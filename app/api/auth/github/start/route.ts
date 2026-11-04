import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  getSessionSecret,
  githubCallbackUrl,
  readAppSession,
} from '@/lib/auth/session';
import { isGitHubCredentialExpired } from '@/lib/auth/session-token';
import { safeReturnTo } from '@/lib/auth/signed-cookie';
import {
  createOAuthStateValue,
  setOAuthStateCookie,
  signOAuthState,
} from '@/lib/auth/oauth-state';
import { buildAuthorizeUrl } from '@/lib/github/oauth/authorize';
import {
  GITHUB_OAUTH_SCOPES,
  getGitHubOAuthConfigProblem,
  requireGitHubOAuthConfig,
} from '@/lib/github/oauth/config';
import {
  logAuthEvent,
  logAuthFailure,
  newCorrelationId,
  userMessageFor,
} from '@/lib/auth/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authError(request: NextRequest, message: string, ref: string): NextResponse {
  const url = new URL('/auth/github', request.url);
  url.searchParams.set('error', message);
  url.searchParams.set('ref', ref);
  const response = NextResponse.redirect(url);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

/**
 * Starts a GitHub OAuth App authorization.
 *
 * Nothing is written to a database before the redirect: the CSRF state lives in
 * a short-lived signed cookie, so sign-in begins even when Neon is unreachable.
 */
export async function GET(request: NextRequest) {
  const correlationId = newCorrelationId();
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get('returnTo'));
  const force = request.nextUrl.searchParams.get('force') === '1';
  const diagnose = request.nextUrl.searchParams.get('diagnose') === '1';

  const secret = getSessionSecret();
  const problem = getGitHubOAuthConfigProblem();

  if (diagnose) {
    // Configuration introspection without redirecting. Only public values are
    // exposed: the client id and the redirect URI are both visible in a normal
    // authorization URL; no secret is ever included.
    const redirectUri = githubCallbackUrl(request.url);
    const authorizeUrl = problem
      ? ''
      : buildAuthorizeUrl({
          clientId: requireGitHubOAuthConfig().clientId,
          redirectUri,
          state: 'diagnostic-state',
          scopes: GITHUB_OAUTH_SCOPES,
        }).toString();

    return NextResponse.json(
      {
        configured: problem === null,
        problem,
        environment: {
          clientId: problem ? '' : requireGitHubOAuthConfig().clientId,
          redirectUri,
          callbackOverride: process.env.GITHUB_CALLBACK_URL || process.env.GITHUB_APP_CALLBACK_URL,
          appUrl: process.env.NEXT_PUBLIC_APP_URL,
          scopes: GITHUB_OAUTH_SCOPES,
        },
        checks: {
          session_secret: Boolean(secret),
        },
        authorize_url: authorizeUrl,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  if (!secret) {
    logAuthFailure('authorize_start', 'not_configured', {
      correlation_id: correlationId,
      missing: 'BUGWISER_SESSION_SECRET',
    });
    return authError(request, userMessageFor('not_configured'), correlationId);
  }

  if (problem) {
    logAuthFailure('authorize_start', 'github_oauth_config_invalid', {
      correlation_id: correlationId,
      problem,
    });
    return authError(request, userMessageFor('not_configured'), correlationId);
  }

  // A usable GitHub session does not need another consent screen. A guest
  // session does: it has no GitHub identity, so "connect GitHub" must run.
  if (!force) {
    const existing = await readAppSession();
    if (
      existing &&
      existing.source === 'github' &&
      !isGitHubCredentialExpired(existing.github)
    ) {
      return NextResponse.redirect(new URL(returnTo, request.url));
    }
  }

  const config = requireGitHubOAuthConfig();
  const redirectUri = githubCallbackUrl(request.url);
  const state = createOAuthStateValue();
  const authorize = buildAuthorizeUrl({
    clientId: config.clientId,
    redirectUri,
    state,
    scopes: GITHUB_OAUTH_SCOPES,
  });

  const response = NextResponse.redirect(authorize);
  setOAuthStateCookie(response, signOAuthState(secret, { state, returnTo }));
  response.headers.set('Cache-Control', 'no-store');

  logAuthEvent('authorize_start', 'redirecting_to_github', {
    correlation_id: correlationId,
    redirect_uri: redirectUri,
    force,
    return_to: returnTo,
    scopes: GITHUB_OAUTH_SCOPES.join(','),
  });

  return response;
}
