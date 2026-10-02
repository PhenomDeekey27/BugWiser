import { strict as assert } from 'node:assert';
import { deriveStageAttemptView, type StageAttemptRecord } from './lib/ai/stageAttemptView';

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
  await check('initial attempt: single attempt, selected equals actual, no fallback', () => {
    const stage: StageAttemptRecord = {
      provider: 'openrouter',
      model: 'model-a',
      fallbackCount: 0,
      attempted: [{ provider: 'openrouter', model: 'model-a' }],
    };
    const view = deriveStageAttemptView(stage);
    assert.equal(view.state, 'initial');
    assert.equal(view.selected, 'openrouter · model-a');
    assert.equal(view.actual, 'openrouter · model-a');
    assert.equal(view.attempts, 1);
    assert.equal(view.fallbackCount, 0);
  });

  await check('subsequent fallback attempt: first choice differs from actual, trail preserved', () => {
    const stage: StageAttemptRecord = {
      provider: 'openrouter',
      model: 'model-b',
      fallbackCount: 1,
      attempted: [
        { provider: 'openrouter', model: 'model-a' },
        { provider: 'openrouter', model: 'model-b' },
      ],
    };
    const view = deriveStageAttemptView(stage);
    assert.equal(view.state, 'fallback');
    assert.equal(view.selected, 'openrouter · model-a');
    assert.equal(view.actual, 'openrouter · model-b');
    assert.equal(view.attempts, 2);
    assert.equal(view.fallbackCount, 1);
  });

  await check('deep fallback chain: three attempts, selected is first, actual is last', () => {
    const stage: StageAttemptRecord = {
      provider: 'chutes',
      model: 'model-c',
      fallbackCount: 2,
      attempted: [
        { provider: 'openrouter', model: 'model-a' },
        { provider: 'openrouter', model: 'model-b' },
        { provider: 'chutes', model: 'model-c' },
      ],
    };
    const view = deriveStageAttemptView(stage);
    assert.equal(view.state, 'fallback');
    assert.equal(view.selected, 'openrouter · model-a');
    assert.equal(view.actual, 'chutes · model-c');
    assert.equal(view.attempts, 3);
    assert.equal(view.fallbackCount, 2);
  });

  await check('exhausted fallbacks: attempt trail without a successful model', () => {
    const stage: StageAttemptRecord = {
      provider: null,
      model: null,
      fallbackCount: 1,
      attempted: [
        { provider: 'openrouter', model: 'model-a' },
        { provider: 'openrouter', model: 'model-b' },
      ],
    };
    const view = deriveStageAttemptView(stage);
    assert.equal(view.state, 'exhausted');
    assert.equal(view.selected, 'openrouter · model-a');
    assert.equal(view.actual, null);
    assert.equal(view.attempts, 2);
    assert.equal(view.fallbackCount, 1);
  });

  await check('exhausted derives fallbackCount from trail when count missing', () => {
    const view = deriveStageAttemptView({
      provider: null,
      model: null,
      attempted: [
        { provider: 'openrouter', model: 'model-a' },
        { provider: 'openrouter', model: 'model-b' },
        { provider: 'openrouter', model: 'model-c' },
      ],
    });
    assert.equal(view.state, 'exhausted');
    assert.equal(view.fallbackCount, 2);
    assert.equal(view.attempts, 3);
  });

  await check('legacy stage row without attempt metadata -> initial, selected unknown', () => {
    const view = deriveStageAttemptView({ provider: 'openrouter', model: 'model-a' });
    assert.equal(view.state, 'initial');
    assert.equal(view.selected, null);
    assert.equal(view.actual, 'openrouter · model-a');
    assert.equal(view.attempts, 1);
    assert.equal(view.fallbackCount, 0);
  });

  await check('fallbackCount without trail -> fallback with unknown selected', () => {
    const view = deriveStageAttemptView({ provider: 'openrouter', model: 'model-b', fallbackCount: 2 });
    assert.equal(view.state, 'fallback');
    assert.equal(view.selected, null);
    assert.equal(view.actual, 'openrouter · model-b');
    assert.equal(view.attempts, 3);
    assert.equal(view.fallbackCount, 2);
  });

  await check('null and empty inputs -> unknown view', () => {
    for (const input of [null, undefined, { provider: null, model: null }]) {
      const view = deriveStageAttemptView(input);
      assert.equal(view.state, 'unknown');
      assert.equal(view.selected, null);
      assert.equal(view.actual, null);
      assert.equal(view.attempts, 0);
      assert.equal(view.fallbackCount, 0);
    }
  });

  await check('exhausted with empty trail -> unknown (no data to show)', () => {
    const view = deriveStageAttemptView({ provider: null, model: null, fallbackCount: 0, attempted: [] });
    assert.equal(view.state, 'unknown');
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
