// Task U — runtime/display provider consistency.
//
// Env-configured providers were available to the runtime (credentials
// env-first, buildAvailableProviders env counts, fetchLiveModels fetches via
// env) but invisible in /models (getProviderConnections was DB-only, so
// discoverModels dropped the fetched env groups and the UI filtered them
// out). These checks prove the display now reflects runtime availability
// without exposing keys, hardcoding providers, weakening Strict Free, or
// changing pricing rules. No network, DB, paid calls, or real credentials.

import { strict as assert } from 'node:assert';
import type { createBackgroundClient } from './lib/supabase/background';
import {
  PROVIDER_NAMES,
  envKeyForProvider,
  envVarForProvider,
  getProviderConnections,
  isProviderConfiguredBysEnv,
} from './lib/ai/connection/service';
import { isProviderConfigured } from './lib/ai/providers/registry';
import { buildProviderFingerprint } from './lib/ai/model-intelligence';
import {
  getFreeStageCandidates,
  isConfirmedFreeModel,
  prepareStrictFreeRun,
} from './lib/ai/catalog/stageSelection';
import type { CatalogModel } from './app/models/page';
import type { ProviderName } from './lib/ai/catalog/types';

type BackgroundClient = ReturnType<typeof createBackgroundClient>;

let failures = 0;

async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log('PASS ' + name);
  } catch (err) {
    failures++;
    console.error('FAIL ' + name + ' :: ' + ((err as Error).message || String(err)));
  }
}

// Minimal fake DB speaking only the chains service.ts uses for connections.
// `encrypted_api_key` is part of the shape: a REAL non-local connected row
// always carries a key (state resolution reads its presence, never its value).
function fakeDb(rows: Array<{ provider: string; status: string; encrypted_api_key?: string | null }>): BackgroundClient {
  return {
    from(table: string) {
      assert.equal(table, 'provider_connections');
      return {
        select(columns: string) {
          void columns;
          const filters: Record<string, unknown> = {};
          const builder: Record<string, unknown> = {
            eq: (column: string, value: unknown) => {
              filters[column] = value;
              return builder;
            },
          };
          // getProviderConnections awaits the builder directly (thenable).
          (builder as { then: unknown }).then = (
            onFulfilled?: (v: { data: unknown[]; error: null }) => unknown
          ) => Promise.resolve({ data: rows, error: null }).then(onFulfilled as never);
          return builder;
        },
      };
    },
  } as unknown as BackgroundClient;
}

function catalogUnknown(providerId: string, modelId: string, contextWindow = 128_000): CatalogModel {
  return {
    providerId,
    modelId,
    displayName: modelId,
    contextWindow,
    maxOutputTokens: 8192,
    price: { input: null, output: null, isFree: false },
    priceSource: 'unknown',
    priceFetchedAt: null,
    supportsReasoning: false,
    supportsToolCalling: false,
    supportsStructuredOutput: false,
    capabilities: [],
    availability: 'available',
    scores: { coding: 30, reasoning: 21, speed: 50, longContext: 55 },
    valueScore: 40,
    tags: ['live'],
    fit: 36,
    stageFit: {},
    available: true,
  };
}

async function main(): Promise<void> {
  // Pick the first provider with a real env-var mapping (generic — no
  // provider name hardcoded in the selection itself). In practice this is a
  // standard external provider (e.g. the env-configured Gemini from the E2E).
  const envProvider = PROVIDER_NAMES.find((p) => envVarForProvider(p) !== '') as ProviderName;
  assert.ok(envProvider, 'expected at least one provider with an env var mapping');
  const envVar = envVarForProvider(envProvider);
  const savedEnv = process.env[envVar];
  const savedKey = `test-env-key-${Date.now()}`;

  try {
    await check('env-only provider is reported connected (display reflects runtime)', async () => {
      process.env[envVar] = savedKey;
      const connections = await getProviderConnections('user-env-only', fakeDb([]));
      assert.equal(connections[envProvider], true, 'env key must count as connected for display/catalog');
      assert.equal(isProviderConfigured(envProvider), true, 'runtime env check must agree');
      assert.equal(isProviderConfiguredBysEnv(envProvider), true);
    });

    await check('no env + no DB row stays disconnected on both sides', async () => {
      delete process.env[envVar];
      const connections = await getProviderConnections('user-none', fakeDb([]));
      assert.equal(connections[envProvider], false);
      assert.equal(isProviderConfigured(envProvider), false);
    });

    await check('DB row still connects without env (existing behavior preserved)', async () => {
      delete process.env[envVar];
      const connections = await getProviderConnections(
        'user-db',
        fakeDb([{ provider: envProvider, status: 'connected', encrypted_api_key: 'fake-encrypted-user-key' }])
      );
      assert.equal(connections[envProvider], true);
    });

    await check('local remains purely DB-driven (no env var exists)', async () => {
      assert.equal(envVarForProvider('local'), '');
      assert.equal(envKeyForProvider('local'), '');
      process.env[envVar] = savedKey; // env for another provider must not affect local
      const connections = await getProviderConnections('user-local', fakeDb([]));
      assert.equal(connections.local, false);
      const connected = await getProviderConnections(
        'user-local',
        fakeDb([{ provider: 'local', status: 'connected' }])
      );
      assert.equal(connected.local, true);
    });

    await check('fingerprint reflects the effective (DB ∪ env) set', async () => {
      process.env[envVar] = savedKey;
      const connections = await getProviderConnections('user-fp', fakeDb([]));
      const fingerprint = buildProviderFingerprint(connections);
      assert.ok(
        fingerprint.split(':').includes(envProvider),
        `fingerprint ${fingerprint} must include the env-available provider`
      );
    });

    await check('no key material leaks through the display path', async () => {
      process.env[envVar] = savedKey;
      const connections = await getProviderConnections('user-leak', fakeDb([]));
      const serialized = JSON.stringify(connections);
      assert.ok(!serialized.includes(savedKey), 'API key must never appear in connection status');
      for (const v of Object.values(connections)) assert.equal(typeof v, 'boolean');
      assert.equal(envKeyForProvider(envProvider), savedKey, 'sanity: env helper still reads the key server-side');
    });

    await check('Strict Free unchanged: unknown-priced env models never count as free', async () => {
      const catalog = [catalogUnknown(envProvider, 'server-a')];
      assert.equal(isConfirmedFreeModel(catalog, envProvider, 'server-a'), false);
      assert.deepEqual(getFreeStageCandidates(catalog, 'relevant_file_discovery'), []);
      const plan = prepareStrictFreeRun(catalog, 'relevant_file_discovery', {
        provider: envProvider,
        model: 'server-a',
      });
      assert.equal(plan.stageOverride, null, 'unconfirmed override must be dropped');
      assert.deepEqual(plan.freeCandidates, []);
    });

    await check('pricing rules unchanged: env inclusion adds no free authority', async () => {
      const catalog = [catalogUnknown(envProvider, 'server-a')];
      assert.equal(catalog[0].priceSource, 'unknown');
      assert.equal(catalog[0].price.isFree, false);
    });
  } finally {
    if (savedEnv === undefined) delete process.env[envVar];
    else process.env[envVar] = savedEnv;
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILED');
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error('SPEC CRASH :: ' + ((err as Error).stack || String(err)));
    process.exit(1);
  });
