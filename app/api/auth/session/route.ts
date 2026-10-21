import { NextResponse } from 'next/server';
import {
  getAuthenticatedUser,
  readAppSession,
  setSessionCookie,
  shouldRotateSession,
} from '@/lib/auth/session';
import { getInstallationStatus } from '@/lib/github/app/access';
import { githubAppInstallUrl } from '@/lib/github/app/config';
import { logGitHubError } from '@/lib/github/app/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Session + GitHub installation status for the UI. Never returns tokens. */
export async function GET() {
  const user = await getAuthenticatedUser();
  const response = NextResponse.json(
    { authenticated: Boolean(user), user: null, installation: null },
    { headers: { 'Cache-Control': 'no-store' } }
  );

  if (!user) return response;

  let installation = null;
  try {
    const status = await getInstallationStatus(user.userId);
    installation = {
      ...status,
      installUrl: status.installUrl || githubAppInstallUrl(),
      needsInstallation: status.installations.length === 0,
    };
  } catch (error) {
    logGitHubError('api/auth/session', 'installation status failed', error);
    installation = {
      configured: false,
      installations: [],
      repositoryCount: 0,
      installUrl: githubAppInstallUrl(),
      manageUrl: 'https://github.com/settings/installations',
      needsInstallation: true,
    };
  }

  // Rotate the signed session periodically while the user is active.
  const session = await readAppSession();
  if (session && shouldRotateSession(session)) {
    setSessionCookie(response, user);
  }

  return NextResponse.json(
    {
      authenticated: true,
      user: {
        id: user.userId,
        githubUserId: user.githubUserId,
        login: user.login,
        name: user.name,
        avatarUrl: user.avatarUrl,
        authSource: user.source,
      },
      installation,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
