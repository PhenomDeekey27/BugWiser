// Server-side provider credential management.
//
// - Provider connections are stored in the `provider_connections` table,
//   encrypted at rest, and scoped to a user.
// - Credentials are resolved: a per-user `disabled` tombstone vetoes the
//   provider entirely, then env-configured keys take precedence, then the
//   user's stored connection.
// - An in-memory cache (per user) avoids repeated decryption during a run.
//
// Credentials NEVER reach the browser. The server only returns a boolean
// `connected` status (and a masked last-4) to the client.

import { createBackgroundClient } from '@/lib/supabase/background';
import type { ProviderName } from '@/lib/ai/providers/registry';
import { encryptSecret, decryptSecret } from './encryption';
import { LOCAL_PROVIDER_ID, normalizeLocalBaseUrl } from './local';

const ENV_VAR_BY_PROVIDER: Record<ProviderName, string> = {
  chutes: 'CHUTES_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  opencode: 'OPENCODE_ZEN_API_KEY',
  gemini: 'GEMINI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  zai: 'ZAI_API_KEY',
  openai: 'OPENAI_API_KEY',
  // The local provider has NO server env var: its endpoint (base URL +
  // optional key) is configured per user connection. Empty string ⇒
  // envKeyForProvider('local') is always '' and the provider can never look
  // "env-configured".
  local: '',
};

export const PROVIDER_NAMES: ProviderName[] = [
  'chutes',
  'openrouter',
  'opencode',
  'gemini',
  'deepseek',
  'zai',
  'openai',
  'local',
];

export function envVarForProvider(provider: ProviderName): string {
  return ENV_VAR_BY_PROVIDER[provider];
}

export function envKeyForProvider(provider: ProviderName): string {
  return process.env[ENV_VAR_BY_PROVIDER[provider]] || '';
}

export function isProviderConfiguredBysEnv(provider: ProviderName): boolean {
  return !!envKeyForProvider(provider);
}

// ── Unified provider lifecycle state ──
//
// Every provider resolves to exactly ONE lifecycle state per user, with the
// precedence:
//
//   DISABLED (per-user tombstone row) > USER ROW (status='connected')
//     > SERVER ENV (deployment credential) > NONE
//
// - 'user'     — the user's own connected row (its credential is used per the
//                existing env-first runtime precedence).
// - 'server'   — no vetoing row; the server env credential makes the provider
//                available to this user (same runtime semantics as before).
// - 'disabled' — an explicit tombstone row (status='disabled', key=NULL): the
//                user opted out of a server-env provider. The env credential
//                must NOT be used for this user anywhere (display, discovery,
//                runtime availability, instance construction).
// - 'none'     — no row, no env credential (or a keyless connected row whose
//                backing env credential was later removed).
//
// Generic over PROVIDER_NAMES — no provider is special-cased; the local
// provider has no env var so it can only ever be 'user'/'none'.
export type ProviderLifecycleState = 'user' | 'server' | 'disabled' | 'none';

/** Safe display metadata — NEVER credential material. */
export interface ProviderConnectionInfo {
  state: ProviderLifecycleState;
  /** Where the effective credential comes from. */
  connectionSource: 'user' | 'server' | null;
  connected: boolean;
  disabled: boolean;
}

type LifecycleRow = {
  provider: ProviderName;
  status: string;
  encrypted_api_key: string | null;
};

/**
 * Pure state resolution (exported for tests). `row` is the user's single
 * provider_connections row for this provider (at most one can exist), and
 * `envConfigured` whether a server env credential exists for it.
 */
export function resolveProviderLifecycleState(
  provider: ProviderName,
  row: Pick<LifecycleRow, 'status' | 'encrypted_api_key'> | null | undefined,
  envConfigured: boolean
): ProviderLifecycleState {
  if (row?.status === 'disabled') return 'disabled';
  if (row?.status === 'connected') {
    if (row.encrypted_api_key) return 'user';
    // A keyless connected row: for the local provider the stored endpoint (not
    // a key) is the credential; for env-mapped providers the row marks an
    // explicit re-enable of the server credential. With neither an endpoint
    // provider nor an env credential, no credential exists at all.
    if (provider === LOCAL_PROVIDER_ID) return 'user';
    if (envConfigured) return 'server';
    return 'none';
  }
  // 'error' (or any legacy/unknown status) does not veto the server env.
  if (envConfigured) return 'server';
  return 'none';
}

function toConnectionInfo(state: ProviderLifecycleState): ProviderConnectionInfo {
  return {
    state,
    connectionSource: state === 'user' ? 'user' : state === 'server' ? 'server' : null,
    connected: state === 'user' || state === 'server',
    disabled: state === 'disabled',
  };
}

/**
 * Full per-user lifecycle states for every provider. One DB read; env is read
 * from the process. Booleans/safe metadata only — never key material.
 */
export async function getProviderConnectionStates(
  userId: string,
  dbOverride?: ReturnType<typeof createBackgroundClient>
): Promise<Record<ProviderName, ProviderConnectionInfo>> {
  let rows: LifecycleRow[] = [];
  try {
    const db = dbOverride ?? createBackgroundClient();
    const { data, error } = await db
      .from('provider_connections')
      .select('provider, status, encrypted_api_key')
      .eq('user_id', userId);
    if (error) {
      console.error('[provider-conn] Failed to load connection states:', error.message);
    } else {
      rows = (data || []) as LifecycleRow[];
    }
  } catch (err) {
    console.error('[provider-conn] Load connection states error:', err);
  }

  const rowByProvider = new Map<ProviderName, LifecycleRow>();
  for (const row of rows) rowByProvider.set(row.provider, row);

  const result = {} as Record<ProviderName, ProviderConnectionInfo>;
  for (const p of PROVIDER_NAMES) {
    result[p] = toConnectionInfo(resolveProviderLifecycleState(p, rowByProvider.get(p), !!envKeyForProvider(p)));
  }
  return result;
}

/** Providers this user has explicitly disabled (tombstone rows). */
export async function getDisabledProviders(
  userId: string,
  dbOverride?: ReturnType<typeof createBackgroundClient>
): Promise<Set<ProviderName>> {
  const states = await getProviderConnectionStates(userId, dbOverride);
  const disabled = new Set<ProviderName>();
  for (const p of PROVIDER_NAMES) {
    if (states[p].disabled) disabled.add(p);
  }
  return disabled;
}

// ── In-memory per-user credential cache (server only) ──
const credentialCache = new Map<string, Partial<Record<ProviderName, string>>>();
// Per-user local endpoint cache (base URL + optional decrypted key), kept in
// step with the credential cache (both cleared together on any change).
const localEndpointCache = new Map<string, ResolvedLocalEndpoint | null>();

export function cacheUserCredentials(userId: string, keys: Partial<Record<ProviderName, string>>): void {
  credentialCache.set(userId, keys);
}

export function clearUserCredentialsCache(userId: string): void {
  credentialCache.delete(userId);
  localEndpointCache.delete(userId);
}

type ConnectionRow = {
  provider: ProviderName;
  encrypted_api_key: string | null;
  base_url?: string | null;
  status: string;
  connected_at: string | null;
};

export interface ResolvedProviderConnection {
  provider: ProviderName;
  connected: boolean;
  source: 'env' | 'user' | 'none';
  /** Only ever sent to the client as a masked/hint field. */
  maskedKey?: string;
}

export async function getProviderConnections(
  userId: string,
  dbOverride?: ReturnType<typeof createBackgroundClient>
): Promise<Record<ProviderName, boolean>> {
  // Connected status is resolved from the unified lifecycle states, so the
  // /models display catalog and the runtime's available-provider set agree:
  //   - 'user' (own connected row) and 'server' (env credential, not vetoed)
  //     count as connected;
  //   - 'disabled' (per-user tombstone) NEVER counts as connected — it beats
  //     both the user's row and the server env credential;
  //   - runtime resolves credentials with the same precedence
  //     (resolveUserCredentials), counts env as available only when not
  //     disabled (model-router buildAvailableProviders), and fetches live
  //     catalogs through the same gate (fetchLiveModels).
  // Booleans only — no key material ever leaves this function. The local
  // provider has no env var (ENV_VAR_BY_PROVIDER.local === ''), so it remains
  // purely DB-driven.
  const states = await getProviderConnectionStates(userId, dbOverride);
  const result = {} as Record<ProviderName, boolean>;
  for (const p of PROVIDER_NAMES) {
    result[p] = states[p].connected;
  }
  return result;
}

export async function resolveUserCredentials(
  userId: string,
  dbOverride?: ReturnType<typeof createBackgroundClient>
): Promise<Partial<Record<ProviderName, string>>> {
  // Verbose per-key logging is gated: enable with AI_DEBUG_SELECTION=true
  // (investigation only — never noisy by default in production).
  const DEBUG = process.env.AI_DEBUG_SELECTION === 'true';
  // The cache is a production-path optimization; an injected client (tests)
  // always reads through so each call reflects the store it was given.
  if (!dbOverride) {
    const cached = credentialCache.get(userId);
    if (cached) {
      if (DEBUG) console.log('[provider-conn] CACHE HIT for user:', userId);
      return cached;
    }
    if (DEBUG) console.log('[provider-conn] CACHE MISS for user:', userId);
  }

  // Read ALL of the user's rows (any status) so a `disabled` tombstone can
  // veto the server env credential for this user. Credential precedence:
  //   DISABLED ⇒ nothing (not even the env key) > env key > user key.
  // The env-over-user ordering is the pre-existing runtime precedence and is
  // deliberately unchanged.
  let rows: ConnectionRow[] = [];
  try {
    const db = dbOverride ?? createBackgroundClient();
    const { data, error } = await db
      .from('provider_connections')
      .select('provider, encrypted_api_key, status')
      .eq('user_id', userId);
    if (error) {
      console.warn('[provider-conn] resolve creds error:', error.message);
    }
    rows = (data || []) as ConnectionRow[];
  } catch (err) {
    console.error('[provider-conn] resolveUserCredentials error:', err);
  }

  const disabled = new Set<ProviderName>();
  for (const row of rows) {
    if (row.status === 'disabled') disabled.add(row.provider as ProviderName);
  }

  const resolved: Partial<Record<ProviderName, string>> = {};
  for (const p of PROVIDER_NAMES) {
    if (disabled.has(p)) continue; // tombstone beats the env credential
    const env = envKeyForProvider(p);
    if (env) {
      if (DEBUG) console.log('[provider-conn] ENV key found for', p);
      resolved[p] = env;
    }
  }

  for (const row of rows) {
    if (row.status !== 'connected') continue;
    if (!row.encrypted_api_key) {
      if (DEBUG) console.log('[provider-conn] DB row for', row.provider, 'has NULL encrypted_api_key');
      continue;
    }
    const provider = row.provider as ProviderName;
    if (resolved[provider]) {
      if (DEBUG) console.log('[provider-conn] Skipping DB key for', provider, 'since ENV key already set');
      continue;
    }
    try {
      const decrypted = decryptSecret(row.encrypted_api_key);
      if (DEBUG) console.log('[provider-conn] Decrypted key for', provider, 'length:', decrypted.length);
      resolved[provider] = decrypted;
    } catch (e) {
      console.warn(`[provider-conn] Failed to decrypt key for ${provider}:`, e);
    }
  }

  if (!dbOverride) credentialCache.set(userId, resolved);
  return resolved;
}

export async function saveUserConnection(
  userId: string,
  provider: ProviderName,
  apiKey: string
): Promise<{ ok: boolean; error?: string }> {
  if (!apiKey || apiKey.trim().length === 0) {
    return { ok: false, error: 'API key is required' };
  }
  const encrypted = encryptSecret(apiKey.trim());
  const db = createBackgroundClient();

  // Upsert
  const { error } = await db.from('provider_connections').upsert(
    {
      user_id: userId,
      provider,
      encrypted_api_key: encrypted,
      status: 'connected',
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,provider' }
  );

  if (error) {
    return { ok: false, error: `Failed to save connection: ${error.message}` };
  }

  // Invalidate cache so the new key is picked up.
  clearUserCredentialsCache(userId);
  return { ok: true };
}

export async function removeUserConnection(
  userId: string,
  provider: ProviderName,
  dbOverride?: ReturnType<typeof createBackgroundClient>
): Promise<void> {
  const db = dbOverride ?? createBackgroundClient();
  await db
    .from('provider_connections')
    .delete()
    .eq('user_id', userId)
    .eq('provider', provider);
  clearUserCredentialsCache(userId);
}

/**
 * Per-user opt-out of a SERVER-ENV-backed provider: upserts the tombstone row
 * `{status:'disabled', encrypted_api_key:NULL}`. The env credential itself is
 * never copied into the row — it stays server-side only. Callers must only use
 * this for env-configured providers (the DELETE route gates on
 * isProviderConfiguredBysEnv); user-key providers disconnect by row deletion,
 * and the local provider is never env-backed.
 */
export async function disableUserConnection(
  userId: string,
  provider: ProviderName,
  dbOverride?: ReturnType<typeof createBackgroundClient>
): Promise<{ ok: boolean; error?: string }> {
  const db = dbOverride ?? createBackgroundClient();
  const { error } = await db.from('provider_connections').upsert(
    {
      user_id: userId,
      provider,
      encrypted_api_key: null,
      status: 'disabled',
      connected_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,provider' }
  );
  if (error) {
    return { ok: false, error: `Failed to disable provider: ${error.message}` };
  }
  clearUserCredentialsCache(userId);
  return { ok: true };
}

/**
 * Keyless re-enable of a SERVER-ENV-backed provider: upserts a connected row
 * with a NULL key — the same shape a keyless local endpoint already uses. The
 * server env credential supplies the runtime key (env precedence), and the
 * row clears any `disabled` tombstone. No credential is ever invented or
 * exposed: nothing key-shaped is stored or returned.
 */
export async function enableServerEnvConnection(
  userId: string,
  provider: ProviderName,
  dbOverride?: ReturnType<typeof createBackgroundClient>
): Promise<{ ok: boolean; error?: string }> {
  const db = dbOverride ?? createBackgroundClient();
  const { error } = await db.from('provider_connections').upsert(
    {
      user_id: userId,
      provider,
      encrypted_api_key: null,
      status: 'connected',
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,provider' }
  );
  if (error) {
    return { ok: false, error: `Failed to enable provider: ${error.message}` };
  }
  clearUserCredentialsCache(userId);
  return { ok: true };
}

// ── Local OpenAI-compatible endpoint connection (base URL + optional key) ──
//
// Stored in the SAME `provider_connections` table as every other provider
// (upsert on user_id,provider — a re-registration replaces the row instead of
// duplicating it). `base_url` holds the normalized endpoint; `encrypted_api_key`
// is NULL when the endpoint needs no key (migration 015 makes it nullable).
// Nothing here marks a provider connected by itself — registration only ever
// runs after a successful connection test (see connection/registerLocal.ts).

export interface ResolvedLocalEndpoint {
  baseUrl: string;
  apiKey?: string;
}

/**
 * Persist (upsert) a verified local endpoint connection. The base URL is
 * re-normalized here so a raw value can never be stored; an empty/whitespace
 * API key is stored as NULL (keyless endpoints are valid).
 */
export async function saveLocalUserConnection(
  userId: string,
  input: { baseUrl: string; apiKey?: string },
  dbOverride?: ReturnType<typeof createBackgroundClient>
): Promise<{ ok: boolean; error?: string }> {
  const normalized = normalizeLocalBaseUrl(input.baseUrl);
  if (!normalized.ok) {
    return { ok: false, error: normalized.error };
  }
  const apiKey = (input.apiKey ?? '').trim();
  const encrypted = apiKey ? encryptSecret(apiKey) : null;
  const db = dbOverride ?? createBackgroundClient();

  const { error } = await db.from('provider_connections').upsert(
    {
      user_id: userId,
      provider: LOCAL_PROVIDER_ID,
      encrypted_api_key: encrypted,
      base_url: normalized.baseUrl,
      status: 'connected',
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,provider' }
  );

  if (error) {
    return { ok: false, error: `Failed to save connection: ${error.message}` };
  }

  clearUserCredentialsCache(userId);
  return { ok: true };
}

/**
 * Resolve the user's connected local endpoint (base URL + decrypted key when
 * one was stored). Returns null when no connected local row exists — the
 * catalog fetcher must skip discovery in that case.
 */
export async function resolveLocalEndpoint(
  userId: string,
  dbOverride?: ReturnType<typeof createBackgroundClient>
): Promise<ResolvedLocalEndpoint | null> {
  // The cache is a production-path optimization; an injected client (tests)
  // always reads through so each call reflects the store it was given.
  if (!dbOverride) {
    const cached = localEndpointCache.get(userId);
    if (cached !== undefined) return cached;
  }

  let result: ResolvedLocalEndpoint | null = null;
  try {
    const db = dbOverride ?? createBackgroundClient();
    const { data, error } = await db
      .from('provider_connections')
      .select('base_url, encrypted_api_key')
      .eq('user_id', userId)
      .eq('provider', LOCAL_PROVIDER_ID)
      .eq('status', 'connected')
      .maybeSingle();
    if (error) {
      console.warn('[provider-conn] resolve local endpoint error:', error.message);
    } else if (data && typeof data.base_url === 'string' && data.base_url) {
      const endpoint: ResolvedLocalEndpoint = { baseUrl: data.base_url };
      if (data.encrypted_api_key) {
        try {
          endpoint.apiKey = decryptSecret(data.encrypted_api_key);
        } catch (e) {
          console.warn('[provider-conn] Failed to decrypt local API key:', e);
        }
      }
      result = endpoint;
    }
  } catch (err) {
    console.error('[provider-conn] resolveLocalEndpoint error:', err);
  }

  if (!dbOverride) localEndpointCache.set(userId, result);
  return result;
}

export function maskedKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 4) return '••••';
  return `••••${trimmed.slice(-4)}`;
}

export async function maskConfiguredProviders(userId: string): Promise<Record<ProviderName, string>> {
  const resulting = {} as Record<ProviderName, string>;
  const creds = await resolveUserCredentials(userId);
  for (const p of PROVIDER_NAMES) {
    const key = creds[p];
    if (key) resulting[p] = maskedKey(key);
  }
  return resulting;
}