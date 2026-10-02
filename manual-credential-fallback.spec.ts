import { strict as assert } from 'node:assert';
import { resolveAnalysisRouting, type RoutingDependencies } from './lib/ai/routing';
import type { ModelPreference } from './lib/ai/preferences';
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

function deps(credentials: Partial<Record<ProviderName, string>>, preference: ModelPreference): RoutingDependencies {
  return {
    resolveCredentials: async () => credentials,
    loadPreference: async () => preference,
  };
}

function manualPreference(strategy: ModelPreference['selected_strategy']): ModelPreference {
  return {
    user_id: 'user-1',
    provider: 'openai',
    model: 'test-model',
    selection_mode: 'manual',
    selected_strategy: strategy,
  };
}

async function routingError(task: string | undefined, d: RoutingDependencies): Promise<string> {
  try {
    await resolveAnalysisRouting('user-1', task, d);
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected resolveAnalysisRouting to throw');
}

async function main(): Promise<void> {
  await check('disconnected manual provider + free strategy -> routing throws (no silent auto run)', async () => {
    const msg = await routingError('root_cause_analysis', deps({}, manualPreference('free')));
    assert.ok(msg.includes('provider "openai" is not connected'), msg);
    assert.ok(msg.includes('No fallback to a different model'), msg);
  });

  await check('disconnect error is identical for every strategy (free, free_paid, fully_paid, auto, balanced, quality, custom)', async () => {
    const expected = await routingError('root_cause_analysis', deps({}, manualPreference('free')));
    for (const strategy of ['free_paid', 'fully_paid', 'auto', 'balanced', 'quality', 'custom'] as const) {
      const msg = await routingError('root_cause_analysis', deps({}, manualPreference(strategy)));
      assert.equal(msg, expected, 'strategy ' + strategy);
    }
  });

  await check('disconnected manual provider throws even when OTHER providers are connected', async () => {
    const msg = await routingError('evidence_extraction', deps({ openrouter: 'key' }, manualPreference('free')));
    assert.ok(msg.includes('provider "openai" is not connected'), msg);
  });

  await check('disconnect throws even without a task argument', async () => {
    const msg = await routingError(undefined, deps({}, manualPreference('free')));
    assert.ok(msg.includes('No fallback to a different model'), msg);
  });

  await check('connected manual + free -> manualModel routed, strategy surfaced, overrides ignored', async () => {
    const preference: ModelPreference = {
      ...manualPreference('free'),
      stage_overrides: { root_cause_analysis: { provider: 'openrouter', model: 'other-model' } },
    };
    const routing = await resolveAnalysisRouting(
      'user-1',
      'root_cause_analysis',
      deps({ openai: 'key' }, preference)
    );
    assert.equal(routing.selection.mode, 'manual');
    assert.deepEqual(routing.runArgs.manualModel, { provider: 'openai', model: 'test-model' });
    assert.deepEqual(routing.runArgs.providerTokens, { openai: 'key' });
    assert.equal(routing.runArgs.stageOverrides, undefined);
    assert.equal(routing.selectedStrategy, 'free');
    assert.equal(routing.stageOverrideUnavailable, false);
  });

  await check('connected manual + non-Free strategy (balanced) -> manualModel routed unchanged', async () => {
    const routing = await resolveAnalysisRouting(
      'user-1',
      'root_cause_analysis',
      deps({ openai: 'key' }, manualPreference('balanced'))
    );
    assert.equal(routing.selection.mode, 'manual');
    assert.deepEqual(routing.runArgs.manualModel, { provider: 'openai', model: 'test-model' });
    assert.equal(routing.selectedStrategy, 'balanced');
  });

  await check('auto + free strategy, no override -> auto branch unchanged (strict-free decision stays in gateway)', async () => {
    const preference: ModelPreference = {
      user_id: 'user-1',
      provider: null,
      model: null,
      selection_mode: 'auto',
      selected_strategy: 'free',
    };
    const routing = await resolveAnalysisRouting(
      'user-1',
      'solution_generation',
      deps({ openrouter: 'key' }, preference)
    );
    assert.equal(routing.selection.mode, 'auto');
    assert.equal(routing.selectedStrategy, 'free');
    assert.equal(routing.runArgs.manualModel, undefined);
    assert.equal(routing.runArgs.stageOverrides, null);
    assert.equal(routing.stageOverrideUnavailable, false);
  });

  await check('auto + per-stage override -> override passed through (unchanged)', async () => {
    const preference: ModelPreference = {
      user_id: 'user-1',
      provider: null,
      model: null,
      selection_mode: 'auto',
      selected_strategy: 'free',
      stage_overrides: { root_cause_analysis: { provider: 'openrouter', model: 'custom-1' } },
    };
    const routing = await resolveAnalysisRouting(
      'user-1',
      'root_cause_analysis',
      deps({ openrouter: 'key' }, preference)
    );
    assert.equal(routing.selection.mode, 'auto');
    assert.deepEqual(routing.runArgs.stageOverrides, { provider: 'openrouter', model: 'custom-1' });
    assert.equal(routing.stageOverrideUnavailable, false);
  });

  await check('auto + unavailable marker -> stageOverrideUnavailable true (unchanged)', async () => {
    const preference: ModelPreference = {
      user_id: 'user-1',
      provider: null,
      model: null,
      selection_mode: 'auto',
      selected_strategy: 'free',
      stage_overrides: { patch_generation: { provider: null, model: null, unavailable: true } },
    };
    const routing = await resolveAnalysisRouting('user-1', 'patch_generation', deps({}, preference));
    assert.equal(routing.stageOverrideUnavailable, true);
    assert.equal(routing.runArgs.stageOverrides, null);
    assert.equal(routing.selection.mode, 'auto');
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
