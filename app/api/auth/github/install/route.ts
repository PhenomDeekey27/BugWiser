import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { safeReturnTo } from '@/lib/auth/signed-cookie';
import { githubAppInstallUrl } from '@/lib/github/app/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Start the GitHub App installation flow. Authentication is required so the
 * setup callback can be tied to a BugWiser user; the final association is
 * still verified with a GitHub user token before any repository is trusted.
 */
export async function GET(request: NextRequest) {
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get('returnTo'));

  const user = await getAuthenticatedUser();
  if (!user) {
    const start = new URL('/api/auth/github/start', request.url);
    start.searchParams.set('returnTo', safeReturnTo(returnTo));
    return NextResponse.redirect(start);
  }

  const installUrl = githubAppInstallUrl();
  if (!installUrl) {
    const url = new URL('/dashboard', request.url);
    url.searchParams.set('github', 'error');
    // Distinguish "not set" from "set to something that is not a slug".
    url.searchParams.set(
      'reason',
      process.env.GITHUB_APP_SLUG ? 'slug_invalid' : 'slug_missing'
    );
    return NextResponse.redirect(url);
  }

  const response = NextResponse.redirect(installUrl);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
