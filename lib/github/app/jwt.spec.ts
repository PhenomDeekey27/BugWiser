import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createAppJwt, verifyAppJwtSignature } from './jwt.ts';

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

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function decode(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

suite('GitHub App JWT', () => {
  test('builds an RS256 JWT with the App id as issuer', () => {
    const now = 1_800_000_000_000;
    const token = createAppJwt(424242, privateKey, now);
    const parts = token.split('.');
    assert.equal(parts.length, 3);

    const header = decode(parts[0]);
    assert.equal(header.alg, 'RS256');
    assert.equal(header.typ, 'JWT');

    const payload = decode(parts[1]);
    const expectedNow = Math.floor(now / 1000);
    assert.equal(payload.iss, 424242);
    assert.equal(payload.iat, expectedNow - 60);
    assert.equal(payload.exp, expectedNow + 9 * 60);
    // GitHub rejects lifetimes above 10 minutes.
    assert.ok((payload.exp as number) - (payload.iat as number) <= 600);
  });

  test('signature verifies against the matching public key', () => {
    const token = createAppJwt(1, privateKey);
    assert.equal(verifyAppJwtSignature(token, publicKey), true);
  });

  test('signature fails for a tampered payload', () => {
    const token = createAppJwt(1, privateKey);
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ iat: 1, exp: 9999999999, iss: 1 })
    ).toString('base64url');
    assert.equal(verifyAppJwtSignature(`${header}.${forged}.${signature}`, publicKey), false);
  });

  test('signature fails for a different key', () => {
    const other = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const token = createAppJwt(1, privateKey);
    assert.equal(verifyAppJwtSignature(token, other.publicKey), false);
  });

  test('rejects an invalid app id or key', () => {
    assert.throws(() => createAppJwt(0, privateKey));
    assert.throws(() => createAppJwt(Number.NaN, privateKey));
    assert.throws(() => createAppJwt(1, 'not-a-key'));
  });
});

run();
