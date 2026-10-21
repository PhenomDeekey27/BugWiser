import assert from 'node:assert/strict';
import {
  constantTimeEqual,
  randomToken,
  safeReturnTo,
  signSignedToken,
  verifySignedToken,
} from './signed-cookie.ts';

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

const SECRET = 'a'.repeat(48);
const NOW = 1_800_000_000_000;

suite('Signed cookie', () => {
  test('round-trips its payload', () => {
    const token = signSignedToken({ uid: 'user-1', sid: 'session-1' }, SECRET, 'session', 60, NOW);
    const payload = verifySignedToken(token, SECRET, 'session', NOW + 1000);
    assert.ok(payload);
    assert.equal(payload.uid, 'user-1');
    assert.equal(payload.sid, 'session-1');
    assert.equal(payload.typ, 'session');
  });

  test('rejects a tampered payload', () => {
    const token = signSignedToken({ uid: 'user-1' }, SECRET, 'session', 60, NOW);
    const [encoded, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ typ: 'session', iat: NOW / 1000, exp: NOW / 1000 + 60, uid: 'admin' })
    ).toString('base64url');
    assert.equal(verifySignedToken(`${forged}.${signature}`, SECRET, 'session', NOW + 1000), null);
    // Sanity: the original still verifies.
    assert.ok(verifySignedToken(`${encoded}.${signature}`, SECRET, 'session', NOW + 1000));
  });

  test('rejects a tampered signature', () => {
    const token = signSignedToken({ uid: 'user-1' }, SECRET, 'session', 60, NOW);
    const [encoded] = token.split('.');
    assert.equal(verifySignedToken(`${encoded}.${'A'.repeat(43)}`, SECRET, 'session', NOW), null);
  });

  test('rejects the wrong secret', () => {
    const token = signSignedToken({ uid: 'user-1' }, SECRET, 'session', 60, NOW);
    assert.equal(verifySignedToken(token, 'b'.repeat(48), 'session', NOW), null);
  });

  test('rejects an expired token', () => {
    const token = signSignedToken({ uid: 'user-1' }, SECRET, 'session', 60, NOW);
    assert.equal(verifySignedToken(token, SECRET, 'session', NOW + 61_000), null);
  });

  test('rejects a token replayed as another cookie type', () => {
    const token = signSignedToken({ state: 'x' }, SECRET, 'oauth_state', 60, NOW);
    assert.equal(verifySignedToken(token, SECRET, 'session', NOW), null);
  });

  test('rejects a token issued in the future', () => {
    const token = signSignedToken({ uid: 'user-1' }, SECRET, 'session', 60, NOW);
    assert.equal(verifySignedToken(token, SECRET, 'session', NOW - 5 * 60_000), null);
  });

  test('refuses to sign with a short secret', () => {
    assert.throws(() => signSignedToken({ uid: 'x' }, 'short', 'session', 60, NOW));
    assert.equal(verifySignedToken('a.b', 'short', 'session', NOW), null);
  });

  test('never verifies empty or malformed input', () => {
    for (const value of [null, undefined, '', 'abc', 'a.b.c', '.']) {
      assert.equal(verifySignedToken(value, SECRET, 'session', NOW), null);
    }
  });
});

suite('safeReturnTo', () => {
  test('allows same-origin absolute paths', () => {
    assert.equal(safeReturnTo('/dashboard'), '/dashboard');
    assert.equal(safeReturnTo('/analysis/abc?tab=patch'), '/analysis/abc?tab=patch');
  });

  test('falls back for open-redirect shapes', () => {
    for (const value of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'dashboard',
      '/path\r\nLocation: https://evil.example',
      '/path\\to',
      '',
      null,
      undefined,
      `/${'a'.repeat(600)}`,
    ]) {
      assert.equal(safeReturnTo(value as string | null | undefined), '/dashboard');
    }
  });

  test('honours a custom fallback', () => {
    assert.equal(safeReturnTo('//evil', '/'), '/');
  });
});

suite('constantTimeEqual', () => {
  test('compares equal values only', () => {
    assert.equal(constantTimeEqual('abc', 'abc'), true);
    assert.equal(constantTimeEqual('abc', 'abd'), false);
    assert.equal(constantTimeEqual('abc', 'abcd'), false);
    assert.equal(constantTimeEqual(null, 'abc'), false);
    assert.equal(constantTimeEqual('', ''), false);
  });
});

suite('randomToken', () => {
  test('is url-safe and unique', () => {
    const a = randomToken(24);
    const b = randomToken(24);
    assert.notEqual(a, b);
    assert.match(a, /^[A-Za-z0-9_-]+$/);
  });
});

run();
