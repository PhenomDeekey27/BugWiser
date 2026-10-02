// Tasks N + P — Local LLM catalog + stage-selection coverage.
//
// Proves that verified local OpenAI-compatible models participate in the
// EXISTING catalog model types and the EXISTING stage-selection pipeline
// (no local-specific selection system), that local pricing semantics stay
// honest (unknown ≠ free), and that Strict Free can never be bypassed by a
// local model with unknown pricing.
//
// Pure/unit tests: HTTP is mocked at the probe boundary, the connection
// store is an injected fake DB — NO real network, NO real database, NO
// secrets, NO hardcoded product model names.

import { strict as assert } from 'node:assert';
import type { createBackgroundClient } from './lib/supabase/background';
import { fetchLocalModels } from './lib/ai/catalog/live';
import { toCatalogModel } from './lib/ai/catalog/toCatalogModel';
import {
  buildAutomaticPool,
  getAutomaticStageCandidates,
  getFreeStageCandidates,
  isConfirmedFreeModel,
  prepareStrictFreeRun,
  selectForStage,
  STAGE_CONTEXT_MIN,
  MAX_CANDIDATES_PER_PROVIDER,
  type StageKey,
} from './lib/ai/catalog/stageSelection';
import { estimateCostUsd } from './lib/ai/catalog/cost';
import { buildProviderFingerprint } from './lib/ai/model-intelligence';
import { getProviderConnections, resolveLocalEndpoint } from './lib/ai/connection/service';
import type { ClassifiedModel } from './lib/ai/model-intelligence';
import type { ModelDefinition } from './lib/ai/catalog/types';
import type { CatalogModel } from './app/models/page';
import type { FetchLike } from './lib/ai/connection/testConnection';

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

// ── Discovery-side fixtures (mocked models endpoint) ──

function mockFetch(payload: unknown): { fn: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fn: FetchLike = async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => payload,
    };
  };
  return { fn, calls };
}

/**
 * The shared discovery → classification passthrough the pipeline applies to
 * every provider (discoverModels maps NormalizedModel fields verbatim and
 * classification fills the score block). Scores are passed in so stage
 * ordering is deterministic; pricing/context/capability fields come ONLY
 * from the discovery output — never re-derived here.
 */
function classified(def: ModelDefinition, scores: { coding: number; reasoning: number; speed: number; longContext: number }): ClassifiedModel {
  return {
    provider: def.providerId,
    modelId: def.modelId,
    displayName: def.displayName,
    isFree: def.price.isFree,
    inputPrice: def.price.input,
    outputPrice: def.price.output,
    priceSource: def.priceSource ?? 'unknown',
    priceFetchedAt: null,
    contextWindow: def.contextWindow,
    maxOutputTokens: def.maxOutputTokens,
    supportsReasoning: def.supportsReasoning,
    supportsToolCalling: def.supportsToolCalling,
    supportsStructuredOutput: def.supportsStructuredOutput,
    supportsCoding: def.capabilities.includes('coding'),
    supportsVision: def.capabilities.includes('vision'),
    availability: def.availability,
    source: 'live',
    contextSource: def.contextSource,
    freeAuthority: def.freeAuthority,
    capabilityProvenance: def.capabilityProvenance,
    metadataConfidence: def.metadataConfidence,
    codingScore: scores.coding,
    reasoningScore: scores.reasoning,
    speedScore: scores.speed,
    longContextScore: scores.longContext,
    valueScore: 50,
    overallScore: 50,
    recommendedCategories: [],
    scoreOrigin: 'deterministic',
  };
}

const EVEN = { coding: 50, reasoning: 50, speed: 50, longContext: 50 };

async function discoverLocal(payload: unknown): Promise<ModelDefinition[]> {
  const { fn } = mockFetch(payload);
  return fetchLocalModels({
    apiKey: '',
    baseUrl: 'http://127.0.0.1:8000/v1',
    probeDeps: { fetchFn: fn },
  });
}

// ── Stage-selection fixtures (existing CatalogModel shape) ──

function cat(p: Partial<CatalogModel> & { providerId: string; modelId: string }): CatalogModel {
  return {
    displayName: p.modelId,
    contextWindow: 128_000,
    maxOutputTokens: null,
    price: { input: null, output: null, isFree: false },
    priceSource: 'unknown',
    priceFetchedAt: null,
    supportsReasoning: false,
    supportsToolCalling: false,
    supportsStructuredOutput: false,
    capabilities: [],
    availability: 'available',
    scores: { coding: 50, reasoning: 50, speed: 50, longContext: 50 },
    valueScore: 50,
    tags: [],
    fit: 0,
    stageFit: {},
    available: true,
    ...p,
  };
}

/** Local model with unknown/absent pricing — the common self-hosted case. */
function localUnknown(modelId: string, scores?: Partial<CatalogModel['scores']>, contextWindow?: number): CatalogModel {
  return cat({
    providerId: 'local',
    modelId,
    contextWindow: contextWindow ?? 128_000,
    scores: { coding: 50, reasoning: 50, speed: 50, longContext: 50, ...scores },
    price: { input: null, output: null, isFree: false },
    priceSource: 'unknown',
    valueScore: 50,
  });
}

/** Local model whose endpoint advertised explicit 0/0 pricing (explicit-zero authority). */
function localFree(modelId: string, scores?: Partial<CatalogModel['scores']>): CatalogModel {
  return cat({
    providerId: 'local',
    modelId,
    scores: { coding: 50, reasoning: 50, speed: 50, longContext: 50, ...scores },
    price: { input: 0, output: 0, isFree: true },
    priceSource: 'live',
    valueScore: 50,
  });
}

function externalFree(modelId: string, scores?: Partial<CatalogModel['scores']>): CatalogModel {
  return cat({
    providerId: 'openrouter',
    modelId,
    scores: { coding: 50, reasoning: 50, speed: 50, longContext: 50, ...scores },
    price: { input: 0, output: 0, isFree: true },
    priceSource: 'live',
    valueScore: 50,
  });
}

function externalPaid(modelId: string, input: number, output: number, scores?: Partial<CatalogModel['scores']>): CatalogModel {
  return cat({
    providerId: 'openrouter',
    modelId,
    scores: { coding: 50, reasoning: 50, speed: 50, longContext: 50, ...scores },
    price: { input, output, isFree: false },
    priceSource: 'live',
    valueScore: 50,
  });
}

const ROOT: StageKey = 'root_cause_analysis';

async function main(): Promise<void> {
  // ── Catalog: discovery → existing catalog types → stage selection ──

  await check('local models appear after discovery and flow into stage-selection candidates', async () => {
    const defs = await discoverLocal({ data: [{ id: 'local-alpha' }, { id: 'local-beta', max_model_len: 262_144 }] });
    assert.equal(defs.length, 2);
    const catalog = defs.map((d) => toCatalogModel(classified(d, EVEN)));
    const candidates = getAutomaticStageCandidates(catalog, ROOT);
    assert.ok(
      candidates.some((c) => c.provider === 'local' && c.model === 'local-alpha'),
      'discovered local model must be an automatic stage candidate'
    );
    assert.ok(candidates.some((c) => c.provider === 'local' && c.model === 'local-beta'));
  });

  await check('discovered local metadata is normalized into the existing catalog model type', async () => {
    const defs = await discoverLocal({ data: [{ id: 'local-meta', max_model_len: 200_000 }] });
    const def = defs[0];
    assert.equal(def.providerId, 'local');
    assert.equal(def.contextWindow, 200_000);
    assert.equal(def.contextSource, 'live');
    assert.equal(def.priceSource, 'unknown');
    assert.equal(def.price.isFree, false);
    assert.equal(def.freeAuthority, 'none');
    const model = toCatalogModel(classified(def, EVEN));
    assert.equal(model.providerId, 'local');
    assert.equal(model.priceSource, 'unknown');
    assert.equal(model.price.isFree, false);
    assert.equal(model.contextWindow, 200_000);
    assert.equal(model.available, true);
  });

  await check('duplicate model IDs are removed at discovery (first entry wins)', async () => {
    const defs = await discoverLocal({
      data: [
        { id: 'local-dup', max_model_len: 100_000 },
        { id: 'local-dup', max_model_len: 999_999 },
        { id: 'local-other' },
      ],
    });
    assert.deepEqual(defs.map((d) => d.modelId).sort(), ['local-dup', 'local-other']);
    assert.equal(defs.find((d) => d.modelId === 'local-dup')?.contextWindow, 100_000, 'first entry wins');
  });

  await check('missing pricing stays unknown end-to-end — never $0, never Free', async () => {
    const defs = await discoverLocal({ data: [{ id: 'local-unpriced' }] });
    const model = toCatalogModel(classified(defs[0], EVEN));
    assert.equal(model.price.input, null);
    assert.equal(model.price.output, null);
    assert.equal(model.price.isFree, false);
    assert.equal(model.priceSource, 'unknown');
    const estimate = estimateCostUsd(
      { inputPricePerMillion: model.price.input, outputPricePerMillion: model.price.output, isFree: model.price.isFree },
      { inputTokens: 12_000, outputTokens: 2_000 }
    );
    assert.equal(estimate.status, 'unknown', 'unknown pricing must not collapse to $0');
    assert.equal(estimate.usd, null);
    assert.equal(isConfirmedFreeModel([model], 'local', 'local-unpriced'), false);
  });

  await check('explicit 0/0 pricing on a local endpoint is confirmed free via explicit-zero authority', async () => {
    const defs = await discoverLocal({ data: [{ id: 'local-zero', pricing: { prompt: '0', completion: '0' } }] });
    const def = defs[0];
    assert.equal(def.price.isFree, true);
    assert.equal(def.freeAuthority, 'explicit-zero');
    assert.equal(def.priceSource, 'live');
    const model = toCatalogModel(classified(def, EVEN));
    assert.equal(isConfirmedFreeModel([model], 'local', 'local-zero'), true);
  });

  await check('context requirements hold for all five stages (existing STAGE_CONTEXT_MIN gates)', async () => {
    const defs = await discoverLocal({
      data: [
        { id: 'ctx-64', context_length: 65_536 },
        { id: 'ctx-128' }, // no context in payload → honest 128K default
        { id: 'ctx-256', max_model_len: 256_000 },
      ],
    });
    const catalog = defs.map((d) => toCatalogModel(classified(d, EVEN)));
    const eligible = (stage: StageKey) =>
      new Set(getAutomaticStageCandidates(catalog, stage).filter((c) => c.provider === 'local').map((c) => c.model));

    const discovery = eligible('relevant_file_discovery');
    assert.ok(discovery.has('ctx-64') && discovery.has('ctx-128') && discovery.has('ctx-256'));

    const rootCause = eligible('root_cause_analysis');
    assert.ok(!rootCause.has('ctx-64'), '64K local model below the 128K root-cause minimum');
    assert.ok(rootCause.has('ctx-128') && rootCause.has('ctx-256'));

    const evidence = eligible('evidence_extraction');
    assert.ok(!evidence.has('ctx-64') && !evidence.has('ctx-128'), 'default 128K local model cannot serve the 200K evidence stage');
    assert.ok(evidence.has('ctx-256'), 'local model advertising ≥200K context serves evidence extraction');

    const solution = eligible('solution_generation');
    const patch = eligible('patch_generation');
    assert.ok(solution.has('ctx-64') && solution.has('ctx-128') && solution.has('ctx-256'));
    assert.ok(patch.has('ctx-64') && patch.has('ctx-128') && patch.has('ctx-256'));

    assert.equal(STAGE_CONTEXT_MIN.evidence_extraction, 200_000, 'context minimums unchanged');
  });

  await check('unavailable (disconnected) local provider is excluded from discovery inputs', async () => {
    const emptyDb = {
      from: () => ({
        select: () => {
          const builder = {
            eq: () => builder,
            maybeSingle: async () => ({ data: null, error: null }),
            then: (onFulfilled?: unknown, onRejected?: unknown) =>
              Promise.resolve({ data: [], error: null }).then(onFulfilled as never, onRejected as never),
          };
          return builder;
        },
      }),
    } as unknown as ReturnType<typeof createBackgroundClient>;

    const connections = await getProviderConnections('user-x', emptyDb);
    assert.equal(connections.local, false, 'no connected local row ⇒ disconnected');
    assert.equal(await resolveLocalEndpoint('user-x', emptyDb), null, 'no endpoint ⇒ discovery is skipped (0 HTTP)');

    const fingerprint = buildProviderFingerprint({
      chutes: false, openrouter: true, opencode: false, openai: false,
      gemini: false, deepseek: false, zai: false, local: false,
    });
    assert.equal(fingerprint, 'openrouter');
    assert.ok(!fingerprint.split(':').includes('local'), 'fingerprint never advertises a disconnected local provider');

    let httpCalls = 0;
    const counting: FetchLike = async () => {
      httpCalls++;
      throw new Error('network must not run');
    };
    await assert.rejects(
      () => fetchLocalModels({ apiKey: '', probeDeps: { fetchFn: counting } }),
      /no base URL/i
    );
    assert.equal(httpCalls, 0, 'missing endpoint ⇒ zero HTTP');
  });

  await check('provider caps and family grouping apply to local models unchanged', async () => {
    const catalog = Array.from({ length: 6 }, (_, i) => localUnknown(`cap-local-${i + 1}`));
    const pool = buildAutomaticPool(catalog, ROOT, { coding: 2, reasoning: 3, speed: 1, longContext: 2 });
    const locals = pool.filter((m) => m.providerId === 'local');
    assert.ok(locals.length <= MAX_CANDIDATES_PER_PROVIDER, 'local provider is capped by the existing top-N rule');

    // Same near-duplicate family (access-tier suffix stripped) ⇒ one
    // representative, with the confirmed-free variant winning the tiebreak.
    const dupFamily = [
      localUnknown('family-model'),
      localFree('family-model:free'),
    ];
    const familyPool = buildAutomaticPool(dupFamily, ROOT, { coding: 2, reasoning: 3, speed: 1, longContext: 2 });
    assert.equal(familyPool.length, 1, 'local family grouping is provider-scoped and unchanged');
    assert.equal(familyPool[0].modelId, 'family-model:free', 'free variant wins the family representative tiebreak');
  });

  // ── Strategy semantics (existing Free / Balanced / Quality rules) ──

  await check('Free: picks the confirmed-free local model; unknown-priced local never wins', () => {
    const pick = selectForStage('free', ROOT, [
      localUnknown('free-decoy', { coding: 99, reasoning: 99, speed: 99, longContext: 99 }),
      localFree('free-eligible', { coding: 80, reasoning: 80, speed: 80, longContext: 80 }),
    ]);
    assert.equal(pick?.provider, 'local');
    assert.equal(pick?.model, 'free-eligible');
    assert.equal(pick?.isFree, true);
    assert.equal(pick?.unavailable, undefined);
  });

  await check('Free: unknown-priced local cannot displace a confirmed-free external model', () => {
    const pick = selectForStage('free', ROOT, [
      localUnknown('free-decoy', { coding: 99, reasoning: 99, speed: 99, longContext: 99 }),
      externalFree('ext-free', { coding: 80, reasoning: 80, speed: 80, longContext: 80 }),
    ]);
    assert.equal(pick?.provider, 'openrouter');
    assert.equal(pick?.model, 'ext-free');
  });

  await check('empty local Free pool: explicit unavailable, never a paid fallback', () => {
    const pick = selectForStage('free', ROOT, [localUnknown('only-unpriced')]);
    assert.ok(pick?.unavailable, 'stage must be marked unavailable');
    assert.equal(pick?.provider, null);
    assert.equal(pick?.model, null);
  });

  await check('Balanced: explicit-zero local wins on quality at zero cost', () => {
    const pick = selectForStage('balanced', ROOT, [
      localFree('local-zero', { coding: 90, reasoning: 90, speed: 90, longContext: 90 }),
      externalPaid('ext-expensive', 50, 150, { coding: 95, reasoning: 95, speed: 95, longContext: 95 }),
    ]);
    assert.equal(pick?.model, 'local-zero', 'zero-cost local model outranks the expensive paid model');
  });

  await check('Balanced: unknown pricing takes the worst cost tier (never treated as free)', () => {
    const pick = selectForStage('balanced', ROOT, [
      localUnknown('local-unpriced', { coding: 90, reasoning: 90, speed: 90, longContext: 90 }),
      externalPaid('ext-cheap', 1, 3, { coding: 50, reasoning: 50, speed: 50, longContext: 50 }),
    ]);
    assert.equal(pick?.model, 'ext-cheap', 'known-priced model outranks an unknown-priced one regardless of score gap');
  });

  await check('Balanced: when ALL candidates are unknown, the best stage score wins (local can win)', () => {
    const pick = selectForStage('balanced', ROOT, [
      localUnknown('local-unknown-best', { coding: 95, reasoning: 95, speed: 95, longContext: 95 }),
      externalPaid('ext-unknown', null as unknown as number, null as unknown as number, { coding: 50, reasoning: 50, speed: 50, longContext: 50 }),
    ]);
    assert.equal(pick?.model, 'local-unknown-best');
  });

  await check('Quality: explicit-zero local wins the cost comparison among comparable candidates', () => {
    const pick = selectForStage('quality', ROOT, [
      localFree('local-zero', { coding: 90, reasoning: 90, speed: 90, longContext: 90 }),
      externalPaid('ext-known', 1, 3, { coding: 90, reasoning: 90, speed: 90, longContext: 90 }),
    ]);
    assert.equal(pick?.model, 'local-zero');
  });

  await check('Quality: known-priced model wins the tie against unknown-priced local', () => {
    const pick = selectForStage('quality', ROOT, [
      localUnknown('local-unpriced', { coding: 100, reasoning: 100, speed: 100, longContext: 100 }),
      externalPaid('ext-known', 1, 3, { coding: 96, reasoning: 96, speed: 96, longContext: 96 }),
    ]);
    assert.equal(pick?.model, 'ext-known', 'unknown pricing must never beat known pricing at equal capability');
  });

  await check('Quality: unknown-priced local is eligible only as the sole qualified candidate', () => {
    const pick = selectForStage('quality', ROOT, [
      localUnknown('local-unpriced', { coding: 100, reasoning: 100, speed: 100, longContext: 100 }),
      externalPaid('ext-weaker', 1, 3, { coding: 80, reasoning: 80, speed: 80, longContext: 80 }),
    ]);
    assert.equal(pick?.model, 'local-unpriced');
  });

  // ── STRICT FREE safety (critical) ──

  await check('STRICT FREE: local with unknown pricing never enters the free candidate pool', () => {
    const catalog = [
      localUnknown('local-unpriced', { coding: 99, reasoning: 99, speed: 99, longContext: 99 }),
      localFree('local-zero', { coding: 80, reasoning: 80, speed: 80, longContext: 80 }),
      externalPaid('ext-paid', 1, 3, { coding: 99, reasoning: 99, speed: 99, longContext: 99 }),
    ];
    const free = getFreeStageCandidates(catalog, ROOT);
    assert.deepEqual(free, [{ provider: 'local', model: 'local-zero' }]);

    // Gateway-derived confirmed-free set (same derivation gateway.generate
    // uses): unknown-priced local must never appear.
    const confirmed = new Set(catalog.filter((m) => m.price.isFree).map((m) => `${m.providerId}/${m.modelId}`));
    assert.ok(!confirmed.has('local/local-unpriced'), 'unknown pricing is never externally free');
    assert.ok(confirmed.has('local/local-zero'));
  });

  await check('STRICT FREE: verified eligible local model qualifies ONLY via explicit-zero authority', () => {
    const catalog = [localFree('local-zero', { coding: 80, reasoning: 80, speed: 80, longContext: 80 })];
    const plan = prepareStrictFreeRun(catalog, ROOT, null);
    assert.deepEqual(plan.freeCandidates, [{ provider: 'local', model: 'local-zero' }]);
    assert.equal(isConfirmedFreeModel(catalog, 'local', 'local-zero'), true);
    assert.equal(isConfirmedFreeModel(catalog, 'local', 'missing-model'), false, 'absent catalog row is never free');
  });

  await check('STRICT FREE: an unknown-priced local stage override is dropped, a confirmed-free one is kept', () => {
    const catalog = [localFree('local-zero'), localUnknown('local-unpriced')];
    const dropped = prepareStrictFreeRun(catalog, ROOT, { provider: 'local', model: 'local-unpriced' });
    assert.equal(dropped.stageOverride, null, 'unconfirmed override must never execute under Strict Free');

    const kept = prepareStrictFreeRun(catalog, ROOT, { provider: 'local', model: 'local-zero' });
    assert.deepEqual(kept.stageOverride, { provider: 'local', model: 'local-zero' });
  });

  await check('STRICT FREE: catalog with only unknown-priced local models yields an empty free pool', () => {
    const catalog = [localUnknown('a'), localUnknown('b')];
    assert.deepEqual(getFreeStageCandidates(catalog, ROOT), []);
    const plan = prepareStrictFreeRun(catalog, ROOT, null);
    assert.deepEqual(plan.freeCandidates, []);
    assert.equal(plan.stageOverride, null);
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
