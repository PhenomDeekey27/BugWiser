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

const ENV_VAR_BY_PROVIDER: Record<ProviderName, string> = {
  chutes: 'CHUTES_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  opencode: 'OPENCODE_ZEN_API_KEY',
  gemini: 'GEMINI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  zai: 'ZAI_API_KEY',
  openai: 'OPENAI_API_KEY',
};

export const PROVIDER_NAMES: ProviderName[] = [
  'chutes',
  'openrouter',
  'opencode',
  'gemini',
  'deepseek',
  'zai',
  'openai',
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

export function cacheUserCredentials(userId: string, keys: Partial<Record<ProviderName, string>>): void {
  credentialCache.set(userId, keys);
}

export function clearUserCredentialsCache(userId: string): void {
  credentialCache.delete(userId);
}

type ConnectionRow = {
  provider: ProviderName;
  encrypted_api_key: string | null;
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

export async function getProviderConnections(userId: string): Promise<Record<ProviderName, boolean>> {
  const result = {} as Record<ProviderName, boolean>;
  // Default: nothing connected. Connected status is resolved purely from the
  // user's stored DB connections so that disconnect (which deletes the row)
  // reliably flips a provider back to disconnected. Env-var configuration is a
  // separate, server-only concern and must NOT keep a provider connected.
  for (const p of PROVIDER_NAMES) {
    result[p] = false;
  }

  try {
    const db = createBackgroundClient();
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

export async function removeUserConnection(userId: string, provider: ProviderName): Promise<void> {
  const db = createBackgroundClient();
  await db
    .from('provider_connections')
    .delete()
    .eq('user_id', userId)
    .eq('provider', provider);
  clearUserCredentialsCache(userId);
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