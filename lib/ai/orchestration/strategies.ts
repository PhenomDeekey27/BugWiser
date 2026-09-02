import { ProviderName } from '../providers/registry';
import { ModelStrategy, StrategyTier } from './types';
import { AnalysisTask, TASK_TYPE_MAP, TASK_WEIGHTS, TaskType } from '../config';
import { MODEL_REGISTRY, ModelEntry } from '../model-registry';
import { isProviderConfigured } from '../providers/registry';

const TASK_COMPLEXITY: Record<AnalysisTask, { label: string; needsStrongReasoning: boolean }> = {
  relevant_file_discovery: { label: 'File Discovery', needsStrongReasoning: false },
  root_cause_analysis: { label: 'Root Cause Analysis', needsStrongReasoning: true },
  evidence_extraction: { label: 'Evidence Extraction', needsStrongReasoning: false },
  solution_generation: { label: 'Solution Generation', needsStrongReasoning: true },
  patch_generation: { label: 'Patch Generation', needsStrongReasoning: true },
};

function getAvailableModels(availableProviders: Set<ProviderName>): ModelEntry[] {
  return MODEL_REGISTRY.filter((m) => {
    const providerReady = availableProviders.has(m.provider);
    return providerReady;
  });
}

function pickBestForTask(
  taskType: TaskType,
  available: ModelEntry[],
  filter?: (m: ModelEntry) => boolean
): ModelEntry | null {
  const weights = TASK_WEIGHTS[taskType];
  const filtered = filter ? available.filter(filter) : available;
  if (filtered.length === 0) return null;

  const norm = weights.coding + weights.reasoning + weights.speed + weights.longContext;
  const scored = filtered.map((m) => ({
    entry: m,
    score:
      (m.codingScore * weights.coding +
        m.reasoningScore * weights.reasoning +
        m.speedScore * weights.speed +
        m.longContextScore * weights.longContext) /
      norm,
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.entry ?? null;
}

function strategyFromModel(
  tier: StrategyTier,
  model: ModelEntry,
  reason: string
): ModelStrategy {
  return {
    tier,
    label:
      tier === 'free'
        ? 'Free / Lowest Cost'
        : tier === 'balanced'
          ? 'Balanced'
          : tier === 'fast'
            ? 'Fast / Powerful'
            : 'Auto (Recommended)',
    provider: model.provider,
    model: model.model,
    isFree: model.free,
    costLevel: model.free ? 'free' : 'medium',
    speed: model.speedScore >= 4 ? 'fast' : model.speedScore >= 2 ? 'moderate' : 'slow',
    reason,
    contextWindow: model.contextWindow,
  };
}

export function buildStrategies(availableProviders: Set<ProviderName>): ModelStrategy[] {
  const available = getAvailableModels(availableProviders);
  const strategies: ModelStrategy[] = [];

  // Free tier: pick the best free model across all task types
  const freeModels = available.filter((m) => m.free);
  const bestFree =
    pickBestForTask('complex_debugging', freeModels) ??
    pickBestForTask('code_generation', freeModels) ??
    freeModels[0];

  if (bestFree) {
    strategies.push(
      strategyFromModel(
        'free',
        bestFree,
        `Free model — zero cost. Best available: ${bestFree.model} from ${bestFree.provider}.`
      )
    );
  }

  // Balanced tier: best model considering cost + quality
  const balancedCandidates = available.filter(
    (m) => m.free || m.speedScore >= 3
  );
  const bestBalanced =
    pickBestForTask('complex_debugging', balancedCandidates) ??
    pickBestForTask('code_generation', available);

  if (bestBalanced) {
    const costLabel = bestBalanced.free ? 'free' : 'medium';
    strategies.push(
      strategyFromModel(
        'balanced',
        bestBalanced,
        `Balanced — good quality at ${costLabel} cost. Strong across all analysis stages.`
      )
    );
  }

  // Fast tier: strongest reasoning + coding model regardless of cost
  const bestFast =
    pickBestForTask('complex_debugging', available) ??
    pickBestForTask('code_generation', available);

  if (bestFast) {
    strategies.push(
      strategyFromModel(
        'fast',
        bestFast,
        `Fast / Powerful — best reasoning and code generation. ${bestFast.free ? 'Free' : 'May incur cost'}.`
      )
    );
  }

  // Auto tier: same as balanced by default, but the auto router will pick per-stage
  if (strategies.length > 0) {
    const autoBase = strategies.find((s) => s.tier === 'balanced') ?? strategies[0];
    strategies.push({
      ...autoBase,
      tier: 'auto',
      label: 'Auto (Recommended)',
      reason:
        'Auto — intelligently selects the best model per stage based on task complexity, context needs, and provider availability.',
    });
  }

  return strategies;
}

export function getRecommendedStrategy(strategies: ModelStrategy[]): StrategyTier {
  if (strategies.some((s) => s.tier === 'auto')) return 'auto';
  if (strategies.some((s) => s.tier === 'balanced')) return 'balanced';
  return strategies[0]?.tier ?? 'auto';
}

export function buildPerStageAssignments(
  strategy: StrategyTier,
  availableProviders: Set<ProviderName>
): Map<AnalysisTask, ModelStrategy> {
  const available = getAvailableModels(availableProviders);
  const assignments = new Map<AnalysisTask, ModelStrategy>();

  const tasks: AnalysisTask[] = [
    'relevant_file_discovery',
    'root_cause_analysis',
    'evidence_extraction',
    'solution_generation',
    'patch_generation',
  ];

  for (const task of tasks) {
    const taskType = TASK_TYPE_MAP[task];
    const complexity = TASK_COMPLEXITY[task];

    let model: ModelEntry | null = null;
    let reason = '';

    if (strategy === 'auto') {
      // Auto: pick the best model per stage based on task complexity
      if (complexity.needsStrongReasoning) {
        model = pickBestForTask(taskType, available, (m) => m.reasoningScore >= 3 || m.codingScore >= 4);
        reason = `${complexity.label} — needs strong reasoning/coding`;
      } else {
        // Simple tasks: prefer free/cheap models
        const cheapOrFree = available.filter((m) => m.free || m.speedScore >= 3);
        model = pickBestForTask(taskType, cheapOrFree) ?? pickBestForTask(taskType, available);
        reason = `${complexity.label} — cost-effective selection`;
      }
    } else if (strategy === 'free') {
      const freeModels = available.filter((m) => m.free);
      model = pickBestForTask(taskType, freeModels);
      reason = `Free model for ${complexity.label}`;
    } else if (strategy === 'balanced') {
      const balanced = available.filter((m) => m.free || m.speedScore >= 3);
      model = pickBestForTask(taskType, balanced) ?? pickBestForTask(taskType, available);
      reason = `Balanced quality/cost for ${complexity.label}`;
    } else {
      // fast: strongest model regardless of cost
      model = pickBestForTask(taskType, available);
      reason = `Best available for ${complexity.label}`;
    }

    if (!model) {
      // Fallback: pick any available model
      model = available[0] ?? null;
      reason = `Fallback model for ${complexity.label}`;
    }

    if (model) {
      assignments.set(task, strategyFromModel(strategy, model, reason));
    }
  }

  return assignments;
}
