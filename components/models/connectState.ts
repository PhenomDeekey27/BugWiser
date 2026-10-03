// Provider connection flow helpers (Tasks Q + R). Pure: no React, no fetch, no
// timers — the page supplies the HTTP calls and the state setters, so the
// "connect/disconnect must not outlive its own request" contract is directly
// testable.
//
// The bug this replaces: `handleConnect`/`handleDisconnect` used to
// `await refresh()` (GET /api/models) before resolving. That GET used to
// perform a SYNCHRONOUS catalog rebuild whenever the connected-provider
// fingerprint changed (i.e. always, right after connecting OR disconnecting),
// so the Connect/Disconnect spinner stayed on for the whole rebuild — live
// provider HTTP, AI classification and a full re-store included. The mutation
// request had already succeeded by then: the spinner was coupled to work that
// is not part of connecting/disconnecting.
//
// The same code path is why provider state appeared only after a page reload:
// `setProviders` ran at the END of `refresh()`, and `refresh()` was the only
// writer. Both are fixed here — the mutation response is authoritative for
// connection state, and the catalog refresh is detached.

import type { CatalogProvider } from '@/app/models/page';

/** Non-secret acknowledgement returned by POST /api/models/connect. */
export interface ConnectAck {
  ok?: boolean;
  provider?: string;
  status?: string;
  modelCount?: number;
  error?: string;
  /** Non-secret endpoint display metadata (local provider only). */
  baseUrl?: string | null;
}

export interface ConnectRequestBody {
  provider: string;
  apiKey: string;
  baseUrl?: string;
}

/** Result of a mutation request. `ok:false` carries the server's message. */
export interface ConnectPostResult {
  ok: boolean;
  status: number;
  ack: ConnectAck;
}

/** Everything both mutations share. The state-application callback is NOT here:
 *  connect must apply a connected patch, disconnect a disconnected one, so each
 *  entry point requires its own (see ConnectDeps / DisconnectDeps). */
export interface ProviderMutationDeps {
  /** Performs the mutation request; rejects only on transport failure. */
  post: (body: ConnectRequestBody) => Promise<ConnectPostResult>;
  /** Refreshes /api/models in the BACKGROUND. Never awaited, never surfaced. */
  refresh: () => Promise<void> | void;
  onSuccess?: (providerId: string) => void;
  onError?: (message: string) => void;
}

export interface ConnectDeps extends ProviderMutationDeps {
  /** Applies the provider's new connection state to page state IMMEDIATELY. */
  onConnected: (providerId: string, ack: ConnectAck) => void;
  onDisconnected?: (providerId: string) => void;
}

export interface DisconnectDeps extends ProviderMutationDeps {
  /** Applies the provider's new connection state to page state IMMEDIATELY.
   *  `ack.status` distinguishes a tombstoned disconnect ('disabled') from a
   *  plain row deletion ('disconnected') so the card can show Reconnect. */
  onDisconnected: (providerId: string, ack?: ConnectAck) => void;
  onConnected?: (providerId: string, ack: ConnectAck) => void;
}

/**
 * Shared mutation lifecycle.
 *
 * Contract (identical for connect and disconnect, because the shared provider
 * flow is what is broken — there is no local-specific variant):
 *  - the DB mutation request is the ONLY awaited work; the flow resolves as
 *    soon as it resolves — never later;
 *  - on success the provider's connection state is applied synchronously, then
 *    the catalog refresh is started detached (a refresh failure is a
 *    catalog-freshness problem and must not revert a persisted mutation);
 *  - on failure the error is surfaced and the promise REJECTS, so every caller
 *    (LocalProviderConnectForm, ProviderCard) clears its loading state and shows
 *    the message. Neither button can stay stuck.
 */
async function runProviderMutation(
  providerId: string,
  action: 'connect' | 'disconnect',
  run: () => Promise<ConnectPostResult>,
  applyState: (ack: ConnectAck) => void,
  deps: ProviderMutationDeps
): Promise<void> {
  let result: ConnectPostResult;
  try {
    result = await run();
  } catch (e) {
    const message = (e as Error)?.message || 'Connection failed';
    deps.onError?.(message);
    throw e instanceof Error ? e : new Error(message);
  }

  if (!result.ok) {
    const message = result.ack.error || `Failed to ${action}`;
    deps.onError?.(message);
    throw new Error(message);
  }

  // The mutation is durable server-side at this point. Apply it now — the UI
  // must not keep showing the pre-mutation state until a rebuild finishes.
  applyState(result.ack);
  deps.onSuccess?.(providerId);

  // Background catalog refresh: may trigger a full provider re-discovery
  // (HTTP + classification). Never part of the mutation, never awaited.
  try {
    void Promise.resolve(deps.refresh()).catch(() => undefined);
  } catch {
    /* refresh must never surface as a mutation failure */
  }
}

/**
 * Runs one connect request: persist first, update the UI on success, then
 * revalidate the catalog in the background. Rejects on failure so the caller's
 * loading state always clears.
 */
export function runConnect(
  providerId: string,
  apiKey: string,
  options: { baseUrl?: string } | undefined,
  deps: ConnectDeps
): Promise<void> {
  const body: ConnectRequestBody = { provider: providerId, apiKey };
  if (options?.baseUrl) body.baseUrl = options.baseUrl;
  return runProviderMutation(
    providerId,
    'connect',
    () => deps.post(body),
    (ack) => deps.onConnected(providerId, ack),
    deps
  );
}

/**
 * Runs one disconnect request. Same contract as runConnect: the row deletion is
 * awaited and nothing else; the card flips to Disconnected immediately and the
 * catalog refresh happens behind it.
 */
export function runDisconnect(
  providerId: string,
  deps: DisconnectDeps
): Promise<void> {
  return runProviderMutation(
    providerId,
    'disconnect',
    () => deps.post({ provider: providerId, apiKey: '' }),
    (ack) => deps.onDisconnected(providerId, ack),
    deps
  );
}

/**
 * Marks a provider connected in the page's provider list from the successful
 * connect acknowledgement. Non-secret fields only: the submitted base URL (the
 * user just typed it and the server echoes it back on GET /api/models) and the
 * status. Model counts are NOT invented here — they come from the catalog the
 * background refresh loads.
 */
export function markProviderConnected(
  providers: CatalogProvider[],
  providerId: string,
  ack?: ConnectAck,
  submittedBaseUrl?: string
): CatalogProvider[] {
  return providers.map((p) => {
    if (p.providerId !== providerId) return p;
    const next: CatalogProvider = { ...p, status: 'connected', disabled: false };
    const baseUrl = submittedBaseUrl || (typeof ack?.baseUrl === 'string' ? ack.baseUrl : undefined);
    if (baseUrl) next.baseUrl = baseUrl;
    return next;
  });
}

/**
 * Marks a provider disconnected after its row was deleted. Only the connection
 * status changes: the catalog rows stay in page state (the background refresh
 * will replace them), and every consumer that shows models — the provider
 * cards, the stage candidate pool, the setup picker — already filters by the
 * connected set, so the provider's models disappear from the UI immediately.
 * Endpoint display metadata is dropped with the connection.
 */
export function markProviderDisconnected(
  providers: CatalogProvider[],
  providerId: string
): CatalogProvider[] {
  return providers.map((p) =>
    p.providerId === providerId ? { ...p, status: 'disconnected', disabled: false, baseUrl: null } : p
  );
}

/**
 * Applies a TOMBSTONED disconnect (the DELETE route answered `status:
 * 'disabled'` — the provider is env-backed and this user opted out). The card
 * flips to the Disabled/Reconnect state immediately; the background refresh
 * later confirms it from the persisted row.
 */
export function markProviderDisabled(
  providers: CatalogProvider[],
  providerId: string
): CatalogProvider[] {
  return providers.map((p) =>
    p.providerId === providerId ? { ...p, status: 'disconnected', disabled: true, baseUrl: null } : p
  );
}

/**
 * Single-flight latch for a connect submit. The button is disabled while a
 * request is in flight, but two clicks dispatched before React re-renders would
 * both read the pre-request state; this makes the duplicate impossible at the
 * handler boundary.
 */
export function createConnectGate(): { tryBegin: () => boolean; end: () => void } {
  let inFlight = false;
  return {
    tryBegin() {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    end() {
      inFlight = false;
    },
  };
}

// Disconnect is now offered for EVERY connected provider (user row, server
// env, or local): env-backed providers write the per-user tombstone instead of
// being refused, so there is no dead-end "Server-managed / Disconnect
// unavailable" case left to hide.
