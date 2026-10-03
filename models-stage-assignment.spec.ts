// Regression tests for the two /models stage-assignment bugs:
//   (1) connecting a provider did not populate stage assignments — rows are
//       now derived from the connected catalog via the existing selection
//       logic (display-only, never persisted);
//   (2) a manually applied Local assignment disappeared after refresh —
//       manual applies now persist as manual overrides, and a pending
//       catalog snapshot can no longer erase them.
import { strict as assert } from 'node:assert';
import {
  deriveAutomaticStagePicks,
  getAutomaticStageCandidates,
  STAGE_CONTEXT_MIN,
} from './lib/ai/catalog/stageSelection';
import { buildStageOverrides, resolveAppliedOverride, type StageOverrideRow } from './lib/ai/catalog/stageOverrides';
import { buildPreferenceSaveBody } from './lib/ai/preferenceMode';
import {
  reconcileStageOverrides,
  shouldReconcileOverrides,
  type StageOverrideEntry,
} from './lib/ai/catalog/overrideReconcile';
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

const STAGE_IDS = [
  'relevant_file_discovery',
  'root_cause_analysis',
  'evidence_extraction',
  'solution_generation',
  'patch_generation',
] as const;

// One connected Local provider: a single unknown-priced endpoint model with
// the documented 65,536-token window (eligible at 32K stages, gated at 128K/200K).
const localModel = cat({
  providerId: 'local',
  modelId: 'qwen3-9b',
  contextWindow: 65_536,
});

const ELIGIBLE_STAGES = STAGE_IDS.filter((id) => localModel.contextWindow >= STAGE_CONTEXT_MIN[id]);
const INELIGIBLE_STAGES = STAGE_IDS.filter((id) => localModel.contextWindow < STAGE_CONTEXT_MIN[id]);

const key = (r: { provider: string | null; model: string | null }): string => `${r.provider}/${r.model}`;

function row(partial: Partial<StageOverrideRow>): StageOverrideRow {
  return { selectedProvider: null, selectedModel: null, isOverride: false, ...partial };
}

async function main(): Promise<void> {
  // 1. One connected Local provider → automatic stage candidates contain Local
  //    where context-eligible.
  await check('Local only: automatic stage candidates contain Local for every context-eligible stage', () => {
    assert.deepEqual([...ELIGIBLE_STAGES].sort(), ['patch_generation', 'relevant_file_discovery', 'solution_generation']);
    const picks = deriveAutomaticStagePicks(null, [localModel]);
    for (const stageId of ELIGIBLE_STAGES) {
      assert.deepEqual(
        picks[stageId],
        { stageId, provider: 'local', model: 'qwen3-9b', isFree: false },
        `${stageId} should resolve to the connected Local model`
      );
      assert.deepEqual(
        getAutomaticStageCandidates([localModel], stageId).map(key),
        ['local/qwen3-9b'],
        `${stageId} candidates should include the Local model`
      );
    }
  });

  // 2. One connected OpenRouter provider → automatic selection uses the
  //    existing per-stage scoring/catalog logic (not one model everywhere).
  await check('OpenRouter only: automatic selection follows per-stage scoring from the catalog', () => {
    const fast = cat({
      providerId: 'openrouter',
      modelId: 'fast-general',
      contextWindow: 200_000,
      price: { input: 0, output: 0, isFree: true },
      scores: { coding: 4, reasoning: 1, speed: 4, longContext: 1 },
    });
    const deep = cat({
      providerId: 'openrouter',
      modelId: 'deep-reasoner',
      contextWindow: 200_000,
      price: { input: 0, output: 0, isFree: true },
      scores: { coding: 1, reasoning: 4, speed: 1, longContext: 4 },
    });
    const picks = deriveAutomaticStagePicks(null, [fast, deep]);
    for (const stageId of STAGE_IDS) {
      const pick = picks[stageId];
      assert.ok(pick, `${stageId} should have a pick`);
      assert.equal(pick!.provider, 'openrouter', `${stageId} pick must come from the connected catalog`);
      const model = pick!.model;
      assert.ok(model !== null, `${stageId} pick must resolve a model`);
      assert.ok(['fast-general', 'deep-reasoner'].includes(model), `${stageId} pick must be a catalog model`);
    }
    // Stage weights decide: discovery (speed/coding) ≠ root cause (reasoning).
    assert.equal(picks.relevant_file_discovery?.model, 'fast-general');
    assert.equal(picks.root_cause_analysis?.model, 'deep-reasoner');
    assert.notEqual(picks.relevant_file_discovery?.model, picks.root_cause_analysis?.model);
    // Strategy path keeps existing semantics too (Balanced via setup branch).
    const balanced = deriveAutomaticStagePicks('balanced', [fast, deep]);
    assert.equal(balanced.root_cause_analysis?.model, 'deep-reasoner');
    assert.equal(balanced.relevant_file_discovery?.model, 'fast-general');
  });

  // 3. Connecting a provider does not create manual overrides — the derived
  //    display rows are never persisted.
  await check('Connecting a provider derives display rows only: stage_overrides stays empty', () => {
    const picks = deriveAutomaticStagePicks(null, [localModel]);
    // The page builds derived rows with isOverride=false / no origin…
    const derivedRows: Record<string, StageOverrideRow> = {};
    for (const stageId of STAGE_IDS) {
      const pick = picks[stageId];
      derivedRows[stageId] = row({
        selectedProvider: pick?.provider ?? null,
        selectedModel: pick?.model ?? null,
        isOverride: false,
      });
      assert.equal('origin' in (pick ?? {}), false, 'a derived pick carries no manual provenance');
    }
    // …so saving after a connect persists nothing.
    assert.deepEqual(buildStageOverrides(STAGE_IDS, derivedRows), {});
    const body = buildPreferenceSaveBody({
      selectionMode: 'auto',
      provider: null,
      model: null,
      selectedStrategy: 'auto',
      stageOverrides: buildStageOverrides(STAGE_IDS, derivedRows),
    });
    assert.deepEqual(body.stage_overrides, {});
    assert.equal(body.selected_strategy, 'auto');
  });

  // 4. Manual Local "apply to all tasks" creates persisted manual overrides —
  //    even when the "Custom Override" checkbox was never ticked.
  await check('Manual Local apply to every stage persists manual overrides (checkbox not required)', () => {
    const rows: Record<string, StageOverrideRow> = {};
    for (const stageId of STAGE_IDS) {
      const applied = resolveAppliedOverride({ checkbox: false, selectionChanged: true });
      assert.equal(applied.isOverride, true, 'a concrete model change must persist as an override');
      rows[stageId] = row({
        selectedProvider: 'local',
        selectedModel: 'qwen3-9b',
        isOverride: applied.isOverride,
        origin: applied.origin,
      });
    }
    const overrides = buildStageOverrides(STAGE_IDS, rows);
    assert.equal(Object.keys(overrides).length, 5, 'all five stages must be persisted');
    for (const stageId of STAGE_IDS) {
      assert.deepEqual(overrides[stageId], { provider: 'local', model: 'qwen3-9b', origin: 'manual' });
    }
    // The PUT body carries the full map.
    const body = buildPreferenceSaveBody({
      selectionMode: 'auto',
      provider: null,
      model: null,
      selectedStrategy: 'custom',
      stageOverrides: overrides,
    });
    assert.deepEqual(body.stage_overrides, overrides);

    // Removal still works: an UNCHANGED selection with the box unchecked is
    // not persisted (existing semantics kept).
    const removed = resolveAppliedOverride({ checkbox: false, selectionChanged: false });
    assert.equal(removed.isOverride, false);
    assert.equal(removed.origin, undefined);
  });

  // 5. Manual overrides survive GET/refresh.
  await check('Manual overrides survive the save → GET → reload round trip', () => {
    const saved: Record<string, StageOverrideEntry> = {};
    for (const stageId of STAGE_IDS) {
      const applied = resolveAppliedOverride({ checkbox: false, selectionChanged: true });
      saved[stageId] = { provider: 'local', model: 'qwen3-9b', origin: applied.origin! };
    }
    // GET with an authoritative (non-pending) snapshot that contains the model.
    const served = reconcileStageOverrides(saved, [{ providerId: 'local', modelId: 'qwen3-9b', available: true }]);
    assert.equal(served.changed, false, 'a valid override must not be dropped');
    assert.deepEqual(served.kept, saved);

    // Reload (loadStageModels) → rows carry the same selection and origin…
    const reloaded: Record<string, StageOverrideRow> = {};
    for (const stageId of STAGE_IDS) {
      const entry = served.kept[stageId];
      reloaded[stageId] = row({
        selectedProvider: entry.provider,
        selectedModel: entry.model,
        isOverride: true,
        origin: entry.origin,
      });
    }
    // …and a subsequent save is idempotent (nothing is lost in the loop).
    assert.deepEqual(buildStageOverrides(STAGE_IDS, reloaded), saved);
  });

  // 6. Manual override origin remains 'manual'.
  await check('Manual override origin stays manual through apply, save and reconcile', () => {
    const changed = resolveAppliedOverride({ checkbox: false, selectionChanged: true, previousOrigin: 'setup' });
    assert.equal(changed.origin, 'manual', 'changing a setup pick makes it manual');
    const reApplied = resolveAppliedOverride({ checkbox: true, selectionChanged: false, previousOrigin: 'manual' });
    assert.equal(reApplied.origin, 'manual', 're-applying an unchanged manual selection keeps manual');
    const checkedLegacy = resolveAppliedOverride({ checkbox: true, selectionChanged: false, previousOrigin: undefined });
    assert.equal(checkedLegacy.origin, 'manual');
    // Reconcile's kept-branch preserves origin (regression for the strip bug).
    const saved: Record<string, StageOverrideEntry> = {
      root_cause_analysis: { provider: 'local', model: 'qwen3-9b', origin: 'manual' },
    };
    const kept = reconcileStageOverrides(saved, [{ providerId: 'local', modelId: 'qwen3-9b', available: true }]);
    assert.equal(kept.kept.root_cause_analysis.origin, 'manual');
  });

  // 7. Catalog revalidation cannot erase valid manual overrides.
  await check('A pending catalog snapshot never erases valid manual overrides', () => {
    // Any pending snapshot while providers are connected is known to lag the
    // current provider set (a just-connected provider's models are missing).
    assert.equal(
      shouldReconcileOverrides({ catalogPending: true, modelCount: 120, connectedProviderCount: 3 }),
      false
    );
    assert.equal(
      shouldReconcileOverrides({ catalogPending: true, modelCount: 1, connectedProviderCount: 1 }),
      false,
      'the connect window (stale pre-connect snapshot) must not reconcile'
    );

    // The connect window: a saved Local override vs. the stale pre-connect
    // snapshot (no local rows). Reconciling against THAT would erase it —
    // which is exactly what the guard now declines, so the route serves the
    // override as-is and persists nothing.
    const saved: Record<string, StageOverrideEntry> = {
      relevant_file_discovery: { provider: 'local', model: 'qwen3-9b', origin: 'manual' },
    };
    const staleSnapshot = [{ providerId: 'openrouter', modelId: 'external-model', available: true }];
    assert.equal(shouldReconcileOverrides({ catalogPending: true, modelCount: 1, connectedProviderCount: 2 }), false);
    const wouldErase = reconcileStageOverrides(saved, staleSnapshot);
    assert.deepEqual(wouldErase.droppedStages, ['relevant_file_discovery'], 'this is the deletion the guard prevents');
    assert.equal(wouldErase.changed, true);

    // Self-heal directions preserved: nothing connected stays authoritative…
    assert.equal(shouldReconcileOverrides({ catalogPending: true, modelCount: 120, connectedProviderCount: 0 }), true);
    // …and an authoritative (non-pending) read still reconciles.
    assert.equal(shouldReconcileOverrides({ catalogPending: false, modelCount: 1, connectedProviderCount: 1 }), true);
    const landed = reconcileStageOverrides(saved, [{ providerId: 'local', modelId: 'qwen3-9b', available: true }]);
    assert.equal(landed.changed, false, 'once the rebuild lands, the override survives');
    assert.deepEqual(landed.kept, saved);
  });

  // 8. A context-ineligible Local stage remains ineligible automatically.
  await check('Context-ineligible Local stages get no automatic assignment', () => {
    assert.deepEqual([...INELIGIBLE_STAGES].sort(), ['evidence_extraction', 'root_cause_analysis']);
    const picks = deriveAutomaticStagePicks(null, [localModel]);
    for (const stageId of INELIGIBLE_STAGES) {
      assert.equal(picks[stageId], null, `${stageId} must stay unassigned (window below stage minimum)`);
      assert.deepEqual(getAutomaticStageCandidates([localModel], stageId), []);
    }
    // No candidates ⇒ the derived display row has no selection ("No config"),
    // and it still never turns into a persisted override.
    const rows: Record<string, StageOverrideRow> = {
      root_cause_analysis: row({ selectedProvider: null, selectedModel: null, isOverride: false }),
    };
    assert.deepEqual(buildStageOverrides(['root_cause_analysis'], rows), {});
  });

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
  if (failures > 0) process.exit(1);
}

void main();
