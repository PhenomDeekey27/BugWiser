// Server-side provider credential management.
//
// - Provider connections are stored in the `provider_connections` table,
//   encrypted at rest, and scoped to a user.
// - Credentials are resolved: env-configured keys take precedence, then the
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
  const result = {} as Record<ProviderName, boolean>;
  // Default: nothing connected. Connected status is resolved purely from the
  // user's stored DB connections so that disconnect (which deletes the row)
  // reliably flips a provider back to disconnected. Env-var configuration is a
  // separate, server-only concern and must NOT keep a provider connected.
  for (const p of PROVIDER_NAMES) {
    result[p] = false;
  }

  try {
    const db = dbOverride ?? createBackgroundClient();
    const { data, error } = await db
      .from('provider_connections')
      .select('provider, status')
      .eq('user_id', userId);
    if (error) {
      console.error('[provider-conn] Failed to load connections:', error.message);
      return result;
    }
    for (const row of data || []) {
      result[row.provider as ProviderName] = row.status === 'connected';
    }
  } catch (err) {
    console.error('[provider-conn] Load connections error:', err);
  }

  return result;
}

export async function resolveUserCredentials(userId: string): Promise<Partial<Record<ProviderName, string>>> {
  // Verbose per-key logging is gated: enable with AI_DEBUG_SELECTION=true
  // (investigation only — never noisy by default in production).
  const DEBUG = process.env.AI_DEBUG_SELECTION === 'true';
  const cached = credentialCache.get(userId);
  if (cached) {
    if (DEBUG) console.log('[provider-conn] CACHE HIT for user:', userId);
    return cached;
  }
  if (DEBUG) console.log('[provider-conn] CACHE MISS for user:', userId);

  const resolved: Partial<Record<ProviderName, string>> = {};
  for (const p of PROVIDER_NAMES) {
    const env = envKeyForProvider(p);
    if (env) {
      if (DEBUG) console.log('[provider-conn] ENV key found for', p);
      resolved[p] = env;
    }
  }

  try {
    const db = createBackgroundClient();
    const { data, error } = await db
      .from('provider_connections')
      .select('provider, encrypted_api_key')
      .eq('user_id', userId)
      .eq('status', 'connected');
    if (error) {
      console.warn('[provider-conn] resolve creds error:', error.message);
    }
    for (const row of (data || []) as ConnectionRow[]) {
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
  } catch (err) {
    console.error('[provider-conn] resolveUserCredentials error:', err);
  }

  credentialCache.set(userId, resolved);
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