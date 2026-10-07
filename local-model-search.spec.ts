// Task W Problem 2 — local model absent from the model search/list.
//
// Incident (reproduced from the live DB): a catalog rebuild at 14:51:20 UTC
//   ran one minute BEFORE the user's llama-server came up (14:52 UTC). The
//   local fetch rejected, but the failed fetch was silently swallowed — the
//   build stored 28 gemini models with fingerprint `gemini:local` and ZERO
//   provider='local' rows. getProviderConnections still reported local
//   connected (its own row existed), so every consumer trusted the catalog:
//   `filterStageModels(pool, 'local')` over the served pool returned [] — the
//   user's local model (provider=local, model=local, 65,536 context) was
//   invisible in search until an unrelated rebuild happened to succeed.
// Fix under test (source-side, no architecture change):
//   - fetchLiveModels reports `failedProviders` (fetch attempted→rejected only;
//     missing-key/endpoint skips are NOT failures), for remote HTTP failures
//     and the local connection refusal alike;
//   - shouldPersistCatalogBuild: a build that lost a connected provider's
//     models must NOT replace the last complete catalog when one exists (the
//     display keeps serving local and revalidate loops retry); a first-ever
//     build still stores (heals at the documented ≤1h TTL bound).
// Preserved behavior asserted verbatim: unknown/null pricing is NEVER free
//   (excluded from Free/Strict Free), context gates unchanged (32K/128K/200K/
//   32K/32K), the local 65,536-context model stays manually selectable/search-
//   able, and it is never eligible for the 128K/200K stages automatically.
// Pure/unit: global fetch mocked, credentials/endpoint injected — no network,
// no real database, no secrets, no paid calls.

import { strict as assert } from 'node:assert';
import { fetchLiveModels } from './lib/ai/catalog/live';
import { shouldPersistCatalogBuild } from './lib/ai/model-intelligence';
import { PROVIDER_NAMES, envVarForProvider } from './lib/ai/connection/service';
import {
  buildStageCandidatePool,
  filterStageModels,
  bucketStageModels,
} from './components/models/stageCandidates';
import {
  STAGE_CONTEXT_MIN,
  getAutomaticStageCandidates,
  getFreeStageCandidates,
  isConfirmedFreeModel,
  prepareStrictFreeRun,
  selectForStage,
  type StageKey,
} from './lib/ai/catalog/stageSelection';
import type { CatalogModel, CatalogProvider } from './app/models/page';

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

// The incident's model: provider=local, model=local, 65,536 context from the
// live llama.cpp payload, pricing unknown (never confirmed free).
function localModel(): CatalogModel {
  return {
    providerId: 'local',
    modelId: 'local',
    displayName: 'local',
    contextWindow: 65_536,
    maxOutputTokens: 8192,
    price: { input: null, output: null, isFree: false },
    priceSource: 'unknown',
    priceFetchedAt: null,
    supportsReasoning: false,
    supportsToolCalling: true,
    supportsStructuredOutput: false,
    capabilities: [],
    availability: 'available',
    scores: { coding: 55, reasoning: 40, speed: 70, longContext: 50 },
    valueScore: 60,
    tags: ['local'],
    fit: 60,
    stageFit: {},
    available: true,
  };
}

function localProvider(): CatalogProvider {
  return {
    providerId: 'local',
    displayName: 'Local endpoint',
    authType: 'api_key',
    status: 'connected',
    connectedAt: null,
    serverConfigured: false,
    description: '',
    docsUrl: '',
    baseUrl: 'http://127.0.0.1:8080',
  };
}

async function main(): Promise<void> {
  // ── The incident: a failed local fetch must refuse to replace the catalog ──

  await check('incomplete build is not persisted while a complete catalog exists', () => {
    // The exact incident: previous catalog holds local's models, the rebuild
    // lost provider=local (fetch rejected) → store refused.
    assert.equal(shouldPersistCatalogBuild(true, ['local']), false);
    assert.equal(shouldPersistCatalogBuild(true, ['gemini', 'local']), false);
  });

  await check('clean builds persist (unchanged behavior)', () => {
    assert.equal(shouldPersistCatalogBuild(true, []), true);
    assert.equal(shouldPersistCatalogBuild(false, []), true);
  });

  await check('first-ever build still stores a partial catalog (≤TTL healing bound)', () => {
    // Nothing to protect yet: storing is today's behavior; the 1h CATALOG_TTL
    // revalidation loop bounds how long it can stay partial.
    assert.equal(shouldPersistCatalogBuild(false, ['local']), true);
  });

  await check('refused store keeps last-complete local model searchable', () => {
    // Display path after the gate fires: the persisted catalog (unchanged) is
    // what /models serves, so local must still be findable in search.
    const persisted = [localModel()];
    const pool = buildStageCandidatePool([localProvider()], persisted);
    const found = filterStageModels(pool, 'local');
    assert.equal(found.length, 1, 'local must be found by search');
    assert.equal(found[0].providerId, 'local');
    assert.equal(found[0].modelId, 'local');
    assert.equal(found[0].contextWindow, 65_536);
    // Case-insensitive, model-id and provider-id matching (search input).
    assert.equal(filterStageModels(pool, 'LOCAL').length, 1);
    assert.equal(filterStageModels(pool, 'loca').length, 1);
    // Not connectable → never in the pool (unchanged gating).
    const disconnected = [{ ...localProvider(), status: 'disconnected' as const }];
    assert.equal(buildStageCandidatePool(disconnected, persisted).length, 0);
  });

  // ── fetchLiveModels failure reporting (mocked HTTP, injected credentials) ──

  const originalFetch = globalThis.fetch;
  const savedEnv = new Map<string, string | undefined>();
  for (const p of PROVIDER_NAMES) {
    const envVar = envVarForProvider(p);
    if (!envVar) continue;
    savedEnv.set(envVar, process.env[envVar]);
    delete process.env[envVar];
  }
  const unexpected: string[] = [];

  globalThis.fetch = (async (input: unknown) => {
    const url = String(
      input instanceof Request ? input.url : Array.isArray(input) ? input[0] : input
    );
    if (url.includes('generativelanguage.googleapis.com')) {
      return { ok: false, status: 500, json: async () => ({}) };
    }
    if (url.includes('api.deepseek.com')) {
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    }
    if (url.includes('127.0.0.1') || url.includes('localhost:39999')) {
      // The probe's host-alias rescue retries `localhost` after a transport
      // failure on `127.0.0.1` — same dead endpoint, same refusal.
      throw new Error('connect ECONNREFUSED ' + (url.includes('localhost') ? 'localhost:39999' : '127.0.0.1:39999'));
    }
    unexpected.push(url);
    throw new Error('unexpected network call: ' + url);
  }) as typeof globalThis.fetch;

  try {
    await check('failed live fetches are reported (remote 500 + local refusal)', async () => {
      const res = await fetchLiveModels('task-w-user', {
        resolveUserCredentials: async () => ({ gemini: 'test-key-g', deepseek: 'test-key-d' }),
        resolveLocalEndpoint: async () => ({ baseUrl: 'http://127.0.0.1:39999' }),
      });
      assert.deepEqual(
        [...res.failedProviders].sort(),
        ['gemini', 'local'],
        'both the HTTP 500 and the local connection refusal must be reported'
      );
      assert.deepEqual(
        res.groups.map((g) => g.providerId),
        ['deepseek'],
        'the successful provider must NOT be marked failed'
      );
      assert.deepEqual(unexpected, [], 'no request outside the mocked URLs');
    });

    await check('credential/endpoint skips are NOT failures (no key ⇒ no fetch)', async () => {
      const res = await fetchLiveModels('task-w-user', {
        resolveUserCredentials: async () => ({}),
        resolveLocalEndpoint: async () => null,
      });
      assert.deepEqual(res.failedProviders, [], 'skipped providers must not read as failed');
      assert.deepEqual(res.groups, []);
      assert.deepEqual(unexpected, [], 'no request for skipped providers');
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [envVar, value] of savedEnv) {
      if (value === undefined) delete process.env[envVar];
      else process.env[envVar] = value;
    }
  }

  // ── Preserved pricing policy: unknown is never free ──

  await check('unknown-priced local model is never confirmed free', () => {
    const catalog = [localModel()];
    assert.equal(catalog[0].priceSource, 'unknown');
    assert.equal(isConfirmedFreeModel(catalog, 'local', 'local'), false);
    for (const stage of Object.keys(STAGE_CONTEXT_MIN) as StageKey[]) {
      assert.deepEqual(
        getFreeStageCandidates(catalog, stage),
        [],
        `Free stage ${stage} must have no local candidates`
      );
    }
  });

  await check('Strict Free drops an unconfirmed local override', () => {
    const plan = prepareStrictFreeRun([localModel()], 'relevant_file_discovery', {
      provider: 'local',
      model: 'local',
    });
    assert.equal(plan.stageOverride, null);
    assert.deepEqual(plan.freeCandidates, []);
    const pick = selectForStage('free', 'relevant_file_discovery', [localModel()]);
    assert.equal(pick?.unavailable, true, 'Free must be explicitly unavailable, never a paid pick');
  });

  await check('display buckets never label the local model as Free', () => {
    const buckets = bucketStageModels([localModel()]);
    assert.equal(buckets.free.length, 0);
    assert.equal(buckets.other.length, 1, 'unknown pricing belongs to the other bucket');
  });

  // ── Preserved context gates (32K / 128K / 200K / 32K / 32K) ──

  await check('STAGE_CONTEXT_MIN values are unchanged', () => {
    assert.deepEqual(STAGE_CONTEXT_MIN, {
      relevant_file_discovery: 32_000,
      root_cause_analysis: 128_000,
      evidence_extraction: 200_000,
      solution_generation: 32_000,
      patch_generation: 32_000,
    });
  });

  await check('automatic selection: 65,536 context passes 32K stages only', () => {
    const catalog = [localModel()];
    const expectEligible: Array<[StageKey, boolean]> = [
      ['relevant_file_discovery', true],
      ['root_cause_analysis', false],
      ['evidence_extraction', false],
      ['solution_generation', true],
      ['patch_generation', true],
    ];
    for (const [stage, eligible] of expectEligible) {
      const candidates = getAutomaticStageCandidates(catalog, stage);
      const hasLocal = candidates.some((c) => c.provider === 'local' && c.model === 'local');
      assert.equal(
        hasLocal,
        eligible,
        `local/local automatic eligibility for ${stage} must stay ${eligible}`
      );
    }
  });

  await check('manual/automatic selection still reaches the local model', () => {
    // Balanced setup on a 32K stage: the model is selectable (not gated away).
    const pick = selectForStage('balanced', 'relevant_file_discovery', [localModel()]);
    assert.equal(pick?.provider, 'local');
    assert.equal(pick?.model, 'local');
    // 128K stage: automatic selection must NOT pick it (context gate preserved).
    const gated = selectForStage('balanced', 'root_cause_analysis', [localModel()]);
    assert.equal(gated, null, 'root cause must not auto-select a 65K model');
  });
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
