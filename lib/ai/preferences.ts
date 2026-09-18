// Persistent per-user model preference (auto vs manual + selected model).
// Belongs to the user, not the repository, and persists across repos, issues,
// new sessions, refreshes, and re-logins for the same account.

import { createBackgroundClient } from '@/lib/supabase/background';
import type { ProviderName } from '@/lib/ai/providers/registry';

export type SelectionMode = 'auto' | 'manual' | 'preset';

export type SelectedStrategy = 'auto' | 'free' | 'free_paid' | 'fully_paid' | 'custom';

export interface ModelPreference {
  user_id: string;
  provider: ProviderName | null;
  model: string | null;
  selection_mode: SelectionMode;
  selected_strategy: SelectedStrategy;
  stage_overrides?: Record<string, { provider: ProviderName | null; model: string | null }>;
  preset_id?: string | null; // For preset-based selections
}

export interface ModelPreferenceSave {
  selection_mode: SelectionMode;
  selected_strategy?: SelectedStrategy;
  provider?: ProviderName | null;
  model?: string | null;
  stage_overrides?: Record<string, { provider: ProviderName | null; model: string | null }>;
  preset_id?: string;
}

export async function getModelPreference(userId: string): Promise<ModelPreference> {
  const db = createBackgroundClient();
  const { data, error } = await db
    .from('user_model_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('[prefs] Failed to load preference:', error.message);
    return { user_id: userId, provider: null, model: null, selection_mode: 'auto', selected_strategy: 'auto' };
  }

  if (!data) {
    return { user_id: userId, provider: null, model: null, selection_mode: 'auto', selected_strategy: 'auto' };
  }

  return {
    user_id: userId,
    provider: (data.provider as ProviderName) || null,
    model: data.model || null,
    selection_mode: (data.selection_mode === 'manual' ? 'manual' : 'auto'),
    selected_strategy: (data.selected_strategy as SelectedStrategy | undefined) || 'auto',
    stage_overrides: data.stage_overrides as Record<string, { provider: ProviderName | null; model: string | null }> | undefined,
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
    preset_id: save.preset_id || null,
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
      preset_id: row.preset_id,
    },
  };
}