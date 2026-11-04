// Cookie names and lifetimes shared by the session, the proxy and the OAuth
// flow. Kept free of Node-only imports so it can be used from `proxy.ts` as well
// as route handlers.

/** Sealed, HttpOnly application session (AES-256-GCM). */
export const SESSION_COOKIE = 'bw_session';

/**
 * Signed OAuth `state` for one authorization attempt. The callback accepts a
 * state only if it matches this cookie, which binds the response to the browser
 * that started the flow.
 */
export const OAUTH_STATE_COOKIE = 'bw_oauth_state';

/** An authorization attempt must be completed within ten minutes. */
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;
