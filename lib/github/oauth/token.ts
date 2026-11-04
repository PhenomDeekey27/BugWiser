// GitHub OAuth App token endpoint.
//
// The two calls here are the only places the client secret is used. Both return
// the token to the caller and never log it: the callback puts it inside the
// sealed session cookie, and anything else is a bug.
//
// Response shape: an OAuth App normally returns a non-expiring token, so
// `expires_in` and `refresh_token` are absent and `expiresAt` is 0. When the app
// has "Expire user access tokens" enabled they are present and the refresh path
// keeps a session alive without another consent screen.

import { GitHubError, sanitizeGitHubMessage } from '../errors.ts';
import type { GitHubOAuthTokenResponse } from '../types';

const TOKEN_URL = 'https://github.com/login/oauth/access_token';

export interface GitHubTokenGrant {
  accessToken: string;
  scopes: string[];
  /** Unix seconds; 0 means GitHub reported a non-expiring token. */
  expiresAt: number;
  refreshToken: string | null;
}

export interface ExchangeCodeOptions {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  timeoutMs?: number;
}

export interface RefreshTokenOptions {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  timeoutMs?: number;
}

/** GitHub returns `scope` as a comma-separated list; tolerate spaces too. */
export function parseScopes(scope: unknown): string[] {
  if (typeof scope !== 'string' || scope.trim().length === 0) return [];
  const scopes: string[] = [];
  for (const entry of scope.split(/[,\s]+/)) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (!scopes.includes(trimmed)) scopes.push(trimmed);
  }
  return scopes;
}

function toGrant(data: GitHubOAuthTokenResponse, nowMs: number): GitHubTokenGrant {
  const accessToken = typeof data.access_token === 'string' ? data.access_token.trim() : '';
  if (!accessToken) {
    throw new GitHubError('GitHub returned no access token', 'api_error');
  }

  const expiresIn = Number(data.expires_in);
  const expiresAt =
    Number.isFinite(expiresIn) && expiresIn > 0
      ? Math.floor(nowMs / 1000) + Math.floor(expiresIn)
      : 0;

  return {
    accessToken,
    scopes: parseScopes(data.scope),
    expiresAt,
    refreshToken:
      typeof data.refresh_token === 'string' && data.refresh_token.trim().length > 0
        ? data.refresh_token.trim()
        : null,
  };
}

async function requestToken(
  body: Record<string, string>,
  timeoutMs: number,
  fetchImpl: typeof fetch,
  nowMs: number
): Promise<GitHubTokenGrant> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'BugWiser',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });

    const text = await response.text();
    let data: GitHubOAuthTokenResponse;
    try {
      data = JSON.parse(text) as GitHubOAuthTokenResponse;
    } catch {
      throw new GitHubError('GitHub returned an unreadable authorization response', 'api_error');
    }

    if (!response.ok || data.error || !data.access_token) {
      const message = sanitizeGitHubMessage(
        data.error_description || data.error || `GitHub authorization failed (${response.status})`
      );
      // A rejected code or refresh token can never succeed on retry: it needs a
      // fresh authorization, which is exactly what `auth_rejected` means.
      throw new GitHubError(
        message,
        response.status === 401 || data.error ? 'auth_rejected' : 'api_error',
        { status: response.status }
      );
    }

    return toGrant(data, nowMs);
  } catch (error) {
    if (error instanceof GitHubError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GitHubError('GitHub authorization timed out', 'network_error');
    }
    throw new GitHubError('Could not reach GitHub to complete authorization', 'network_error');
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Exchanges a one-time authorization code for the user's access token. The code
 * is single-use and short-lived; the caller must have already verified `state`.
 */
export function exchangeAuthorizationCode(
  options: ExchangeCodeOptions,
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now()
): Promise<GitHubTokenGrant> {
  return requestToken(
    {
      client_id: options.clientId,
      client_secret: options.clientSecret,
      code: options.code,
      redirect_uri: options.redirectUri,
    },
    options.timeoutMs ?? 15_000,
    fetchImpl,
    nowMs
  );
}

/** Renews an expiring token. GitHub rotates the refresh token on each use. */
export function refreshAccessToken(
  options: RefreshTokenOptions,
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now()
): Promise<GitHubTokenGrant> {
  return requestToken(
    {
      client_id: options.clientId,
      client_secret: options.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: options.refreshToken,
    },
    options.timeoutMs ?? 15_000,
    fetchImpl,
    nowMs
  );
}
