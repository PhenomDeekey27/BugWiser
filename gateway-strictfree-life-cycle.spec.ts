// Task AC — Model preference/selection lifecycle trace (regression suite).
//
// Traces a /models selection through REAL analysis execution for all five
// stages and captures the boundary values at each step:
//
//   /models selection → buildStageOverrides → buildPreferenceSaveBody →
//   (persisted preference) → resolveAnalysisRouting → isStrictFreeSelection →
//   prepareStrictFreeRun → buildRunChain → routed provider/model →
//   buildStageAssignmentRecord
//
// Regression targets fixed in this task:
//   1. A saved per-stage selection survives into real analysis execution for
//      every one of the five stages.
//   2. An explicitly selected stage model (origin 'manual') is NOT replaced by
//      the Free strategy.
//   3. Automatic strategy still uses automatic catalog candidates.
//   4. Each stage reads its OWN saved assignment (no cross-stage leakage).
//   5. Strict Free still never falls back to paid or unknown-priced models.
//
// Pure boundaries + injected fakes only: no network, no database, no AI calls,
// no secrets. Provenance/catalog fixtures are synthetic.

import { strict as assert } from 'node:assert';

import { resolveAnalysisRouting, isStrictFreeSelection, type ResolvedRouting, type ResolvedStageOverride } from './lib/ai/routing';
import { buildRunChain, type RunRequest } from './lib/ai/model-router';
import {
  prepareStrictFreeRun,
  getAutomaticStageCandidates,
  getFreeStageCandidates,
  isConfirmedFreeModel,
  STAGE_CONTEXT_MIN,
  type StageKey,
} from './lib/ai/catalog/stageSelection';
import { buildStageOverrides, resolveAppliedOverride } from './lib/ai/catalog/stageOverrides';
import { buildPreferenceSaveBody } from './lib/ai/preferenceMode';
import { buildStageAssignmentRecord } from './lib/ai/analysis-selection';
import type { ModelPreference, SelectedStrategy } from './lib/ai/preferences';
import type { StageOverrideEntry } from './lib/ai/catalog/overrideReconcile';
import type { ProviderName } from './lib/ai/providers/registry';
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

// ── Stage table (one source of truth for all five stages) ────────────────────

const STAGES: StageKey[] = [
  'relevant_file_discovery',
  'root_cause_analysis',
  'evidence_extraction',
  'solution_generation',
  'patch_generation',
];

// A local model that advertises its context window (262144) so it clears every
// stage gate, and a second one at the honest 128K default (clears all but
// evidence_extraction's 200K).
const LOCAL_BIG = 'local/server-262k';
const LOCAL_DEFAULT = 'local/server-128k';
const PAID = 'openrouter/paid-1';

// ── Fakes ────────────────────────────────────────────────────────────────────

const LOCAL_ENDPOINT = { baseUrl: 'http://127.0.0.1:18000/v1' };

function catalogModel(
  providerId: string,
  modelId: string,
  opts: { contextWindow: number; input: number | null; output: number | null; isFree: boolean; priceSource: string }
): CatalogModel {
  return {
    providerId,
    modelId,
    displayName: `${providerId} ${modelId}`,
    contextWindow: opts.contextWindow,
    maxOutputTokens: null,
    price: { input: opts.input, output: opts.output, isFree: opts.isFree },
    priceSource: opts.priceSource,
    priceFetchedAt: null,
    supportsReasoning: false,
    supportsToolCalling: false,
    supportsStructuredOutput: false,
    capabilities: [],
    availability: 'live',
    scores: { coding: 3, reasoning: 3, speed: 3, longContext: 3 },
    valueScore: 50,
    tags: ['live'],
    fit: 0,
    stageFit: {},
    available: true,
    scoreOrigin: 'deterministic',
  };
}

/** Only Local connected; unknown pricing (never free) at both context sizes. */
function localOnlyCatalog(): CatalogModel[] {
  return [
    catalogModel('local', LOCAL_BIG, {
      contextWindow: 262_144, input: null, output: null, isFree: false, priceSource: 'unknown',
    }),
    catalogModel('local', LOCAL_DEFAULT, {
      contextWindow: 128_000, input: null, output: null, isFree: false, priceSource: 'unknown',
    }),
  ];
}

/** Local (unknown pricing) + one confirmed-free OpenRouter model. */
function localPlusFreeCatalog(): CatalogModel[] {
  return [
    ...localOnlyCatalog(),
    catalogModel('openrouter', 'free-1', {
      contextWindow: 262_144, input: 0, output: 0, isFree: true, priceSource: 'live',
    }),
  ];
}

/** Local (unknown pricing) + one confirmed-PAID OpenRouter model. */
function localPlusPaidCatalog(): CatalogModel[] {
  return [
    ...localOnlyCatalog(),
    catalogModel('openrouter', 'paid-1', {
      contextWindow: 262_144, input: 2, output: 8, isFree: false, priceSource: 'live',
    }),
  ];
}

function preference(
  overrides: Record<string, StageOverrideEntry>,
  selectedStrategy: SelectedStrategy,
  selectionMode: 'auto' | 'manual' = 'auto'
): ModelPreference {
  const stageOverrides = overrides as ModelPreference['stage_overrides'];
  return {
    user_id: 'ac-user',
    provider: null,
    model: null,
    selection_mode: selectionMode,
    selected_strategy: selectedStrategy,
    stage_overrides: stageOverrides,
    readFailed: false,
  };
}

async function route(pref: ModelPreference, stage: StageKey): Promise<ResolvedRouting> {
  return resolveAnalysisRouting('ac-user', stage, {
    loadPreference: async () => pref,
    resolveCredentials: async () => ({}),
    resolveLocalEndpoint: async () => LOCAL_ENDPOINT,
    resolveDisabledProviders: async () => new Set<ProviderName>(),
  });
}

/**
 * Replays gateway.generate's decision chain for one stage against a real
 * catalog, without any network/DB: routing → strict-Free gate → strict-Free
 * plan OR automatic candidates → buildRunChain. Returns every boundary value.
 */
async function planStage(
  pref: ModelPreference,
  stage: StageKey,
  catalog: CatalogModel[]
): Promise<{
  routing: ResolvedRouting;
  strictFree: boolean;
  stageOverride: ResolvedStageOverride | null;
  freeCandidates: Array<{ provider: string; model: string }>;
  automaticCandidates: Array<{ provider: string; model: string }>;
  confirmedFreeIds: Set<string>;
  chain: Array<{ provider: string; model: string }>;
  error: string | null;
}> {
  const routing = await route(pref, stage);
  const strictFree = isStrictFreeSelection(routing);

  const confirmedFreeIds = new Set(
    catalog.filter((m) => m.price.isFree).map((m) => `${m.providerId}/${m.modelId}`)
  );

  let stageOverride = routing.runArgs.stageOverrides ?? null;
  let freeCandidates: Array<{ provider: string; model: string }> = [];
  let automaticCandidates: Array<{ provider: string; model: string }> = [];

  if (strictFree && routing.stageOverrideUnavailable) {
    stageOverride = null;
  } else if (strictFree) {
    const plan = prepareStrictFreeRun(catalog, stage, stageOverride);
    freeCandidates = plan.freeCandidates;
    stageOverride = plan.stageOverride as ResolvedStageOverride | null;
  } else {
    automaticCandidates = getAutomaticStageCandidates(catalog, stage).map((c) => ({
      provider: c.provider,
      model: c.model,
    }));
  }

  const request = {
    task: stage,
    strictFree,
    freeCandidates,
    stageOverrides: stageOverride,
    stageOverrideUnavailable: strictFree && routing.stageOverrideUnavailable,
    manualModel: routing.runArgs.manualModel,
  } as unknown as RunRequest;

  let chain: Array<{ provider: string; model: string }> = [];
  let error: string | null = null;
  try {
    chain = buildRunChain(request, [], []);
  } catch (err) {
    error = (err as Error).message;
  }

  return { routing, strictFree, stageOverride, freeCandidates, automaticCandidates, confirmedFreeIds, chain, error };
}

// ── 0. Global guards ─────────────────────────────────────────────────────────

async function checkStageTableMatchesApplication(): Promise<void> {
  assert.deepEqual(
    Object.keys(STAGE_CONTEXT_MIN).sort(),
    [...STAGES].sort(),
    'spec stage table matches the application stage keys'
  );
}

// ── 1. Boundary: /models UI → save payload → preference ──────────────────────

function saveBodyPerStage(stage: StageKey): StageOverrideEntry {
  // What the Configure modal produces for a hand-picked model.
  const applied = resolveAppliedOverride({ checkbox: false, selectionChanged: true });
  assert.equal(applied.isOverride, true, 'a concrete selection is a manual override');
  assert.equal(applied.origin, 'manual');
  const row = {
    selectedProvider: 'local',
    selectedModel: LOCAL_BIG,
    isOverride: applied.isOverride,
    origin: applied.origin,
  };
  return buildStageOverrides([stage], { [stage]: row })[stage];
}

async function checkSaveBodyPersistsEveryStage(): Promise<void> {
  const stageOverrides: Record<string, StageOverrideEntry> = {};
  for (const stage of STAGES) stageOverrides[stage] = saveBodyPerStage(stage);

  const body = buildPreferenceSaveBody({
    selectionMode: 'auto',
    provider: null,
    model: null,
    selectedStrategy: 'free',
    stageOverrides,
  });

  assert.equal(body.selection_mode, 'auto');
  assert.equal(body.provider, null, 'auto mode saves a null provider/model pair');
  assert.equal(body.model, null);
  assert.equal(body.selected_strategy, 'free');
  for (const stage of STAGES) {
    assert.deepEqual(
      body.stage_overrides[stage],
      { provider: 'local', model: LOCAL_BIG, origin: 'manual' },
      `save body carries ${stage}`
    );
  }
}

async function checkRefreshRoundTrip(): Promise<void> {
  // A /models reload re-reads the persisted JSONB; the same object survives, so
  // routing must resolve the identical pair (this is the "refresh /models"
  // case — the row is rebuilt from persistence, not from UI state).
  const persisted: Record<string, StageOverrideEntry> = {};
  for (const stage of STAGES) persisted[stage] = saveBodyPerStage(stage);
  const reloaded = preference(persisted, 'free');

  for (const stage of STAGES) {
    const routing = await route(reloaded, stage);
    assert.deepEqual(
      routing.runArgs.stageOverrides,
      { provider: 'local', model: LOCAL_BIG, origin: 'manual' },
      `reload keeps ${stage}`
    );
  }
}

// ── 2. Regression: manual stage selection survives into execution ────────────

async function checkManualSelectionSurvivesStrictFree(): Promise<void> {
  const catalog = localOnlyCatalog();
  const overrides: Record<string, StageOverrideEntry> = {};
  for (const stage of STAGES) overrides[stage] = saveBodyPerStage(stage);
  const pref = preference(overrides, 'free');

  for (const stage of STAGES) {
    const plan = await planStage(pref, stage, catalog);
    assert.equal(plan.strictFree, true, `${stage}: free strategy in auto mode is strict Free`);
    assert.equal(plan.error, null, `${stage}: no longer fails the stage :: ${plan.error}`);
    assert.deepEqual(plan.chain[0], { provider: 'local', model: LOCAL_BIG }, `${stage}: saved model runs first`);
    assert.equal(plan.chain.length, 1, `${stage}: unknown-priced Local is the only executable entry`);
  }
}

async function checkStageAssignmentRecordUsesActualModel(): Promise<void> {
  const overrides: Record<string, StageOverrideEntry> = {};
  for (const stage of STAGES) overrides[stage] = saveBodyPerStage(stage);
  const pref = preference(overrides, 'free');
  for (const stage of STAGES) {
    const plan = await planStage(pref, stage, localOnlyCatalog());
    const head = plan.chain[0];
    const record = buildStageAssignmentRecord({
      provider: head.provider as never,
      model: head.model,
      fallbackCount: 0,
      attemptedProviders: [],
    });
    assert.equal(record.provider, 'local');
    assert.equal(record.model, LOCAL_BIG, `${stage}: what actually ran is what gets persisted`);
  }
}

// ── 3. Regression: each stage reads its OWN assignment (no leakage) ───────────

async function checkNoStageCrossContamination(): Promise<void> {
  const perStage: Record<StageKey, string> = {
    relevant_file_discovery: 'local/server-a',
    root_cause_analysis: 'local/server-b',
    evidence_extraction: 'local/server-c',
    solution_generation: 'local/server-d',
    patch_generation: 'local/server-e',
  };
  const overrides: Record<string, StageOverrideEntry> = {};
  for (const stage of STAGES) {
    overrides[stage] = { provider: 'local', model: perStage[stage], origin: 'manual' };
  }
  const pref = preference(overrides, 'free');

  for (const stage of STAGES) {
    const plan = await planStage(pref, stage, localOnlyCatalog());
    assert.deepEqual(plan.chain[0], { provider: 'local', model: perStage[stage] }, `${stage} runs its own model`);
  }

  // An unknown task id is not an analysis stage: no override, no chain.
  const unknown = await resolveAnalysisRouting('ac-user', 'not_a_stage', {
    loadPreference: async () => pref,
    resolveCredentials: async () => ({}),
    resolveDisabledProviders: async () => new Set<ProviderName>(),
  });
  assert.equal(unknown.runArgs.stageOverrides ?? null, null, 'a non-stage task never borrows a stage override');
}

// ── 4. Regression: strict Free still never falls back to a paid model ────────

async function checkStrictFreeNeverFallsBackToPaid(): Promise<void> {
  const catalog = localPlusPaidCatalog();
  const pref = preference({}, 'free');

  for (const stage of STAGES) {
    const plan = await planStage(pref, stage, catalog);
    assert.equal(plan.strictFree, true);
    assert.deepEqual(plan.freeCandidates, [], `${stage}: the paid OpenRouter model is not a free candidate`);
    assert.equal(plan.error !== null, true, `${stage}: fails with the structured no-free-model error`);
    assert.match(plan.error ?? '', /No free model is available for this stage/);
    assert.equal(plan.chain.some((c) => c.provider === 'openrouter'), false);
  }
}

async function checkSetupDerivedOverrideStillDroppedWhenNotFree(): Promise<void> {
  const catalog = localPlusPaidCatalog();
  const paid = { provider: 'openrouter', model: PAID } as const;
  const pref = preference(
    Object.fromEntries(STAGES.map((s) => [s, { provider: paid.provider, model: paid.model, origin: 'setup' as const }])),
    'free'
  );
  for (const stage of STAGES) {
    const plan = await planStage(pref, stage, catalog);
    assert.equal(plan.stageOverride, null, `${stage}: a setup-derived non-free pick is still dropped`);
    assert.equal(plan.error !== null, true, `${stage}: still fails closed`);
  }

  // A legacy row with NO origin stays conservative too (unknown provenance is
  // never treated as an explicit user choice).
  const legacy = preference(
    Object.fromEntries(STAGES.map((s) => [s, { provider: paid.provider, model: paid.model }])),
    'free'
  );
  for (const stage of STAGES) {
    const plan = await planStage(legacy, stage, catalog);
    assert.equal(plan.stageOverride, null, `${stage}: a provenance-less row is still dropped`);
  }
}

async function checkUnavailableMarkerStillFailsClosed(): Promise<void> {
  const pref = preference(
    Object.fromEntries(STAGES.map((s) => [s, { provider: null, model: null, unavailable: true }])),
    'free'
  );
  for (const stage of STAGES) {
    const plan = await planStage(pref, stage, localPlusFreeCatalog());
    assert.match(plan.error ?? '', /no free model available" in your Free setup|marked/);
  }
}

async function checkConfirmedFreeOverrideStillKept(): Promise<void> {
  const catalog = localPlusFreeCatalog();
  const pref = preference(
    Object.fromEntries(STAGES.map((s) => [s, { provider: 'openrouter', model: 'free-1', origin: 'setup' as const }])),
    'free'
  );
  for (const stage of STAGES) {
    const plan = await planStage(pref, stage, catalog);
    assert.deepEqual(plan.stageOverride, { provider: 'openrouter', model: 'free-1', origin: 'setup' });
    assert.deepEqual(plan.chain[0], { provider: 'openrouter', model: 'free-1' });
    assert.equal(plan.error, null);
  }
}

// ── 5. Regression: automatic strategy still uses automatic catalog candidates ─

async function checkAutomaticStrategyUsesCatalogCandidates(): Promise<void> {
  const catalog = localPlusFreeCatalog();
  const pref = preference({}, 'custom');

  for (const stage of STAGES) {
    const plan = await planStage(pref, stage, catalog);
    assert.equal(plan.strictFree, false, `${stage}: non-free strategy is not strict Free`);
    assert.equal(plan.stageOverride, null, `${stage}: no override → no override in the chain`);
    assert.deepEqual(plan.automaticCandidates, getAutomaticStageCandidates(catalog, stage).map((c) => ({
      provider: c.provider,
      model: c.model,
    })), `${stage}: automatic candidates come from the catalog pool`);
    assert.ok(plan.automaticCandidates.length > 0, `${stage}: the automatic pool is non-empty`);
  }
}

async function checkAutomaticPoolStillHonorsContextGate(): Promise<void> {
  const catalog = localOnlyCatalog();
  // Local at the honest 128K default must not enter evidence_extraction (200K).
  const evidence = getAutomaticStageCandidates(catalog, 'evidence_extraction').map((c) => c.model);
  assert.equal(evidence.includes(LOCAL_DEFAULT), false, '128K model stays out of the 200K stage');
  assert.equal(evidence.includes(LOCAL_BIG), true, 'the 262K model is eligible');

  // Context gates are untouched by this task: every other stage keeps the 128K
  // model eligible.
  for (const stage of STAGES) {
    if (stage === 'evidence_extraction') continue;
    const ids = getAutomaticStageCandidates(catalog, stage).map((c) => c.model);
    assert.equal(ids.includes(LOCAL_DEFAULT), true, `${stage} still accepts a 128K model`);
  }
}

async function checkUnknownPricingIsNeverFree(): Promise<void> {
  const catalog = localOnlyCatalog();
  for (const stage of STAGES) {
    assert.deepEqual(getFreeStageCandidates(catalog, stage), [], `${stage}: unknown pricing is never free`);
  }
  assert.equal(isConfirmedFreeModel(catalog, 'local', LOCAL_BIG), false, 'absent 0/0 pricing ⇒ not confirmed free');
  assert.equal(
    isConfirmedFreeModel(localPlusFreeCatalog(), 'openrouter', 'free-1'),
    true,
    'explicit 0/0 pricing ⇒ confirmed free'
  );
}

// ── 6. Automatic per-stage selection (OpenRouter available) ─────────────────

async function checkOpenRouterAutomaticPerStageSelection(): Promise<void> {
  const catalog = [
    ...localPlusFreeCatalog(),
    catalogModel('openrouter', 'paid-big', {
      contextWindow: 262_144, input: 1, output: 3, isFree: false, priceSource: 'live',
    }),
  ];
  // Strategy 'free' with NO override: strict Free, free-only pool, and the
  // paid OpenRouter models never appear.
  const pref = preference({}, 'free');
  for (const stage of STAGES) {
    const plan = await planStage(pref, stage, catalog);
    assert.equal(plan.strictFree, true);
    assert.equal(plan.chain.every((c) => c.provider === 'openrouter' && c.model === 'free-1'), true,
      `${stage}: only the confirmed-free OpenRouter model is reachable`);
  }

  // An explicitly selected OpenRouter paid model for one stage is honored for
  // THAT stage only; the other four keep the free automatic pick.
  const mixed = preference({ patch_generation: { provider: 'openrouter', model: 'paid-big', origin: 'manual' } }, 'free');
  const patched = await planStage(mixed, 'patch_generation', catalog);
  assert.deepEqual(patched.chain[0], { provider: 'openrouter', model: 'paid-big' });
  assert.equal(patched.chain.filter((c) => c.model === 'free-1').length, 1, 'fallbacks stay confirmed-free only');

  for (const stage of STAGES.filter((s) => s !== 'patch_generation')) {
    const other = await planStage(mixed, stage, catalog);
    assert.deepEqual(other.chain[0], { provider: 'openrouter', model: 'free-1' }, `${stage} unaffected by patch's override`);
  }
}

// ── 7. Manual MODE remains outside strict Free (existing behavior) ───────────

async function checkManualModeUnaffected(): Promise<void> {
  const routing = await resolveAnalysisRouting('ac-user', 'relevant_file_discovery', {
    loadPreference: async () =>
      preference({}, 'free', 'manual') as ModelPreference,
    resolveCredentials: async () => ({}),
    resolveLocalEndpoint: async () => LOCAL_ENDPOINT,
    resolveDisabledProviders: async () => new Set<ProviderName>(),
  });
  // Manual mode requires a concrete pair; with none it stays in auto mode and
  // keeps strict Free. (A full manual-mode pair is covered by existing suites.)
  assert.equal(routing.selection.mode, 'auto');
  assert.equal(isStrictFreeSelection(routing), true);
};

// ── Run ──────────────────────────────────────────────────────────────────────

async function runAll(): Promise<void> {
  await check('stage table matches application stage keys', checkStageTableMatchesApplication);
  await check('save body persists every stage selection (manual origin)', checkSaveBodyPersistsEveryStage);
  await check('refresh /models: persisted stage selections reload identically', checkRefreshRoundTrip);
  await check('regression: manual stage selection survives Free strategy (all 5 stages)', checkManualSelectionSurvivesStrictFree);
  await check('regression: persisted stage record equals the executed model', checkStageAssignmentRecordUsesActualModel);
  await check('regression: each stage reads its own assignment, no cross-stage leakage', checkNoStageCrossContamination);
  await check('strict Free never falls back to a paid model', checkStrictFreeNeverFallsBackToPaid);
  await check('strict Free drops setup-derived and provenance-less non-free overrides', checkSetupDerivedOverrideStillDroppedWhenNotFree);
  await check('strict Free unavailable marker still fails closed', checkUnavailableMarkerStillFailsClosed);
  await check('strict Free keeps a confirmed-free override', checkConfirmedFreeOverrideStillKept);
  await check('automatic strategy uses automatic catalog candidates', checkAutomaticStrategyUsesCatalogCandidates);
  await check('automatic pool still honors the per-stage context gate', checkAutomaticPoolStillHonorsContextGate);
  await check('unknown/null pricing is never treated as free', checkUnknownPricingIsNeverFree);
  await check('OpenRouter: automatic per-stage selection + mixed manual override', checkOpenRouterAutomaticPerStageSelection);
  await check('manual mode boundary unchanged', checkManualModeUnaffected);
  console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

runAll();