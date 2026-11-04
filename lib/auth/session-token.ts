// BugWiser session token: encrypted, authenticated, self-contained.
//
// WHY THIS IS NOT A DATABASE SESSION
// GitHub is the authentication authority, so a successful authorization-code
// exchange with GitHub must be enough to sign the user in. A `public.sessions`
// row would make Neon PostgreSQL (a sleeping/suspended compute resource) decide
// whether GitHub sign-in succeeds. Instead the session is a single AES-256-GCM
// sealed cookie:
//
//   * confidentiality — the GitHub access token inside it is never readable by
//     browser JavaScript (HttpOnly) nor by anyone who copies the cookie value;
//   * integrity — the GCM auth tag rejects any modified byte, so a forged or
//     edited payload cannot claim another user id;
//   * expiry — `exp` is inside the authenticated plaintext and re-checked on
//     every read;
//   * no database — reading a session performs zero I/O.
//
// The cookie therefore holds the only copy of the GitHub credential BugWiser
// uses. It is never logged, never returned by an API, and never written to
// localStorage.
//
// This module has no Next.js or `pg` imports so it is unit-testable and safe to
// import from `proxy.ts`.

import crypto from 'node:crypto';

export const SESSION_TOKEN_VERSION = 1;
export const SESSION_COOKIE_VERSION_TAG = 's1';

/** 7 days of absolute session lifetime. */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
/** Re-seal an active session once it has less than a day left. */
export const SESSION_REFRESH_AFTER_SECONDS = 24 * 60 * 60;

const IV_BYTES = 12;
const MAX_LOGIN_LENGTH = 100;
const MAX_NAME_LENGTH = 200;
const MAX_AVATAR_LENGTH = 500;
const MAX_TOKEN_LENGTH = 512;
const MAX_SCOPES = 32;
/** GHES / future GitHub changes: never trust an arbitrarily large scope list. */
const MAX_SCOPE_LENGTH = 64;

export type SessionSource = 'github' | 'guest';

/**
 * GitHub credential carried by the session. Only present for `github` sessions.
 * `expiresAt` is unix seconds, or 0 for a token GitHub reports as non-expiring.
 */
export interface GitHubCredential {
  accessToken: string;
  expiresAt: number;
  refreshToken: string | null;
  scopes: string[];
}

/** The identity part of a session. Safe to render in the app shell. */
export interface SessionIdentity {
  userId: string;
  githubUserId: string | null;
  login: string;
  name: string | null;
  avatarUrl: string;
  source: SessionSource;
}

export interface AppSession extends SessionIdentity {
  iat: number;
  exp: number;
  /** False while the `users` row has not been written (Neon was unavailable). */
  persisted: boolean;
  /** Failed persistence attempts so far; drives the retry backoff. */
  persistAttempts: number;
  /** Unix seconds before which persistence must not be retried. */
  nextPersistAt: number;
  github: GitHubCredential | null;
}

export interface SessionPayloadInput extends SessionIdentity {
  persisted: boolean;
  persistAttempts?: number;
  nextPersistAt?: number;
  github?: GitHubCredential | null;
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

/**
 * HKDF keeps the AES key distinct from every other use of the same secret
 * (for example the HMAC key used for OAuth state cookies).
 */
function sessionKey(secret: string): Buffer {
  const derived = crypto.hkdfSync(
    'sha256',
    Buffer.from(secret, 'utf8'),
    Buffer.from('bugwiser/session/v1', 'utf8'),
    Buffer.from('aes-256-gcm', 'utf8'),
    32
  );
  return Buffer.from(derived);
}

const AAD = Buffer.from('bugwiser/session/v1', 'utf8');

/** Bounds cookie size and rejects values a client cannot legitimately produce. */
function sanitizeScopes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const scopes: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const scope = entry.trim();
    if (!scope || scope.length > MAX_SCOPE_LENGTH) continue;
    if (!scopes.includes(scope)) scopes.push(scope);
    if (scopes.length >= MAX_SCOPES) break;
  }
  return scopes;
}

function trimTo(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function credentialFromInput(
  github: GitHubCredential | null | undefined
): GitHubCredential | null {
  if (!github) return null;
  const accessToken = trimTo(github.accessToken, MAX_TOKEN_LENGTH);
  if (!accessToken) return null;

  return {
    accessToken,
    expiresAt:
      Number.isFinite(github.expiresAt) && github.expiresAt > 0
        ? Math.floor(github.expiresAt)
        : 0,
    refreshToken: github.refreshToken
      ? trimTo(github.refreshToken, MAX_TOKEN_LENGTH) || null
      : null,
    scopes: sanitizeScopes(github.scopes),
  };
}

/**
 * Seals a session into its cookie value. The caller supplies the lifetime so a
 * token that expires sooner can shorten the session instead of outliving it.
 */
export function sealSession(
  input: SessionPayloadInput,
  secret: string,
  ttlSeconds: number = SESSION_TTL_SECONDS,
  nowMs: number = Date.now()
): string {
  if (!secret || secret.length < 32) {
    throw new Error('Session secret must be at least 32 characters');
  }

  const now = Math.floor(nowMs / 1000);
  const exp = now + Math.max(1, Math.floor(ttlSeconds));

  const payload = {
    v: SESSION_TOKEN_VERSION,
    typ: 'session',
    iat: now,
    exp,
    u: input.userId,
    g: input.githubUserId,
    l: trimTo(input.login, MAX_LOGIN_LENGTH),
    n: input.name === null ? null : trimTo(input.name, MAX_NAME_LENGTH),
    a: trimTo(input.avatarUrl, MAX_AVATAR_LENGTH),
    s: input.source,
    p: input.persisted ? 1 : 0,
    pa: Math.max(0, Math.floor(input.persistAttempts ?? 0)),
    pn: Math.max(0, Math.floor(input.nextPersistAt ?? 0)),
    gh: credentialFromInput(input.github ?? null),
  };

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', sessionKey(secret), iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    SESSION_COOKIE_VERSION_TAG,
    base64UrlEncode(iv),
    base64UrlEncode(ciphertext),
    base64UrlEncode(tag),
  ].join('.');
}

function isUserId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 16 && value.length <= 64;
}

function isGitHubId(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,20}$/.test(value);
}

/**
 * Opens and validates a session cookie. Returns null for anything that is not a
 * live, correctly sealed session for this secret — never a partially valid one.
 */
export function openSession(
  token: string | null | undefined,
  secret: string | null | undefined,
  nowMs: number = Date.now()
): AppSession | null {
  if (!token || !secret || secret.length < 32) return null;

  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [version, ivPart, dataPart, tagPart] = parts;
  if (version !== SESSION_COOKIE_VERSION_TAG) return null;
  if (!ivPart || !dataPart || !tagPart) return null;

  let plaintext: string;
  try {
    const iv = base64UrlDecode(ivPart);
    if (iv.length !== IV_BYTES) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', sessionKey(secret), iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(base64UrlDecode(tagPart));
    plaintext = Buffer.concat([
      decipher.update(base64UrlDecode(dataPart)),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Wrong key, tampered ciphertext, or an edited auth tag.
    return null;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(plaintext) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (!payload || payload.typ !== 'session') return null;
  if (payload.v !== SESSION_TOKEN_VERSION) return null;

  const iat = payload.iat;
  const exp = payload.exp;
  if (typeof iat !== 'number' || typeof exp !== 'number') return null;

  const now = Math.floor(nowMs / 1000);
  if (exp <= now) return null;
  // Reject a payload issued meaningfully in the future (clock-skew allowance).
  if (iat > now + 120) return null;

  if (!isUserId(payload.u)) return null;
  if (payload.s !== 'github' && payload.s !== 'guest') return null;

  const source = payload.s;
  const githubUserId = isGitHubId(payload.g) ? payload.g : null;
  if (source === 'github' && !githubUserId) return null;

  let github: GitHubCredential | null = null;
  const rawGithub = payload.gh as Record<string, unknown> | undefined;
  if (source === 'github') {
    const accessToken = trimTo(rawGithub?.accessToken, MAX_TOKEN_LENGTH);
    if (!accessToken) return null;
    github = {
      accessToken,
      expiresAt:
        typeof rawGithub?.expiresAt === 'number' &&
        Number.isFinite(rawGithub.expiresAt) &&
        rawGithub.expiresAt > 0
          ? Math.floor(rawGithub.expiresAt)
          : 0,
      refreshToken: rawGithub?.refreshToken
        ? trimTo(rawGithub.refreshToken, MAX_TOKEN_LENGTH) || null
        : null,
      scopes: sanitizeScopes(rawGithub?.scopes),
    };
  }

  return {
    userId: payload.u,
    githubUserId,
    login: trimTo(payload.l, MAX_LOGIN_LENGTH) || 'user',
    name: payload.n === null ? null : trimTo(payload.n, MAX_NAME_LENGTH) || null,
    avatarUrl: trimTo(payload.a, MAX_AVATAR_LENGTH),
    source,
    iat,
    exp,
    persisted: payload.p === 1,
    persistAttempts:
      typeof payload.pa === 'number' && Number.isFinite(payload.pa)
        ? Math.max(0, Math.floor(payload.pa))
        : 0,
    nextPersistAt:
      typeof payload.pn === 'number' && Number.isFinite(payload.pn)
        ? Math.max(0, Math.floor(payload.pn))
        : 0,
    github,
  };
}

/**
 * A session holding an expired GitHub token cannot call the GitHub API. With a
 * refresh token the session route can silently renew it; without one the user
 * has to authorize again.
 */
export function isGitHubCredentialExpired(
  credential: GitHubCredential | null,
  nowMs: number = Date.now()
): boolean {
  if (!credential) return true;
  if (credential.expiresAt === 0) return false;
  return credential.expiresAt * 1000 <= nowMs + 60_000;
}

/** Sliding expiry: re-seal when less than a day of the session remains. */
export function sessionNeedsRefresh(
  session: AppSession,
  nowMs: number = Date.now()
): boolean {
  return session.exp - Math.floor(nowMs / 1000) <= SESSION_REFRESH_AFTER_SECONDS;
}

/**
 * The lifetime a new cookie should get. A non-expiring GitHub token keeps the
 * full 7 days; an expiring one bounds the session so it never outlives the
 * credential it carries.
 */
export function sessionTtlFor(
  credential: GitHubCredential | null,
  ttlSeconds: number = SESSION_TTL_SECONDS,
  nowMs: number = Date.now()
): number {
  if (!credential || credential.expiresAt === 0) return ttlSeconds;

  const remaining = credential.expiresAt - Math.floor(nowMs / 1000);
  if (!Number.isFinite(remaining) || remaining <= 0) return 60;
  return Math.max(60, Math.min(ttlSeconds, remaining));
}

/**
 * Persistence retry backoff: 30s, 60s, 120s ... capped at 15 minutes. Stored in
 * the cookie so the schedule survives a serverless cold start — there is no
 * in-memory queue to lose.
 */
export function persistenceBackoffSeconds(attempts: number): number {
  const safeAttempts = Math.max(1, Math.floor(attempts));
  return Math.min(30 * 2 ** (safeAttempts - 1), 15 * 60);
}
