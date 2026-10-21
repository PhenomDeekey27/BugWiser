// Cookie names and lifetimes shared by the session, the proxy (edge runtime)
// and the OAuth/setup flows. Kept free of Node-only imports so it can be used
// from middleware as well as route handlers.

export const SESSION_COOKIE = 'bw_session';
export const OAUTH_STATE_COOKIE = 'bw_oauth';
export const PENDING_INSTALL_COOKIE = 'bw_pending_install';

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const SESSION_ROTATE_AFTER_SECONDS = 24 * 60 * 60;
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;
export const PENDING_INSTALL_TTL_SECONDS = 15 * 60;
