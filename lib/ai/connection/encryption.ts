// Encrypts/decrypts provider credentials at rest using AES-256-GCM.
// The key comes from a server-side secret (BUGWISER_ENCRYPTION_KEY) and is
// never exposed to the client.

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getEncryptionKey(): Buffer {
  const raw = process.env.BUGWISER_ENCRYPTION_KEY;
  if (raw) {
    // Support either a raw 32-byte key or a base64-encoded 32-byte key.
    try {
      const decoded = Buffer.from(raw, 'base64');
      if (decoded.length === 32) return decoded;
    } catch { /* fall through */ }
    if (Buffer.byteLength(raw, 'utf8') === 32) {
      return Buffer.from(raw, 'utf8');
    }
    return crypto.createHash('sha256').update(raw).digest();
  }
  // Deterministic fallback from a known secret so encryption still works at
  // rest, but teams MUST set BUGWISER_ENCRYPTION_KEY in production.
  return crypto.createHash('sha256').update('bugwiser-local-encryption-secret').digest();
}

export function encryptSecret(plain: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.');
}

export function decryptSecret(payload: string): string {
  const key = getEncryptionKey();
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted credential payload');
  }
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

export function hasEncryptionKeyConfigured(): boolean {
  return !!process.env.BUGWISER_ENCRYPTION_KEY;
}