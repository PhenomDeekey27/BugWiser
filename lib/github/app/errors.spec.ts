import assert from 'node:assert/strict';
import { GitHubAppError, isRateLimited, retryAfterSeconds, sanitizeGitHubMessage } from './errors.ts';

const { test, suite, run } = (() => {
  const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];
  return {
    suite(_name: string, fn: () => void) {
      fn();
    },
    test(name: string, fn: () => void | Promise<void>) {
      tests.push({ name, fn });
    },
    async run() {
      let passed = 0;
      for (const t of tests) {
        try {
          await t.fn();
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

suite('GitHub App errors', () => {
  test('keeps a typed code, status and retry hint', () => {
    const error = new GitHubAppError('nope', 'missing_permissions', { status: 403 });
    assert.equal(error.name, 'GitHubAppError');
    assert.equal(error.code, 'missing_permissions');
    assert.equal(error.status, 403);
    assert.equal(error.retryAfterSeconds, undefined);
  });

  test('redacts token-shaped values from messages', () => {
    const message = sanitizeGitHubMessage(
      'failed with ghp_abcdefgh12345678 and github_pat_abcdefgh12345678 using Authorization: Bearer abc.def'
    );
    assert.ok(!message.includes('ghp_abcdefgh12345678'));
    assert.ok(!message.includes('github_pat_abcdefgh12345678'));
    assert.ok(!message.includes('abc.def'));
    assert.ok(message.includes('[redacted-token]'));
  });

  test('caps message length', () => {
    assert.equal(sanitizeGitHubMessage('x'.repeat(5000)).length, 500);
  });
});

suite('Rate limiting', () => {
  test('detects 429 and exhausted 403s', () => {
    assert.equal(isRateLimited(429, new Headers()), true);
    assert.equal(
      isRateLimited(403, new Headers({ 'x-ratelimit-remaining': '0' })),
      true
    );
    assert.equal(
      isRateLimited(403, new Headers({ 'x-ratelimit-remaining': '12' })),
      false
    );
    assert.equal(isRateLimited(500, new Headers()), false);
  });

  test('reads retry-after seconds and HTTP dates', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    assert.equal(retryAfterSeconds(429, new Headers({ 'retry-after': '42' }), now), 42);
    assert.equal(
      retryAfterSeconds(
        403,
        new Headers({ 'retry-after': 'Thu, 01 Jan 2026 00:01:00 GMT' }),
        now
      ),
      60
    );
  });

  test('falls back to the rate-limit reset timestamp', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    const reset = String(Math.floor(now / 1000) + 30);
    assert.equal(
      retryAfterSeconds(403, new Headers({ 'x-ratelimit-reset': reset }), now),
      30
    );
  });

  test('defaults a bare 429 to one minute', () => {
    assert.equal(retryAfterSeconds(429, new Headers()), 60);
    assert.equal(retryAfterSeconds(403, new Headers()), undefined);
  });
});

run();
