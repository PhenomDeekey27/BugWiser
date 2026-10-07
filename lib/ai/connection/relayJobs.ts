// Browser-side execution of one relay job (client-safe).
//
// The worker component (components/relay/LocalRelayWorker.tsx) claims a job
// row and calls THIS module to perform the actual request against the user's
// local endpoint from the user's own machine, then writes the result back.
// Kept free of Supabase/network-of-its-own so specs can drive it with an
// injected fetch (local-relay.spec.ts).
//
// Security invariants:
//   - Only local-network http(s) targets run here (same classification the
//     server uses to decide relaying, plus the local.ts SSRF screens).
//   - Method allowlist matches the server's — no arbitrary verbs relay.
//   - Stale jobs (past expires_at) never execute.
//   - Failure messages are user-facing and actionable: a browser fetch that
//     rejects with TypeError is AMBIGUOUS (server down OR CORS OR mixed
//     content), so the message covers all three with concrete fix steps for
//     common local servers. It never includes headers/keys/bodies.

import { isRelayableTarget } from './relayTarget';
import { blockedLocalTargetReason } from './local';

/** Hard cap for the worker's own fetch — slightly beyond the server's longest wait budget (generation). */
export const RELAY_JOB_FETCH_TIMEOUT_MS = 260_000;

const RELAY_ALLOWED_METHODS = new Set(['GET', 'POST', 'HEAD']);

export interface RelayJobRecord {
  id: string;
  method: string;
  url: string;
  headers: Record<string, string> | null;
  body: string | null;
  expires_at: string;
}

export type RelayJobOutcome =
  | { ok: true; status: number; headers: Record<string, string>; body: string }
  | { ok: false; error: string };

// Headers the BROWSER must set itself when it performs the fetch.
const BROWSER_CONTROLLED_REQUEST_HEADERS = new Set([
  'host',
  'content-length',
  'origin',
  'referer',
  'connection',
]);

function plainHttpNonLoopback(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:') return false;
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return !(host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host.startsWith('127.'));
  } catch {
    return false;
  }
}

/**
 * Actionable failure text for an opaque browser fetch rejection. A refused
 * connection, a CORS block, and a mixed-content block all surface as the same
 * "Failed to fetch" TypeError, so the message addresses every possibility
 * with the concrete fix for popular local servers.
 */
export function relayReachFailureMessage(rawUrl: string): string {
  let host = 'your local endpoint';
  try {
    host = new URL(rawUrl).host;
  } catch {
    // keep the generic default
  }
  const mixedContentNote = plainHttpNonLoopback(rawUrl)
    ? ' Browsers also block plain http requests to non-loopback addresses from an https page — use 127.0.0.1/localhost, or serve the endpoint over https.'
    : '';
  return (
    `Could not reach ${host} from this browser tab — the local server may be ` +
    'down, may refuse this connection, or may not allow this site’s origin ' +
    '(CORS). Allow BugWiser’s origin on your local server (Ollama: ' +
    'OLLAMA_ORIGINS=* then restart; llama.cpp: --cors-origin "*"; LM Studio: ' +
    `enable CORS in server settings) and confirm it is running.${mixedContentNote}`
  );
}

export interface RelayJobDeps {
  /** Injectable for specs; defaults to the tab's global fetch. */
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
  now?: () => number;
}

/**
 * Execute one claimed job: validate (method/target/expiry), perform the
 * fetch with `redirect: 'follow'` (the browser hides Location on manual
 * redirects, so the start + final URL screens are the practical check), and
 * return the recorded status/headers/body — or a sanitized failure.
 */
export async function executeRelayJob(
  job: RelayJobRecord,
  deps: RelayJobDeps = {}
): Promise<RelayJobOutcome> {
  const now = deps.now ?? Date.now;
  const fetchFn = deps.fetchFn ?? globalThis.fetch;

  const method = (job.method ?? 'GET').toUpperCase();
  if (!RELAY_ALLOWED_METHODS.has(method)) {
    return { ok: false, error: `Requests with method ${method} are not relayed.` };
  }

  // Same two screens the server applies before enqueueing — defense in depth
  // (the row could outlive a config change, or a hand-crafted row exists).
  const targetReason = !isRelayableTarget(job.url)
    ? 'Only local-network endpoints can be relayed.'
    : blockedLocalTargetReason(job.url);
  if (targetReason) return { ok: false, error: targetReason };

  const expiresAt = Date.parse(job.expires_at);
  if (Number.isFinite(expiresAt) && now() >= expiresAt) {
    return { ok: false, error: 'This relay job expired before it could run.' };
  }

  if (typeof fetchFn !== 'function') {
    return { ok: false, error: 'This browser tab has no HTTP client available.' };
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(job.headers ?? {})) {
    if (BROWSER_CONTROLLED_REQUEST_HEADERS.has(name.toLowerCase())) continue;
    if (typeof value === 'string') headers[name] = value;
  }

  const init: RequestInit = {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : job.body ?? undefined,
    redirect: 'follow',
  };
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    init.signal = AbortSignal.timeout(RELAY_JOB_FETCH_TIMEOUT_MS);
  }

  try {
    const response = await fetchFn(job.url, init);
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, name) => {
      responseHeaders[name] = value;
    });
    // `text()` yields DECOMPRESSED bytes; the server strips content-encoding/
    // content-length when it rebuilds the Response so they cannot disagree.
    const body = await response.text();
    return { ok: true, status: response.status, headers: responseHeaders, body };
  } catch {
    return { ok: false, error: relayReachFailureMessage(job.url) };
  }
}
