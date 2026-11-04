// The GitHub credential for the current request.
//
// A session carries the GitHub access token inside its seal. This module decides
// whether that token is still usable, renews it when GitHub issued a refresh
// token, and tells the caller plainly when only a new authorization can help.
//
// Distinction that matters to users:
//   * `not_authenticated` — no BugWiser session (or a guest): sign in.
//   * `reauth_required`   — the session is fine but GitHub no longer accepts the
//     credential (revoked, expired without a refresh token, or the OAuth App's
//     token expiry kicked in). Sign in again; do not retry the request.
// A network/API failure while refreshing is NOT one of these: it is thrown so the
// route returns 502 and the session survives a transient GitHub outage.

import { NextResponse } from 'next/server';
import { GitHubError } from '@/lib/github/errors';
import { requireGitHubOAuthConfig } from '@/lib/github/oauth/config';
import { refreshAccessToken } from '@/lib/github/oauth/token';
import { logAuthEvent, logAuthFailure } from './log';
import {
  authUserFromSession,
  readAppSession,
  resealSessionWithCredential,
  type AuthUser,
} from './session';
import {
  isGitHubCredentialExpired,
  type AppSession,
  type GitHubCredential,
} from './session-token';

export type CredentialRefresh =
  | { refreshed: true; credential: GitHubCredential }
  | { refreshed: false; reauthRequired: boolean };

export type GitHubCredentialResult =
  | { ok: true; session: AppSession; credential: GitHubCredential; refreshed: boolean }
  | { ok: false; reason: 'not_authenticated' | 'reauth_required' };

/**
 * Renews an expired credential, or reports that a new authorization is needed.
 *
 * Never refreshes a credential that is still valid: every refresh rotates the
 * refresh token, so doing it eagerly would churn GitHub state on each request.
 */
export async function refreshCredentialIfExpired(
  session: AppSession,
  nowMs: number = Date.now()
): Promise<CredentialRefresh> {
  const credential = session.github;
  if (session.source !== 'github' || !credential) {
    return { refreshed: false, reauthRequired: false };
  }
  if (!isGitHubCredentialExpired(credential, nowMs)) {
    return { refreshed: false, reauthRequired: false };
  }

  if (!credential.refreshToken) {
    logAuthFailure('reauth', 'github credential expired without refresh token', {
      user: session.userId,
    });
    return { refreshed: false, reauthRequired: true };
  }

  const config = requireGitHubOAuthConfig();

  try {
    const grant = await refreshAccessToken(
      {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        refreshToken: credential.refreshToken,
      },
      fetch,
      nowMs
    );

    const refreshed: GitHubCredential = {
      accessToken: grant.accessToken,
      expiresAt: grant.expiresAt,
      // GitHub rotates refresh tokens; keep the old one only when it sent none.
      refreshToken: grant.refreshToken ?? credential.refreshToken,
      scopes: grant.scopes.length > 0 ? grant.scopes : credential.scopes,
    };

    logAuthEvent('reauth', 'github credential refreshed', {
      user: session.userId,
      expires: refreshed.expiresAt,
    });

    return { refreshed: true, credential: refreshed };
  } catch (error) {
    if (error instanceof GitHubError && error.code === 'auth_rejected') {
      logAuthFailure('reauth', 'github refresh token rejected', { user: session.userId });
      return { refreshed: false, reauthRequired: true };
    }
    throw error;
  }
}

/** Resolves the token this request may use for GitHub calls. */
export async function resolveGitHubCredential(
  nowMs: number = Date.now()
): Promise<GitHubCredentialResult> {
  const session = await readAppSession();
  if (!session) return { ok: false, reason: 'not_authenticated' };
  if (session.source !== 'github' || !session.github) {
    return { ok: false, reason: 'not_authenticated' };
  }

  const refresh = await refreshCredentialIfExpired(session, nowMs);
  if (refresh.refreshed) {
    return { ok: true, session, credential: refresh.credential, refreshed: true };
  }
  if (refresh.reauthRequired) {
    return { ok: false, reason: 'reauth_required' };
  }

  return { ok: true, session, credential: session.github, refreshed: false };
}

/**
 * Writes the rotated credential back into the session cookie, if any. Call once
 * on the outgoing response: a rotated refresh token is only valid once GitHub
 * returns it, so it must be stored immediately.
 */
export function applyCredentialRefresh(
  response: NextResponse,
  result: GitHubCredentialResult,
  nowMs: number = Date.now()
): NextResponse {
  if (result.ok && result.refreshed) {
    resealSessionWithCredential(response, result.session, result.credential, nowMs);
  }
  return response;
}

export function githubAuthUser(result: GitHubCredentialResult): AuthUser | null {
  return result.ok ? authUserFromSession(result.session) : null;
}

/**
 * 401 with a machine code. `reauth_required` is what the shared client session
 * flow looks for when deciding to send the user through GitHub again.
 */
export function githubAuthErrorResponse(
  reason: 'not_authenticated' | 'reauth_required'
): NextResponse {
  const response = NextResponse.json(
    {
      error:
        reason === 'reauth_required'
          ? 'Your GitHub authorization has expired. Please sign in again.'
          : 'Not authenticated',
      code: reason,
    },
    { status: 401 }
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
