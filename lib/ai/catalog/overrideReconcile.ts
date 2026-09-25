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

export interface StageOverrideEntry {
  provider: string | null;
  model: string | null;
  /**
   * Strict-Free marker: the Free setup found no confirmed-free model for this
   * stage. Kept verbatim by reconciliation (it points at no model, so it can
   * never go stale) until the user re-applies a setup or configures the stage.
   */
  unavailable?: boolean;
}

export interface ReconcilableModel {
  providerId: string;
  modelId: string;
  available: boolean;
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
      kept[stage] = { provider, model };
    } else {
      droppedStages.push(stage);
    }
  }

  const dropped = droppedStages.length > 0;
  return { kept, droppedStages, changed: dropped };
}
