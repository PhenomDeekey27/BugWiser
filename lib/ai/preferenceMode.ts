import type { SelectedStrategy } from './preferences';
import type { StageOverrideEntry, StageOverrideOrigin } from './catalog/overrideReconcile';

export interface PreferenceSaveBodyInput {
  selectionMode: 'auto' | 'manual' | null | undefined;
  provider?: string | null;
  model?: string | null;
  selectedStrategy: SelectedStrategy;
  stageOverrides: Record<string, StageOverrideEntry>;
}

export interface PreferenceSaveBody {
  selection_mode: 'auto' | 'manual';
  provider: string | null;
  model: string | null;
  selected_strategy: SelectedStrategy;
  stage_overrides: Record<string, StageOverrideEntry>;
}

export function buildPreferenceSaveBody(input: PreferenceSaveBodyInput): PreferenceSaveBody {
  const selection_mode: 'auto' | 'manual' = input.selectionMode === 'manual' ? 'manual' : 'auto';
  return {
    selection_mode,
    provider: selection_mode === 'manual' ? (input.provider ?? null) : null,
    model: selection_mode === 'manual' ? (input.model ?? null) : null,
    selected_strategy: input.selectedStrategy,
    stage_overrides: input.stageOverrides,
  };
}

export interface StageSelectionState {
  active: boolean;
  mode: 'auto' | 'manual';
  banner: string | null;
  inactiveStatusText: string;
  saveNote: string | null;
}

export function deriveStageSelectionState(
  selectionMode: 'auto' | 'manual' | null | undefined,
  manualModel?: { provider: string | null; model: string | null } | null
): StageSelectionState {
  const mode: 'auto' | 'manual' = selectionMode === 'manual' ? 'manual' : 'auto';
  if (mode === 'auto') {
    return { active: true, mode, banner: null, inactiveStatusText: 'Inactive', saveNote: null };
  }
  const pair =
    manualModel?.provider && manualModel?.model
      ? `Manual model mode is active — every AI stage runs ${manualModel.provider} · ${manualModel.model}, so the stage selections below are saved but not used at runtime. Switch to Auto mode on the New Analysis page.`
      : 'Manual model mode is active — the stage selections below are saved but not used at runtime. Switch to Auto mode on the New Analysis page.';
  return {
    active: false,
    mode,
    banner: pair,
    inactiveStatusText: 'Inactive',
    saveNote: 'Manual mode is active — stage selections stay inactive until you switch to Auto mode.',
  };
}

export type StageStatusTone = 'unavailable' | 'unconfigured' | 'inactive' | 'custom' | 'active';

export interface StageStatusInput {
  configured: boolean;
  unavailable?: boolean;
  origin?: StageOverrideOrigin | null;
  modeActive: boolean;
}

export function deriveStageStatus(input: StageStatusInput): StageStatusTone {
  if (input.unavailable) return 'unavailable';
  if (!input.configured) return 'unconfigured';
  if (!input.modeActive) return 'inactive';
  if (input.origin === 'manual') return 'custom';
  return 'active';
}
