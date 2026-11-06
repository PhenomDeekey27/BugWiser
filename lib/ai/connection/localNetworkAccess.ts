// Chrome Local Network Access (LNA) permission layer (browser-side).
//
// WHY THIS EXISTS: from Chrome 142, EVERY request from a public https page to
// the user's loopback/LAN is gated behind the granular `loopback-network` /
// `local-network` permissions. Declaring `targetAddressSpace` (relayTarget.ts)
// only exempts the request from MIXED CONTENT and states which address space is
// intended — it does NOT grant the permission. Until the site is allowed, the
// browser rejects the fetch before a single byte leaves the tab, with the same
// opaque "Failed to fetch" TypeError a dead server produces. That is why a
// permission block was being reported as "your server is down / CORS".
//
// Two rules from Chrome's LNA adoption guide drive the API below:
//   1. Query the permission FIRST and show remediation when it is `denied`
//      (a denied origin fails forever, silently, until the user re-allows it).
//   2. Trigger the FIRST prompt from a real user gesture. BugWiser reaches the
//      local server through the relay worker's polling loop — seconds after the
//      click — so `primeLocalNetworkAccess` fires one cheap no-cors request
//      straight from the click handler, while the tab still has user
//      activation, which is what makes the prompt appear.
//
// Only the granular permission names are queried: the legacy combined
// `local-network-access` name crashed old Chrome renderers and is never used.

import { localAddressSpace, type LocalAddressSpace } from './relayTarget';
import { appOrigin } from './reachability';

export type LocalNetworkPermissionState = 'granted' | 'prompt' | 'denied' | 'unsupported';

const PERMISSION_NAMES: Record<LocalAddressSpace, string> = {
  loopback: 'loopback-network',
  local: 'local-network',
};

/** `loopback-network` for this machine, `local-network` for the LAN. */
export function localNetworkPermissionName(addressSpace: LocalAddressSpace): string {
  return PERMISSION_NAMES[addressSpace];
}

type PermissionsLike = {
  query?: (descriptor: { name: string }) => Promise<{ state: string }>;
};

function defaultPermissions(): PermissionsLike | undefined {
  try {
    if (typeof navigator !== 'undefined' && navigator.permissions) {
      // Granular LNA names are not in every TS lib.dom PermissionName union.
      return navigator.permissions as unknown as PermissionsLike;
    }
  } catch {
    // no navigator (SSR/spec) — fall through
  }
  return undefined;
}

/**
 * Current LNA permission state for the address space of `rawUrl`.
 * `unsupported` means "this browser has no LNA permission model" (old Chrome,
 * Firefox, Safari, SSR) — callers must not claim anything is blocked then.
 */
export async function queryLocalNetworkPermission(
  addressSpace: LocalAddressSpace,
  permissions: PermissionsLike | undefined = defaultPermissions()
): Promise<LocalNetworkPermissionState> {
  if (!permissions?.query) return 'unsupported';
  try {
    const status = await permissions.query({ name: localNetworkPermissionName(addressSpace) });
    if (status.state === 'granted' || status.state === 'denied') return status.state;
    return 'prompt';
  } catch {
    // Unrecognized permission name — the browser predates granular LNA rights.
    return 'unsupported';
  }
}

export interface PrimeOptions {
  fetchFn?: (url: string, init?: RequestInit) => Promise<unknown>;
  permissions?: PermissionsLike;
  /** Budget for the priming request (a prompt can keep it open a moment). */
  timeoutMs?: number;
}

/**
 * Trigger (or confirm) LNA permission from a user gesture.
 *
 * - `granted` / `unsupported` ⇒ nothing to ask; no request is sent.
 * - `denied` ⇒ returns immediately: the browser will block every later request.
 * - `prompt` ⇒ sends one `no-cors` GET to the endpoint (a no-cors request needs
 *   no CORS cooperation, so an opaque response is enough) which is what makes
 *   Chrome show the permission prompt; the state is re-read afterwards.
 *
 * A rejected probe is NOT a verdict on the server: this only exists to surface
 * the permission prompt. The real connection test runs afterwards.
 */
export async function primeLocalNetworkAccess(
  rawUrl: string,
  opts: PrimeOptions = {}
): Promise<LocalNetworkPermissionState> {
  const addressSpace = localAddressSpace(rawUrl);
  if (!addressSpace) return 'unsupported';

  const before = await queryLocalNetworkPermission(addressSpace, opts.permissions);
  if (before !== 'prompt') return before;

  const fetchFn = opts.fetchFn ?? (globalThis.fetch as PrimeOptions['fetchFn']);
  if (typeof fetchFn !== 'function') return before;

  const init: RequestInit & { targetAddressSpace?: LocalAddressSpace } = {
    mode: 'no-cors',
    // Without the declaration Chrome rejects the priming request itself.
    targetAddressSpace: addressSpace,
  };
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    init.signal = AbortSignal.timeout(opts.timeoutMs ?? 5_000);
  }
  try {
    await fetchFn(rawUrl, init);
  } catch {
    // Down server or dismissed prompt — the caller's real test decides.
  }
  return queryLocalNetworkPermission(addressSpace, opts.permissions);
}

function hostOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).host;
  } catch {
    return 'your local endpoint';
  }
}

/**
 * Failure text for a DENIED permission. This is not the server's fault and it
 * never recovers on its own, so it must say what to click.
 */
export function localNetworkDeniedMessage(rawUrl: string): string {
  return (
    `This browser is blocking local-network access for ${appOrigin()}, so requests to ` +
    `${hostOf(rawUrl)} are rejected before they are sent. Open the site controls next to the ` +
    'address bar (or Site settings → Local network / Loopback network) and set access to ' +
    'Allow, then press Connect again.'
  );
}

/**
 * Extra sentence for the ambiguous case: the permission is still `prompt`
 * while the request failed, which happens when the prompt was dismissed (or
 * could not be shown because the request came from outside a user gesture).
 */
export function localNetworkPromptNote(rawUrl: string): string {
  return (
    ` This browser has not granted local-network access to ${appOrigin()} yet — allow the ` +
    `prompt for ${hostOf(rawUrl)} and press Connect again.`
  );
}
