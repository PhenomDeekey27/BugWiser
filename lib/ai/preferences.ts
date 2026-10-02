// Persistent per-user model preference (auto vs manual + selected model).
// Belongs to the user, not the repository, and persists across repos, issues,
// new sessions, refreshes, and re-logins for the same account.

import { createBackgroundClient } from '@/lib/supabase/background';
import type { ProviderName } from '@/lib/ai/providers/registry';
import type { StageOverrideOrigin } from '@/lib/ai/catalog/overrideReconcile';

export type SelectionMode = 'auto' | 'manual';

/** Engine strategies plus the /models page UI setups (balanced/quality).
 * The runtime engine (strategy-selection.ts) only consumes the engine set;
 * UI setups carry their concrete picks in stage_overrides. */
export type SelectedStrategy = 'auto' | 'free' | 'free_paid' | 'fully_paid' | 'custom' | 'balanced' | 'quality';

export interface ModelPreference {
  user_id: string;
  provider: ProviderName | null;
  model: string | null;
  selection_mode: SelectionMode;
  selected_strategy: SelectedStrategy;
  stage_overrides?: Record<string, { provider: ProviderName | null; model: string | null; unavailable?: boolean; origin?: StageOverrideOrigin }>;
  readFailed?: boolean;
}

export interface ModelPreferenceSave {
  selection_mode: SelectionMode;
  selected_strategy?: SelectedStrategy;
  provider?: ProviderName | null;
  model?: string | null;
  stage_overrides?: Record<string, { provider: ProviderName | null; model: string | null; unavailable?: boolean; origin?: StageOverrideOrigin }>;
}

export interface PreferenceRow {
  provider?: unknown;
  model?: unknown;
  selection_mode?: unknown;
  selected_strategy?: unknown;
  stage_overrides?: unknown;
}

export type PreferenceRowLoader = (userId: string) => Promise<{
  data: PreferenceRow | null;
  error: { message: string } | null;
}>;

async function loadPreferenceRow(userId: string): Promise<{
  data: PreferenceRow | null;
  error: { message: string } | null;
}> {
  const db = createBackgroundClient();
  const { data, error } = await db
    .from('user_model_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  return {
    data: (data ?? null) as PreferenceRow | null,
    error: error ? { message: error.message } : null,
  };
}

export async function getModelPreference(
  userId: string,
  loadRow: PreferenceRowLoader = loadPreferenceRow
): Promise<ModelPreference> {
  const { data, error } = await loadRow(userId);

  if (error) {
    console.error('[prefs] Failed to load preference:', error.message);
    return { user_id: userId, provider: null, model: null, selection_mode: 'auto', selected_strategy: 'auto', readFailed: true };
  }

  if (!data) {
    return { user_id: userId, provider: null, model: null, selection_mode: 'auto', selected_strategy: 'auto' };
  }

  return {
    user_id: userId,
    provider: (data.provider as ProviderName) || null,
    model: (data.model as string) || null,
    selection_mode: (data.selection_mode === 'manual' ? 'manual' : 'auto'),
    selected_strategy: (data.selected_strategy as SelectedStrategy | undefined) || 'auto',
    stage_overrides: data.stage_overrides as Record<string, { provider: ProviderName | null; model: string | null; unavailable?: boolean; origin?: StageOverrideOrigin }> | undefined,
  };
}

export async function saveModelPreference(
  userId: string,
  save: ModelPreferenceSave
): Promise<{ ok: boolean; error?: string; preference?: ModelPreference }> {
  const selection_mode = save.selection_mode === 'manual' ? 'manual' : 'auto';

  // For manual mode a concrete provider+model must be present.
  if (selection_mode === 'manual' && (!save.provider || !save.model)) {
    return { ok: false, error: 'Manual mode requires a provider and model selection.' };
  }

  const row = {
    user_id: userId,
    provider: selection_mode === 'manual' ? save.provider : null,
    model: selection_mode === 'manual' ? save.model : null,
    selection_mode,
    selected_strategy: save.selected_strategy || 'auto',
    stage_overrides: save.stage_overrides,
    updated_at: new Date().toISOString(),
  };

  const db = createBackgroundClient();
  const { error } = await db
    .from('user_model_preferences')
    .upsert(row, { onConflict: 'user_id' });

  if (error) {
    console.error('[prefs] Failed to save preference:', error.message);
    return { ok: false, error: `Failed to save preference: ${error.message}` };
  }

  return {
    ok: true,
    preference: {
      user_id: userId,
      provider: row.provider || null,
      model: row.model || null,
      selection_mode,
      selected_strategy: row.selected_strategy || 'auto',
      stage_overrides: row.stage_overrides,
    },
  };
}

export type StrategySaveResolution =
  | { ok: true; strategy: SelectedStrategy }
  | { ok: false; error: string };

export function resolveSavedStrategy(
  requested: SelectedStrategy | null | undefined,
  stored: ModelPreference | null
): StrategySaveResolution {
  if (requested != null) {
    return { ok: true, strategy: requested };
  }
  if (!stored) {
    return { ok: false, error: 'Stored model strategy is unavailable — nothing was changed. Try again.' };
  }
  if (stored.readFailed) {
    return { ok: false, error: 'Could not verify your stored model strategy (preference read failed) — nothing was changed. Try again.' };
  }
  return { ok: true, strategy: stored.selected_strategy };
}