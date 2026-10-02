// Task K — registration of a LOCAL OpenAI-compatible provider, gated on a
// successful connection test.
//
// Flow (identical semantics to the existing POST /api/models/connect for key
// providers: validate BEFORE persist, failure ⇒ nothing saved):
//
//   normalize base URL → connection TEST (Task J utilities) → save through the
//   EXISTING provider_connections infrastructure (service.ts).
//
// A URL alone never marks the provider connected: `saveFn` runs only after
// `testFn` reports success. This module owns no database schema and no HTTP
// security layer — it composes the pieces Tasks I/J and the existing
// connection service already provide (deps are injectable for tests).

import {
  buildLocalProviderConfig,
  LOCAL_PROVIDER_ID,
  type LocalProviderConfig,
} from './local';
import {
  testLocalConnection,
  type LocalConnectionTestResult,
  type TestConnectionDeps,
} from './testConnection';
import { saveLocalUserConnection, removeUserConnection } from './service';
import type { ProviderName } from '@/lib/ai/providers/registry';

export interface RegisterLocalDeps {
  /** Connection-test implementation (defaults to the Task J test). */
  testFn?: (
    input: { baseUrl: string; apiKey?: string },
    deps?: TestConnectionDeps
  ) => Promise<LocalConnectionTestResult>;
  /** HTTP-boundary injection for the default test (mocked fetch in tests). */
  testDeps?: TestConnectionDeps;
  /** Persistence implementation (defaults to saveLocalUserConnection). */
  saveFn?: (
    userId: string,
    config: LocalProviderConfig
  ) => Promise<{ ok: boolean; error?: string }>;
}

export interface RegisterLocalResult {
  ok: boolean;
  /** Normalized base URL ('' when normalization failed). */
  baseUrl: string;
  /** Models discovered by the verification test (0 unless ok). */
  modelCount: number;
  /** Test compatibility classification, when a test ran. */
  compatibility?: LocalConnectionTestResult['compatibility'];
  /** Human-readable failure reason; null on success. Never contains secrets. */
  error: string | null;
}

/**
 * Register a local provider connection for a user. Steps:
 *   1. Normalize/validate the base URL (invalid ⇒ fail, no HTTP, no save).
 *   2. Run the connection test (SSRF-screened, redirect-validated Task J probe).
 *   3. Only on test success, upsert the row via saveLocalUserConnection —
 *      base URL + optional encrypted key, in the existing table, so a repeat
 *      registration REPLACES the single (user_id, provider) row (no duplicates).
 */
export async function registerLocalConnection(
  userId: string,
  input: { baseUrl: string; apiKey?: string },
  deps: RegisterLocalDeps = {}
): Promise<RegisterLocalResult> {
  const built = buildLocalProviderConfig(input);
  if (!built.ok) {
    return { ok: false, baseUrl: '', modelCount: 0, error: built.error };
  }
  if (!built.config) {
    return { ok: false, baseUrl: built.baseUrl, modelCount: 0, error: 'Invalid base URL.' };
  }
  const config = built.config;

  const testFn = deps.testFn ?? testLocalConnection;
  const test = await testFn(
    { baseUrl: config.baseUrl, apiKey: config.apiKey },
    deps.testDeps
  );
  if (!test.success) {
    // Failed verification ⇒ registration is impossible. Nothing was persisted.
    return {
      ok: false,
      baseUrl: test.baseUrl || config.baseUrl,
      modelCount: 0,
      compatibility: test.compatibility,
      error: test.error || 'Connection test failed.',
    };
  }

  const saveFn =
    deps.saveFn ??
    ((uid: string, cfg: LocalProviderConfig) =>
      saveLocalUserConnection(uid, { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey }));
  const saved = await saveFn(userId, config);
  if (!saved.ok) {
    return {
      ok: false,
      baseUrl: config.baseUrl,
      modelCount: test.modelIds.length,
      compatibility: test.compatibility,
      error: saved.error || 'Failed to save connection.',
    };
  }

  return {
    ok: true,
    baseUrl: config.baseUrl,
    modelCount: test.modelIds.length,
    compatibility: test.compatibility,
    error: null,
  };
}

export interface DisconnectLocalDeps {
  /** Removal implementation (defaults to the existing removeUserConnection). */
  removeFn?: (userId: string, provider: ProviderName) => Promise<void>;
}

/**
 * Disconnect the local provider through the EXISTING connection mechanism —
 * the same `removeUserConnection` the shared DELETE route already uses for
 * every provider (deletes the (user_id, 'local') row and clears caches, which
 * in turn flips the catalog fingerprint on the next rebuild).
 */
export async function disconnectLocalConnection(
  userId: string,
  deps: DisconnectLocalDeps = {}
): Promise<void> {
  const removeFn = deps.removeFn ?? removeUserConnection;
  await removeFn(userId, LOCAL_PROVIDER_ID);
}
