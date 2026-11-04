import assert from 'node:assert/strict';
import {
  GitHubConfigError,
  GitHubError,
  isRateLimited,
  retryAfterSeconds,
  sanitizeGitHubMessage,
} from './errors.ts';

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

test('redacts token-shaped values from messages', () => {
  assert.equal(
    sanitizeGitHubMessage('Bad token ghp_abcdefghijklmnopqrstuvwxyz0123456789'),
    'Bad token [redacted-token]'
  );
  assert.equal(
    sanitizeGitHubMessage('fine-grained github_pat_11ABCDEFG0123456789'),
    'fine-grained [redacted-token]'
  );
  assert.equal(
    sanitizeGitHubMessage('Header: Bearer abc.def-ghi'),
    'Header: Bearer [redacted]'
  );
  assert.equal(
    sanitizeGitHubMessage('Authorization: token abcdef'),
    'Authorization: [redacted]'
  );
});

test('bounds message length', () => {
  const message = sanitizeGitHubMessage('x'.repeat(2000));
  assert.equal(message.length, 500);
});

test('treats 429 and exhausted 403 as rate limits', () => {
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

test('extracts Retry-After as seconds or an HTTP date', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(retryAfterSeconds(429, new Headers({ 'retry-after': '45' }), now), 45);
  assert.equal(
    retryAfterSeconds(429, new Headers({ 'retry-after': 'Thu, 01 Jan 2026 00:02:00 GMT' }), now),
    120
  );
});

test('falls back to the rate-limit reset timestamp', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(
    retryAfterSeconds(403, new Headers({ 'x-ratelimit-reset': String(now / 1000 + 90) }), now),
    90
  );
});

test('defaults to a minute for a bare 429', () => {
  assert.equal(retryAfterSeconds(429, new Headers()), 60);
  assert.equal(retryAfterSeconds(500, new Headers()), undefined);
});

test('carries a stable code, status, and retry hint', () => {
  const error = new GitHubError('nope', 'rate_limited', { status: 429, retryAfterSeconds: 30 });
  assert.equal(error.name, 'GitHubError');
  assert.equal(error.code, 'rate_limited');
  assert.equal(error.status, 429);
  assert.equal(error.retryAfterSeconds, 30);

  const config = new GitHubConfigError('missing');
  assert.equal(config.name, 'GitHubConfigError');
  assert.equal(config.message, 'missing');
});

run();
