// Pure OAuth `state` rules: signing, verification, and cookie-value reading.
//
// Kept free of Next.js imports so the CSRF rules can be tested with plain Node.
// `oauth-state.ts` binds these to the request cookie store.

import { OAUTH_STATE_COOKIE, OAUTH_STATE_TTL_SECONDS } from './cookie-names.ts';
import {
  constantTimeEqual,
  randomToken,
  signSignedToken,
  verifySignedToken,
} from './signed-cookie.ts';

export { OAUTH_STATE_COOKIE, OAUTH_STATE_TTL_SECONDS };

export interface OAuthStateValue {
  state: string;
  returnTo: string;
}

/** Creates a fresh, unguessable state value. */
export function createOAuthStateValue(): string {
  return randomToken(32);
}

/** Pure: seals `{ state, returnTo }` into a signed cookie value. */
export function signOAuthState(
  secret: string,
  value: OAuthStateValue,
  nowMs: number = Date.now()
): string {
  return signSignedToken(
    { s: value.state, r: value.returnTo },
    secret,
    'oauth_state',
    OAUTH_STATE_TTL_SECONDS,
    nowMs
  );
}

export type OAuthStateVerification =
  | { ok: true; returnTo: string }
  | { ok: false; reason: 'missing' | 'invalid' | 'mismatch' };

/**
 * Pure: checks the callback's `state` against the signed cookie value.
 *
 * A missing cookie is reported separately from a wrong value so the log can
 * distinguish "cookies were blocked" from "the value did not match".
 */
export function verifyOAuthStateToken(
  cookieValue: string | null | undefined,
  receivedState: string | null | undefined,
  secret: string | null | undefined,
  nowMs: number = Date.now()
): OAuthStateVerification {
  if (!cookieValue) return { ok: false, reason: 'missing' };

  const payload = verifySignedToken(cookieValue, secret, 'oauth_state', nowMs);
  if (!payload) return { ok: false, reason: 'invalid' };

  const expected = typeof payload.s === 'string' ? payload.s : '';
  if (!expected || !receivedState || !constantTimeEqual(expected, receivedState)) {
    return { ok: false, reason: 'mismatch' };
  }

  return {
    ok: true,
    returnTo: typeof payload.r === 'string' && payload.r ? payload.r : '/dashboard',
  };
}

/** Pure: the state cookie's value from a cookie store shape. */
export function readOAuthStateCookieValue(store: {
  get(name: string): { value: string } | undefined;
}): string | null {
  const value = store.get(OAUTH_STATE_COOKIE)?.value;
  return typeof value === 'string' && value.length > 0 ? value : null;
}
