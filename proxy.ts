import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
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
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const protectedPaths = ['/dashboard', '/analysis', '/repositories'];
  const isProtected = protectedPaths.some((path) =>
    request.nextUrl.pathname.startsWith(path)
  );

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/github';
    return NextResponse.redirect(url);
  }

  // GitHub session expired: the Supabase user is still valid but the session
  // no longer carries the GitHub provider_token (same condition the GitHub
  // API routes answer 401 with). Redirect BEFORE the protected page renders
  // so no stale profile ever appears, using the auth page's existing
  // `error` message mechanism.
  if (isProtected && user) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session && !session.provider_token) {
      const url = request.nextUrl.clone();
      url.pathname = '/auth/github';
      url.searchParams.set(
        'error',
        'Your GitHub session has expired. Please sign in again.'
      );
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
