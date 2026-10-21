// Pure signed-cookie helpers. No Next.js or Supabase imports so this module is
// unit-testable without a request context.
//
// Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload))
// The payload always carries a `typ` marker plus `iat`/`exp`, so one cookie can
// never be replayed as another kind of cookie.

import crypto from 'node:crypto';
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_SECONDS,
  PENDING_INSTALL_COOKIE,
  PENDING_INSTALL_TTL_SECONDS,
  SESSION_COOKIE,
  SESSION_ROTATE_AFTER_SECONDS,
  SESSION_TTL_SECONDS,
} from './cookie-names.ts';

export {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_SECONDS,
  PENDING_INSTALL_COOKIE,
  PENDING_INSTALL_TTL_SECONDS,
  SESSION_COOKIE,
  SESSION_ROTATE_AFTER_SECONDS,
  SESSION_TTL_SECONDS,
};

export type SignedTokenType = 'session' | 'oauth_state' | 'pending_install';

export interface SignedTokenPayload {
  typ: SignedTokenType;
  iat: number;
  exp: number;
  [key: string]: unknown;
}

function base64UrlEncode(value: Buffer | string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Buffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, 'base64');
}

function hmac(payload: string, secret: string): Buffer {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest();
}

export function signSignedToken(
  data: Record<string, unknown>,
  secret: string,
  type: SignedTokenType,
  ttlSeconds: number,
  nowMs: number = Date.now()
): string {
  if (!secret || secret.length < 32) {
    throw new Error('Session secret must be at least 32 characters');
  }

  const now = Math.floor(nowMs / 1000);
  const payload: SignedTokenPayload = {
    ...data,
    typ: type,
    iat: now,
    exp: now + Math.max(1, Math.floor(ttlSeconds)),
  };

  const encoded = base64UrlEncode(JSON.stringify(payload));
  const signature = base64UrlEncode(hmac(encoded, secret));
  return `${encoded}.${signature}`;
}

export function verifySignedToken(
  token: string | null | undefined,
  secret: string | null | undefined,
  type: SignedTokenType,
  nowMs: number = Date.now()
): SignedTokenPayload | null {
  if (!token || !secret || secret.length < 32) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [encoded, suppliedSignature] = parts;
  if (!encoded || !suppliedSignature) return null;

  let expected: Buffer;
  let supplied: Buffer;
  try {
    expected = hmac(encoded, secret);
    supplied = base64UrlDecode(suppliedSignature);
  } catch {
    return null;
  }

  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
    return null;
  }

  let payload: SignedTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(encoded).toString('utf8')) as SignedTokenPayload;
  } catch {
    return null;
  }

  if (!payload || payload.typ !== type) return null;
  if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null;

  const now = Math.floor(nowMs / 1000);
  if (payload.exp <= now) return null;
  // Reject tokens issued meaningfully in the future (clock skew allowance).
  if (payload.iat > now + 120) return null;

  return payload;
}

/**
 * Only same-origin, absolute-path return targets are allowed. This blocks
 * protocol-relative (`//evil`), backslash (`/\evil`), control-character, and
 * absolute-URL open redirects.
 */
export function safeReturnTo(value: string | null | undefined, fallback = '/dashboard'): string {
  if (!value) return fallback;
  if (value.length > 512) return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  return value;
}

export function constantTimeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function randomToken(bytes = 32): string {
  return base64UrlEncode(crypto.randomBytes(bytes));
}
