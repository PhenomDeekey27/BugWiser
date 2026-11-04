import assert from 'node:assert/strict';
import {
  AnalysisAccessError,
  assertAnalysisVisible,
  isAnalysisVisibleTo,
} from './ownership.ts';

const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];

function test(name: string, fn: () => void | Promise<void>) {
  tests.push({ name, fn });
}

const ALICE = '11111111-1111-1111-1111-111111111111';
const BOB = '22222222-2222-2222-2222-222222222222';

test('the owner sees their own analysis', () => {
  assert.equal(isAnalysisVisibleTo(ALICE, ALICE), true);
  assert.doesNotThrow(() => assertAnalysisVisible(ALICE, ALICE));
});

test("a different signed-in user never sees someone else's analysis", () => {
  assert.equal(isAnalysisVisibleTo(ALICE, BOB), false);
  assert.equal(isAnalysisVisibleTo(BOB, ALICE), false);
  assert.throws(() => assertAnalysisVisible(ALICE, BOB), AnalysisAccessError);
});

test('an analysis with no owner is never visible', () => {
  for (const value of [null, undefined, '']) {
    assert.equal(isAnalysisVisibleTo(value as string | null, ALICE), false);
  }
});

test('an unauthenticated viewer never sees an analysis, even an ownerless one', () => {
  for (const value of [null, undefined, '']) {
    assert.equal(isAnalysisVisibleTo(ALICE, value as string | null), false);
    assert.equal(isAnalysisVisibleTo(null, value as string | null), false);
  }
});

test('ownership is an exact comparison, not a prefix, trim, or case-fold', () => {
  // A UUID that actually contains letters, so case folding is observable.
  const mixed = 'AaBbCcDd-1111-2222-3333-444455556666';
  assert.equal(isAnalysisVisibleTo(mixed, mixed), true);
  assert.equal(isAnalysisVisibleTo(mixed, mixed.toLowerCase()), false);
  assert.equal(isAnalysisVisibleTo(mixed, `${mixed} `), false);
  assert.equal(isAnalysisVisibleTo(mixed, mixed.slice(0, -1)), false);
});

let passed = 0;
for (const t of tests) {
  try {
    await t.fn();
    passed++;
    console.log(`ok  - ${t.name}`);
  } catch (error) {
    console.log(`FAIL- ${t.name}`);
    console.log(error instanceof Error ? error.stack : String(error));
  }
}

console.log(`${passed}/${tests.length} tests passed`);
if (passed !== tests.length) process.exitCode = 1;
