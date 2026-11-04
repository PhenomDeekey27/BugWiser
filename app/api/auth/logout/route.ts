import { NextResponse } from 'next/server';
import { clearAuthCookies } from '@/lib/auth/session';
import { logAuthEvent } from '@/lib/auth/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Signs out by clearing the session cookie.
 *
 * There is no server-side session row to revoke: the sealed cookie IS the
 * session, and deleting it on the client is the whole operation. The GitHub
 * token inside it can also be revoked at any time from GitHub's settings, which
 * is the only revocation that matters if a cookie was ever copied.
 */
export async function POST() {
  const response = NextResponse.json(
    { ok: true },
    { headers: { 'Cache-Control': 'no-store' } }
  );

  clearAuthCookies(response);
  logAuthEvent('logout', 'session_ended');

  return response;
}
