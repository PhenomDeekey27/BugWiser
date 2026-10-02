// Task I — Local OpenAI-compatible provider foundation.
//
// Represents a user-configured, GENERIC OpenAI-compatible endpoint (any server
// that implements the OpenAI `/models` + `/chat/completions` conventions — no
// specific local server software is assumed or named). This module owns:
//
//   1. The provider identity (`local`) required by the provider system.
//   2. The connection config shape (Base URL + OPTIONAL API key).
//   3. Safe Base URL normalization/validation.
//   4. SSRF target screening for server-side connection tests.
//
// This batch (Tasks K/L — implemented):
//   - persistence / registration (registerLocal.ts + saveLocalUserConnection:
//     a URL alone never marks a provider connected — registration runs only
//     after a SUCCESSFUL test, through the existing provider_connections
//     architecture; see also migration 015)
//   - catalog / discovery (PROVIDER_FETCHERS.local reuses the Task J probe,
//     PROVIDER_DEFINITIONS gains the local entry)
//
// Deliberately NOT in this batch (see think/state.md): model routing /
// fallback changes — local models are visible/selectable but not yet routable.
//
// Security notes:
//   - API keys are OPTIONAL (many local servers need no auth) and are NEVER
//     logged or embedded in any result structure produced here.
//   - URLs with embedded credentials (user:pass@) are rejected so a key can
//     never hide in a URL string.

export const LOCAL_PROVIDER_ID = 'local';

export type LocalProviderId = typeof LOCAL_PROVIDER_ID;

/**
 * Connection config for a local OpenAI-compatible endpoint.
 * Follows the existing provider connection shape (provider + credential),
 * with the credential optional and a Base URL required instead.
 */
export interface LocalProviderConfig {
  provider: LocalProviderId;
  /** Normalized API root, e.g. `http://127.0.0.1:8000/v1` (no trailing slash). */
  baseUrl: string;
  /** Optional — many local servers require no authentication. */
  apiKey?: string;
}

export type LocalUrlResult =
  | { ok: true; baseUrl: string }
  | { ok: false; error: string };

/** Version-segment check, e.g. `v1`, `v2` (existing providers mount under `/v1`). */
const VERSION_SEGMENT = /^v\d+$/;

function stripTrailingSlashes(pathname: string): string {
  return pathname.replace(/\/+$/, '');
}

/**
 * Normalize + validate a user-supplied local provider Base URL.
 *
 * Rules:
 *   - trims surrounding whitespace
 *   - must parse as an absolute URL (rejects clearly invalid values)
 *   - scheme must be http: or https: (everything else — ftp:, file:,
 *     javascript:, data:, … — is rejected)
 *   - rejects URLs with embedded credentials (user:pass@host) so secrets
 *     never live in a URL string
 *   - drops query strings and fragments (a Base URL never has them)
 *   - strips trailing slashes so `${baseUrl}/models` never yields `//models`
 *   - strips a pasted `/models` endpoint suffix (`…/v1/models` → `…/v1`)
 *   - preserves any non-root path the user typed (no silent `/v1` guessing);
 *     endpoint probing decides between `/models` and `/v1/models`
 */
export function normalizeLocalBaseUrl(rawInput: string): LocalUrlResult {
  const raw = (rawInput ?? '').trim();
  if (raw.length === 0) {
    return { ok: false, error: 'Base URL is required.' };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return {
      ok: false,
      error: 'Invalid base URL — expected a full URL such as http://127.0.0.1:8000/v1.',
    };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      ok: false,
      error: `Invalid URL scheme "${url.protocol.replace(':', '')}" — only http and https are supported.`,
    };
  }

  if (url.username || url.password) {
    return {
      ok: false,
      error: 'Base URL must not contain embedded credentials — use the optional API key field.',
    };
  }

  // A Base URL never needs a query string or fragment; drop them so they can
  // not leak into constructed API paths.
  url.search = '';
  url.hash = '';

  let path = stripTrailingSlashes(url.pathname);

  // Endpoint-paste protection: `…/v1/models` → `…/v1`.
  if (path === '/models' || path.endsWith('/models')) {
    path = stripTrailingSlashes(path.slice(0, -'/models'.length));
  }

  url.pathname = path === '' ? '/' : path;

  // URL.toString() appends a trailing slash for a bare origin; keep the
  // canonical no-trailing-slash form used by every existing provider baseUrl.
  const normalized = url.toString().replace(/\/$/, '');
  return { ok: true, baseUrl: normalized };
}

/**
 * Build the connection config from user input. Identity + normalized Base URL
 * + optional key. Callers MUST NOT treat a produced config as "connected" —
 * connection status changes only through the existing connection architecture
 * after a successful connection test.
 */
export function buildLocalProviderConfig(input: {
  baseUrl: string;
  apiKey?: string;
}): LocalUrlResult & { config?: LocalProviderConfig } {
  const normalized = normalizeLocalBaseUrl(input.baseUrl);
  if (!normalized.ok) return normalized;

  const apiKey = (input.apiKey ?? '').trim();
  const config: LocalProviderConfig = {
    provider: LOCAL_PROVIDER_ID,
    baseUrl: normalized.baseUrl,
    ...(apiKey ? { apiKey } : {}),
  };
  return { ok: true, baseUrl: normalized.baseUrl, config };
}

/** True when the base URL's last path segment is already a version (…/v1). */
export function hasVersionSegment(baseUrl: string): boolean {
  try {
    const path = stripTrailingSlashes(new URL(baseUrl).pathname);
    if (path === '' || path === '/') return false;
    const last = path.split('/').pop() ?? '';
    return VERSION_SEGMENT.test(last);
  } catch {
    return false;
  }
}

// ── SSRF target screening ──
//
// The feature is explicitly about reaching user-chosen local/LAN endpoints,
// so loopback and private ranges are ALLOWED. What is screened out is the
// "obvious" SSRF abuse: link-local cloud-metadata addresses and non-HTTP
// schemes. Residual risks (DNS rebinding, redirects) are handled where the
// request is made (redirects are re-validated per hop) and documented in
// think/state.md.

const BLOCKED_HOSTNAMES = new Set(['metadata.google.internal', 'metadata.goog']);

function hostnameOf(url: URL): string {
  // URL.hostname keeps IPv6 brackets (e.g. `[::1]`).
  return url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

function isIpv4Literal(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function isBlockedIpv4(host: string): boolean {
  if (!isIpv4Literal(host)) return false;
  const octets = host.split('.').map((o) => Number(o));
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return false;
  const [a, b] = octets;
  // 169.254.0.0/16 — link-local incl. cloud metadata (169.254.169.254).
  // The URL parser canonicalizes alternate IPv4 notations (decimal/octal/
  // hex), so literal-form bypasses land here too.
  return a === 169 && b === 254;
}

function isBlockedIpv6(host: string): boolean {
  const lower = host.toLowerCase();
  // fe80::/10 link-local (IPv6 metadata endpoints).
  return lower.startsWith('fe80:');
}

/**
 * Screen a NORMALIZED base URL for obviously unsafe server-side fetch targets.
 * Returns null when allowed, otherwise a human-readable reason.
 */
export function blockedLocalTargetReason(baseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return 'Invalid base URL.';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'Only http and https targets are allowed.';
  }
  const host = hostnameOf(url);
  if (BLOCKED_HOSTNAMES.has(host)) {
    return 'That address is not allowed.';
  }
  if (isBlockedIpv4(host) || isBlockedIpv6(host)) {
    return 'Link-local addresses are not allowed.';
  }
  return null;
}
