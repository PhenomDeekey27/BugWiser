import { NextResponse } from 'next/server';
import { GuestSessionError, resolveOrCreateGuest } from '@/lib/auth/guest';
import { setSessionCookie } from '@/lib/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Starts (or reuses) a session for a visitor without a GitHub account. The
 * browser never receives a token: only a signed HttpOnly cookie.
 */
export async function POST() {
  try {
    const { user, created } = await resolveOrCreateGuest();
    const response = NextResponse.json(
      {
        authenticated: true,
        guest: user.source === 'guest',
        user: {
          id: user.userId,
          githubUserId: user.githubUserId,
          login: user.login,
          name: user.name,
          avatarUrl: user.avatarUrl,
          authSource: user.source,
        },
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );

    if (created) setSessionCookie(response, user);
    return response;
  } catch (error) {
    if (error instanceof GuestSessionError) {
      const status = error.code === 'provisioning_failed' ? 502 : 503;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error('[api/auth/guest] Unexpected error:', (error as Error).message);
    return NextResponse.json({ error: 'Could not start a guest session' }, { status: 500 });
  }
}
