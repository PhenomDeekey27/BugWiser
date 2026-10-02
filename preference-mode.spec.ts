import { strict as assert } from 'node:assert';
import {
  buildPreferenceSaveBody,
  deriveStageSelectionState,
  deriveStageStatus,
} from './lib/ai/preferenceMode';

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

async function main(): Promise<void> {
  await check('save in manual mode preserves selection_mode (never forced to auto)', () => {
    const body = buildPreferenceSaveBody({
      selectionMode: 'manual',
      provider: 'openrouter',
      model: 'test-model-a',
      selectedStrategy: 'free',
      stageOverrides: { root_cause_analysis: { provider: 'openrouter', model: 'test-model-b' } },
    });
    assert.equal(body.selection_mode, 'manual');
    assert.notEqual(body.selection_mode, 'auto');
    assert.equal(body.provider, 'openrouter');
    assert.equal(body.model, 'test-model-a');
    assert.equal(body.selected_strategy, 'free');
    assert.deepEqual(body.stage_overrides, { root_cause_analysis: { provider: 'openrouter', model: 'test-model-b' } });
  });

  await check('manual save body satisfies the server contract (provider+model required)', () => {
    const body = buildPreferenceSaveBody({
      selectionMode: 'manual',
      provider: 'openrouter',
      model: 'test-model-a',
      selectedStrategy: 'custom',
      stageOverrides: {},
    });
    assert.ok(['auto', 'manual'].includes(body.selection_mode));
    assert.ok(body.provider, 'manual body must carry a provider or the PUT 400s');
    assert.ok(body.model, 'manual body must carry a model or the PUT 400s');
  });

  await check('save in automatic mode keeps auto and nulls provider/model (old behavior)', () => {
    const body = buildPreferenceSaveBody({
      selectionMode: 'auto',
      selectedStrategy: 'balanced',
      stageOverrides: { solution_generation: { provider: 'openrouter', model: 'test-model-c' } },
    });
    assert.equal(body.selection_mode, 'auto');
    assert.equal(body.provider, null);
    assert.equal(body.model, null);
    assert.equal(body.selected_strategy, 'balanced');
    assert.equal(Object.keys(body.stage_overrides).length, 1);
  });

  await check('no stored preference (first save) defaults to auto with null pair', () => {
    for (const mode of [null, undefined]) {
      const body = buildPreferenceSaveBody({
        selectionMode: mode,
        selectedStrategy: 'auto',
        stageOverrides: {},
      });
      assert.equal(body.selection_mode, 'auto');
      assert.equal(body.provider, null);
      assert.equal(body.model, null);
    }
  });

  await check('manual mode with missing stored pair still sends manual (server rejects loudly, no silent flip)', () => {
    const body = buildPreferenceSaveBody({
      selectionMode: 'manual',
      selectedStrategy: 'auto',
      stageOverrides: {},
    });
    assert.equal(body.selection_mode, 'manual');
    assert.equal(body.provider, null);
    assert.equal(body.model, null);
  });

  await check('manual display state: inactive + banner names the running model + save note', () => {
    const state = deriveStageSelectionState('manual', { provider: 'openrouter', model: 'test-model-a' });
    assert.equal(state.active, false);
    assert.equal(state.mode, 'manual');
    assert.ok(state.banner, 'manual mode must render a banner');
    assert.match(state.banner!, /not used at runtime/);
    assert.match(state.banner!, /openrouter · test-model-a/);
    assert.match(state.banner!, /New Analysis page/);
    assert.equal(state.inactiveStatusText, 'Inactive');
    assert.ok(state.saveNote, 'manual saves must disclose inactivity');
    assert.match(state.saveNote!, /inactive/);
  });

  await check('manual display state without stored pair: banner has no dangling "undefined"', () => {
    const state = deriveStageSelectionState('manual', null);
    assert.equal(state.active, false);
    assert.ok(state.banner);
    assert.ok(!(state.banner as string).includes('undefined'), 'banner must not interpolate undefined');
    assert.match(state.banner!, /not used at runtime/);
  });

  await check('automatic display state: active, no banner, no save note', () => {
    for (const mode of ['auto', null, undefined] as const) {
      const state = deriveStageSelectionState(mode);
      assert.equal(state.active, true);
      assert.equal(state.mode, 'auto');
      assert.equal(state.banner, null);
      assert.equal(state.saveNote, null);
    }
  });

  await check('row status: configured row under manual mode -> inactive (not custom/active)', () => {
    const configured = { configured: true, modeActive: false } as const;
    assert.equal(deriveStageStatus({ ...configured, origin: 'manual' }), 'inactive');
    assert.equal(deriveStageStatus({ ...configured, origin: 'setup' }), 'inactive');
    assert.equal(deriveStageStatus(configured), 'inactive');
  });

  await check('row status: unavailable/unconfigured stay truthful under manual mode', () => {
    assert.equal(deriveStageStatus({ configured: false, unavailable: true, modeActive: false }), 'unavailable');
    assert.equal(deriveStageStatus({ configured: false, modeActive: false }), 'unconfigured');
    assert.equal(deriveStageStatus({ configured: true, unavailable: true, modeActive: false }), 'unavailable');
  });

  await check('row status: auto mode unchanged (custom/active/unavailable/unconfigured)', () => {
    assert.equal(deriveStageStatus({ configured: true, origin: 'manual', modeActive: true }), 'custom');
    assert.equal(deriveStageStatus({ configured: true, origin: 'setup', modeActive: true }), 'active');
    assert.equal(deriveStageStatus({ configured: true, modeActive: true }), 'active');
    assert.equal(deriveStageStatus({ configured: false, unavailable: true, modeActive: true }), 'unavailable');
    assert.equal(deriveStageStatus({ configured: false, modeActive: true }), 'unconfigured');
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
