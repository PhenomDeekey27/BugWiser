// Browser-relay target classification.
//
// A deployed server (Vercel) cannot reach 127.0.0.1 on the user's machine, so
// requests to the user's LOCAL/LAN endpoints are relayed through the user's
// open browser tab (lib/ai/connection/relay.ts enqueues; components/relay/
// LocalRelayWorker.tsx executes). This module decides WHICH URLs that applies
// to — deliberately pure (no env reads, no imports) so both the server routes
// and the browser worker can share it without pulling in server-only code.

export type RelayMode = 'auto' | 'always' | 'never';

/** Parse `LOCAL_ENDPOINT_RELAY` (or absent) into a mode. Invalid ⇒ 'auto'. */
export function relayModeFromEnv(value: string | undefined): RelayMode {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'always') return 'always';
  if (v === 'never') return 'never';
  return 'auto';
}

function hostnameOf(url: URL): string {
  // URL.hostname keeps IPv6 brackets (e.g. `[::1]`).
  return url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

function isIpv4(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/**
 * True for hosts only the USER'S OWN MACHINE (or their LAN) can reach —
 * loopback, RFC1918 private ranges, IPv6 loopback/ULA, and `.local` names.
 * Public addresses, link-local (169.254/fe80, screened separately by
 * blockedLocalTargetReason), and unparseable hosts are NOT relay targets:
 * a public URL is reachable by the server directly and needs no relay.
 */
export function isLocalNetworkHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host.length === 0) return false;

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  // IPv6 unique-local fc00::/7.
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;

  if (isIpv4(host)) {
    const octets = host.split('.').map((o) => Number(o));
    if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return false;
    const [a, b] = octets;
    if (a === 127) return true; // loopback 127.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 0 && b === 0 && octets[2] === 0 && octets[3] === 0) return true; // 0.0.0.0 (INADDR_ANY)
    return false;
  }
  return false;
}

/**
 * Address-space declaration a browser needs before it may contact a local
 * target from a public https page (Chrome Local Network Access). Omitting it
 * makes Chrome reject the request before it leaves the browser — which is
 * indistinguishable from "server down" unless the option is set.
 */
export type LocalAddressSpace = 'loopback' | 'local';

function isLoopbackHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (isIpv4(host)) {
    const octets = host.split('.').map((o) => Number(o));
    if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return false;
    // 127.0.0.0/8 and INADDR_ANY are this machine.
    return octets[0] === 127 || (octets[0] === 0 && octets[1] === 0 && octets[2] === 0 && octets[3] === 0);
  }
  return false;
}

/** `loopback` for this machine, `local` for the LAN, null for public targets. */
export function localAddressSpace(rawUrl: string): LocalAddressSpace | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = hostnameOf(url);
  if (isLoopbackHost(host)) return 'loopback';
  if (isLocalNetworkHost(host)) return 'local';
  return null;
}

/**
 * True when the URL is an http(s) address only the user's browser can reach
 * (local network host). This is the precondition for relaying: the server
 * would fail the fetch itself, and only the user's own machine can succeed.
 */
export function isRelayableTarget(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return isLocalNetworkHost(hostnameOf(url));
}

/**
 * Should this URL be fetched through the browser relay?
 *
 *   - mode 'never'  ⇒ always direct (override for testing/forcing server-local).
 *   - mode 'always' ⇒ relay local targets even in local dev (exercises the
 *     relay path when the server COULD reach the endpoint directly).
 *   - mode 'auto'   ⇒ relay local targets only when deployed (process.env.VERCEL),
 *     where the server provably cannot reach loopback/private hosts.
 *
 * Public/tunnel URLs are never relayed: the server can reach them directly.
 */
export function shouldRelay(
  rawUrl: string,
  opts: { deployed: boolean; mode?: RelayMode }
): boolean {
  const mode = opts.mode ?? 'auto';
  if (mode === 'never') return false;
  if (!isRelayableTarget(rawUrl)) return false;
  if (mode === 'always') return true;
  return opts.deployed;
}
