// GitHub OAuth App authorization URL. Pure so the exact URL the browser is sent
// to can be unit-tested; building it anywhere else risks a second, stale flow.
//
// Web application flow:
//   https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
//
// Notes that matter here:
//   * OAuth Apps use `client_id`/`client_secret` and do NOT support PKCE, so no
//     code_challenge is sent;
//   * `scope` is space-separated;
//   * `state` is echoed back verbatim and is the only CSRF control.

export const GITHUB_AUTHORIZE_ENDPOINT = 'https://github.com/login/oauth/authorize';

export interface AuthorizeUrlParams {
  /** OAuth App client id (public). */
  clientId: string;
  /** Must match a callback URL registered on the OAuth App. */
  redirectUri: string;
  /** Random value, stored in a signed cookie and compared on the callback. */
  state: string;
  /** Scopes to request; joined with spaces. */
  scopes: readonly string[];
  allowSignup?: boolean;
}

export function buildAuthorizeUrl(params: AuthorizeUrlParams): URL {
  const allowSignup = params.allowSignup === undefined ? true : params.allowSignup;

  const authorize = new URL(GITHUB_AUTHORIZE_ENDPOINT);
  authorize.searchParams.set('client_id', params.clientId);
  authorize.searchParams.set('redirect_uri', params.redirectUri);
  authorize.searchParams.set('state', params.state);

  const scopes = (params.scopes || []).map((scope) => scope.trim()).filter(Boolean);
  if (scopes.length > 0) authorize.searchParams.set('scope', scopes.join(' '));
  if (allowSignup) authorize.searchParams.set('allow_signup', 'true');

  return authorize;
}
