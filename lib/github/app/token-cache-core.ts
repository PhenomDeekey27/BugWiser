// Pure installation-token cache logic. No GitHub or environment imports so it
// can be unit-tested directly.

export interface CachedInstallationToken {
  token: string;
  expiresAtMs: number;
  permissions: Record<string, string>;
  repositorySelection: string;
  installationId: number;
}

export interface TokenCacheDependencies {
  now: () => number;
  create: (installationId: number) => Promise<CachedInstallationToken>;
}

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export function createInstallationTokenCache(deps: TokenCacheDependencies) {
  const cache = new Map<number, CachedInstallationToken>();
  const pending = new Map<number, Promise<CachedInstallationToken>>();

  return {
    async get(installationId: number): Promise<CachedInstallationToken> {
      const existing = cache.get(installationId);
      if (existing && existing.expiresAtMs - deps.now() > REFRESH_MARGIN_MS) {
        return existing;
      }

      const inFlight = pending.get(installationId);
      if (inFlight) return inFlight;

      const request = deps
        .create(installationId)
        .then((token) => {
          if (token.expiresAtMs - deps.now() <= 0) {
            throw new Error('GitHub returned an already-expired installation token');
          }
          cache.set(installationId, token);
          return token;
        })
        .finally(() => {
          pending.delete(installationId);
        });

      pending.set(installationId, request);
      return request;
    },

    invalidate(installationId: number): void {
      cache.delete(installationId);
    },

    clear(): void {
      cache.clear();
      pending.clear();
    },

    peek(installationId: number): CachedInstallationToken | undefined {
      return cache.get(installationId);
    },
  };
}
