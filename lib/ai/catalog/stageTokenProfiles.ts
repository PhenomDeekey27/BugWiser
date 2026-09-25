// Centralized per-stage estimated token profiles (SINGLE SOURCE OF TRUTH).
//
// These are ESTIMATED WORKLOADS for one stage request of a typical bug-fix
// analysis — used only for the "~cost / analysis" display. They are NOT
// context-window requirements (see STAGE_CONTEXT_MIN in stageSelection.ts for
// those) and NOT measured usage; the pipeline does not track real per-stage
// token counts yet. Adjust the numbers here to retune every cost display at
// once — no component may define its own token counts.
//
// Baseline: the historical flat 12k input / 2k output estimate, differentiated
// per stage. Evidence extraction has by far the largest input profile: its
// stage context requirement is 200K tokens (STAGE_CONTEXT_MIN), so real
// requests carry substantially more file/issue context than ordinary
// generation stages — while still being an estimate well below the 200K
// capacity ceiling, not the ceiling itself.

import type { StageKey } from '@/lib/ai/catalog/stageSelection';

export interface StageTokenProfile {
  inputTokens: number;
  outputTokens: number;
}

export const STAGE_TOKEN_PROFILES: Record<StageKey, StageTokenProfile> = {
  // Repo tree + issue body → short list of relevant files (compact output).
  relevant_file_discovery: { inputTokens: 12_000, outputTokens: 1_000 },
  // Issue + relevant file contents → root-cause write-up.
  root_cause_analysis: { inputTokens: 24_000, outputTokens: 2_000 },
  // Largest input by far: issue + extensive file context is scanned to pull
  // out structured evidence snippets (200K context requirement; the numbers
  // here are the estimated workload, not the capacity itself).
  evidence_extraction: { inputTokens: 64_000, outputTokens: 4_000 },
  // Root cause + evidence → solution description.
  solution_generation: { inputTokens: 16_000, outputTokens: 3_000 },
  // Full file context + solution → unified diff output.
  patch_generation: { inputTokens: 20_000, outputTokens: 4_000 },
};
