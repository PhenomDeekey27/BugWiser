import crypto from 'node:crypto';

function base64Url(value: Buffer | string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

/**
 * Create the RS256 JWT GitHub requires for App-level requests.
 * `iat` is backdated 60s for clock skew; `exp` stays under GitHub's 10-minute
 * maximum. The private key never leaves the server.
 */
export function createAppJwt(
  appId: number,
  privateKeyPem: string,
  nowMs: number = Date.now()
): string {
  if (!Number.isSafeInteger(appId) || appId <= 0) {
    throw new Error('Invalid GitHub App id');
  }
  if (!privateKeyPem.includes('BEGIN') || !privateKeyPem.includes('PRIVATE KEY')) {
    throw new Error('Invalid GitHub App private key');
  }

  const now = Math.floor(nowMs / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({
      iat: now - 60,
      exp: now + 9 * 60,
      iss: appId,
    })
  );

  const signingInput = `${header}.${payload}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(signingInput)
    .sign(privateKeyPem);

  return `${signingInput}.${base64Url(signature)}`;
}

/** Verify a JWT produced above. Exposed for tests and diagnostics only. */
export function verifyAppJwtSignature(
  token: string,
  publicKeyPem: string
): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [header, payload, signature] = parts;
  const padded = signature.replace(/-/g, '+').replace(/_/g, '/');
  const signatureBuffer = Buffer.from(
    padded + '='.repeat((4 - (padded.length % 4)) % 4),
    'base64'
  );
  return crypto
    .createVerify('RSA-SHA256')
    .update(`${header}.${payload}`)
    .verify(publicKeyPem, signatureBuffer);
}
