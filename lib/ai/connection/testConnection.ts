// Task J — Server-side "Test Connection" for a local OpenAI-compatible endpoint.
//
// Contract: the client submits a Base URL + optional API key; the server
// verifies the endpoint behaves like an OpenAI-compatible LLM API and returns
// a STRUCTURED result. This module NEVER persists or registers anything —
// "test connection" and "register provider" are separate concepts (failed
// tests cannot create an active provider; registration in
// connection/registerLocal.ts consumes a successful result and is gated on it).
//
// Verification strategy (mirrors the existing provider healthCheck pattern —
// GET `${baseUrl}/models`, e.g. providers/openai/client.ts healthCheck):
//   1. GET `<base>/models`; when that 404s and the base URL has no version
//      segment, also try `<base>/v1/models` (OpenAI-compatible convention).
//   2. A 200 alone is NOT enough: the body must parse as an OpenAI models
//      list (bare array or `{ data: [...] }` with extractable `id`s).
//   3. No generation request is sent — the existing architecture only ever
//      requires the lightweight models listing for compatibility checks.
//
// Security:
//   - The API key is optional, sent ONLY as an Authorization header to the
//     validated target, and is never included in any result or message.
//   - Response bodies are never echoed — only extracted model IDs or generic
//     human-readable errors (status codes, timeout, reachability).
//   - Target URLs are screened for obvious SSRF (blockedLocalTargetReason);
//     redirects are re-validated per hop.
//   - A short timeout keeps a dead local server from hanging the request.

import {
  LOCAL_PROVIDER_ID,
  normalizeLocalBaseUrl,
  blockedLocalTargetReason,
  hasVersionSegment,
} from './local';

export type LocalCompatibility = 'openai-compatible' | 'not-compatible' | 'unverified';

export interface LocalConnectionTestResult {
  success: boolean;
  providerType: typeof LOCAL_PROVIDER_ID;
  /** Normalized base URL; '' when the input could not be normalized. */
  baseUrl: string;
  /** The models endpoint that was verified, when one was reached. */
  modelsEndpoint: string | null;
  /** Discovered model IDs (present only for a verified compatible endpoint). */
  modelIds: string[];
  compatibility: LocalCompatibility;
  /** Human-readable failure reason; null on success. Never contains secrets. */
  error: string | null;
}

interface ResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<ResponseLike>;

export interface TestConnectionDeps {
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: FetchLike;
  /** Short by default so a dead local server cannot hang the request. */
  timeoutMs?: number;
}

/**
 * Result of the shared models-endpoint probe (the SINGLE HTTP security layer
 * for local endpoints — used by both the connection test and catalog
 * discovery). Never contains API keys, Authorization headers, or raw response
 * bodies; `entries` holds only the parsed list entries of a verified response.
 */
export interface LocalModelsProbe {
  ok: boolean;
  /** Normalized base URL; '' when the input could not be normalized. */
  baseUrl: string;
  /** The models endpoint that was verified, when one was reached. */
  modelsEndpoint: string | null;
  /** Parsed list entries (present only for a verified compatible endpoint). */
  entries: unknown[];
  /** Extracted model IDs (present only for a verified compatible endpoint). */
  modelIds: string[];
  compatibility: LocalCompatibility;
  /** Human-readable failure reason; null on success. Never contains secrets. */
  error: string | null;
  /**
   * Set only on a transport-level failure (every candidate URL of the base
   * AND its host alias refused/unreachable) — lets the browser-side detect
   * run a no-cors reachability diagnosis instead of guessing.
   */
  networkFailure?: boolean;
}

export const DEFAULT_TEST_TIMEOUT_MS = 5_000;
const MAX_REDIRECT_HOPS = 3;

const TIMEOUT = Symbol('local-connection-test-timeout');

type TransportOutcome =
  | { kind: 'response'; response: ResponseLike }
  | { kind: 'timeout'; url: string }
  | { kind: 'network'; url: string }
  // Browser-relay failure (lib/ai/connection/relay.ts): the message is already
  // user-facing and sanitized (CORS/keep-a-tab-open guidance, no secrets), so
  // it is surfaced verbatim instead of the generic network wording.
  | { kind: 'relay-error'; message: string }
  | { kind: 'blocked-redirect'; reason: string }
  | { kind: 'too-many-redirects' };

function fail(
  baseUrl: string,
  compatibility: LocalCompatibility,
  error: string,
  modelsEndpoint: string | null = null
): LocalModelsProbe {
  return {
    ok: false,
    baseUrl,
    modelsEndpoint,
    entries: [],
    modelIds: [],
    compatibility,
    error,
  };
}

async function requestWithTimeout(
  fetchFn: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<TransportOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    // Ref'd on purpose: this timer is the safety net that guarantees the test
    // settles even when the request hangs (it is cleared in `finally`).
    timer = setTimeout(() => reject(TIMEOUT), timeoutMs);
  });
  try {
    const initWithSignal: RequestInit = { ...init };
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      initWithSignal.signal = AbortSignal.timeout(timeoutMs);
    }
    const response = await Promise.race([fetchFn(url, initWithSignal), timeoutPromise]);
    return { kind: 'response', response };
  } catch (err) {
    if (err === TIMEOUT) return { kind: 'timeout', url };
    const name = (err as { name?: string } | null)?.name;
    // Relay failures are recognized by NAME ONLY (duck-typed on purpose): this
    // module must not import relay.ts — that would pull the server-only job
    // transport into every probe consumer. See relay.ts isRelayError.
    if (name === 'RelayError') {
      const message = (err as { message?: unknown }).message;
      return {
        kind: 'relay-error',
        message:
          typeof message === 'string' && message.length > 0
            ? message
            : 'The browser relay failed to reach the endpoint.',
      };
    }
    if (name === 'TimeoutError' || name === 'AbortError') return { kind: 'timeout', url };
    return { kind: 'network', url };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Fetch with redirect following done MANUALLY so every hop is re-screened
 * against the SSRF target rules (a redirect must not smuggle the request to a
 * blocked address).
 */
async function safeFetch(
  fetchFn: FetchLike,
  startUrl: string,
  init: RequestInit,
  timeoutMs: number
): Promise<TransportOutcome> {
  let currentUrl = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    const outcome = await requestWithTimeout(fetchFn, currentUrl, { ...init, redirect: 'manual' }, timeoutMs);
    if (outcome.kind !== 'response') return outcome;

    const { response } = outcome;
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return { kind: 'response', response };
      let nextUrl: string;
      try {
        nextUrl = new URL(location, currentUrl).toString();
      } catch {
        return { kind: 'network', url: currentUrl };
      }
      const blocked = blockedLocalTargetReason(nextUrl);
      if (blocked) return { kind: 'blocked-redirect', reason: blocked };
      currentUrl = nextUrl;
      continue;
    }
    return { kind: 'response', response };
  }
  return { kind: 'too-many-redirects' };
}

function extractModelIds(list: unknown[]): string[] {
  const ids: string[] = [];
  for (const entry of list) {
    if (typeof entry === 'string') {
      if (entry.trim()) ids.push(entry);
    } else if (entry && typeof entry === 'object') {
      const id = (entry as { id?: unknown }).id;
      if (typeof id === 'string' && id.trim()) ids.push(id);
    }
  }
  return ids;
}

function extractModelList(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed; // bare-array form (existing fetchChutes accepts it)
  if (parsed && typeof parsed === 'object') {
    const data = (parsed as { data?: unknown }).data;
    if (Array.isArray(data)) return data; // OpenAI `{ object: 'list', data: [...] }`
  }
  return null;
}

/**
 * Candidate models-endpoint URLs for ONE base URL, plus the conventional
 * OpenAI root fallback (set only when it is an EXTRA candidate — bare-origin
 * bases already probe `/v1/models` as their second candidate).
 */
function candidatesFor(baseUrl: string): { urls: string[]; originFallback: string | null } {
  const urls: string[] = [];
  const add = (url: string) => {
    if (!urls.includes(url)) urls.push(url);
  };
  add(`${baseUrl}/models`);
  if (!hasVersionSegment(baseUrl)) add(`${baseUrl}/v1/models`);

  let originFallback: string | null = null;
  try {
    const url = new URL(baseUrl);
    if (url.pathname.replace(/\/+$/, '') !== '') {
      const candidate = `${url.origin}/v1/models`;
      if (!urls.includes(candidate)) {
        urls.push(candidate);
        originFallback = candidate;
      }
    }
  } catch {
    // normalizeLocalBaseUrl already validated this URL.
  }
  return { urls, originFallback };
}

/**
 * Host-alias base URL for a transport failure: a server often binds one of
 * `localhost`/`127.0.0.1` (IPv4 vs IPv6) while the OTHER name refuses the
 * connection. Returns the alias base, or null when no alias applies.
 */
function hostAliasBase(baseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  const bare = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  let aliasHost: string | null = null;
  if (bare === 'localhost') aliasHost = '127.0.0.1';
  else if (bare === '127.0.0.1') aliasHost = 'localhost';
  else if (bare === '::1') aliasHost = '127.0.0.1';
  if (!aliasHost) return null;
  try {
    const alias = new URL(url.toString());
    alias.hostname = aliasHost; // sets the hostname, keeps scheme/port/path
    return alias.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

type AttemptResult = { kind: 'probe'; probe: LocalModelsProbe } | { kind: 'network'; url: string };

/**
 * Probe every candidate models-endpoint URL under ONE base URL. Returns the
 * probe result, or `{ kind: 'network' }` when the transport failed for every
 * candidate (only then may the caller retry a host alias — a server that
 * ANSWERED, even with 404s, must never be retried elsewhere: transport
 * failures are the only ambiguous verdict).
 */
async function attemptBase(
  fetchFn: FetchLike,
  baseUrl: string,
  originalBaseUrl: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<AttemptResult> {
  const { urls, originFallback } = candidatesFor(baseUrl);

  for (const candidate of urls) {
    const outcome = await safeFetch(fetchFn, candidate, { method: 'GET', headers }, timeoutMs);

    switch (outcome.kind) {
      case 'network':
        return { kind: 'network', url: outcome.url };
      case 'timeout':
        return {
          kind: 'probe',
          probe: fail(originalBaseUrl, 'unverified', `Connection test timed out after ${timeoutMs}ms reaching ${outcome.url}.`),
        };
      case 'relay-error':
        return { kind: 'probe', probe: fail(originalBaseUrl, 'unverified', outcome.message) };
      case 'blocked-redirect':
        return { kind: 'probe', probe: fail(originalBaseUrl, 'unverified', outcome.reason) };
      case 'too-many-redirects':
        return {
          kind: 'probe',
          probe: fail(originalBaseUrl, 'unverified', `Too many redirects while testing ${candidate}.`),
        };
      case 'response':
        break;
    }

    const response = (outcome as { kind: 'response'; response: ResponseLike }).response;
    const { status } = response;

    if (status === 401 || status === 403) {
      return {
        kind: 'probe',
        probe: fail(
          originalBaseUrl,
          'unverified',
          `Authentication failed (HTTP ${status}) — check the API key for ${candidate}.`,
          candidate
        ),
      };
    }
    if (status === 404) continue; // try the next candidate endpoint
    if (status >= 300 && status < 400) {
      return {
        kind: 'probe',
        probe: fail(originalBaseUrl, 'unverified', `Unexpected redirect (HTTP ${status}) from ${candidate}.`, candidate),
      };
    }
    if (!response.ok) {
      return {
        kind: 'probe',
        probe: fail(originalBaseUrl, 'unverified', `Endpoint responded with HTTP ${status} from ${candidate}.`, candidate),
      };
    }

    // 2xx — a status alone proves nothing; the body must be an OpenAI models list.
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return {
        kind: 'probe',
        probe: fail(
          originalBaseUrl,
          'not-compatible',
          `${candidate} responded but the response is not valid JSON — not an OpenAI-compatible endpoint.`,
          candidate
        ),
      };
    }

    const list = extractModelList(parsed);
    if (!list) {
      return {
        kind: 'probe',
        probe: fail(
          originalBaseUrl,
          'not-compatible',
          `${candidate} responded but did not return an OpenAI-compatible models list.`,
          candidate
        ),
      };
    }

    const modelIds = extractModelIds(list);
    if (list.length === 0) {
      return {
        kind: 'probe',
        probe: fail(
          originalBaseUrl,
          'openai-compatible',
          `${candidate} is OpenAI-compatible but returned an empty model list — no models are available.`,
          candidate
        ),
      };
    }
    if (modelIds.length === 0) {
      return {
        kind: 'probe',
        probe: fail(
          originalBaseUrl,
          'not-compatible',
          `${candidate} returned a models list without any model IDs — malformed response.`,
          candidate
        ),
      };
    }

    // Verified. When the conventional OpenAI root fallback answered, persist
    // THAT root (`…/api` → `…/v1`) — registration must store exactly what was
    // tested; every other candidate keeps the base the user entered.
    const verifiedBaseUrl =
      originFallback && candidate === originFallback ? new URL(originFallback).origin + '/v1' : baseUrl;

    return {
      kind: 'probe',
      probe: {
        ok: true,
        baseUrl: verifiedBaseUrl,
        modelsEndpoint: candidate,
        entries: list,
        modelIds,
        compatibility: 'openai-compatible',
        error: null,
      },
    };
  }

  return {
    kind: 'probe',
    probe: fail(
      originalBaseUrl,
      'not-compatible',
      `No OpenAI-compatible models endpoint found at ${baseUrl} (tried ${urls.join(', ')}).`,
      null
    ),
  };
}

/**
 * Probe a local OpenAI-compatible endpoint's models list. This is the ONE
 * place local-endpoint HTTP happens (connection test AND catalog discovery
 * reuse it), so URL normalization, SSRF screening, manual per-hop redirect
 * validation, timeout handling, and response-shape verification exist once.
 * Performs NO persistence and sends NO generation request.
 *
 * Failure escalation (each step only on the previous step's ambiguity):
 *   1. candidate URLs under the entered base (`/models`, `/v1/models`,
 *      conventional `${origin}/v1/models` for non-root paths)
 *   2. the host-alias base (`localhost` ⇄ `127.0.0.1`, `::1` → `127.0.0.1`)
 *      — ONLY when the transport itself failed (a 404 means the server
 *      answered; never retry a server that answered)
 *   3. a generic unreachable message flagged `networkFailure` so the browser
 *      can run a no-cors reachability diagnosis
 */
export async function probeLocalModelsList(
  input: { baseUrl: string; apiKey?: string },
  deps: TestConnectionDeps = {}
): Promise<LocalModelsProbe> {
  const fetchFn = deps.fetchFn ?? (globalThis.fetch as FetchLike | undefined);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS;

  if (!fetchFn) {
    return fail('', 'unverified', 'No HTTP client is available to run the connection test.');
  }

  const normalized = normalizeLocalBaseUrl(input.baseUrl);
  if (!normalized.ok) {
    return fail('', 'unverified', normalized.error);
  }
  const baseUrl = normalized.baseUrl;

  const blocked = blockedLocalTargetReason(baseUrl);
  if (blocked) {
    return fail(baseUrl, 'unverified', blocked);
  }

  const apiKey = (input.apiKey ?? '').trim();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const alias = hostAliasBase(baseUrl);
  const bases = alias && alias !== baseUrl ? [baseUrl, alias] : [baseUrl];
  let firstNetwork: { kind: 'network'; url: string } | null = null;

  for (const base of bases) {
    const attempt = await attemptBase(fetchFn, base, baseUrl, headers, timeoutMs);
    if (attempt.kind === 'network') {
      firstNetwork = firstNetwork ?? attempt;
      continue;
    }
    return attempt.probe;
  }

  // Every base (original + alias) failed at the transport level.
  const networkUrl = firstNetwork ? firstNetwork.url : `${baseUrl}/models`;
  return {
    ...fail(baseUrl, 'unverified', `Could not reach ${networkUrl} — the server refused the connection or is unreachable.`),
    networkFailure: true,
  };
}

/**
 * Test a local OpenAI-compatible endpoint: the shared probe plus the
 * user-facing result contract (providerType + success flag). Registration is
 * gated on `success === true` — a reachable-but-empty or unverified endpoint
 * can never mark the provider connected.
 */
export async function testLocalConnection(
  input: { baseUrl: string; apiKey?: string },
  deps: TestConnectionDeps = {}
): Promise<LocalConnectionTestResult> {
  const probe = await probeLocalModelsList(input, deps);
  return {
    success: probe.ok,
    providerType: LOCAL_PROVIDER_ID,
    baseUrl: probe.baseUrl,
    modelsEndpoint: probe.modelsEndpoint,
    modelIds: probe.modelIds,
    compatibility: probe.compatibility,
    error: probe.error,
  };
}
