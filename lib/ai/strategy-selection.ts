// Strategy Selection Engine — builds per-stage model assignments for each user-facing mode.
//
// Modes:
//   free        — every stage uses the best FREE model per-stage
//   free_paid   — discovery/evidence → FREE, everything else → PAID
//   fully_paid  — every stage uses the best PAID model per-stage
//   custom      — inherits auto strategy, with optional stage_overrides
//   auto        — auto-selects the best model per-stage (default)
//
// Uses the existing MODEL_REGISTRY scoring system.
//
// Persisted stage_overrides (the concrete picks saved by the /models page
// setups) are honored by EVERY mode via applyStageOverrides — so /api/ai/models
// reports the same assignments the UI and runtime use, and an automatic setup
// plus manual per-stage customization stay consistent. Manual model selection
// is unaffected (it flows through selection_mode/manualModel, not here).

import type { ProviderName } from './providers/registry';
import { MODEL_REGISTRY } from './model-registry';
import type { AnalysisTask, TaskType, TaskWeights } from './config';
import { TASK_TYPE_MAP, TASK_WEIGHTS } from './config';

const AI_STAGES: AnalysisTask[] = [
  'relevant_file_discovery',
  'root_cause_analysis',
  'evidence_extraction',
  'solution_generation',
  'patch_generation',
];

export interface StageAssignment {
  task: AnalysisTask;
  provider: ProviderName;
  model: string;
  isFree: boolean;
}

export interface StrategyMode {
  name: 'free' | 'free_paid' | 'fully_paid' | 'custom' | 'auto';
  build: (availableProviders: Set<ProviderName>, stageOverrides?: Record<AnalysisTask, { provider: ProviderName; model: string }>) => StageAssignment[];
}

export const STRATEGY_MODES: StrategyMode[] = [
  {
    name: 'free',
    build: (availableProviders, stageOverrides) => {
      const assignments: StageAssignment[] = [];

      for (const task of AI_STAGES) {
        const taskType = TASK_TYPE_MAP[task];
        if (!taskType) continue;

        const freeModels = MODEL_REGISTRY.filter((m) => {
          return m.free && availableProviders.has(m.provider);
        });

        if (freeModels.length === 0) {
          // STRICT FREE: no confirmed-free model on any connected provider —
          // skip the stage instead of falling back to a paid model. The
          // runtime error-fallback chain (autoChain in runWithFallback) is
          // unaffected; this only removes the paid model as the strategy pick.
          continue;
        }

        const best = pickBestForTask(freeModels, TASK_WEIGHTS[taskType]);
        if (best) {
          assignments.push({
            task,
            provider: best.provider as ProviderName,
            model: best.model as string,
            isFree: true,
          });
        } else {
          continue;
        }
      }

      return applyStageOverrides(assignments, stageOverrides);
    },
  },
  {
    name: 'free_paid',
    build: (availableProviders, stageOverrides) => {
      const assignments: StageAssignment[] = [];

      // Define which stages use FREE models
      const freeStages = new Set<AnalysisTask>([
        'relevant_file_discovery',
        'evidence_extraction',
      ]);

      for (const task of AI_STAGES) {
        const taskType = TASK_TYPE_MAP[task];
        if (!taskType) continue;

        let models: typeof MODEL_REGISTRY;
        const isFreeStage = freeStages.has(task);

        if (isFreeStage) {
          // FREE models for discovery and evidence stages
          models = MODEL_REGISTRY.filter((m) => {
            return m.free && availableProviders.has(m.provider);
          });
        } else {
          // PAID models for analysis and generation stages
          models = MODEL_REGISTRY.filter((m) => {
            return !m.free && availableProviders.has(m.provider);
          });
        }

        if (models.length === 0) {
          // Fallback: use any available model
          const allAvailable = MODEL_REGISTRY.filter(
            (m) => availableProviders.has(m.provider)
          );
          if (allAvailable.length === 0) {
            continue;
          }
          const best = pickBestForTask(allAvailable, TASK_WEIGHTS[taskType]);
          assignments.push({
            task,
            provider: best?.provider as ProviderName,
            model: best?.model as string,
            isFree: false,
          });
          continue;
        }

        const best = pickBestForTask(models, TASK_WEIGHTS[taskType]);
        if (best) {
          assignments.push({
            task,
            provider: best.provider as ProviderName,
            model: best.model as string,
            isFree: isFreeStage,
          });
        } else {
          continue;
        }
      }

      return applyStageOverrides(assignments, stageOverrides);
    },
  },
  {
    name: 'fully_paid',
    build: (availableProviders, stageOverrides) => {
      const assignments: StageAssignment[] = [];

      for (const task of AI_STAGES) {
        const taskType = TASK_TYPE_MAP[task];
        if (!taskType) continue;

        const paidModels = MODEL_REGISTRY.filter((m) => {
          return !m.free && availableProviders.has(m.provider);
        });

        if (paidModels.length === 0) {
          // Fallback: use any available model
          const allAvailable = MODEL_REGISTRY.filter(
            (m) => availableProviders.has(m.provider)
          );
          if (allAvailable.length === 0) {
            continue;
          }
          const best = pickBestForTask(allAvailable, TASK_WEIGHTS[taskType]);
          assignments.push({
            task,
            provider: best?.provider as ProviderName,
            model: best?.model as string,
            isFree: false,
          });
          continue;
        }

        const best = pickBestForTask(paidModels, TASK_WEIGHTS[taskType]);
        if (best) {
          assignments.push({
            task,
            provider: best.provider as ProviderName,
            model: best.model as string,
            isFree: false,
          });
        } else {
          continue;
        }
      }

      return applyStageOverrides(assignments, stageOverrides);
    },
  },
  {
    name: 'custom',
    build: (availableProviders, stageOverrides) => {
      // Start with the "auto" strategy (per-stage optimal) as the base
      const baseAssignments = buildAutoAssignments(availableProviders);

      // Apply stage overrides on top
      const merged: StageAssignment[] = [];

      for (const task of AI_STAGES) {
        if (stageOverrides && stageOverrides[task]) {
          const { provider, model } = stageOverrides[task];
          const isFree = MODEL_REGISTRY.find(
            (m) => m.provider === provider && m.model === model
          )?.free ?? false;
          merged.push({
            task,
            provider,
            model,
            isFree,
          });
        } else {
          const base = baseAssignments.find((a) => a.task === task);
          if (base) {
            merged.push(base);
          } else {
            // Fallback for stages not in base
            const allAvailable = MODEL_REGISTRY.filter(
              (m) => availableProviders.has(m.provider)
            );
            if (allAvailable.length > 0) {
              const taskType = TASK_TYPE_MAP[task];
              if (taskType) {
                const best = pickBestForTask(allAvailable, TASK_WEIGHTS[taskType]);
                if (best) {
                  merged.push({
                    task,
                    provider: best.provider as ProviderName,
                    model: best.model as string,
                    isFree: best.free,
                  });
                }
              }
            }
          }
        }
      }

      return merged;
    },
  },
  {
    name: 'auto',
    build: (availableProviders, stageOverrides) => {
      // Auto strategy: per-stage optimal selection (mix of providers/models)
      const baseAssignments = buildAutoAssignments(availableProviders);

      // Apply stage overrides on top
      const merged: StageAssignment[] = [];

      for (const task of AI_STAGES) {
        if (stageOverrides && stageOverrides[task]) {
          const { provider, model } = stageOverrides[task];
          merged.push({
            task,
            provider,
            model,
            isFree: false, // auto mode doesn't track free status on overrides
          });
        } else {
          const base = baseAssignments.find((a) => a.task === task);
          if (base) {
            merged.push(base);
          } else {
            // Fallback for stages not in base
            const allAvailable = MODEL_REGISTRY.filter(
              (m) => availableProviders.has(m.provider)
            );
            if (allAvailable.length > 0) {
              const taskType = TASK_TYPE_MAP[task];
              if (taskType) {
                const best = pickBestForTask(allAvailable, TASK_WEIGHTS[taskType]);
                if (best) {
                  merged.push({
                    task,
                    provider: best.provider as ProviderName,
                    model: best.model as string,
                    isFree: best.free,
                  });
                }
              }
            }
          }
        }
      }

      return merged;
    },
  },
];

/**
 * Applies persisted per-stage overrides (user_model_preferences.stage_overrides)
 * on top of built assignments. An override with a valid provider+model replaces
 * the assignment; `isFree` is re-derived from the registry (unknown entry →
 * false, conservative). Used by every mode so the engine's stage list always
 * reflects what the user actually configured on /models.
 */
function applyStageOverrides(
  assignments: StageAssignment[],
  stageOverrides?: Record<AnalysisTask, { provider: ProviderName; model: string }>
): StageAssignment[] {
  if (!stageOverrides) return assignments;
  return assignments.map((assignment) => {
    const override = stageOverrides[assignment.task];
    if (!override?.provider || !override?.model) return assignment;
    const isFree = MODEL_REGISTRY.find(
      (m) => m.provider === override.provider && m.model === override.model
    )?.free ?? false;
    return { ...assignment, provider: override.provider, model: override.model, isFree };
  });
}

type LocalTaskWeights = {
  coding: number;
  reasoning: number;
  speed: number;
  longContext: number;
};

function pickBestForTask(
  models: typeof MODEL_REGISTRY,
  weights: LocalTaskWeights
): typeof MODEL_REGISTRY[number] | undefined {
  const norm = weights.coding + weights.reasoning + weights.speed + weights.longContext;
  const scored = models.map((m) => ({
    entry: m,
    score:
      (m.codingScore * weights.coding +
        m.reasoningScore * weights.reasoning +
        m.speedScore * weights.speed +
        m.longContextScore * weights.longContext) /
      norm,
  }));
  scored.sort((a, b) => {
    const d = b.score - a.score;
    if (d !== 0) return d;
    // Deterministic tie-break so equal-scored models never depend on registry
    // iteration order: stable provider/model ID comparison.
    return `${a.entry.provider}/${a.entry.model}`.localeCompare(`${b.entry.provider}/${b.entry.model}`);
  });
  return scored[0]?.entry || undefined;
}

function buildAutoAssignments(availableProviders: Set<ProviderName>): StageAssignment[] {
  // Auto strategy: per-stage optimal selection (mix of providers/models)
  const assignments: StageAssignment[] = [];

  for (const task of AI_STAGES) {
    const taskType = TASK_TYPE_MAP[task];
    if (!taskType) continue;

    const available = MODEL_REGISTRY.filter(
      (m) => availableProviders.has(m.provider)
    );

    if (available.length === 0) {
      continue;
    }

    const best = pickBestForTask(available, TASK_WEIGHTS[taskType]);
    if (best) {
      assignments.push({
        task,
        provider: best.provider as ProviderName,
        model: best.model as string,
        isFree: best.free,
      });
    } else {
      continue;
    }
  }

  return assignments;
}

// Public API: build assignments for a given strategy mode
export function buildStageAssignments(
  strategyMode: 'auto' | 'free' | 'free_paid' | 'fully_paid' | 'custom',
  availableProviders: Set<ProviderName>,
  stageOverrides?: Record<AnalysisTask, { provider: ProviderName; model: string }>
): StageAssignment[] {
  const mode = STRATEGY_MODES.find((s) => s.name === strategyMode);
  if (!mode) {
    throw new Error(`Unknown strategy mode: ${strategyMode}`);
  }
  return mode.build(availableProviders, stageOverrides);
}
