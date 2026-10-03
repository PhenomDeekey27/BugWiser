// Task U — local context metadata: meta.n_ctx propagation.
//
// The llama.cpp endpoint reports `{ id, meta: { n_ctx: 65536 } }` but the
// catalog treated the model as 128K because normalizeLocalModel never read
// that field. These checks prove the fix without network, DB, or paid calls:
// raw payloads only, plus the existing stage-gate helpers.
//
// No provider/model names are hardcoded in product code; fixtures below use
// generic ids (the only literals are the generic OpenAI-compatible field
// shapes `meta.n_ctx`, `max_model_len`, `context_length`, `n_ctx`).

import { strict as assert } from 'node:assert';
import { normalizeProviderModel } from './lib/ai/catalog/normalizers';
import {
  buildAutomaticPool,
  selectForStage,
  STAGE_CONTEXT_MIN,
  getFreeStageCandidates,
  isConfirmedFreeModel,
} from './lib/ai/catalog/stageSelection';
import type { CatalogModel } from './app/models/page';

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

function localModel(raw: Record<string, unknown>) {
  const m = normalizeProviderModel('local', raw);
  assert.ok(m, `expected ${JSON.stringify(raw.id)} to normalize`);
  return m!;
}

function catalogFromContext(contextWindow: number, modelId = 'server-a'): CatalogModel {
  return {
    providerId: 'local',
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
  await check('llama.cpp shape: meta.n_ctx 65536 propagates as live context', () => {
    const m = localModel({
      id: 'local',
      object: 'model',
      owned_by: 'llamacpp',
      meta: { n_ctx: 65536, n_ctx_train: 262144 },
    });
    assert.equal(m.contextWindow, 65536);
    assert.equal(m.contextSource, 'live');
  });

  await check('n_ctx_train alone is NOT servable capacity (ignored)', () => {
    const m = localModel({ id: 'server-a', meta: { n_ctx_train: 262144 } });
    assert.equal(m.contextWindow, 128_000, 'must fall back to honest default, not training context');
    assert.equal(m.contextSource, 'default');
  });

  await check('existing top-level fields keep priority over meta.n_ctx', () => {
    const viaMax = localModel({ id: 'server-a', max_model_len: 32768, meta: { n_ctx: 65536 } });
    assert.equal(viaMax.contextWindow, 32768);
    assert.equal(viaMax.contextSource, 'live');

    const viaCtxLen = localModel({ id: 'server-b', context_length: 131072, meta: { n_ctx: 65536 } });
    assert.equal(viaCtxLen.contextWindow, 131072);
    assert.equal(viaCtxLen.contextSource, 'live');
  });

  await check('top-level n_ctx is accepted as a generic fallback', () => {
    const m = localModel({ id: 'server-a', n_ctx: 98304 });
    assert.equal(m.contextWindow, 98304);
    assert.equal(m.contextSource, 'live');
  });

  await check('missing meta safely falls back to honest 128K default', () => {
    const m = localModel({ id: 'server-a' });
    assert.equal(m.contextWindow, 128_000);
    assert.equal(m.contextSource, 'default');
  });

  await check('untrustworthy meta values never poison context (all default safely)', () => {
    const bad: Array<{ label: string; raw: Record<string, unknown> }> = [
      { label: 'null meta', raw: { id: 'server-a', meta: null } },
      { label: 'array meta', raw: { id: 'server-a', meta: [] } },
      { label: 'missing n_ctx', raw: { id: 'server-a', meta: {} } },
      { label: 'null n_ctx', raw: { id: 'server-a', meta: { n_ctx: null } } },
      { label: 'string n_ctx', raw: { id: 'server-a', meta: { n_ctx: '65536' } } },
      { label: 'zero n_ctx', raw: { id: 'server-a', meta: { n_ctx: 0 } } },
      { label: 'negative n_ctx', raw: { id: 'server-a', meta: { n_ctx: -1024 } } },
      { label: 'NaN n_ctx', raw: { id: 'server-a', meta: { n_ctx: NaN } } },
      { label: 'Infinity n_ctx', raw: { id: 'server-a', meta: { n_ctx: Infinity } } },
    ];
    for (const { label, raw } of bad) {
      const m = localModel(raw);
      assert.equal(m.contextWindow, 128_000, label);
      assert.equal(m.contextSource, 'default', label);
    }
  });

  await check('context gates: 65K model passes 32K stages, fails 128K/200K (gates NOT weakened)', () => {
    assert.equal(STAGE_CONTEXT_MIN.relevant_file_discovery, 32_000);
    assert.equal(STAGE_CONTEXT_MIN.root_cause_analysis, 128_000);
    assert.equal(STAGE_CONTEXT_MIN.evidence_extraction, 200_000);
    const tiny = catalogFromContext(65536, 'server-a');
    const discovery = buildAutomaticPool([tiny], 'relevant_file_discovery', {
      coding: 3, reasoning: 1, speed: 3, longContext: 1,
    });
    assert.equal(discovery.length, 1, '65K >= 32K passes discovery');
    const root = buildAutomaticPool([tiny], 'root_cause_analysis', {
      coding: 2, reasoning: 3, speed: 1, longContext: 2,
    });
    assert.equal(root.length, 0, '65K < 128K excluded from root cause');
    const evidence = buildAutomaticPool([tiny], 'evidence_extraction', {
      coding: 2, reasoning: 2, speed: 3, longContext: 3,
    });
    assert.equal(evidence.length, 0, '65K < 200K excluded from evidence');
  });

  await check('128K default still passes the inclusive 128K root-cause gate', () => {
    const def = catalogFromContext(128_000, 'server-a');
    const pool = buildAutomaticPool([def], 'root_cause_analysis', {
      coding: 2, reasoning: 3, speed: 1, longContext: 2,
    });
    assert.equal(pool.length, 1, 'gate is inclusive (>=)');
  });

  await check('unknown pricing stays unknown (never free) even with live context', () => {
    const m = localModel({ id: 'server-a', meta: { n_ctx: 65536 } });
    assert.equal(m.price.isFree, false);
    assert.equal(m.priceSource, 'unknown');
    assert.equal(m.price.input, null);
    assert.equal(m.price.output, null);
    const catalog = catalogFromContext(65536, 'server-a');
    assert.equal(isConfirmedFreeModel([catalog], 'local', 'server-a'), false);
    assert.deepEqual(getFreeStageCandidates([catalog], 'relevant_file_discovery'), []);
  });

  await check('balanced/quality still select a 65K local where eligible (no scoring change)', () => {
    const catalog = [catalogFromContext(65536, 'server-a')];
    const balanced = selectForStage('balanced', 'relevant_file_discovery', catalog);
    assert.equal(balanced?.provider, 'local');
    assert.equal(balanced?.model, 'server-a');
    const quality = selectForStage('quality', 'relevant_file_discovery', catalog);
    assert.equal(quality?.provider, 'local');
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
