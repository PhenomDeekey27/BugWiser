import { strict as assert } from 'node:assert';
import { buildStageOverrides, resolveOverrideOrigin, type StageOverrideRow } from './lib/ai/catalog/stageOverrides';
import { reconcileStageOverrides, type StageOverrideEntry } from './lib/ai/catalog/overrideReconcile';

let failures = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log('PASS ' + name);
  } catch (err) {
    failures++;
    console.error('FAIL ' + name + ' :: ' + ((err as Error).message || String(err)));
  }
}

const STAGE_IDS = ['relevant_file_discovery', 'root_cause_analysis'];

function row(partial: Partial<StageOverrideRow>): StageOverrideRow {
  return { selectedProvider: null, selectedModel: null, isOverride: false, ...partial };
}

function main(): void {
  check('setup row -> entry persisted with origin setup', () => {
    const out = buildStageOverrides(STAGE_IDS, {
      relevant_file_discovery: row({ selectedProvider: 'openrouter', selectedModel: 'm1', isOverride: true, origin: 'setup' }),
    });
    assert.deepEqual(out.relevant_file_discovery, { provider: 'openrouter', model: 'm1', origin: 'setup' });
  });

  check('manual row -> entry persisted with origin manual', () => {
    const out = buildStageOverrides(STAGE_IDS, {
      root_cause_analysis: row({ selectedProvider: 'openai', selectedModel: 'gpt', isOverride: true, origin: 'manual' }),
    });
    assert.deepEqual(out.root_cause_analysis, { provider: 'openai', model: 'gpt', origin: 'manual' });
  });

  check('legacy row (no origin) -> entry persisted WITHOUT origin key', () => {
    const out = buildStageOverrides(STAGE_IDS, {
      relevant_file_discovery: row({ selectedProvider: 'openrouter', selectedModel: 'm1', isOverride: true }),
    });
    assert.equal('origin' in out.relevant_file_discovery, false);
    assert.deepEqual(out.relevant_file_discovery, { provider: 'openrouter', model: 'm1' });
  });

  check('unchecked row with model -> entry omitted (override removed)', () => {
    const out = buildStageOverrides(STAGE_IDS, {
      relevant_file_discovery: row({ selectedProvider: 'openrouter', selectedModel: 'm1', isOverride: false, origin: 'manual' }),
    });
    assert.equal('relevant_file_discovery' in out, false);
  });

  check('checked row without model -> entry omitted', () => {
    const out = buildStageOverrides(STAGE_IDS, {
      relevant_file_discovery: row({ isOverride: true, origin: 'manual' }),
    });
    assert.equal('relevant_file_discovery' in out, false);
  });

  check('unavailable row -> null/null marker without origin', () => {
    const out = buildStageOverrides(STAGE_IDS, {
      relevant_file_discovery: row({ isOverride: true, unavailable: true, origin: 'setup' }),
    });
    assert.deepEqual(out.relevant_file_discovery, { provider: null, model: null, unavailable: true });
    assert.equal('origin' in out.relevant_file_discovery, false);
  });

  check('stage without row -> skipped; all skipped -> empty object', () => {
    assert.deepEqual(buildStageOverrides(STAGE_IDS, {}), {});
    const out = buildStageOverrides(['other_stage'], {
      relevant_file_discovery: row({ selectedProvider: 'openrouter', selectedModel: 'm1', isOverride: true, origin: 'manual' }),
    });
    assert.deepEqual(out, {});
  });

  check('unchecked with model next to checked entry -> only checked persisted', () => {
    const out = buildStageOverrides(STAGE_IDS, {
      relevant_file_discovery: row({ selectedProvider: 'openrouter', selectedModel: 'm1', isOverride: false, origin: 'manual' }),
      root_cause_analysis: row({ selectedProvider: 'openrouter', selectedModel: 'm2', isOverride: true, origin: 'setup' }),
    });
    assert.deepEqual(Object.keys(out), ['root_cause_analysis']);
  });

  check('resolver: unchecked -> undefined regardless of previous origin', () => {
    assert.equal(resolveOverrideOrigin(false, false, 'setup'), undefined);
    assert.equal(resolveOverrideOrigin(false, true, 'manual'), undefined);
    assert.equal(resolveOverrideOrigin(false, true, undefined), undefined);
  });

  check('resolver: checked + changed -> manual', () => {
    assert.equal(resolveOverrideOrigin(true, true, 'setup'), 'manual');
    assert.equal(resolveOverrideOrigin(true, true, undefined), 'manual');
    assert.equal(resolveOverrideOrigin(true, true, 'manual'), 'manual');
  });

  check('resolver: checked + unchanged -> keeps setup, stamps legacy as manual', () => {
    assert.equal(resolveOverrideOrigin(true, false, 'setup'), 'setup');
    assert.equal(resolveOverrideOrigin(true, false, undefined), 'manual');
    assert.equal(resolveOverrideOrigin(true, false, 'manual'), 'manual');
  });

  const catalog = [{ providerId: 'openrouter', modelId: 'm1', available: true }];

  check('reconcile: kept entry preserves manual origin', () => {
    const input: Record<string, StageOverrideEntry> = {
      root_cause_analysis: { provider: 'openrouter', model: 'm1', origin: 'manual' },
    };
    const r = reconcileStageOverrides(input, catalog);
    assert.equal(r.changed, false);
    assert.deepEqual(r.droppedStages, []);
    assert.deepEqual(r.kept.root_cause_analysis, { provider: 'openrouter', model: 'm1', origin: 'manual' });
  });

  check('reconcile: kept entry preserves setup origin', () => {
    const r = reconcileStageOverrides(
      { relevant_file_discovery: { provider: 'openrouter', model: 'm1', origin: 'setup' } },
      catalog
    );
    assert.deepEqual(r.kept.relevant_file_discovery, { provider: 'openrouter', model: 'm1', origin: 'setup' });
  });

  check('reconcile: kept legacy entry stays without origin key', () => {
    const r = reconcileStageOverrides(
      { relevant_file_discovery: { provider: 'openrouter', model: 'm1' } },
      catalog
    );
    assert.equal('origin' in r.kept.relevant_file_discovery, false);
    assert.equal(r.changed, false);
  });

  check('reconcile: stale entry dropped even with manual origin', () => {
    const r = reconcileStageOverrides(
      { root_cause_analysis: { provider: 'openrouter', model: 'gone', origin: 'manual' } },
      catalog
    );
    assert.equal('root_cause_analysis' in r.kept, false);
    assert.deepEqual(r.droppedStages, ['root_cause_analysis']);
    assert.equal(r.changed, true);
  });

  check('reconcile: unavailable marker kept verbatim', () => {
    const r = reconcileStageOverrides(
      { relevant_file_discovery: { provider: null, model: null, unavailable: true } },
      catalog
    );
    assert.deepEqual(r.kept.relevant_file_discovery, { provider: null, model: null, unavailable: true });
    assert.equal(r.changed, false);
  });

  check('reconcile: null/undefined input -> no changes', () => {
    assert.deepEqual(reconcileStageOverrides(null, catalog), { kept: {}, droppedStages: [], changed: false });
    assert.deepEqual(reconcileStageOverrides(undefined, catalog), { kept: {}, droppedStages: [], changed: false });
  });
}

main();
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILED');
process.exit(failures === 0 ? 0 : 1);
