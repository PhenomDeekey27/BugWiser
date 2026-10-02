// Persists the model-selection record for an analysis. Merges incremental
// per-stage assignments into the analysis.model_selection JSONB column and
// stores a lightweight model_selection artifact for UI consumption.

import { createBackgroundClient } from '@/lib/supabase/background';
import type { ProviderName } from './providers/registry';
import type { AnalysisStageKey } from './catalog/types';

export interface StageAssignmentRecord {
  provider: ProviderName;
  model: string;
  fit?: number | null;
  fallbackCount?: number;
  attempted?: Array<{ provider: ProviderName; model: string }>;
}

export interface AnalysisSelectionRecord {
  mode: 'auto' | 'manual';
  reason: string;
  manualFallbackOccurred: boolean;
  stages: Partial<Record<AnalysisStageKey, StageAssignmentRecord>>;
  startedAt: string;
}

export async function getAnalysisSelection(analysisId: string): Promise<AnalysisSelectionRecord | null> {
  const db = createBackgroundClient();
  const { data, error } = await db
    .from('analyses')
    .select('model_selection')
    .eq('id', analysisId)
    .single();
  if (error || !data?.model_selection) return null;
  return data.model_selection as AnalysisSelectionRecord;
}

export async function recordStageAssignment(
  analysisId: string,
  task: string,
  stage: StageAssignmentRecord,
  selection: { mode: 'auto' | 'manual'; reason: string; manualFallbackOccurred: boolean }
): Promise<void> {
  const db = createBackgroundClient();

  const current = await getAnalysisSelection(analysisId);
  const existing: AnalysisSelectionRecord = current || {
    mode: selection.mode,
    reason: selection.reason,
    manualFallbackOccurred: false,
    stages: {},
    startedAt: new Date().toISOString(),
  };

  const next: AnalysisSelectionRecord = {
    ...existing,
    mode: selection.mode,
    reason: selection.reason,
    manualFallbackOccurred: existing.manualFallbackOccurred || selection.manualFallbackOccurred,
    stages: {
      ...existing.stages,
      [task]: stage,
    },
  };

  const { error } = await db
    .from('analyses')
    .update({ model_selection: next })
    .eq('id', analysisId);
  if (error) {
    console.warn('[analysis-selection] Failed to update analysis model_selection:', error.message);
  }
}

export function taskToStageKey(task: string): AnalysisStageKey {
  switch (task) {
    case 'relevant_file_discovery':
      return 'relevant_file_discovery';
    case 'root_cause_analysis':
      return 'root_cause_analysis';
    case 'evidence_extraction':
      return 'evidence_extraction';
    case 'solution_generation':
      return 'solution_generation';
    case 'patch_generation':
      return 'patch_generation';
    default:
      return 'root_cause_analysis';
  }
}