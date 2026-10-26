// Server-side BugWiser application session.
//
// The session is a stateless, signed, HttpOnly cookie. It contains only the
// minimum identity needed by server handlers (BugWiser user UUID + GitHub
// numeric id/login/avatar). It NEVER contains GitHub tokens, installation
// tokens, client secrets, or private keys.
//
// Supabase Auth remains a supported fallback: when no BugWiser session exists
// but a valid Supabase session does, the Supabase user is returned and can be
// bridged into a BugWiser session by the legacy callback or a protected route.

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_SECONDS,
  PENDING_INSTALL_COOKIE,
  PENDING_INSTALL_TTL_SECONDS,
  SESSION_COOKIE,
  SESSION_ROTATE_AFTER_SECONDS,
  SESSION_TTL_SECONDS,
  signSignedToken,
  verifySignedToken,
  randomToken,
  type SignedTokenPayload,
} from './signed-cookie';

export interface AuthUser {
  userId: string;
  githubUserId: string | null;
  login: string;
  name: string | null;
  avatarUrl: string;
  /**
   * Which mechanism authenticated this request. `guest` is a signed-cookie
   * session backed by a provisioned Supabase user: it can own analyses but has
   * no GitHub identity, installation, or write access.
   */
  source: 'github_app' | 'supabase' | 'guest';
}

export interface AppSession extends AuthUser {
  sid: string;
  iat: number;
  exp: number;
}

export interface PendingInstallation {
  installationId: number;
  setupAction: string;
  returnTo: string;
}

/** Display-only viewer for the app shell; never includes tokens. */
export function viewerFromAuthUser(
  user: AuthUser | null
): { login: string; name: string | null; avatarUrl: string } | null {
  if (!user) return null;
  return { login: user.login, name: user.name, avatarUrl: user.avatarUrl };
}

export interface OAuthFlowState {
  state: string;
  codeVerifier: string;
  returnTo: string;
}

export function getSessionSecret(): string | null {
  const secret = process.env.BUGWISER_SESSION_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function appBaseUrl(requestUrl?: string): string {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : '');
  if (configured) return configured.replace(/\/+$/, '');
  if (requestUrl) return new URL(requestUrl).origin;
  return 'http://localhost:3000';
}

export function githubCallbackUrl(requestUrl?: string): string {
  const configured = process.env.GITHUB_APP_CALLBACK_URL;
  if (configured) return configured;
  return `${appBaseUrl(requestUrl)}/api/auth/callback`;
}

function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: isProductionRuntime(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

function metadataValue(meta: Record<string, unknown> | undefined, keys: string[]): string {
  if (!meta) return '';
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return '';
}

export function authUserFromSupabaseUser(user: {
  id: string;
  user_metadata?: Record<string, unknown>;
}): AuthUser {  const meta = user.user_metadata;
  const gid = metadataValue(meta, ['sub', 'provider_id']);
  return {
    userId: user.id,
    githubUserId: /^\d+$/.test(gid) ? gid : null,
    login: metadataValue(meta, ['user_name', 'preferred_username', 'login']) || 'user',
    name: metadataValue(meta, ['full_name', 'name']) || null,
    avatarUrl: metadataValue(meta, ['avatar_url']) || '',
    source: 'supabase',
  };
}

export async function readAppSession(): Promise<AppSession | null> {
  const secret = getSessionSecret();
  if (!secret) return null;

  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  const payload = verifySignedToken(raw, secret, 'session');
  if (!payload) return null;

  const { uid, gid, login, name, avatar, sid, src } = payload;
  if (typeof uid !== 'string' || uid.length === 0) return null;
  if (typeof sid !== 'string' || sid.length < 16) return null;

  const source = src === 'guest' ? 'guest' : src === 'supabase' ? 'supabase' : 'github_app';

  return {
    userId: uid,
    githubUserId: typeof gid === 'string' && /^\d+$/.test(gid) ? gid : null,
    login: typeof login === 'string' && login.length > 0 ? login : 'user',
    name: typeof name === 'string' ? name : null,
    avatarUrl: typeof avatar === 'string' ? avatar : '',
    source,
    sid,
    iat: payload.iat,
    exp: payload.exp,
  };
}

/**
 * Resolve the request identity. A valid BugWiser session wins; otherwise the
 * existing Supabase session is used so users mid-rollout keep working.
 */
export async function getAuthenticatedUser(): Promise<AuthUser | null> {
  const appSession = await readAppSession();
  if (appSession) {
    return {
      userId: appSession.userId,
      githubUserId: appSession.githubUserId,
      login: appSession.login,
      name: appSession.name,
      avatarUrl: appSession.avatarUrl,
      source: appSession.source,
    };
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    return authUserFromSupabaseUser(user);
  } catch {
    return null;
  }
}

export function shouldRotateSession(session: AppSession): boolean {
  const now = Math.floor(Date.now() / 1000);
  return now - session.iat >= SESSION_ROTATE_AFTER_SECONDS;
}

export function buildSessionToken(user: AuthUser, nowMs: number = Date.now()): string {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error('BUGWISER_SESSION_SECRET is not configured');
  }
  return signSignedToken(
    {
      uid: user.userId,
      gid: user.githubUserId,
      login: user.login,
      name: user.name,
      avatar: user.avatarUrl,
      src: user.source,
      sid: randomToken(24),
    },
    secret,
    'session',
    SESSION_TTL_SECONDS,
    nowMs
  );
}

export function setSessionCookie(response: NextResponse, user: AuthUser): void {
  response.cookies.set(SESSION_COOKIE, buildSessionToken(user), sessionCookieOptions(SESSION_TTL_SECONDS));
}

export function clearAuthCookies(response: NextResponse): void {
  for (const name of [SESSION_COOKIE, OAUTH_STATE_COOKIE, PENDING_INSTALL_COOKIE]) {
    response.cookies.set(name, '', { ...sessionCookieOptions(0), maxAge: 0 });
  }
}

export function setOAuthStateCookie(
  response: NextResponse,
  flow: OAuthFlowState
): void {
  const secret = getSessionSecret();
  if (!secret) return;
  const token = signSignedToken(
    { state: flow.state, codeVerifier: flow.codeVerifier, returnTo: flow.returnTo },
    secret,
    'oauth_state',
    OAUTH_STATE_TTL_SECONDS
  );
  response.cookies.set(OAUTH_STATE_COOKIE, token, sessionCookieOptions(OAUTH_STATE_TTL_SECONDS));
}

export async function readOAuthState(): Promise<OAuthFlowState | null> {
  const secret = getSessionSecret();
  if (!secret) return null;
  const store = await cookies();
  const raw = store.get(OAUTH_STATE_COOKIE)?.value;
  const payload = verifySignedToken(raw, secret, 'oauth_state');
  if (!payload) return null;
  if (typeof payload.state !== 'string' || typeof payload.codeVerifier !== 'string') return null;
  if (typeof payload.returnTo !== 'string') return null;
  return {
    state: payload.state,
    codeVerifier: payload.codeVerifier,
    returnTo: payload.returnTo,
  };
}

export function setPendingInstallCookie(
  response: NextResponse,
  pending: PendingInstallation
): boolean {
  const secret = getSessionSecret();
  if (!secret) return false;
  const token = signSignedToken(
    {
      installationId: pending.installationId,
      setupAction: pending.setupAction,
      returnTo: pending.returnTo,
    },
    secret,
    'pending_install',
    PENDING_INSTALL_TTL_SECONDS
  );
  response.cookies.set(PENDING_INSTALL_COOKIE, token, sessionCookieOptions(PENDING_INSTALL_TTL_SECONDS));
  return true;
}

export async function readPendingInstall(): Promise<PendingInstallation | null> {
  const secret = getSessionSecret();
  if (!secret) return null;
  const store = await cookies();
  const raw = store.get(PENDING_INSTALL_COOKIE)?.value;
  const payload: SignedTokenPayload | null = verifySignedToken(raw, secret, 'pending_install');
  if (!payload) return null;

  const installationId = Number(payload.installationId);
  if (!Number.isSafeInteger(installationId) || installationId <= 0) return null;

  return {
    installationId,
    setupAction: typeof payload.setupAction === 'string' ? payload.setupAction : 'install',
    returnTo: typeof payload.returnTo === 'string' ? payload.returnTo : '/dashboard',
  };
}

export function clearPendingInstallCookie(response: NextResponse): void {
  response.cookies.set(PENDING_INSTALL_COOKIE, '', { ...sessionCookieOptions(0), maxAge: 0 });
}

export function clearOAuthStateCookie(response: NextResponse): void {
  response.cookies.set(OAUTH_STATE_COOKIE, '', { ...sessionCookieOptions(0), maxAge: 0 });
}
