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
