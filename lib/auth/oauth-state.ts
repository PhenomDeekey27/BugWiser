// OAuth `state`: the CSRF control for the authorization-code flow.
//
// DESIGN
// `state` is a random value. The browser is sent a signed cookie holding the
// same value plus the return target, and the callback succeeds only if GitHub
// echoes back the value stored in *this browser's* cookie. That gives two
// guarantees at once:
//
//   * CSRF — an attacker cannot make a victim's browser complete an
//     authorization the attacker started, because the attacker cannot write the
//     victim's cookie;
//   * browser binding — a state value leaked to another browser is unusable
//     there, because that browser has no matching cookie.
//
// No database row is involved, so a suspended Neon compute cannot block sign-in.
// The cookie is short-lived (ten minutes), HttpOnly, and cleared as soon as the
// callback reads it.
//
// The rules live in `oauth-state-core.ts`; this module only touches Next.js.

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { OAUTH_STATE_COOKIE, OAUTH_STATE_TTL_SECONDS } from './cookie-names';
import { isProductionRuntime } from './session';
import { readOAuthStateCookieValue } from './oauth-state-core';

export {
  createOAuthStateValue,
  readOAuthStateCookieValue,
  signOAuthState,
  verifyOAuthStateToken,
  type OAuthStateValue,
  type OAuthStateVerification,
} from './oauth-state-core';

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: isProductionRuntime(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

/** Reads the state cookie from the current request. */
export async function readOAuthStateCookie(): Promise<string | null> {
  return readOAuthStateCookieValue(await cookies());
}

export function setOAuthStateCookie(response: NextResponse, cookieValue: string): void {
  response.cookies.set(OAUTH_STATE_COOKIE, cookieValue, cookieOptions(OAUTH_STATE_TTL_SECONDS));
}

export function clearOAuthStateCookie(response: NextResponse): void {
  response.cookies.set(OAUTH_STATE_COOKIE, '', { ...cookieOptions(0), maxAge: 0 });
}
