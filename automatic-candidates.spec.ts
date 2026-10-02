import { strict as assert } from 'node:assert';
import {
  getAutomaticStageCandidates,
  getFreeStageCandidates,
} from './lib/ai/catalog/stageSelection';
import { selectModelsForTask, type AutomaticCandidate } from './lib/ai/config';
import { buildRunChain } from './lib/ai/model-router';
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
    scores: { coding: 3, reasoning: 3, speed: 3, longContext: 3 },
    valueScore: 50,
    tags: [],
    fit: 0,
    stageFit: {},
    available: true,
    ...p,
  };
}

const freeBig = cat({
  providerId: 'openrouter',
  modelId: 'models/free-large',
  contextWindow: 200_000,
  price: { input: 0, output: 0, isFree: true },
  scores: { coding: 5, reasoning: 5, speed: 5, longContext: 5 },
});

const paidMid = cat({
  providerId: 'openrouter',
  modelId: 'models/paid-mid',
  contextWindow: 128_000,
  price: { input: 3, output: 9, isFree: false },
  scores: { coding: 4, reasoning: 4, speed: 4, longContext: 4 },
});

const unknownPrice = cat({
  providerId: 'deepseek',
  modelId: 'models/unknown-price',
  contextWindow: 128_000,
  price: { input: null, output: null, isFree: false },
  scores: { coding: 3, reasoning: 3, speed: 3, longContext: 3 },
});

const tiny = cat({
  providerId: 'opencode',
  modelId: 'models/tiny',
  contextWindow: 16_000,
  price: { input: 0, output: 0, isFree: true },
});

const ids = (rows: Array<{ provider: string; model: string }>): string[] =>
  rows.map((r) => `${r.provider}/${r.model}`);

async function main(): Promise<void> {
  await check('automatic candidates include paid AND free models (non-strict eligibility), stage-score ordered', () => {
    const out = getAutomaticStageCandidates([freeBig, paidMid, unknownPrice], 'root_cause_analysis');
    assert.deepEqual(ids(out), [
      'openrouter/models/free-large',
      'openrouter/models/paid-mid',
      'deepseek/models/unknown-price',
    ]);
    assert.equal(out[0].contextWindow, 200_000);
  });

  await check('strict-free pool still free-only: paid and unknown pricing excluded, unknown never treated as free', () => {
    const out = getFreeStageCandidates([freeBig, paidMid, unknownPrice, tiny], 'root_cause_analysis');
    assert.deepEqual(ids(out), ['openrouter/models/free-large']);
  });

  await check('stage context gate: model below stage minimum excluded from automatic candidates', () => {
    assert.deepEqual(getAutomaticStageCandidates([tiny], 'root_cause_analysis'), []);
    const evidence = getAutomaticStageCandidates([freeBig, paidMid], 'evidence_extraction');
    assert.deepEqual(ids(evidence), ['openrouter/models/free-large']);
  });

  await check('unknown stage key and empty catalog -> empty candidates', () => {
    assert.deepEqual(getAutomaticStageCandidates([freeBig], 'not_a_stage'), []);
    assert.deepEqual(getAutomaticStageCandidates([], 'root_cause_analysis'), []);
  });

  const catalogChain: AutomaticCandidate[] = [
    { provider: 'openrouter', model: 'models/paid-mid', contextWindow: 128_000 },
    { provider: 'openrouter', model: 'models/free-large', contextWindow: 200_000 },
  ];

  await check('selectModelsForTask: catalog candidates returned free-first when confirmed-free ids provided', () => {
    const out = selectModelsForTask(
      'root_cause_analysis',
      1000,
      new Set(),
      new Set(['openrouter']),
      new Set(['openrouter/models/free-large']),
      catalogChain
    );
    assert.deepEqual(out, [
      { provider: 'openrouter', model: 'models/free-large' },
      { provider: 'openrouter', model: 'models/paid-mid' },
    ]);
  });

  await check('selectModelsForTask: no free ids set -> input order kept, paid candidates eligible', () => {
    const out = selectModelsForTask(
      'root_cause_analysis',
      1000,
      new Set(),
      new Set(['openrouter']),
      undefined,
      catalogChain
    );
    assert.deepEqual(out, [
      { provider: 'openrouter', model: 'models/paid-mid' },
      { provider: 'openrouter', model: 'models/free-large' },
    ]);
  });

  await check('selectModelsForTask: catalog candidate from a provider without credentials dropped, registry fallback used', () => {
    const out = selectModelsForTask(
      'root_cause_analysis',
      1000,
      new Set(),
      new Set(['deepseek']),
      undefined,
      catalogChain
    );
    assert.ok(out.length > 0, 'expected registry fallback candidates');
    assert.ok(out.every((m) => m.provider === 'deepseek'), JSON.stringify(out));
    assert.ok(!out.some((m) => m.model === 'models/paid-mid'));
  });

  await check('selectModelsForTask: dynamic context gate drops candidates smaller than 2x estimated tokens', () => {
    const chain: AutomaticCandidate[] = [
      { provider: 'openrouter', model: 'small-ctx', contextWindow: 64_000 },
      { provider: 'openrouter', model: 'large-ctx', contextWindow: 128_000 },
    ];
    const out = selectModelsForTask(
      'root_cause_analysis',
      50_000,
      new Set(),
      new Set(['openrouter']),
      undefined,
      chain
    );
    assert.deepEqual(out, [{ provider: 'openrouter', model: 'large-ctx' }]);
  });

  await check('selectModelsForTask: empty or absent catalog candidates -> registry default path unchanged', () => {
    const withoutParam = selectModelsForTask(
      'root_cause_analysis',
      1000,
      new Set(),
      new Set(['openrouter']),
      undefined,
      undefined
    );
    const withEmpty = selectModelsForTask(
      'root_cause_analysis',
      1000,
      new Set(),
      new Set(['openrouter']),
      undefined,
      []
    );
    assert.ok(withoutParam.length > 0, 'expected registry candidates');
    assert.deepEqual(withEmpty, withoutParam);
  });

  await check('benchmark env override still takes precedence over catalog candidates', () => {
    process.env.BENCHMARK_DEEPSEEK = 'true';
    try {
      const out = selectModelsForTask(
        'root_cause_analysis',
        1000,
        new Set(),
        new Set(['openrouter']),
        undefined,
        catalogChain
      );
      assert.deepEqual(out, [{ provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' }]);
    } finally {
      delete process.env.BENCHMARK_DEEPSEEK;
    }
  });

  await check('strict free chain never includes autoChain entries (catalog candidates cannot leak in)', () => {
    const chain = buildRunChain(
      { task: 'root_cause_analysis', strictFree: true, freeCandidates: [{ provider: 'openrouter', model: 'models/free-large' }] },
      [{ provider: 'openrouter', model: 'models/paid-mid' }],
      []
    );
    assert.deepEqual(chain, [{ provider: 'openrouter', model: 'models/free-large' }]);
  });

  await check('strict free fails closed: empty pool and unavailable marker both throw structured error', () => {
    assert.throws(
      () => buildRunChain({ task: 'root_cause_analysis', strictFree: true, freeCandidates: [] }, [], []),
      /No free model is available/
    );
    assert.throws(
      () =>
        buildRunChain(
          { task: 'root_cause_analysis', strictFree: true, stageOverrideUnavailable: true, freeCandidates: [{ provider: 'openrouter', model: 'm' }] },
          [],
          []
        ),
      /No free model is available/
    );
  });

  await check('non-strict manual chain keeps manual primary with catalog autoChain as tail', () => {
    const chain = buildRunChain(
      { task: 'root_cause_analysis', manualModel: { provider: 'openai', model: 'manual-1' } },
      [
        { provider: 'openrouter', model: 'models/free-large' },
        { provider: 'openrouter', model: 'models/paid-mid' },
      ],
      []
    );
    assert.deepEqual(chain, [
      { provider: 'openai', model: 'manual-1' },
      { provider: 'openrouter', model: 'models/free-large' },
      { provider: 'openrouter', model: 'models/paid-mid' },
    ]);
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
