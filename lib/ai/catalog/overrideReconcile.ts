// Deterministic stage_overrides reconciliation.
//
// Persisted stage_overrides may reference models that no longer exist in the
// user's CURRENT connected-provider catalog (provider disconnected, live model
// removed upstream, catalog rebuilt). Unreconciled, those stale entries
// silently override fresh automatic selection: the UI shows "configured" rows
// pointing at phantom models and the runtime tries a nonexistent model first
// (it survives via fallback, but that is exactly the silent divergence this
// task forbids).
//
// Policy (deterministic, no randomness):
//   - An override is KEPT only when its (provider, model) exists in the
//     current connected catalog.
//   - `unavailable` markers (strict Free: no confirmed-free model for the
//     stage) are KEPT verbatim — they reference no model, so they can never
//     be stale; the user clears them by re-applying a setup or configuring
//     the stage manually.
//   - Stale overrides are DROPPED — never rewritten to a guessed model — so
//     the next automatic selection pass owns those stages again.
//   - An empty result means "no overrides", which re-enables automatic
//     selection per stage; that is the correct recovery.

export type StageOverrideOrigin = 'setup' | 'manual';

export interface StageOverrideEntry {
  provider: string | null;
  model: string | null;
  /**
   * Strict-Free marker: the Free setup found no confirmed-free model for this
   * stage. Kept verbatim by reconciliation (it points at no model, so it can
   * never go stale) until the user re-applies a setup or configures the stage.
   */
  unavailable?: boolean;
  origin?: StageOverrideOrigin;
}

export interface ReconcilableModel {
  providerId: string;
  modelId: string;
  available: boolean;
}

/**
 * Whether stage_overrides may be reconciled (and self-heal persisted) against
 * the catalog snapshot this response is about to serve.
 *
 * Reconciliation DROPS overrides whose model is absent from the served catalog,
 * and `/api/models` then persists that dropped set. That is only meaningful
 * when the snapshot reflects reality. A pending snapshot (`catalogPending`)
 * PROVABLY lags the current provider set — the served rows predate the latest
 * connect/disconnect — so a freshly connected provider's models are missing
 * from it. Reconciling then would drop (and persist-delete) perfectly valid
 * overrides for those models: connect Local → save a manual override while the
 * rebuild is still in flight → the stale snapshot erases it on the next read.
 * Self-heal therefore waits for the authoritative (non-pending) read, at which
 * point the rebuild's snapshot contains every connected provider's models.
 *
 * Two pending cases stay authoritative:
 *   - Nothing is connected: every override references a disconnected provider,
 *     so dropping is correct no matter which snapshot serves the rows (without
 *     this, stale overrides would never self-heal).
 *   - A first-ever load (nothing persisted yet) is covered by the same rule
 *     via `modelCount`/connection inputs downstream — an empty catalog with
 *     providers connected never reconciles while pending.
 */
export function shouldReconcileOverrides(input: {
  /** A background rebuild is in flight; the snapshot may still be catching up. */
  catalogPending: boolean;
  /** Rows in the served catalog snapshot. */
  modelCount: number;
  /** Providers reported connected from provider_connections. */
  connectedProviderCount: number;
}): boolean {
  if (!input.catalogPending) return true;
  // Pending + something connected ⇒ the snapshot may predate that provider's
  // models; never drop against it (over-drop risk). Pending + nothing
  // connected ⇒ no override can reference a connected model; drop freely.
  return input.connectedProviderCount === 0;
}

export interface OverrideReconcileResult {
  /** Overrides that still point at real, available connected models, plus
   * kept strict-Free `unavailable` markers. */
  kept: Record<string, StageOverrideEntry>;
  /** Stage ids whose overrides were dropped as stale. */
  droppedStages: string[];
  changed: boolean;
}

/**
 * Filters stage_overrides down to entries whose model exists in the CURRENT
 * connected-provider catalog (strict-Free `unavailable` markers are kept
 * verbatim). Pure function — same input, same output.
 */
export function reconcileStageOverrides(
  overrides: Record<string, StageOverrideEntry> | null | undefined,
  catalogModels: ReconcilableModel[]
): OverrideReconcileResult {
  const kept: Record<string, StageOverrideEntry> = {};
  const droppedStages: string[] = [];
  if (!overrides) return { kept, droppedStages, changed: false };

  const valid = new Set(
    catalogModels
      .filter((m) => m.available)
      .map((m) => `${m.providerId}::${m.modelId}`)
  );

  for (const [stage, entry] of Object.entries(overrides)) {
    const provider = entry?.provider ?? null;
    const model = entry?.model ?? null;
    if (entry?.unavailable) {
      // Strict-Free unavailable marker: keep verbatim (no model to validate).
      kept[stage] = { provider: null, model: null, unavailable: true };
    } else if (provider && model && valid.has(`${provider}::${model}`)) {
      kept[stage] = { provider, model, ...(entry.origin ? { origin: entry.origin } : {}) };
    } else {
      droppedStages.push(stage);
    }
  }

  const dropped = droppedStages.length > 0;
  return { kept, droppedStages, changed: dropped };
}
