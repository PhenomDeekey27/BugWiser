import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  getAuthenticatedUser,
  getSessionSecret,
  setPendingInstallCookie,
} from '@/lib/auth/session';
import { logGitHubEvent } from '@/lib/github/app/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseInstallationId(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function redirectTo(request: NextRequest, path: string, params?: Record<string, string>) {
  const url = new URL(path, request.url);
  for (const [key, value] of Object.entries(params || {})) {
    url.searchParams.set(key, value);
  }
  const response = NextResponse.redirect(url);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

/**
 * GitHub redirects here after an installation (setup URL). The `installation_id`
 * is untrusted: it is only stored as a pending association and is verified with
 * a user access token before it is linked to the signed-in user.
 */
export async function GET(request: NextRequest) {
  const installationId = parseInstallationId(request.nextUrl.searchParams.get('installation_id'));
  const setupAction = request.nextUrl.searchParams.get('setup_action') || 'install';

  logGitHubEvent('github-setup', 'callback received', {
    installation: installationId,
    action: setupAction,
    valid: Boolean(installationId),
  });

  if (!installationId) {
    return redirectTo(request, '/dashboard', { github: 'error', reason: 'invalid_installation' });
  }

  if (!getSessionSecret()) {
    return redirectTo(request, '/auth/github', {
      error: 'Authentication is not configured on this deployment.',
    });
  }

  const user = await getAuthenticatedUser();

  if (setupAction === 'request') {
    // Organisation owner approval is pending. Nothing to associate yet.
    if (!user) {
      return redirectTo(request, '/auth/github', {
        error: 'GitHub is waiting for an organisation owner to approve the installation. Sign in to continue.',
      });
    }
    return redirectTo(request, '/dashboard', { github: 'pending_approval' });
  }

  logGitHubEvent('github-setup', 'storing pending installation', {
    installation: installationId,
    authenticated: Boolean(user),
  });

  const response = user
    ? redirectTo(request, '/api/auth/github/setup/complete')
    : redirectTo(request, '/api/auth/github/start', {
        returnTo: '/api/auth/github/setup/complete',
        force: '1',
      });

  const stored = setPendingInstallCookie(response, {
    installationId,
    setupAction,
    returnTo: '/dashboard',
  });

  if (!stored) {
    return redirectTo(request, '/auth/github', {
      error: 'Authentication is not configured on this deployment.',
    });
  }

  return response;
}
