// Stage "Change Model" candidate derivation (Task Q). Pure — no React, no
// fetch. Extracted from StageChangeModal so the pool can be tested directly
// instead of only through JSX.
//
// The pool is the FULL catalog of every CONNECTED provider. It deliberately
// applies NO pricing/authority filter: bucketing a candidate as "Free" vs
// "Paid" for display is a label, never an eligibility gate. Eligibility rules
// live where they already live:
//   - Strict Free / Free setup → lib/ai/catalog/stageSelection.ts
//     (`pool.filter(m => m.price.isFree)`), where unknown pricing is NOT free;
//   - Balanced / Quality → the same file's automatic pool (unknown pricing is
//     the worst cost tier, still selectable);
//   - manual stage override → no free gate at all (handleApplyStageChange).
// So a connected model is never invisible here, and a local model with unknown
// pricing is never silently promoted to "free" either.

import type { CatalogModel, CatalogProvider } from '@/app/models/page';

export const RECOMMENDED_LIMIT = 4;

/**
 * Every available model belonging to a connected provider. A provider that is
 * not connected contributes nothing — the same rule for every provider.
 */
export function buildStageCandidatePool(
  providers: CatalogProvider[],
  models: CatalogModel[]
): CatalogModel[] {
  const connected = new Set(
    providers.filter((p) => p.status === 'connected').map((p) => p.providerId)
  );
  return models.filter((m) => m.available && connected.has(m.providerId));
}

/**
 * Case-insensitive search across display name, model id and provider id (so a
 * provider-scoped query such as "local" finds that provider's models).
 * Never mutates the input array.
 */
export function filterStageModels(models: CatalogModel[], query: string): CatalogModel[] {
  const q = query.toLowerCase().trim();
  if (!q) return [...models];
  return models.filter(
    (m) =>
      m.displayName.toLowerCase().includes(q) ||
      m.modelId.toLowerCase().includes(q) ||
      m.providerId.toLowerCase().includes(q)
  );
}

export interface StageModelBuckets {
  /** Highest value score first, capped at RECOMMENDED_LIMIT. */
  recommended: CatalogModel[];
  /** Display bucket: models whose pricing is CONFIRMED zero cost. */
  free: CatalogModel[];
  /** Display bucket: everything else, including UNKNOWN pricing. */
  other: CatalogModel[];
}

/**
 * Splits the (already filtered) candidate list into the modal's display
 * buckets. Ordering never mutates the caller's array.
 */
export function bucketStageModels(models: CatalogModel[]): StageModelBuckets {
  const byValue = (a: CatalogModel, b: CatalogModel) => b.valueScore - a.valueScore;
  return {
    recommended: [...models].sort(byValue).slice(0, RECOMMENDED_LIMIT),
    free: models.filter((m) => m.price.isFree).sort(byValue),
    other: models.filter((m) => !m.price.isFree).sort(byValue),
  };
}
