import assert from 'node:assert/strict';
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_SECONDS,
  createOAuthStateValue,
  readOAuthStateCookieValue,
  signOAuthState,
  verifyOAuthStateToken,
} from './oauth-state-core.ts';

const { test, run } = (() => {
  const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];
  return {
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

const SECRET = 'k'.repeat(48);
const NOW = 1_800_000_000_000;

test('creates unique, url-safe state values', () => {
  const a = createOAuthStateValue();
  const b = createOAuthStateValue();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]{20,}$/);
});

test('round-trips state and return target', () => {
  const state = createOAuthStateValue();
  const cookie = signOAuthState(SECRET, { state, returnTo: '/analysis/new' }, NOW);
  const result = verifyOAuthStateToken(cookie, state, SECRET, NOW + 1000);
  assert.deepEqual(result, { ok: true, returnTo: '/analysis/new' });
});

test('reports a missing cookie separately from a mismatch', () => {
  assert.deepEqual(verifyOAuthStateToken(null, 'anything', SECRET, NOW), {
    ok: false,
    reason: 'missing',
  });
  assert.deepEqual(verifyOAuthStateToken('', 'anything', SECRET, NOW), {
    ok: false,
    reason: 'missing',
  });

  const cookie = signOAuthState(SECRET, { state: 'abc', returnTo: '/dashboard' }, NOW);
  assert.deepEqual(verifyOAuthStateToken(cookie, 'different', SECRET, NOW), {
    ok: false,
    reason: 'mismatch',
  });
  assert.deepEqual(verifyOAuthStateToken(cookie, null, SECRET, NOW), {
    ok: false,
    reason: 'mismatch',
  });
});

test('rejects a forged, tampered, or foreign-secret cookie', () => {
  const state = 'state-value';
  const cookie = signOAuthState(SECRET, { state, returnTo: '/dashboard' }, NOW);
  const [encoded, signature] = cookie.split('.');
  const forged = Buffer.from(
    JSON.stringify({ typ: 'oauth_state', iat: NOW / 1000, exp: NOW / 1000 + 600, s: state })
  ).toString('base64url');

  assert.deepEqual(verifyOAuthStateToken(`${forged}.${signature}`, state, SECRET, NOW), {
    ok: false,
    reason: 'invalid',
  });
  assert.deepEqual(verifyOAuthStateToken(cookie, state, 'z'.repeat(48), NOW), {
    ok: false,
    reason: 'invalid',
  });
  assert.deepEqual(verifyOAuthStateToken(`${encoded}.${'A'.repeat(43)}`, state, SECRET, NOW), {
    ok: false,
    reason: 'invalid',
  });
});

test('rejects an expired state cookie', () => {
  const state = 'state-value';
  const cookie = signOAuthState(SECRET, { state, returnTo: '/dashboard' }, NOW);
  assert.deepEqual(
    verifyOAuthStateToken(cookie, state, SECRET, NOW + OAUTH_STATE_TTL_SECONDS * 1000),
    { ok: false, reason: 'invalid' }
  );
});

test('falls back to /dashboard when the payload has no return target', () => {
  const state = 'state-value';
  const cookie = signOAuthState(SECRET, { state, returnTo: '' }, NOW);
  assert.deepEqual(verifyOAuthStateToken(cookie, state, SECRET, NOW), {
    ok: true,
    returnTo: '/dashboard',
  });
});

test('reads the state cookie value from a cookie store', () => {
  assert.equal(
    readOAuthStateCookieValue({ get: (name) => (name === OAUTH_STATE_COOKIE ? { value: 'v' } : undefined) }),
    'v'
  );
  assert.equal(readOAuthStateCookieValue({ get: () => undefined }), null);
  assert.equal(readOAuthStateCookieValue({ get: () => ({ value: '' }) }), null);
});

run();
