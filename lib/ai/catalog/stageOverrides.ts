import type { StageOverrideEntry, StageOverrideOrigin } from './overrideReconcile';

export interface StageOverrideRow {
  selectedProvider: string | null;
  selectedModel: string | null;
  isOverride: boolean;
  unavailable?: boolean;
  origin?: StageOverrideOrigin;
}

export function buildStageOverrides(
  stageIds: readonly string[],
  rows: Record<string, StageOverrideRow>
): Record<string, StageOverrideEntry> {
  const overrides: Record<string, StageOverrideEntry> = {};
  for (const stageId of stageIds) {
    const row = rows[stageId];
    if (!row) continue;
    if (row.unavailable) {
      overrides[stageId] = { provider: null, model: null, unavailable: true };
    } else if (row.isOverride && row.selectedProvider && row.selectedModel) {
      overrides[stageId] = {
        provider: row.selectedProvider,
        model: row.selectedModel,
        ...(row.origin ? { origin: row.origin } : {}),
      };
    }
  }
  return overrides;
}

export function resolveOverrideOrigin(
  isOverride: boolean,
  selectionChanged: boolean,
  previousOrigin: StageOverrideOrigin | undefined
): StageOverrideOrigin | undefined {
  if (!isOverride) return undefined;
  if (selectionChanged) return 'manual';
  return previousOrigin === 'setup' ? 'setup' : 'manual';
}

export interface AppliedStageOverride {
  isOverride: boolean;
  origin: StageOverrideOrigin | undefined;
}

/**
 * Resolves what a Configure-modal Apply writes for one stage.
 *
 * A concrete model change IS a manual selection: it persists as a manual
 * override even when the "Custom Override" checkbox is unchecked. The checkbox
 * alone used to gate persistence, so applying a model to a previously
 * unconfigured stage (its checkbox starts unchecked) rendered as configured in
 * the UI but was omitted from `stage_overrides` on save — the assignment then
 * vanished on refresh. The checkbox still controls an UNCHANGED selection:
 * checked re-stamps it, unchecked removes it from persistence.
 */
export function resolveAppliedOverride(input: {
  checkbox: boolean;
  selectionChanged: boolean;
  previousOrigin?: StageOverrideOrigin | null;
}): AppliedStageOverride {
  const isOverride = input.checkbox || input.selectionChanged;
  return {
    isOverride,
    origin: resolveOverrideOrigin(isOverride, input.selectionChanged, input.previousOrigin ?? undefined),
  };
}
