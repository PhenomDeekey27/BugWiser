import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  clearOAuthStateCookie,
  readOAuthStateCookie,
  verifyOAuthStateToken,
} from '@/lib/auth/oauth-state';
import { resolveGitHubIdentity } from '@/lib/auth/identity';
import { setSessionCookie, getSessionSecret, githubCallbackUrl } from '@/lib/auth/session';
import { safeReturnTo } from '@/lib/auth/signed-cookie';
import { fetchGitHubUser } from '@/lib/github/api';
import { GitHubError } from '@/lib/github/errors';
import { requireGitHubOAuthConfig } from '@/lib/github/oauth/config';
import {
  exchangeAuthorizationCode,
  type GitHubTokenGrant,
} from '@/lib/github/oauth/token';
import {
  logAuthEvent,
  logAuthFailure,
  newCorrelationId,
  userMessageFor,
  type AuthFailureCategory,
} from '@/lib/auth/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GitHub OAuth App callback.
 *
 * Order matters:
 *   1. `state` is verified against this browser's signed cookie BEFORE the code
 *      is exchanged, so a forged or replayed callback cannot produce a token;
 *   2. only then is the code (single-use, short-lived) exchanged;
 *   3. the session is issued from what GitHub itself returned;
 *   4. the database write happens last and is allowed to fail.
 *
 * Step 4 is the point of the OAuth migration: `resolveGitHubIdentity` never
 * throws, and a pending result still produces a working session that retries the
 * write on a backoff schedule.
 */
export async function GET(request: NextRequest) {
  const correlationId = newCorrelationId();
  const { searchParams } = request.nextUrl;

  // Every exit path clears the state cookie: it is single-use.
  const respond = (url: URL) => {
    const response = NextResponse.redirect(url);
    clearOAuthStateCookie(response);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  };

  const fail = (
    category: AuthFailureCategory,
    fields: Record<string, string | number | boolean> = {}
  ) => {
    logAuthFailure('authorize_callback', category, { correlation_id: correlationId, ...fields });
    const url = new URL('/auth/github', request.url);
    url.searchParams.set('error', userMessageFor(category));
    url.searchParams.set('ref', correlationId);
    return respond(url);
  };

  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const providerError = searchParams.get('error');

  logAuthEvent('authorize_callback', 'received', {
    correlation_id: correlationId,
    code_present: Boolean(code),
    state_present: Boolean(state),
    provider_error: providerError,
  });

  if (providerError) {
    if (providerError === 'access_denied') {
      logAuthEvent('authorize_callback', 'user_cancelled', { correlation_id: correlationId });
      return fail('provider_cancelled', { provider_error: providerError });
    }
    return fail('provider_error', { provider_error: providerError });
  }

  if (!code) return fail('missing_code');
  if (!state) return fail('missing_state');

  const secret = getSessionSecret();
  if (!secret) return fail('not_configured');

  let config;
  try {
    config = requireGitHubOAuthConfig();
  } catch {
    return fail('not_configured');
  }

  const verification = verifyOAuthStateToken(await readOAuthStateCookie(), state, secret);
  if (!verification.ok) {
    const category: AuthFailureCategory =
      verification.reason === 'missing'
        ? 'state_unknown'
        : verification.reason === 'mismatch'
          ? 'state_mismatch'
          : 'state_expired';
    return fail(category, { state_valid: false, state_reason: verification.reason });
  }

  const target = safeReturnTo(verification.returnTo);

  let grant: GitHubTokenGrant;
  try {
    grant = await exchangeAuthorizationCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      redirectUri: githubCallbackUrl(request.url),
    });
  } catch (error) {
    logAuthFailure('authorize_callback', 'token_exchange_failed', {
      correlation_id: correlationId,
      github_code: error instanceof GitHubError ? error.code : 'unexpected',
      status: error instanceof GitHubError ? error.status : undefined,
    });
    return fail('token_exchange_failed');
  }

  try {
    const githubUser = await fetchGitHubUser(grant.accessToken);
    if (!Number.isSafeInteger(githubUser.id) || githubUser.id <= 0) {
      return fail('identity_failed', { reason: 'invalid_github_id' });
    }

    const profile = {
      id: githubUser.id,
      login: githubUser.login,
      name: githubUser.name ?? null,
      avatarUrl: githubUser.avatar_url || '',
    };

    const identity = await resolveGitHubIdentity(profile);
    if (identity.status === 'invalid') {
      return fail('identity_failed', { reason: 'invalid_github_id' });
    }

    const destination = new URL(target, request.url);
    if (destination.pathname === '/dashboard') destination.searchParams.set('welcome', '1');

    const response = respond(destination);

    try {
      setSessionCookie(response, {
        identity: {
          userId: identity.userId,
          githubUserId: String(githubUser.id),
          login: profile.login,
          name: profile.name,
          avatarUrl: profile.avatarUrl,
          source: 'github',
        },
        github: {
          accessToken: grant.accessToken,
          expiresAt: grant.expiresAt,
          refreshToken: grant.refreshToken,
          scopes: grant.scopes,
        },
        persisted: identity.status === 'ok',
      });
    } catch (error) {
      logAuthFailure('authorize_callback', 'session_failed', {
        correlation_id: correlationId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      return fail('session_failed');
    }

    if (identity.status === 'pending') {
      // Sign-in succeeded; the row write did not. That is not a failure: the
      // session carries the deterministic user id and the retry schedule.
      logAuthFailure('authorize_callback', 'identity_pending', {
        correlation_id: correlationId,
        user: identity.userId,
        error: identity.error,
      });
    }

    logAuthEvent('authorize_callback', 'signed_in', {
      correlation_id: correlationId,
      user: profile.login,
      github_user_id: String(githubUser.id),
      persisted: identity.status === 'ok',
      scopes: grant.scopes.join(','),
      redirect_path: destination.pathname,
    });

    return response;
  } catch (error) {
    logAuthFailure('authorize_callback', 'unexpected', {
      correlation_id: correlationId,
      github_code: error instanceof GitHubError ? error.code : 'unexpected',
    });
    if (error instanceof GitHubError && error.code === 'auth_rejected') {
      return fail('token_exchange_failed');
    }
    return fail('unexpected');
  }
}
