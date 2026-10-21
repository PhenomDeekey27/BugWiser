import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  clearPendingInstallCookie,
  getAuthenticatedUser,
  readPendingInstall,
} from '@/lib/auth/session';
import { safeReturnTo } from '@/lib/auth/signed-cookie';
import { getStoredUserAccessToken } from '@/lib/auth/identity';
import { syncInstallation, verifyInstallationOwnership } from '@/lib/github/app/access';
import { GitHubAppConfigError } from '@/lib/github/app/config';
import { GitHubAppError } from '@/lib/github/app/errors';
import { githubErrorCode, logGitHubError, logGitHubEvent } from '@/lib/github/app/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function dashboard(request: NextRequest, params: Record<string, string>) {
  const url = new URL('/dashboard', request.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = NextResponse.redirect(url);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

/**
 * Verify and associate a pending installation. This is the only place an
 * installation is linked to a user, and it always checks GitHub's
 * `/user/installations` for the signed-in user first.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  logGitHubEvent('github-setup', 'callback entered', {
    authenticated: Boolean(user),
    hasGithubIdentity: Boolean(user?.githubUserId),
  });

  if (!user) {
    const start = new URL('/api/auth/github/start', request.url);
    start.searchParams.set('returnTo', '/api/auth/github/setup/complete');
    start.searchParams.set('force', '1');
    return NextResponse.redirect(start);
  }

  const pending = await readPendingInstall();
  if (!pending) {
    logGitHubEvent('github-setup', 'missing installation context');
    return dashboard(request, { github: 'error', reason: 'missing_installation_context' });
  }

  logGitHubEvent('github-setup', 'pending installation read', {
    installation: pending.installationId,
    action: pending.setupAction,
  });

  if (!user.githubUserId) {
    logGitHubEvent('github-setup', 'identity unavailable', {
      installation: pending.installationId,
    });
    const response = dashboard(request, { github: 'error', reason: 'identity_unavailable' });
    clearPendingInstallCookie(response);
    return response;
  }

  const userToken = await getStoredUserAccessToken(Number(user.githubUserId));
  if (!userToken) {
    // No recent user token: run a fresh OAuth roundtrip, then return here.
    logGitHubEvent('github-setup', 'stored user token unavailable; reauthorizing', {
      installation: pending.installationId,
    });
    const start = new URL('/api/auth/github/start', request.url);
    start.searchParams.set('returnTo', '/api/auth/github/setup/complete');
    start.searchParams.set('force', '1');
    return NextResponse.redirect(start);
  }

  try {
    const installation = await verifyInstallationOwnership(userToken, pending.installationId);
    logGitHubEvent('github-setup', 'installation ownership verified', {
      installation: pending.installationId,
      account: installation.account.login,
      selection: installation.repository_selection,
    });

    const synced = await syncInstallation(user.userId, pending.installationId, {
      userToken,
      verifiedInstallation: installation,
    });

    logGitHubEvent('github-setup', 'installation synchronized', {
      installation: synced.installation.installation_id,
      account: synced.installation.account_login,
      repositories: synced.repositories.length,
    });

    const target = new URL(safeReturnTo(pending.returnTo), request.url);
    target.searchParams.set(
      'github',
      pending.setupAction === 'update' ? 'updated' : 'connected'
    );
    const response = NextResponse.redirect(target);
    clearPendingInstallCookie(response);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    const reason =
      error instanceof GitHubAppConfigError
        ? 'not_configured'
        : error instanceof GitHubAppError
          ? error.code === 'rate_limited'
            ? 'rate_limited'
            : error.code === 'installation_forbidden'
              ? 'not_owned'
              : error.code === 'installation_suspended'
                ? 'suspended'
                : error.code === 'installation_not_found'
                  ? 'installation_not_found'
                  : 'installation_failed'
          : 'installation_failed';

    logGitHubError('github-setup', 'installation setup failed', error, {
      installation: pending.installationId,
      reason,
      code: githubErrorCode(error),
    });

    const response = dashboard(request, { github: 'error', reason });
    clearPendingInstallCookie(response);
    return response;
  }
}
