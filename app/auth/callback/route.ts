import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Legacy Supabase Auth callback.
 *
 * Supabase Auth no longer issues BugWiser user ids or sessions, so there is
 * nothing to exchange here. The GitHub OAuth callback lives at
 * `/api/auth/callback`; this route exists only so a stale bookmarked URL lands
 * on a working sign-in instead of an error.
 */
export async function GET(request: NextRequest) {
  const url = new URL('/api/auth/github/start', request.url);
  url.searchParams.set('force', '1');
  const response = NextResponse.redirect(url);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
