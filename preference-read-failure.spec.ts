import { strict as assert } from 'node:assert';
import {
  getModelPreference,
  resolveSavedStrategy,
  type ModelPreference,
  type PreferenceRowLoader,
} from './lib/ai/preferences';
import { resolveAnalysisRouting, isStrictFreeSelection, type RoutingDependencies } from './lib/ai/routing';
import type { ProviderName } from './lib/ai/providers/registry';

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

function loader(data: Record<string, unknown> | null, error: { message: string } | null): PreferenceRowLoader {
  return async () => ({ data, error });
}

function deps(credentials: Partial<Record<ProviderName, string>>, preference: ModelPreference): RoutingDependencies {
  return {
    resolveCredentials: async () => credentials,
    loadPreference: async () => preference,
  };
}

function gate(strategy: ModelPreference['selected_strategy'], readFailed: boolean, mode: 'auto' | 'manual'): boolean {
  return isStrictFreeSelection({
    selectedStrategy: strategy,
    preferenceReadFailed: readFailed,
    selection: { mode, provider: null, model: null, reason: 'test' },
  });
}

async function main(): Promise<void> {
  await check('read ERROR -> fabricated defaults + readFailed flag (the P8 source)', async () => {
    const pref = await getModelPreference('user-1', loader(null, { message: 'db down' }));
    assert.equal(pref.readFailed, true);
    assert.equal(pref.selection_mode, 'auto');
    assert.equal(pref.selected_strategy, 'auto');
    assert.equal(pref.provider, null);
    assert.equal(pref.model, null);
  });

  await check('missing row / first-time user -> defaults WITHOUT the flag', async () => {
    const pref = await getModelPreference('user-1', loader(null, null));
    assert.equal(pref.readFailed, undefined);
    assert.equal(pref.selection_mode, 'auto');
    assert.equal(pref.selected_strategy, 'auto');
  });

  await check('valid stored free preference -> values preserved, no flag', async () => {
    const pref = await getModelPreference(
      'user-1',
      loader({ provider: 'openrouter', model: 'stored-model', selection_mode: 'manual', selected_strategy: 'free' }, null)
    );
    assert.equal(pref.readFailed, undefined);
    assert.equal(pref.selected_strategy, 'free');
    assert.equal(pref.selection_mode, 'manual');
    assert.equal(pref.provider, 'openrouter');
    assert.equal(pref.model, 'stored-model');
  });

  await check('malformed/corrupt row -> read SUCCEEDS (no flag), existing coercion rules apply', async () => {
    const coerced = await getModelPreference(
      'user-1',
      loader({ selection_mode: 'weird', selected_strategy: null }, null)
    );
    assert.equal(coerced.readFailed, undefined);
    assert.equal(coerced.selection_mode, 'auto');
    assert.equal(coerced.selected_strategy, 'auto');

    const garbage = await getModelPreference(
      'user-1',
      loader({ selection_mode: 'manual', selected_strategy: 'nonsense-strategy' }, null)
    );
    assert.equal(garbage.readFailed, undefined);
    assert.equal(garbage.selection_mode, 'manual');
    assert.equal(garbage.selected_strategy, 'nonsense-strategy');
  });

  await check('loader rejection propagates (thrown read errors stay fail-closed upstream)', async () => {
    const boom: PreferenceRowLoader = async () => {
      throw new Error('network unreachable');
    };
    await assert.rejects(() => getModelPreference('user-1', boom), /network unreachable/);
  });

  await check('routing propagates preferenceReadFailed from a failed read', async () => {
    const failed: ModelPreference = {
      user_id: 'user-1', provider: null, model: null,
      selection_mode: 'auto', selected_strategy: 'auto', readFailed: true,
    };
    const routing = await resolveAnalysisRouting('user-1', 'root_cause_analysis', deps({ openrouter: 'key' }, failed));
    assert.equal(routing.preferenceReadFailed, true);
    assert.equal(routing.selection.mode, 'auto');
  });

  await check('routing reports preferenceReadFailed false for normal preferences (auto and manual)', async () => {
    const autoPref: ModelPreference = {
      user_id: 'user-1', provider: null, model: null,
      selection_mode: 'auto', selected_strategy: 'free',
    };
    const autoRouting = await resolveAnalysisRouting('user-1', 'root_cause_analysis', deps({}, autoPref));
    assert.equal(autoRouting.preferenceReadFailed, false);

    const manualPref: ModelPreference = {
      user_id: 'user-1', provider: 'openrouter', model: 'stored-model',
      selection_mode: 'manual', selected_strategy: 'auto',
    };
    const manualRouting = await resolveAnalysisRouting('user-1', 'root_cause_analysis', deps({ openrouter: 'key' }, manualPref));
    assert.equal(manualRouting.preferenceReadFailed, false);
    assert.equal(manualRouting.selection.mode, 'manual');
  });

  await check('gate: explicit live free + auto -> strict (unchanged)', () => {
    assert.equal(gate('free', false, 'auto'), true);
  });

  await check('gate: missing/first-time defaults (auto, no flag) -> NOT strict (unchanged)', () => {
    assert.equal(gate('auto', false, 'auto'), false);
  });

  await check('gate: READ FAILURE in auto mode -> strict (Free-policy fail-safe; paid cannot unlock)', () => {
    assert.equal(gate('auto', true, 'auto'), true);
    assert.equal(gate('free_paid', true, 'auto'), true);
    assert.equal(gate('fully_paid', true, 'auto'), true);
  });

  await check('gate: manual mode stays outside strict Free (Task C/B design preserved)', () => {
    assert.equal(gate('free', false, 'manual'), false);
    assert.equal(gate('auto', true, 'manual'), false);
  });

  await check('end-to-end: failed preference read -> routing -> strict Free enforced', async () => {
    const failed: ModelPreference = {
      user_id: 'user-1', provider: null, model: null,
      selection_mode: 'auto', selected_strategy: 'auto', readFailed: true,
    };
    const routing = await resolveAnalysisRouting('user-1', 'evidence_extraction', deps({ openrouter: 'key' }, failed));
    assert.equal(isStrictFreeSelection(routing), true);
  });

  await check('save: strategy provided -> used as-is (no read, no clobber risk)', () => {
    const storedReadFailed: ModelPreference = {
      user_id: 'user-1', provider: null, model: null,
      selection_mode: 'auto', selected_strategy: 'auto', readFailed: true,
    };
    const provided = resolveSavedStrategy('free', storedReadFailed);
    assert.equal(provided.ok, true);
    if (provided.ok) assert.equal(provided.strategy, 'free');
    const providedNullStored = resolveSavedStrategy('balanced', null);
    assert.equal(providedNullStored.ok, true);
    if (providedNullStored.ok) assert.equal(providedNullStored.strategy, 'balanced');
  });

  await check('save: strategy omitted + stored read OK -> stored strategy preserved (existing behavior)', () => {
    const stored: ModelPreference = {
      user_id: 'user-1', provider: null, model: null,
      selection_mode: 'auto', selected_strategy: 'free',
    };
    const kept = resolveSavedStrategy(undefined, stored);
    assert.equal(kept.ok, true);
    if (kept.ok) assert.equal(kept.strategy, 'free');
    const keptNull = resolveSavedStrategy(null, stored);
    assert.equal(keptNull.ok, true);
    if (keptNull.ok) assert.equal(keptNull.strategy, 'free');
  });

  await check('save: strategy omitted + stored read FAILED -> refused (no fabricated auto overwrite)', () => {
    const storedReadFailed: ModelPreference = {
      user_id: 'user-1', provider: null, model: null,
      selection_mode: 'auto', selected_strategy: 'auto', readFailed: true,
    };
    const refused = resolveSavedStrategy(undefined, storedReadFailed);
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.ok(refused.error.includes('nothing was changed'), refused.error);
    const noStored = resolveSavedStrategy(undefined, null);
    assert.equal(noStored.ok, false);
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
