// Task M — the Local LLM connect flow state machine (Test Connection gate →
// Register). Pure reducer tests: no React render, no HTTP, no database.

import { strict as assert } from 'node:assert';
import {
  canRegister,
  canTest,
  createInitialLocalFlowState,
  localFlowReducer,
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

/** idle → field(base URL) → testing → verified(2 models). */
function verifiedState(modelCount = 2): LocalFlowState {
  let s = createInitialLocalFlowState();
  s = localFlowReducer(s, { type: 'field', field: 'baseUrl', value: 'http://127.0.0.1:8000/v1' });
  s = localFlowReducer(s, { type: 'test-start' });
  s = localFlowReducer(s, { type: 'test-success', modelCount, baseUrl: 'http://127.0.0.1:8000/v1' });
  return s;
}

async function main(): Promise<void> {
  await check('initial state: idle, nothing testable, nothing registrable', () => {
    const s = createInitialLocalFlowState();
    assert.equal(s.phase, 'idle');
    assert.equal(s.baseUrl, '');
    assert.equal(s.apiKey, '');
    assert.equal(s.modelCount, 0);
    assert.equal(s.error, null);
    assert.equal(s.verifiedBaseUrl, null);
    assert.equal(canTest(s), false, 'no base URL → nothing to test');
    assert.equal(canRegister(s), false, 'never before a successful test');
  });

  await check('typing a base URL makes testing possible; other fields keep idle', () => {
    let s = createInitialLocalFlowState();
    s = localFlowReducer(s, { type: 'field', field: 'baseUrl', value: 'http://127.0.0.1:8000/v1' });
    assert.equal(s.baseUrl, 'http://127.0.0.1:8000/v1');
    assert.equal(s.phase, 'idle');
    assert.equal(canTest(s), true);
    s = localFlowReducer(s, { type: 'field', field: 'apiKey', value: 'sk-local' });
    assert.equal(s.apiKey, 'sk-local');
    assert.equal(s.phase, 'idle');
  });

  await check('test-start: idle → testing, and no double-fire while testing', () => {
    const s = createInitialLocalFlowState('http://127.0.0.1:8000/v1');
    const started = localFlowReducer(s, { type: 'test-start' });
    assert.equal(started.phase, 'testing');
    const again = localFlowReducer(started, { type: 'test-start' });
    assert.equal(again, started, 'a second test-start while testing must be ignored');
    assert.equal(canTest(started), false, 'no concurrent tests');
    assert.equal(canRegister(started), false);
  });

  await check('test-start with an empty base URL is ignored', () => {
    const s = createInitialLocalFlowState();
    assert.equal(localFlowReducer(s, { type: 'test-start' }), s);
  });

  await check('test-success with models → verified, registration allowed', () => {
    const s = verifiedState(3);
    assert.equal(s.phase, 'verified');
    assert.equal(s.modelCount, 3);
    assert.equal(s.verifiedBaseUrl, 'http://127.0.0.1:8000/v1');
    assert.equal(s.error, null);
    assert.equal(canRegister(s), true);
  });

  await check('test-success with zero models → "no-models", registration BLOCKED', () => {
    const s = verifiedState(0);
    assert.equal(s.phase, 'no-models');
    assert.equal(s.modelCount, 0);
    assert.equal(canRegister(s), false, 'an empty endpoint must never register');
    assert.equal(canTest(s), true, 'the user can still re-test');
  });

  await check('test-failure → failed with the error, nothing verified', () => {
    let s = createInitialLocalFlowState('http://127.0.0.1:8000/v1');
    s = localFlowReducer(s, { type: 'test-start' });
    s = localFlowReducer(s, { type: 'test-failure', error: 'HTTP 401 from /models' });
    assert.equal(s.phase, 'failed');
    assert.equal(s.error, 'HTTP 401 from /models');
    assert.equal(s.verifiedBaseUrl, null);
    assert.equal(s.modelCount, 0);
    assert.equal(canRegister(s), false);
    assert.equal(canTest(s), true, 'a failed test can be retried');
  });

  await check('editing the base URL after verification invalidates it (register what you tested)', () => {
    const before = verifiedState(2);
    assert.equal(canRegister(before), true);
    const after = localFlowReducer(before, {
      type: 'field',
      field: 'baseUrl',
      value: 'http://127.0.0.1:9999/v1',
    });
    assert.equal(after.phase, 'idle');
    assert.equal(after.modelCount, 0);
    assert.equal(after.verifiedBaseUrl, null);
    assert.equal(canRegister(after), false);
    assert.equal(after.baseUrl, 'http://127.0.0.1:9999/v1');
  });

  await check('editing the API key after verification also invalidates it', () => {
    const after = localFlowReducer(verifiedState(2), {
      type: 'field',
      field: 'apiKey',
      value: 'sk-rotated',
    });
    assert.equal(after.phase, 'idle');
    assert.equal(canRegister(after), false, 'an untested key must never register');
    assert.equal(after.apiKey, 'sk-rotated');
  });

  await check('field edits are ignored while testing or registering', () => {
    const testing = localFlowReducer(
      createInitialLocalFlowState('http://127.0.0.1:8000/v1'),
      { type: 'test-start' }
    );
    assert.equal(
      localFlowReducer(testing, { type: 'field', field: 'baseUrl', value: 'changed' }),
      testing
    );
    const registering = localFlowReducer(verifiedState(2), { type: 'register-start' });
    assert.equal(registering.phase, 'registering');
    assert.equal(
      localFlowReducer(registering, { type: 'field', field: 'apiKey', value: 'changed' }),
      registering
    );
  });

  await check('register-start only fires from verified (gate holds)', () => {
    const idle = createInitialLocalFlowState('http://127.0.0.1:8000/v1');
    assert.equal(localFlowReducer(idle, { type: 'register-start' }), idle);

    const empty = verifiedState(0);
    assert.equal(localFlowReducer(empty, { type: 'register-start' }), empty, 'no-models cannot start');

    const failed = localFlowReducer(idle, { type: 'test-start' });
    const failed2 = localFlowReducer(failed, { type: 'test-failure', error: 'x' });
    assert.equal(localFlowReducer(failed2, { type: 'register-start' }), failed2);

    const ok = localFlowReducer(verifiedState(1), { type: 'register-start' });
    assert.equal(ok.phase, 'registering');
    assert.equal(canTest(ok), false, 'no test while registering');
    assert.equal(canRegister(ok), false, 'no double registration');
  });

  await check('register-success → registered; register-failure → back to verified with error', () => {
    const registering = localFlowReducer(verifiedState(2), { type: 'register-start' });

    const registered = localFlowReducer(registering, { type: 'register-success' });
    assert.equal(registered.phase, 'registered');
    assert.equal(registered.error, null);
    assert.equal(canRegister(registered), false, 'terminal state, no re-register');

    const retry = localFlowReducer(registering, {
      type: 'register-failure',
      error: 'Provider validation failed: HTTP 404',
    });
    assert.equal(retry.phase, 'verified', 'failed registration can retry after the same test');
    assert.equal(retry.error, 'Provider validation failed: HTTP 404');
    assert.equal(canRegister(retry), true);
  });

  await check('register outcomes outside "registering" are ignored', () => {
    const before = verifiedState(2);
    assert.equal(localFlowReducer(before, { type: 'register-success' }), before);
    assert.equal(
      localFlowReducer(before, { type: 'register-failure', error: 'stale' }),
      before
    );
    assert.equal(before.error, null, 'stale failures never surface');
  });

  await check('clear-api-key drops the secret without touching the phase', () => {
    const registering = localFlowReducer(verifiedState(2), { type: 'register-start' });
    const cleared = localFlowReducer(registering, { type: 'clear-api-key' });
    assert.equal(cleared.apiKey, '');
    assert.equal(cleared.phase, 'registering', 'phase untouched mid-registration');
    assert.equal(cleared.verifiedBaseUrl, registering.verifiedBaseUrl);
  });

  await check('happy path end-to-end: test → verify → register → registered', () => {
    let s = createInitialLocalFlowState();
    assert.equal(s.phase, 'idle');
    s = localFlowReducer(s, { type: 'field', field: 'baseUrl', value: 'http://127.0.0.1:8000/v1' });
    s = localFlowReducer(s, { type: 'field', field: 'apiKey', value: 'sk-local' });
    s = localFlowReducer(s, { type: 'test-start' });
    s = localFlowReducer(s, { type: 'test-success', modelCount: 2, baseUrl: 'http://127.0.0.1:8000/v1' });
    assert.equal(canRegister(s), true, 'gate opens only here');
    s = localFlowReducer(s, { type: 'register-start' });
    s = localFlowReducer(s, { type: 'register-success' });
    s = localFlowReducer(s, { type: 'clear-api-key' });
    assert.equal(s.phase, 'registered');
    assert.equal(s.apiKey, '');
    assert.equal(canRegister(s), false);
    assert.equal(canTest(s), false);
    assert.equal(s.error, null);
  });

  await check('reset returns to idle keeping the typed base URL', () => {
    const failed = localFlowReducer(
      localFlowReducer(
        createInitialLocalFlowState('http://127.0.0.1:8000/v1'),
        { type: 'test-start' }
      ),
      { type: 'test-failure', error: 'boom' }
    );
    const reset = localFlowReducer(failed, { type: 'reset' });
    assert.equal(reset.phase, 'idle');
    assert.equal(reset.baseUrl, 'http://127.0.0.1:8000/v1');
    assert.equal(reset.error, null);
    assert.equal(reset.modelCount, 0);
    assert.equal(reset.verifiedBaseUrl, null);
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
