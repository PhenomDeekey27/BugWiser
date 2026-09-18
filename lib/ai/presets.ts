/**
 * BugWiser Recommended Model Presets
 * 
 * Four curated model combinations representing different cost/quality tradeoffs:
 * - Efficient: Optimal free models across all stages
 * - Balanced: Mix of free and paid models for best value
 * - Fast: Prioritizes speed, using faster models throughout
 * - Quality: Highest quality models for best results
 */

import type { AnalysisTask } from './config';
import type { ProviderName } from './providers/registry';
import { MODEL_REGISTRY } from './model-registry';

export interface PresetAssignment {
  task: AnalysisTask;
  provider: ProviderName;
  model: string;
}

export interface PresetDefinition {
  id: 'efficient' | 'balanced' | 'fast' | 'quality';
  name: string;
  description: string;
  assignments: Record<AnalysisTask, { provider: ProviderName; model: string }>;
}

/**
 * Efficient: Best free models for each stage
 * Optimized for zero cost while maintaining good quality
 */
export const EFFICIENT_PRESET: PresetDefinition = {
  id: 'efficient',
  name: 'Efficient',
  description: 'Optimal free models across all stages',
  assignments: {
    relevant_file_discovery: {
      provider: 'opencode',
      model: 'mimo-v2.5-free', // High coding & reasoning score, fast
    },
    root_cause_analysis: {
      provider: 'opencode',
      model: 'mimo-v2.5-free', // Excellent for debugging & complex reasoning
    },
    evidence_extraction: {
      provider: 'opencode',
      model: 'nemotron-3-ultra-free', // Strong reasoning, good for evidence
    },
    solution_generation: {
      provider: 'opencode',
      model: 'mimo-v2.5-free', // Best free model for code generation
    },
    patch_generation: {
      provider: 'opencode',
      model: 'mimo-v2.5-free', // Best free model for code generation
    },
  },
};

/**
 * Balanced: Mix of free and paid models
 * Free models for simpler tasks, paid for complex ones
 */
export const BALANCED_PRESET: PresetDefinition = {
  id: 'balanced',
  name: 'Balanced',
  description: 'Free models for simple tasks, paid for complex work',
  assignments: {
    relevant_file_discovery: {
      provider: 'opencode',
      model: 'mimo-v2.5-free', // Free is sufficient for discovery
    },
    root_cause_analysis: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash', // Paid model for better debugging
    },
    evidence_extraction: {
      provider: 'opencode',
      model: 'nemotron-3-ultra-free', // Free model handles evidence well
    },
    solution_generation: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash', // Paid model for better code generation
    },
    patch_generation: {
      provider: 'deepseek',
      model: 'deepseek-v4-flash', // Paid model for reliable patches
    },
  },
};

/**
 * Fast: Prioritizes speed across all stages
 * Uses models optimized for fast response times
 */
export const FAST_PRESET: PresetDefinition = {
  id: 'fast',
  name: 'Fast',
  description: 'Optimized for speed across all stages',
  assignments: {
    relevant_file_discovery: {
      provider: 'opencode',
      model: 'nemotron-3.5-lightning-free', // Lightning fast free model
    },
    root_cause_analysis: {
      provider: 'opencode',
      model: 'nemotron-3.5-lightning-free', // Fast reasoning
    },
    evidence_extraction: {
      provider: 'opencode',
      model: 'nemotron-3.5-lightning-free', // Extremely fast for extraction
    },
    solution_generation: {
      provider: 'opencode',
      model: 'nemotron-3.5-lightning-free', // Fast code generation
    },
    patch_generation: {
      provider: 'opencode',
      model: 'nemotron-3.5-lightning-free', // Fast patch generation
    },
  },
};

/**
 * Quality: Highest quality models for best results
 * Uses the best available models regardless of cost
 */
export const QUALITY_PRESET: PresetDefinition = {
  id: 'quality',
  name: 'Quality',
  description: 'Best quality models across all stages',
  assignments: {
    relevant_file_discovery: {
      provider: 'deepseek',
      model: 'deepseek-v4-pro', // High quality discovery
    },
    root_cause_analysis: {
      provider: 'deepseek',
      model: 'deepseek-v4-pro', // Best debugging model
    },
    evidence_extraction: {
      provider: 'deepseek',
      model: 'deepseek-v4-pro', // High quality evidence extraction
    },
    solution_generation: {
      provider: 'deepseek',
      model: 'deepseek-v4-pro', // Best code generation
    },
    patch_generation: {
      provider: 'deepseek',
      model: 'deepseek-v4-pro', // Most reliable patches
    },
  },
};

/**
 * Export all presets for use in UI
 */
export const ALL_PRESETS: PresetDefinition[] = [
  EFFICIENT_PRESET,
  BALANCED_PRESET,
  FAST_PRESET,
  QUALITY_PRESET,
];

/**
 * Map preset IDs to their definitions
 */
export const PRESET_MAP: Record<string, PresetDefinition> = {
  efficient: EFFICIENT_PRESET,
  balanced: BALANCED_PRESET,
  fast: FAST_PRESET,
  quality: QUALITY_PRESET,
};
