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
const TYPE = 'oauth_state' as const;

suite('Signed cookie', () => {
  test('round-trips its payload', () => {
    const token = signSignedToken(
      { state: 'state-1', returnTo: '/dashboard', binding: 'b1' },
      SECRET,
      TYPE,
      60,
      NOW
    );
    const payload = verifySignedToken(token, SECRET, TYPE, NOW + 1000);
    assert.ok(payload);
    assert.equal(payload.state, 'state-1');
    assert.equal(payload.returnTo, '/dashboard');
    assert.equal(payload.binding, 'b1');
    assert.equal(payload.typ, TYPE);
  });

  test('rejects a tampered payload', () => {
    const token = signSignedToken({ state: 'state-1' }, SECRET, TYPE, 60, NOW);
    const [encoded, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ typ: TYPE, iat: NOW / 1000, exp: NOW / 1000 + 60, state: 'attacker' })
    ).toString('base64url');
    assert.equal(verifySignedToken(`${forged}.${signature}`, SECRET, TYPE, NOW + 1000), null);
    // Sanity: the original still verifies.
    assert.ok(verifySignedToken(`${encoded}.${signature}`, SECRET, TYPE, NOW + 1000));
  });

  test('rejects a tampered signature', () => {
    const token = signSignedToken({ state: 'state-1' }, SECRET, TYPE, 60, NOW);
    const [encoded] = token.split('.');
    assert.equal(verifySignedToken(`${encoded}.${'A'.repeat(43)}`, SECRET, TYPE, NOW), null);
  });

  test('rejects the wrong secret', () => {
    const token = signSignedToken({ state: 'state-1' }, SECRET, TYPE, 60, NOW);
    assert.equal(verifySignedToken(token, 'b'.repeat(48), TYPE, NOW), null);
  });

  test('rejects an expired token', () => {
    const token = signSignedToken({ state: 'state-1' }, SECRET, TYPE, 60, NOW);
    assert.equal(verifySignedToken(token, SECRET, TYPE, NOW + 61_000), null);
  });

  test('rejects a token whose type marker does not match', () => {
    const token = signSignedToken({ state: 'state-1' }, SECRET, TYPE, 60, NOW);
    const [encoded, signature] = token.split('.');
    const otherType = Buffer.from(
      JSON.stringify({ typ: 'sealed_session', iat: NOW / 1000, exp: NOW / 1000 + 60 })
    ).toString('base64url');
    assert.equal(verifySignedToken(`${otherType}.${signature}`, SECRET, TYPE, NOW), null);
    assert.ok(verifySignedToken(`${encoded}.${signature}`, SECRET, TYPE, NOW));
  });

  test('rejects a token issued in the future', () => {
    const token = signSignedToken({ state: 'state-1' }, SECRET, TYPE, 60, NOW);
    assert.equal(verifySignedToken(token, SECRET, TYPE, NOW - 5 * 60_000), null);
  });

  test('refuses to sign with a short secret', () => {
    assert.throws(() => signSignedToken({ state: 'x' }, 'short', TYPE, 60, NOW));
    assert.equal(verifySignedToken('a.b', 'short', TYPE, NOW), null);
  });

  test('never verifies empty or malformed input', () => {
    for (const value of [null, undefined, '', 'abc', 'a.b.c', '.']) {
      assert.equal(verifySignedToken(value, SECRET, TYPE, NOW), null);
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
