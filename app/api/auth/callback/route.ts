import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  authUserFromSupabaseUser,
  clearOAuthStateCookie,
  clearPendingInstallCookie,
  getSessionSecret,
  githubCallbackUrl,
  readOAuthState,
  readPendingInstall,
  setSessionCookie,
} from '@/lib/auth/session';
import { constantTimeEqual } from '@/lib/auth/signed-cookie';
import { findOrCreateUserId, storeUserAccessToken } from '@/lib/auth/identity';
import { requireGitHubAppConfig } from '@/lib/github/app/config';
import { exchangeUserAuthorizationCode } from '@/lib/github/app/oauth';
import { fetchGitHubUser } from '@/lib/github/app/api';
import { GitHubAppError } from '@/lib/github/app/errors';
import { syncInstallation, verifyInstallationOwnership } from '@/lib/github/app/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorRedirect(request: NextRequest, message: string): NextResponse {
  const url = new URL('/auth/github', request.url);
  url.searchParams.set('error', message);
  const response = NextResponse.redirect(url);
  clearOAuthStateCookie(response);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  // GitHub-denied authorization (user pressed Cancel).
  const providerError = searchParams.get('error');
  if (providerError) {
    const description =
      providerError === 'access_denied'
        ? 'GitHub authorization was cancelled.'
        : searchParams.get('error_description') || 'GitHub authorization failed.';
    return errorRedirect(request, description);
  }

  const code = searchParams.get('code');
  const state = searchParams.get('state');
  if (!code) return errorRedirect(request, 'No authorization code was received from GitHub.');
  if (!state) return errorRedirect(request, 'The authorization response was missing its security state.');

  if (!getSessionSecret()) {
    return errorRedirect(request, 'Authentication is not configured on this deployment.');
  }

  let config;
  try {
    config = requireGitHubAppConfig();
  } catch {
    return errorRedirect(request, 'GitHub App is not configured on this deployment.');
  }

  const flow = await readOAuthState();
  if (!flow || !constantTimeEqual(flow.state, state)) {
    return errorRedirect(
      request,
      'Your sign-in link expired or was already used. Please start again.'
    );
  }

  try {
    const { accessToken, expiresAt } = await exchangeUserAuthorizationCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      redirectUri: githubCallbackUrl(request.url),
      codeVerifier: flow.codeVerifier,
    });

    const githubUser = await fetchGitHubUser(accessToken);
    if (!Number.isSafeInteger(githubUser.id) || githubUser.id <= 0) {
      throw new GitHubAppError('GitHub returned an invalid account id', 'app_auth_failed');
    }

    const userId = await findOrCreateUserId({
      id: githubUser.id,
      login: githubUser.login,
      name: githubUser.name,
      avatarUrl: githubUser.avatar_url || '',
    });

    await storeUserAccessToken(githubUser.id, accessToken, expiresAt);

    const user = {
      ...authUserFromSupabaseUser({
        id: userId,
        user_metadata: {
          sub: String(githubUser.id),
          provider_id: String(githubUser.id),
          user_name: githubUser.login,
          full_name: githubUser.name,
          avatar_url: githubUser.avatar_url,
        },
      }),
      source: 'github_app' as const,
    };

    // A GitHub installation can land before authentication. Complete that
    // association only after verifying it with the freshly issued user token.
    const pending = await readPendingInstall();
    let target = flow.returnTo;
    let installError: string | null = null;

    if (pending) {
      try {
        await verifyInstallationOwnership(accessToken, pending.installationId);
        await syncInstallation(userId, pending.installationId, { userToken: accessToken });
        target = pending.returnTo || '/dashboard';
      } catch (error) {
        installError = error instanceof GitHubAppError ? error.code : 'installation_failed';
        target = '/dashboard';
      }
    }

    const url = new URL(target, request.url);
    if (installError) {
      url.searchParams.set('github', 'error');
      url.searchParams.set('reason', installError);
    } else if (pending) {
      url.searchParams.set('github', 'connected');
    } else if (url.pathname === '/dashboard') {
      url.searchParams.set('welcome', '1');
    }

    const response = NextResponse.redirect(url);
    setSessionCookie(response, user);
    clearOAuthStateCookie(response);
    if (pending) clearPendingInstallCookie(response);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    if (error instanceof GitHubAppError) {
      if (error.code === 'network_error') {
        return errorRedirect(request, 'We could not reach GitHub. Please try again.');
      }
      if (error.code === 'app_auth_failed') {
        return errorRedirect(
          request,
          'GitHub authorization could not be completed. Please sign in again.'
        );
      }
      return errorRedirect(request, error.message);
    }

    console.error('[api/auth/callback] Unexpected authorization failure');
    return errorRedirect(request, 'We could not complete GitHub sign-in. Please try again.');
  }
}
