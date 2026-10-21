import crypto from 'node:crypto';
import { GitHubAppError, sanitizeGitHubMessage } from './errors';
import type { GitHubOAuthTokenResponse } from './types';

const TOKEN_URL = 'https://github.com/login/oauth/access_token';

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export interface ExchangeCodeOptions {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  timeoutMs?: number;
}

/**
 * Exchange a GitHub App user-authorization code. The user access token is
 * returned to the caller only; it is never logged or placed in a cookie.
 */
export async function exchangeUserAuthorizationCode(
  options: ExchangeCodeOptions,
  fetchImpl: typeof fetch = fetch
): Promise<{ accessToken: string; expiresAt: Date; refreshToken?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);

  try {
    const response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'BugWiser-GitHub-App',
      },
      body: JSON.stringify({
        client_id: options.clientId,
        client_secret: options.clientSecret,
        code: options.code,
        redirect_uri: options.redirectUri,
        code_verifier: options.codeVerifier,
      }),
      signal: controller.signal,
      cache: 'no-store',
    });

    const text = await response.text();
    let data: GitHubOAuthTokenResponse;
    try {
      data = JSON.parse(text) as GitHubOAuthTokenResponse;
    } catch {
      throw new GitHubAppError('GitHub returned an unreadable authorization response', 'api_error');
    }

    if (!response.ok || data.error || !data.access_token) {
      const message = sanitizeGitHubMessage(
        data.error_description || data.error || `GitHub authorization failed (${response.status})`
      );
      throw new GitHubAppError(message, 'app_auth_failed', { status: response.status });
    }

    const expiresAt = new Date(
      Date.now() + (Number.isFinite(data.expires_in) ? Number(data.expires_in) : 8 * 60 * 60) * 1000
    );

    return {
      accessToken: data.access_token,
      expiresAt,
      refreshToken: data.refresh_token,
    };
  } catch (error) {
    if (error instanceof GitHubAppError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GitHubAppError('GitHub authorization timed out', 'network_error');
    }
    throw new GitHubAppError('Could not reach GitHub to complete authorization', 'network_error');
  } finally {
    clearTimeout(timeout);
  }
}
