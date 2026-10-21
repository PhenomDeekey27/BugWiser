import { GitHubAppConfigError, requireGitHubAppConfig } from './config';
import { createAppJwt } from './jwt';
import { createInstallationAccessToken, fetchAppInstallation } from './api';
import {
  createInstallationTokenCache,
  type CachedInstallationToken,
  type TokenCacheDependencies,
} from './token-cache-core';
import type { GitHubInstallationToken } from './types';

export type { CachedInstallationToken, TokenCacheDependencies };
export { createInstallationTokenCache };

const MAX_CACHE_MS = 60 * 60 * 1000;

/**
 * Sign an App JWT, turning a broken PEM into an explicit configuration error
 * instead of an opaque signing exception deep inside a GitHub request.
 */
function createAppToken(): string {
  const config = requireGitHubAppConfig();
  try {
    return createAppJwt(config.appId, config.privateKeyPem);
  } catch (error) {
    console.error(
      '[github-app] Could not sign an App JWT with the configured private key:',
      (error as Error).message
    );
    throw new GitHubAppConfigError(
      'GitHub App private key is invalid. Set GITHUB_APP_PRIVATE_KEY to the App private key PEM, or put its base64 form in GITHUB_APP_PRIVATE_KEY_BASE64.'
    );
  }
}

const realDependencies: TokenCacheDependencies = {
  now: () => Date.now(),
  create: async (installationId) => {
    const appJwt = createAppToken();
    const token: GitHubInstallationToken = await createInstallationAccessToken(appJwt, installationId);
    const parsed = Date.parse(token.expires_at);
    const now = Date.now();
    const expiresAtMs = Number.isFinite(parsed)
      ? Math.min(parsed, now + MAX_CACHE_MS)
      : now + 55 * 60 * 1000;
    return {
      token: token.token,
      expiresAtMs,
      permissions: token.permissions || {},
      repositorySelection: token.repository_selection || 'selected',
      installationId,
    };
  },
};

/** Process-local cache. Installation tokens are short-lived and never persisted. */
export const installationTokenCache = createInstallationTokenCache(realDependencies);

export async function getInstallationToken(installationId: number): Promise<CachedInstallationToken> {
  return installationTokenCache.get(installationId);
}

export async function getInstallationAccount(installationId: number) {
  return fetchAppInstallation(createAppToken(), installationId);
}
