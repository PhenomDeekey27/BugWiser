// In-memory catalog cache — per-user, server-side only.
// Refreshes only when connected providers change (fingerprint match).

import type { ModelCatalog } from './types';
import { buildCatalog } from './builder';

interface CacheEntry {
  catalog: ModelCatalog;
  builtAt: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000; // 5 minutes

function isStale(entry: CacheEntry): boolean {
  return Date.now() - entry.builtAt > TTL_MS;
}

export async function getCatalog(userId: string, forceRefresh = false): Promise<ModelCatalog> {
  const existing = cache.get(userId);

  if (!forceRefresh && existing && !isStale(existing)) {
    return existing.catalog;
  }

  const catalog = await buildCatalog(userId);

  // If fingerprint unchanged and we had a cached version, keep the old AI recommendations
  if (existing && existing.catalog.providerFingerprint === catalog.providerFingerprint && !forceRefresh) {
    return existing.catalog;
  }

  cache.set(userId, { catalog, builtAt: Date.now() });
  return catalog;
}

export function invalidateCatalog(userId: string): void {
  cache.delete(userId);
}

export function getCatalogCacheStats() {
  return {
    entries: cache.size,
    userIds: Array.from(cache.keys()),
  };
}
