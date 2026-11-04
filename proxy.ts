import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth/cookie-names';
import { openSession } from '@/lib/auth/session-token';

/**
 * Route protection and cross-site request rejection.
 *
 * The proxy verifies the sealed session cookie — decryption, auth tag, and
 * expiry — which is cheap (no I/O) and enough to reject forged or stale cookies
 * before a page renders. It does NOT prove the GitHub credential is still
 * accepted by GitHub; every API route and page re-checks what it needs.
 *
 * This file runs on the Node.js runtime (Next.js default for `proxy.ts`), so it
 * can use `node:crypto`. It must never import the database layer.
 */

const PROTECTED_PREFIXES = ['/dashboard', '/analysis', '/models'];

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function safeReturnTo(value: string): string {
  if (!value.startsWith('/')) return '/dashboard';
  if (value.startsWith('//') || value.startsWith('/\\')) return '/dashboard';
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return '/dashboard';
  return value;
}

function signInUrl(request: NextRequest): URL {
  const url = request.nextUrl.clone();
  url.pathname = '/auth/github';
  url.search = '';
  const returnTo = safeReturnTo(`${request.nextUrl.pathname}${request.nextUrl.search}`);
  if (returnTo !== '/dashboard') url.searchParams.set('returnTo', returnTo);
  return url;
}

/**
 * Rejects cross-site state-changing API requests. Browsers always send
 * `Origin` on a mutating cross-origin request; when it is present it must match
 * the request host. Non-browser clients (no Origin) are allowed through — they
 * cannot be driven by a victim's browser cookies.
 */
function isSameOriginRequest(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) {
    // No Origin header. Browsers still mark the request's initiator, so a
    // cross-site attempt without Origin is rejected too.
    const site = request.headers.get('sec-fetch-site');
    if (site && site !== 'same-origin' && site !== 'none') return false;
    return true;
  }
  if (origin === 'null') return false;

  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }

  const requestHost = (
    request.headers.get('x-forwarded-host') ||
    request.headers.get('host') ||
    ''
  )
    .split(',')[0]
    .trim()
    .toLowerCase();

  if (!requestHost) return false;
  return originHost === requestHost;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method.toUpperCase();

  if (pathname.startsWith('/api/') && MUTATING_METHODS.has(method) && !isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: 'Cross-origin request rejected' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (!isProtected) {
    return NextResponse.next();
  }

  const rawSession = request.cookies.get(SESSION_COOKIE)?.value;
  const session = openSession(rawSession, process.env.BUGWISER_SESSION_SECRET);
  if (session) {
    return NextResponse.next();
  }

  const redirect = NextResponse.redirect(signInUrl(request));
  if (rawSession) {
    // Drop a stale/tampered cookie so the next request starts clean.
    redirect.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  }
  return redirect;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
