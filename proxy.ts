import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth/cookie-names';
import { verifySignedToken } from '@/lib/auth/signed-cookie';

/**
 * Route protection and cross-site request rejection.
 *
 * The BugWiser session is an HttpOnly signed cookie. The proxy runs on the
 * Node.js runtime, so it verifies the signature and expiry before letting a
 * protected page render. When there is no valid BugWiser session it falls back
 * to the legacy Supabase session, which keeps users working during rollout.
 * Pages and API routes still authorise server-side; this is a UX boundary on
 * top of that, never the only check.
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

  // A valid BugWiser session is enough. Anything else (missing, expired,
  // tampered) falls through to the Supabase fallback before redirecting.
  const rawSession = request.cookies.get(SESSION_COOKIE)?.value;
  const sessionValid = Boolean(
    rawSession &&
      process.env.BUGWISER_SESSION_SECRET &&
      verifySignedToken(rawSession, process.env.BUGWISER_SESSION_SECRET, 'session')
  );
  if (sessionValid) {
    return NextResponse.next();
  }

  // Legacy Supabase session fallback (rollout support).
  let supabaseResponse = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  let signedIn = false;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    signedIn = Boolean(user);
  } catch {
    signedIn = false;
  }

  if (signedIn) return supabaseResponse;

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
