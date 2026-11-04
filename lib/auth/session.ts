// BugWiser application session.
//
// ONE COOKIE, NO DATABASE READ
// The session is a single AES-256-GCM sealed cookie (see `session-token.ts`).
// Reading it performs zero I/O, so a suspended Neon compute cannot decide whether
// a user is signed in: GitHub already answered that question during the OAuth
// exchange.
//
// What the cookie carries:
//   * the display identity (user id, GitHub id, login, name, avatar, source),
//   * the GitHub credential this session acts with, encrypted inside the seal,
//   * whether the `users` row has been written yet, plus the retry schedule for
//     that write when Neon was unavailable at sign-in time.
//
// What it must never carry in the clear: nothing. HttpOnly + Secure (in
// production) + SameSite=Lax keep it away from JavaScript and from cross-site
// requests, and the GCM auth tag rejects any edit.
//
// Persistence is therefore *after* authentication and never gates it: a failed
// `users` write produces a pending session that retries on a backoff schedule
// (see `persistence.ts`), not a failed sign-in.

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { resolveAppBaseUrl, resolveGitHubCallbackUrl } from './app-url';
import { OAUTH_STATE_COOKIE, SESSION_COOKIE } from './cookie-names';
import {
  SESSION_TTL_SECONDS,
  openSession,
  sealSession,
  sessionNeedsRefresh,
  sessionTtlFor,
  type AppSession,
  type GitHubCredential,
  type SessionIdentity,
} from './session-token';

export type { AppSession, GitHubCredential, SessionIdentity };

/** How the caller proved who they are. A guest has no GitHub credential. */
export type AuthSource = 'github' | 'guest';

export interface AuthUser {
  userId: string;
  githubUserId: string | null;
  login: string;
  name: string | null;
  avatarUrl: string;
  /**
   * `guest` means a session provisioned without GitHub: it can own analyses of
   * public repositories but has no GitHub identity, no token, and no write
   * access.
   */
  source: AuthSource;
}

export interface NewSessionInput {
  identity: SessionIdentity;
  github: GitHubCredential | null;
  persisted: boolean;
  persistAttempts?: number;
  nextPersistAt?: number;
}

export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_SECONDS;

/**
 * Session input for a freshly provisioned guest.
 *
 * A guest has no GitHub credential by definition, so this is the only place a
 * `github: null` session is created. Keeping it in one helper prevents a caller
 * from accidentally seeding a guest cookie with a token.
 */
export function guestSessionInput(
  user: Pick<AuthUser, 'userId' | 'login' | 'name' | 'avatarUrl'>
): NewSessionInput {
  return {
    identity: {
      userId: user.userId,
      githubUserId: null,
      login: user.login,
      name: user.name,
      avatarUrl: user.avatarUrl,
      source: 'guest',
    },
    github: null,
    persisted: true,
  };
}

export function getSessionSecret(): string | null {
  const secret = process.env.BUGWISER_SESSION_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function appBaseUrl(requestUrl?: string): string {
  return resolveAppBaseUrl(process.env, requestUrl);
}

export function githubCallbackUrl(requestUrl?: string): string {
  return resolveGitHubCallbackUrl(process.env, requestUrl);
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    // `secure` would make the cookie unusable on http://localhost in
    // development, so it follows the runtime rather than a hardcoded value.
    secure: isProductionRuntime(),
    // `lax` still sends the cookie on the top-level redirect back from GitHub,
    // which is exactly the one cross-site navigation the flow needs.
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

/** Display-only viewer for the app shell; never includes tokens. */
export function viewerFromAuthUser(
  user: AuthUser | null
): { login: string; name: string | null; avatarUrl: string } | null {
  if (!user) return null;
  return { login: user.login, name: user.name, avatarUrl: user.avatarUrl };
}

export function authUserFromSession(session: AppSession): AuthUser {
  return {
    userId: session.userId,
    githubUserId: session.githubUserId,
    login: session.login,
    name: session.name,
    avatarUrl: session.avatarUrl,
    source: session.source,
  };
}

export function sessionIdentity(session: AppSession): SessionIdentity {
  return {
    userId: session.userId,
    githubUserId: session.githubUserId,
    login: session.login,
    name: session.name,
    avatarUrl: session.avatarUrl,
    source: session.source,
  };
}

/**
 * Resolves the caller's session, or null when there is none.
 *
 * No database and no network: an unreadable, edited, expired, or foreign cookie
 * is simply "no session", and the caller decides what that means.
 */
export async function readAppSession(): Promise<AppSession | null> {
  const secret = getSessionSecret();
  if (!secret) return null;

  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  return openSession(raw, secret);
}

/** Request identity, resolved only from a live BugWiser session cookie. */
export async function getAuthenticatedUser(): Promise<AuthUser | null> {
  const session = await readAppSession();
  return session ? authUserFromSession(session) : null;
}

/**
 * Writes a brand-new session cookie. The lifetime is bounded by the GitHub
 * credential so the cookie can never outlive the token it carries.
 */
export function setSessionCookie(
  response: NextResponse,
  input: NewSessionInput,
  nowMs: number = Date.now()
): void {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error('BUGWISER_SESSION_SECRET is not configured');
  }

  const ttl = sessionTtlFor(input.github, SESSION_TTL_SECONDS, nowMs);
  const token = sealSession(
    {
      ...input.identity,
      persisted: input.persisted,
      persistAttempts: input.persistAttempts ?? 0,
      nextPersistAt: input.nextPersistAt ?? 0,
      github: input.github,
    },
    secret,
    ttl,
    nowMs
  );

  response.cookies.set(SESSION_COOKIE, token, cookieOptions(ttl));
}

/**
 * Re-seals an existing session with its remaining lifetime. Used for the sliding
 * refresh and for persistence retries, which must not extend the session.
 */
export function resealSessionCookie(
  response: NextResponse,
  session: AppSession,
  nowMs: number = Date.now()
): boolean {
  const secret = getSessionSecret();
  if (!secret) return false;

  const remaining = session.exp - Math.floor(nowMs / 1000);
  if (remaining <= 0) return false;

  const token = sealSession(
    {
      ...sessionIdentity(session),
      persisted: session.persisted,
      persistAttempts: session.persistAttempts,
      nextPersistAt: session.nextPersistAt,
      github: session.github,
    },
    secret,
    remaining,
    nowMs
  );

  response.cookies.set(SESSION_COOKIE, token, cookieOptions(remaining));
  return true;
}

/**
 * Re-seals a session after its GitHub credential changed (a refresh), extending
 * it to the new credential's lifetime. A refreshed token is proof the session is
 * still in active use, so sliding the expiry forward is correct here.
 */
export function resealSessionWithCredential(
  response: NextResponse,
  session: AppSession,
  credential: GitHubCredential,
  nowMs: number = Date.now()
): boolean {
  const secret = getSessionSecret();
  if (!secret) return false;

  const ttl = sessionTtlFor(credential, SESSION_TTL_SECONDS, nowMs);
  const token = sealSession(
    {
      ...sessionIdentity(session),
      persisted: session.persisted,
      persistAttempts: session.persistAttempts,
      nextPersistAt: session.nextPersistAt,
      github: credential,
    },
    secret,
    ttl,
    nowMs
  );

  response.cookies.set(SESSION_COOKIE, token, cookieOptions(ttl));
  return true;
}

/** True when the session should be re-sealed to keep it from expiring mid-use. */
export function shouldRefreshSession(
  session: AppSession,
  nowMs: number = Date.now()
): boolean {
  return sessionNeedsRefresh(session, nowMs);
}

/**
 * Slides an active session forward. Used only after the caller proved it is
 * still in use (a rendered app shell), so an idle cookie still expires.
 */
export function extendSessionCookie(
  response: NextResponse,
  session: AppSession,
  nowMs: number = Date.now()
): boolean {
  const secret = getSessionSecret();
  if (!secret) return false;

  const ttl = sessionTtlFor(session.github, SESSION_TTL_SECONDS, nowMs);
  const token = sealSession(
    {
      ...sessionIdentity(session),
      persisted: session.persisted,
      persistAttempts: session.persistAttempts,
      nextPersistAt: session.nextPersistAt,
      github: session.github,
    },
    secret,
    ttl,
    nowMs
  );

  response.cookies.set(SESSION_COOKIE, token, cookieOptions(ttl));
  return true;
}

/**
 * Clears every auth cookie. There is no server-side session row to revoke: the
 * cookie is the session, so deleting it ends the session. A copied cookie stays
 * valid until it expires — which is why its lifetime is bounded and why the
 * GitHub token inside it can be revoked from GitHub at any time.
 */
export function clearAuthCookies(response: NextResponse): void {
  for (const name of [SESSION_COOKIE, OAUTH_STATE_COOKIE]) {
    response.cookies.set(name, '', { ...cookieOptions(0), maxAge: 0 });
  }
}
