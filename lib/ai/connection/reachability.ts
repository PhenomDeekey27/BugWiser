// Browser-side reachability diagnosis for local endpoints.
//
// A failed CORS-mode fetch is AMBIGUOUS — server down, CORS refusal, and a
// browser local-network/mixed-content block all reject with the same opaque
// TypeError. A follow-up `mode: 'no-cors'` probe disambiguates: an opaque
// response needs no cooperation from the server, so it RESOLVES whenever the
// network path works and fails only when the request never left the browser.
// Called only after a CORS-mode failure, a resolve therefore means "the
// server is up and refused us on origin policy (CORS)".

export type ReachabilityVerdict = 'reachable-blocked' | 'unreachable' | 'unknown';

const DIAGNOSE_TIMEOUT_MS = 3_000;

/**
 * No-cors follow-up probe. Resolves → the address is up but blocking this
 * site's origin (CORS). Rejects with an abort/timeout → verdict 'unknown'
 * (slow server, inconclusive). Any other rejection → unreachable.
 */
export async function diagnoseFetchFailure(
  url: string,
  fetchFn: (url: string, init?: RequestInit) => Promise<unknown>,
  timeoutMs = DIAGNOSE_TIMEOUT_MS
): Promise<ReachabilityVerdict> {
  try {
    const init: RequestInit = {};
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      init.signal = AbortSignal.timeout(timeoutMs);
    }
    await fetchFn(url, { ...init, mode: 'no-cors' });
    return 'reachable-blocked';
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') return 'unknown';
    return 'unreachable';
  }
}

/**
 * CORS setting guidance per server family, keyed by the Base URL's port.
 * Always safe to include in a failure message.
 */
export function serverCorsHint(rawUrl: string): string {
  let port = '';
  try {
    const url = new URL(rawUrl);
    port = url.port || (url.protocol === 'https:' ? '443' : '80');
  } catch {
    port = '';
  }
  switch (port) {
    case '11434':
      return 'Ollama: set OLLAMA_ORIGINS=* and restart it';
    case '1234':
      return 'LM Studio: enable CORS in the server settings';
    case '8080':
    case '8000':
    case '5000':
    case '8888':
      return 'llama.cpp: start the server with --cors-origin "*"; FastAPI/vLLM-style servers: allow_origins=["*"]';
    default:
      return 'most local LLM servers have a CORS / allowed-origins setting for this';
  }
}

/**
 * The app origin to name in CORS guidance. Guarded so it is safe in server
 * contexts and specs (falls back to a phrase that still reads correctly).
 */
export function appOrigin(): string {
  try {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return window.location.origin;
    }
  } catch {
    // fall through
  }
  return 'this site';
}
