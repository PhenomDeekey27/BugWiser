// Browser relay for local-model endpoints.
//
// WHY: a deployed server (Vercel) cannot reach 127.0.0.1 / private addresses on
// the user's machine. The relay flips the direction — the server enqueues an
// HTTP job in `local_relay_jobs` (migration 017), the user's open browser tab
// (components/relay/LocalRelayWorker.tsx) executes it against the local
// endpoint from the user's OWN machine, and this module polls the row and
// replays a real `Response` to its own caller.
//
// SCOPE (decided in relayTarget.ts): only local-network http(s) targets relay,
// only in mode 'always' or 'auto' when deployed. Public/tunnel URLs are fetched
// directly. `LOCAL_ENDPOINT_RELAY=never` forces direct everywhere.
//
// WHAT THE RELAY IS NOT: it does not bypass CORS — the worker's fetch runs at
// the app origin, so a local server that refuses this origin fails with the
// worker's actionable guidance (never silently). It also cannot re-screen
// redirect hops (browsers hide Location on manual redirects), so the worker
// validates the start AND final URL instead; only local-network hosts relay.
//
// CREDENTIALS: the optional local API key travels in the job row's headers ONLY
// while the job is in flight — the worker clears headers/body on completion,
// and this module discards the row as soon as it has read the response (or
// given up), so request payloads do not rest in the table.
//
// Everything time/transport shaped is injectable for specs (local-relay.spec.ts).

import type { FetchLike, TestConnectionDeps } from './testConnection';
import { blockedLocalTargetReason } from './local';
import {
  isRelayableTarget,
  relayModeFromEnv,
  shouldRelay,
  type RelayMode,
} from './relayTarget';
import { createBackgroundClient } from '@/lib/supabase/background';

// ── Timing ──

/** Relay wait budget for a connection probe (fires before the probe's own 15s AbortSignal so callers see the richer RelayError message). */
export const RELAY_PROBE_FETCH_TIMEOUT_MS = 14_000;
/** Probe `timeoutMs` bump when relaying (direct probes keep the 5s default). */
export const RELAY_PROBE_TIMEOUT_MS = 15_000;
/** Relay wait budget for a chat-completions generation (local models can be slow). */
export const RELAY_GENERATION_TIMEOUT_MS = 240_000;
/** Relay wait budget for a provider health check. */
export const RELAY_HEALTH_TIMEOUT_MS = 15_000;

/** Row expiry slack past our own deadline, so the row outlives the poller. */
const RELAY_JOB_SLACK_MS = 30_000;
const RELAY_POLL_BASE_MS = 250;
const RELAY_POLL_GROWTH = 1.4;
const RELAY_POLL_MAX_MS = 1_000;
const RELAY_ALLOWED_METHODS = new Set(['GET', 'POST', 'HEAD']);

// ── Transport contract ──

export interface RelayEnqueueInput {
  userId: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | null;
  /** ISO timestamp; the row expires (and stops being claimed) after this. */
  expiresAt: string;
}

export interface RelayJobRow {
  id: string;
  status: 'pending' | 'claimed' | 'done' | 'error';
  response_status: number | null;
  response_headers: Record<string, string> | null;
  response_body: string | null;
  error: string | null;
  expires_at: string;
}

/**
 * Storage boundary for relay jobs. The default implementation writes through
 * the Supabase service role (server-only); specs inject an in-memory fake.
 */
export interface RelayTransport {
  enqueue(input: RelayEnqueueInput): Promise<{ id: string }>;
  read(id: string): Promise<RelayJobRow | null>;
  /** Best-effort row removal (give-up paths, successful completion). */
  discard(id: string): Promise<void>;
}

// ── Errors ──

export type RelayErrorKind =
  | 'enqueue' // could not queue the job (DB/transport failure)
  | 'expired' // row expired/deleted before an answer was written
  | 'failed' // worker executed it and reported a sanitized error
  | 'timeout' // our own poll deadline elapsed
  | 'aborted' // caller's AbortSignal fired
  | 'unsupported'; // method/body/target that cannot be relayed

export class RelayError extends Error {
  readonly kind: RelayErrorKind;
  constructor(kind: RelayErrorKind, message: string) {
    super(message);
    this.name = 'RelayError';
    this.kind = kind;
  }
}

/**
 * Duck-typed check (name only) so callers — including testConnection.ts — can
 * recognize relay failures WITHOUT importing this module (no import cycle,
 * no server-only supabase code pulled into the probe's dependency graph).
 */
export function isRelayError(err: unknown): err is RelayError {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: unknown }).name === 'RelayError'
  );
}

// ── Small helpers ──

function abortError(): Error {
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  return err;
}

function throwIfAborted(signal: AbortSignal | null | undefined): void {
  if (signal?.aborted) throw abortError();
}

/** Reject with AbortError as soon as `signal` fires (the promise still settles on its own — its result is ignored). */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll backoff: 250ms → ~1s (1.4^n growth, capped), so a fast answer returns in one round-trip. */
function pollDelay(attempt: number): number {
  return Math.min(RELAY_POLL_MAX_MS, Math.round(RELAY_POLL_BASE_MS * RELAY_POLL_GROWTH ** attempt));
}

/** Normalize any RequestInit headers shape into a plain record for the job row. */
function headersToRecord(headers: RequestInit['headers']): Record<string, string> {
  if (!headers) return {};
  if (Array.isArray(headers)) return Object.fromEntries(headers as [string, string][]);
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  return { ...headers };
}

// Headers the BROWSER must control itself when the worker runs the fetch —
// forwarding the server's copy would send a bogus Origin/Cookie or a stale
// Content-Length.
const BROWSER_CONTROLLED_REQUEST_HEADERS = new Set([
  'host',
  'cookie',
  'connection',
  'origin',
  'referer',
  'content-length',
]);

// Headers that must not survive response reconstruction: the worker's
// `response.text()` is already DECOMPRESSED, so a copied content-encoding/
// content-length would make Next.js serve a body that no longer matches.
const STRIPPED_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'set-cookie',
  'connection',
]);

// ── Response reconstruction ──

/**
 * Replay the worker's recorded answer as a real Response. Guards:
 *  - status must be a Response-legal code (200–599), else 502;
 *  - 204/205/304 are null-body statuses — a body would throw a TypeError;
 *  - hop-by-hop/decoding headers are dropped (see STRIPPED_RESPONSE_HEADERS).
 */
function rowToResponse(row: RelayJobRow): Response {
  const raw = row.response_status;
  const status = typeof raw === 'number' && raw >= 200 && raw <= 599 ? raw : 502;
  const nullBody = status === 204 || status === 205 || status === 304;
  const headers = new Headers();
  for (const [name, value] of Object.entries(row.response_headers ?? {})) {
    const key = name.toLowerCase();
    if (STRIPPED_RESPONSE_HEADERS.has(key)) continue;
    if (typeof value === 'string') headers.append(name, value);
  }
  const body = nullBody ? null : (row.response_body ?? '');
  return new Response(body, { status, headers });
}

// ── Default transport (server, service role) ──

let defaultTransport: RelayTransport | null = null;

function getDefaultTransport(): RelayTransport {
  if (!defaultTransport) defaultTransport = createSupabaseRelayTransport();
  return defaultTransport;
}

/**
 * Supabase-backed transport. INSERT runs with the service role (browser RLS
 * has no INSERT policy on purpose); reads/discards also use the service role
 * because the poller runs on the server, never in the browser.
 */
function createSupabaseRelayTransport(): RelayTransport {
  const client = () => createBackgroundClient(); // lazy: env may not be read until first use

  return {
    async enqueue(input) {
      const { data, error } = await client()
        .from('local_relay_jobs')
        .insert({
          user_id: input.userId,
          method: input.method,
          url: input.url,
          headers: input.headers,
          body: input.body ?? null,
          expires_at: input.expiresAt,
        })
        .select('id')
        .single();
      if (error || !data?.id) {
        console.warn('[relay] enqueue failed:', error?.message ?? 'no row returned');
        throw new RelayError(
          'enqueue',
          'Could not queue a browser-relay job — please try again in a moment.'
        );
      }
      return { id: data.id as string };
    },

    async read(id) {
      const { data, error } = await client()
        .from('local_relay_jobs')
        .select('id, status, response_status, response_headers, response_body, error, expires_at')
        .eq('id', id)
        .maybeSingle();
      if (error) {
        console.warn('[relay] read failed:', error.message);
        throw new RelayError('expired', 'Lost track of the relay job — please try again.');
      }
      return (data as RelayJobRow | null) ?? null;
    },

    async discard(id) {
      const { error } = await client().from('local_relay_jobs').delete().eq('id', id);
      if (error) console.warn('[relay] discard failed:', error.message);
    },
  };
}

// ── The relay fetch ──

export interface RelayFetchRequest {
  userId: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
  /** Total poll budget. The row expires RELAY_JOB_SLACK_MS after this. */
  timeoutMs: number;
  signal?: AbortSignal | null;
}

export interface RelayFetchDeps {
  /** Defaults to the Supabase service-role transport. */
  transport?: RelayTransport;
  /** Injectable clocks/timers for specs. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

function relayTimeoutMessage(timeoutMs: number): string {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000));
  return (
    `The local endpoint did not answer within ${seconds}s. Keep a BugWiser tab ` +
    'open in this browser — BugWiser reaches your local model server through ' +
    'that tab — and make sure the server is running.'
  );
}

function relayExpiredMessage(): string {
  return (
    'The relay job expired before an open BugWiser tab could run it. Keep a ' +
    'BugWiser tab open in this browser and try again.'
  );
}

/**
 * Enqueue `req` as a job, poll until the worker writes the answer, then replay
 * it as a real Response. Throws RelayError on every failure mode and aborts on
 * `req.signal`. The row is discarded on ALL exits (success and failure) so job
 * payloads never outlive the call.
 */
export async function relayFetch(
  req: RelayFetchRequest,
  deps: RelayFetchDeps = {}
): Promise<Response> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const transport = deps.transport ?? getDefaultTransport();
  const signal = req.signal;

  const method = (req.method ?? 'GET').toUpperCase();
  if (!RELAY_ALLOWED_METHODS.has(method)) {
    throw new RelayError('unsupported', `Requests with method ${method} cannot be relayed.`);
  }
  if (req.body !== null && req.body !== undefined && typeof req.body !== 'string') {
    throw new RelayError('unsupported', 'Relayed requests must use a plain-text body.');
  }

  // Defense in depth: only local-network http(s) targets relay, and the
  // link-local/credential/scheme screens from local.ts apply too.
  const targetBlocked = !isRelayableTarget(req.url) ? 'Only local-network endpoints are relayed.'
    : blockedLocalTargetReason(req.url);
  if (targetBlocked) throw new RelayError('unsupported', targetBlocked);

  throwIfAborted(signal);

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers ?? {})) {
    if (!BROWSER_CONTROLLED_REQUEST_HEADERS.has(name.toLowerCase())) headers[name] = value;
  }

  throwIfAborted(signal);
  const enqueued = await raceAbort(
    transport.enqueue({
      userId: req.userId,
      method,
      url: req.url,
      headers,
      body: req.body ?? null,
      expiresAt: new Date(now() + req.timeoutMs + RELAY_JOB_SLACK_MS).toISOString(),
    }),
    signal
  );
  const jobId = enqueued.id;
  const deadline = now() + req.timeoutMs;

  try {
    let attempt = 0;
    for (;;) {
      throwIfAborted(signal);
      const remaining = deadline - now();
      if (remaining <= 0) throw new RelayError('timeout', relayTimeoutMessage(req.timeoutMs));

      const row = await raceAbort(transport.read(jobId), signal);
      if (!row) throw new RelayError('expired', relayExpiredMessage());
      if (row.status === 'done') {
        const response = rowToResponse(row);
        await transport.discard(jobId).catch(() => undefined);
        return response;
      }
      if (row.status === 'error') {
        throw new RelayError('failed', row.error || 'The browser relay failed to reach the endpoint.');
      }
      if (Date.parse(row.expires_at) <= now()) throw new RelayError('expired', relayExpiredMessage());

      const delay = Math.min(pollDelay(attempt++), remaining);
      await raceAbort(sleep(delay), signal);
    }
  } catch (err) {
    // Any failure here leaves a (possibly claimable) row behind — remove it so
    // a worker tab cannot execute a job nobody is waiting for any more.
    await transport.discard(jobId).catch(() => undefined);
    throw err;
  }
}

// ── Public assembly ──

export interface RelayEnabledEnv {
  /** Defaults to deployed = !!process.env.VERCEL (Vercel sets it). */
  deployed?: boolean;
  /** Defaults to relayModeFromEnv(process.env.LOCAL_ENDPOINT_RELAY). */
  mode?: RelayMode;
}

/** Should `rawUrl` be relayed under the current deployment/env? */
export function relayEnabledFor(rawUrl: string, env: RelayEnabledEnv = {}): boolean {
  const deployed = env.deployed ?? !!process.env.VERCEL;
  const mode = env.mode ?? relayModeFromEnv(process.env.LOCAL_ENDPOINT_RELAY);
  return shouldRelay(rawUrl, { deployed, mode });
}

export type RelayFetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface RelayAwareFetchOptions extends RelayFetchDeps {
  /**
   * Relay poll budget (default RELAY_GENERATION_TIMEOUT_MS). DIRECT calls are
   * never wrapped in a timeout — existing provider behavior is preserved.
   */
  timeoutMs?: number;
  deployed?: boolean;
  mode?: RelayMode;
  /** Direct-path fetch (default: globalThis.fetch looked up per call so specs can mock it). */
  fetchFn?: FetchLike;
}

/**
 * A fetch bound to one user: local-network URLs go through the browser relay
 * (when the mode/deployment calls for it), everything else takes the direct
 * path untouched. Callers pass this anywhere they would pass `fetch`.
 *
 * No userId ⇒ always direct (local dev servers, scripts, and spec-injected
 * fetches keep working unchanged; the deployed, authenticated flows always
 * have a userId).
 */
export function createRelayAwareFetch(
  userId: string | null | undefined,
  opts: RelayAwareFetchOptions = {}
): RelayFetchFn {
  const timeoutMs = opts.timeoutMs ?? RELAY_GENERATION_TIMEOUT_MS;
  const deployed = opts.deployed ?? !!process.env.VERCEL;
  const mode = opts.mode ?? relayModeFromEnv(process.env.LOCAL_ENDPOINT_RELAY);

  return async (url, init = {}) => {
    if (userId && shouldRelay(url, { deployed, mode })) {
      const { body } = init;
      if (body !== null && body !== undefined && typeof body !== 'string') {
        throw new RelayError('unsupported', 'Relayed requests must use a plain-text body.');
      }
      return relayFetch(
        {
          userId,
          url,
          method: init.method,
          headers: headersToRecord(init.headers),
          body: typeof body === 'string' ? body : null,
          timeoutMs,
          signal: init.signal,
        },
        opts
      );
    }
    const direct = opts.fetchFn ?? (globalThis.fetch as FetchLike | undefined);
    if (!direct) throw new Error('No HTTP client is available.');
    return (direct as unknown as RelayFetchFn)(url, init);
  };
}

/**
 * TestConnectionDeps for a probe against `baseUrl`: relay-aware fetch + the
 * longer probe budget ONLY when this URL will actually relay; otherwise `{}` —
 * the plain server-side probe with its 5s default (direct behavior unchanged).
 * Routes pass the result straight into testLocalConnection/registerLocal.
 */
export function relayProbeDeps(userId: string, baseUrl: string): TestConnectionDeps {
  if (!userId || !relayEnabledFor(baseUrl.trim())) return {};
  return {
    fetchFn: createRelayAwareFetch(userId, { timeoutMs: RELAY_PROBE_FETCH_TIMEOUT_MS }),
    timeoutMs: RELAY_PROBE_TIMEOUT_MS,
  };
}
