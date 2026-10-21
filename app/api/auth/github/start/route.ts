import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { githubCallbackUrl, getSessionSecret, readAppSession, setOAuthStateCookie } from '@/lib/auth/session';
import { randomToken, safeReturnTo } from '@/lib/auth/signed-cookie';
import { createPkcePair } from '@/lib/github/app/oauth';
import { requireGitHubAppConfig } from '@/lib/github/app/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authError(request: NextRequest, message: string): NextResponse {
  const url = new URL('/auth/github', request.url);
  url.searchParams.set('error', message);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get('returnTo'));
  const force = request.nextUrl.searchParams.get('force') === '1';

  if (!getSessionSecret()) {
    return authError(request, 'Authentication is not configured on this deployment.');
  }

  let config;
  try {
    config = requireGitHubAppConfig();
  } catch {
    return authError(request, 'GitHub App is not configured on this deployment.');
  }

  // A valid session is enough for a normal sign-in click; installation
  // verification passes force=1 because it needs a fresh user token.
  if (!force) {
    const existing = await readAppSession();
    if (existing) {
      return NextResponse.redirect(new URL(returnTo, request.url));
    }
  }

  const state = randomToken(32);
  const { verifier, challenge } = createPkcePair();

  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', config.clientId);
  authorize.searchParams.set('redirect_uri', githubCallbackUrl(request.url));
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');
  authorize.searchParams.set('prompt', 'select_account');
  authorize.searchParams.set('allow_signup', 'true');

  const response = NextResponse.redirect(authorize);
  setOAuthStateCookie(response, { state, codeVerifier: verifier, returnTo });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
