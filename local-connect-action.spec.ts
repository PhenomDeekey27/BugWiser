// Local LLM connect action — what ONE click on Connect does.
//
// The UI is one action: test the manually entered Base URL, show the
// discovered model IDs, then register only when the test genuinely succeeded.
// These are pure reducer/orchestration tests (no React, no HTTP):
//   - a saved/verified URL registers without being re-entered;
//   - idle/failed/no-models retries start with the test (the URL stays);
//   - discovered model IDs are kept for display and gate registration;
//   - a saved Base URL prefills the form (reconnect after reload).

import { strict as assert } from 'node:assert';
import {
  canConnect,
  canRegister,
  canTest,
  createInitialLocalFlowState,
  localFlowReducer,
  nextConnectStep,
  type LocalFlowState,
} from './components/models/localProviderFlow';

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

const SAVED_URL = 'http://127.0.0.1:1234/v1';

function failedState(baseUrl = SAVED_URL): LocalFlowState {
  let s = localFlowReducer(createInitialLocalFlowState(), {
    type: 'field',
    field: 'baseUrl',
    value: baseUrl,
  });
  s = localFlowReducer(s, { type: 'test-start' });
  return localFlowReducer(s, { type: 'test-failure', error: 'could not reach the endpoint' });
}

function verifiedState(modelIds = ['qwen2.5-7b', 'llama-3-8b']): LocalFlowState {
  let s = localFlowReducer(createInitialLocalFlowState(), {
    type: 'field',
    field: 'baseUrl',
    value: 'localhost:1234/v1',
  });
  s = localFlowReducer(s, { type: 'test-start' });
  return localFlowReducer(s, {
    type: 'test-success',
    modelIds,
    baseUrl: SAVED_URL,
  });
}

async function main(): Promise<void> {
  await check('saved Base URL prefills the form (reconnect without retyping)', () => {
    const s = createInitialLocalFlowState(SAVED_URL);
    assert.equal(s.baseUrl, SAVED_URL);
    assert.equal(s.phase, 'idle');
    assert.equal(canConnect(s), true, 'a prefilled URL can be connected immediately');
  });

  await check('Connect from idle tests first (never registers an untested URL)', () => {
    const s = createInitialLocalFlowState('127.0.0.1:1234/v1');
    assert.deepEqual(nextConnectStep(s), { step: 'test' });
    assert.equal(canRegister(s), false);
  });

  await check('Connect with an empty URL is blocked, not sent', () => {
    const s = createInitialLocalFlowState();
    const next = nextConnectStep(s);
    assert.equal(next.step, 'blocked');
    if (next.step === 'blocked') assert.ok(/base url/i.test(next.reason));
    assert.equal(canConnect(s), false);
    assert.equal(canTest(s), false);
  });

  await check('successful test keeps the discovered model IDs and normalizes the tested URL', () => {
    const s = verifiedState(['a', 'b', 'c']);
    assert.equal(s.phase, 'verified');
    assert.deepEqual(s.modelIds, ['a', 'b', 'c']);
    assert.equal(s.modelCount, 3);
    assert.equal(s.verifiedBaseUrl, SAVED_URL, 'registration submits what the server tested');
    assert.equal(canRegister(s), true);
  });

  await check('Connect after a verified test registers the verified URL directly', () => {
    const s = verifiedState();
    assert.deepEqual(nextConnectStep(s), { step: 'register', baseUrl: SAVED_URL });
  });

  await check('a failed test keeps the URL and the next Connect retries the test', () => {
    const s = failedState('localhost:8000/v1');
    assert.equal(s.baseUrl, 'localhost:8000/v1');
    assert.equal(s.error, 'could not reach the endpoint');
    assert.deepEqual(nextConnectStep(s), { step: 'test' });
    assert.equal(canConnect(s), true);
  });

  await check('a zero-model endpoint cannot register and can be retried without retyping', () => {
    let s = createInitialLocalFlowState();
    s = localFlowReducer(s, { type: 'field', field: 'baseUrl', value: SAVED_URL });
    s = localFlowReducer(s, { type: 'test-start' });
    s = localFlowReducer(s, { type: 'test-success', modelIds: [], baseUrl: SAVED_URL });
    assert.equal(s.phase, 'no-models');
    assert.equal(s.modelCount, 0);
    assert.equal(canRegister(s), false);
    assert.deepEqual(nextConnectStep(s), { step: 'test' });
    assert.equal(canConnect(s), true);
  });

  await check('busy and registered states cannot start another Connect (no duplicates)', () => {
    const testing = localFlowReducer(
      localFlowReducer(createInitialLocalFlowState(), {
        type: 'field',
        field: 'baseUrl',
        value: SAVED_URL,
      }),
      { type: 'test-start' }
    );
    assert.equal(canConnect(testing), false);
    assert.equal(nextConnectStep(testing).step, 'blocked');

    const registering = localFlowReducer(verifiedState(), { type: 'register-start' });
    assert.equal(canConnect(registering), false);

    const registered = localFlowReducer(registering, { type: 'register-success' });
    assert.equal(canConnect(registered), false);
    assert.equal(nextConnectStep(registered).step, 'blocked');
  });

  await check('editing the URL after verification drops the discovered models too', () => {
    const s = localFlowReducer(verifiedState(), {
      type: 'field',
      field: 'baseUrl',
      value: 'http://127.0.0.1:8000/v1',
    });
    assert.equal(s.phase, 'idle');
    assert.deepEqual(s.modelIds, []);
    assert.equal(s.modelCount, 0);
    assert.equal(s.verifiedBaseUrl, null);
    assert.equal(canRegister(s), false);
  });

  await check('full click path: paste → test → models → register → connected', () => {
    let s = createInitialLocalFlowState();
    s = localFlowReducer(s, { type: 'field', field: 'baseUrl', value: 'localhost:1234/v1' });

    // Connect decides it must test first.
    const step = nextConnectStep(s);
    assert.deepEqual(step, { step: 'test' });
    s = localFlowReducer(s, { type: 'test-start' });
    s = localFlowReducer(s, {
      type: 'test-success',
      modelIds: ['qwen2.5-7b'],
      baseUrl: SAVED_URL,
    });

    // Then it registers exactly the verified endpoint.
    const registerStep = nextConnectStep(s);
    assert.equal(registerStep.step, 'register');
    if (registerStep.step === 'register') {
      assert.equal(registerStep.baseUrl, SAVED_URL);
    }
    s = localFlowReducer(s, { type: 'register-start' });
    s = localFlowReducer(s, { type: 'register-success' });
    s = localFlowReducer(s, { type: 'clear-api-key' });
    assert.equal(s.phase, 'registered');
    assert.equal(s.error, null);
    assert.deepEqual(s.modelIds, ['qwen2.5-7b'], 'discovered models stay visible after saving');
  });

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILED');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('SPEC CRASH :: ' + ((err as Error).stack || String(err)));
  process.exit(1);
});
