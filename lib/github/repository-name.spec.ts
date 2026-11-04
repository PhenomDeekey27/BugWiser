import assert from 'node:assert/strict';
import { parseRepositoryFullName } from './repository-name.ts';

const { test, run } = (() => {
  const tests: Array<{ name: string; fn: () => void }> = [];
  return {
    test(name: string, fn: () => void) {
      tests.push({ name, fn });
    },
    run() {
      let passed = 0;
      for (const t of tests) {
        try {
          t.fn();
          passed++;
          console.log(`ok  - ${t.name}`);
        } catch (err) {
          console.log(`FAIL- ${t.name}`);
          console.log(err instanceof Error ? err.stack : String(err));
        }
      }
      console.log(`${passed}/${tests.length} tests passed`);
      if (passed !== tests.length) process.exitCode = 1;
    },
  };
})();

test('accepts owner/name and normalises whitespace', () => {
  assert.deepEqual(parseRepositoryFullName('  octocat/Hello-World.js '), {
    ok: true,
    owner: 'octocat',
    repo: 'Hello-World.js',
    fullName: 'octocat/Hello-World.js',
  });
});

test('rejects anything that is not exactly two segments', () => {
  for (const value of ['', 'octocat', 'a/b/c']) {
    assert.deepEqual(parseRepositoryFullName(value), { ok: false, reason: 'shape' });
  }
  for (const value of ['/', 'a/', '/b']) {
    assert.deepEqual(parseRepositoryFullName(value), { ok: false, reason: 'invalid' });
  }
});

test('rejects path traversal and encoded separators before any network call', () => {
  for (const value of ['../etc/passwd', 'a/..', 'a/%2e%2e', 'a b/c', 'a/b?x=1', 'a/b#frag']) {
    const result = parseRepositoryFullName(value);
    assert.equal(result.ok, false);
  }
});

test('rejects overly long segments', () => {
  assert.deepEqual(parseRepositoryFullName(`a/${'b'.repeat(101)}`), {
    ok: false,
    reason: 'invalid',
  });
});

run();
