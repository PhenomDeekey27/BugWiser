import { ProviderName } from './providers/registry';
import { MODEL_REGISTRY, ModelEntry, getModelById } from './model-registry';
import { isProviderConfigured } from './providers/registry';

export { getModelById };

export type AnalysisTask =
  | 'relevant_file_discovery'
  | 'root_cause_analysis'
  | 'evidence_extraction'
  | 'solution_generation'
  | 'patch_generation';

export interface TaskModelEntry {
  provider: ProviderName;
  model: string;
}

export interface AutomaticCandidate extends TaskModelEntry {
  contextWindow: number;
}

export type TaskType =
  | 'simple_coding'
  | 'complex_debugging'
  | 'large_repository_analysis'
  | 'code_generation'
  | 'evidence_extraction'
  | 'general';

const TASK_TYPE_MAP: Record<AnalysisTask, TaskType> = {
  relevant_file_discovery: 'simple_coding',
  root_cause_analysis: 'complex_debugging',
  evidence_extraction: 'evidence_extraction',
  solution_generation: 'code_generation',
  patch_generation: 'code_generation',
};

export { TASK_TYPE_MAP };

interface TaskWeights {
  coding: number;
  reasoning: number;
  speed: number;
  longContext: number;
}

const TASK_WEIGHTS: Record<TaskType, TaskWeights> = {
  simple_coding: { coding: 3, reasoning: 1, speed: 3, longContext: 1 },
  complex_debugging: { coding: 2, reasoning: 3, speed: 1, longContext: 2 },
  large_repository_analysis: { coding: 1, reasoning: 2, speed: 1, longContext: 3 },
  code_generation: { coding: 3, reasoning: 2, speed: 1, longContext: 2 },
  evidence_extraction: { coding: 2, reasoning: 2, speed: 3, longContext: 3 },
  general: { coding: 1, reasoning: 2, speed: 2, longContext: 1 },
};

export type { TaskWeights };
export { TASK_WEIGHTS };

function scoreModel(model: ModelEntry, weights: TaskWeights, requiredContext: number): number {
  if (model.contextWindow < requiredContext) return -1;

  const w = weights;
  const norm = w.coding + w.reasoning + w.speed + w.longContext;

  return (
    (model.codingScore * w.coding +
      model.reasoningScore * w.reasoning +
      model.speedScore * w.speed +
      model.longContextScore * w.longContext) /
    norm
  );
}

function getAvailableModels(
  requiredContext: number,
  availableProviders?: Set<ProviderName>
): ModelEntry[] {
  return MODEL_REGISTRY.filter((m) => {
    const providerReady = availableProviders
      ? availableProviders.has(m.provider)
      : isProviderConfigured(m.provider);
    return providerReady && m.contextWindow >= requiredContext;
  });
}

function rankModels(
  taskType: TaskType,
  requiredContext: number,
  excludeModels: Set<string> = new Set(),
  availableProviders?: Set<ProviderName>,
  confirmedFreeIds?: Set<string>
): Array<{ entry: ModelEntry; score: number }> {
  const weights = TASK_WEIGHTS[taskType];
  const available = getAvailableModels(requiredContext, availableProviders);

  const scored = available
    .filter((m) => !excludeModels.has(m.id))
    .map((m) => ({
      entry: m,
      score: scoreModel(m, weights, requiredContext),
      // Canonical free status: `provider/model` keys derived by the gateway
      // from the catalog's price.isFree. No set ⇒ nothing gets the free-first
      // preference — MODEL_REGISTRY.free is never consulted here.
      free: confirmedFreeIds?.has(`${m.provider}/${m.model}`) ?? false,
    }))
    .filter((m) => m.score >= 0)
    .sort((a, b) => {
      if (a.free !== b.free) return a.free ? -1 : 1;
      return b.score - a.score;
    });

  return scored;
}

// BENCHMARK MODE: Override all task models for benchmarking
const BENCHMARK_MODELS: Record<string, TaskModelEntry[]> = {
  simple_coding: [{ provider: 'openrouter', model: 'deepseek/deepseek-v4-flash-0731' }],
  evidence_extraction: [{ provider: 'openrouter', model: 'deepseek/deepseek-v4-flash-0731' }],
  fast_generation: [{ provider: 'openrouter', model: 'deepseek/deepseek-v4-flash-0731' }],
  complex_debugging: [{ provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' }],
  code_generation: [{ provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' }],
  large_repository_analysis: [{ provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' }],
  general: [{ provider: 'openrouter', model: 'deepseek/deepseek-v4-pro' }],
};

export function selectModelsForTask(
  task: string,
  estimatedTokens: number = 0,
  excludeModels: Set<string> = new Set(),
  availableProviders?: Set<ProviderName>,
  confirmedFreeIds?: Set<string>,
  automaticCandidates?: AutomaticCandidate[]
): TaskModelEntry[] {
  // BENCHMARK MODE: Use DeepSeek models if BENCHMARK_DEEPSEEK=true
  if (process.env.BENCHMARK_DEEPSEEK === 'true') {
    const taskType = TASK_TYPE_MAP[task as AnalysisTask] || 'general';
    const benchmarkModels = BENCHMARK_MODELS[taskType] || BENCHMARK_MODELS.general;
    const filtered = benchmarkModels.filter(
      (m) => !excludeModels.has(`${m.provider}/${m.model}`)
    );
    if (filtered.length > 0) {
      console.log(`[benchmark] Using DeepSeek for ${task} (${taskType}): ${filtered.map(m => m.model).join(', ')}`);
      return filtered;
    }
  }

  if (automaticCandidates && automaticCandidates.length > 0) {
    const requiredContext = Math.max(estimatedTokens * 2, 32_000);
    const eligible = automaticCandidates.filter(
      (c) =>
        (availableProviders ? availableProviders.has(c.provider) : isProviderConfigured(c.provider)) &&
        c.contextWindow >= requiredContext &&
        !excludeModels.has(`${c.provider}/${c.model}`)
    );
    const freeIds = confirmedFreeIds ?? new Set<string>();
    const freeFirst = [
      ...eligible.filter((c) => freeIds.has(`${c.provider}/${c.model}`)),
      ...eligible.filter((c) => !freeIds.has(`${c.provider}/${c.model}`)),
    ];
    if (freeFirst.length > 0) {
      return freeFirst.map((c) => ({ provider: c.provider, model: c.model }));
    }
  }

  // Default: use ranked models
  const taskType = TASK_TYPE_MAP[task as AnalysisTask] || 'general';
  const requiredContext = Math.max(estimatedTokens * 2, 32_000);
  const ranked = rankModels(taskType, requiredContext, excludeModels, availableProviders, confirmedFreeIds);

  if (ranked.length === 0) {
    console.warn(`[config] No models available for task ${task} (context: ${requiredContext}), falling back to all configured models`);
    const allAvailable = MODEL_REGISTRY.filter((m) => {
      const providerReady = availableProviders
        ? availableProviders.has(m.provider)
        : isProviderConfigured(m.provider);
      return providerReady && !excludeModels.has(m.id);
    });
    return allAvailable.map((m) => ({ provider: m.provider, model: m.model }));
  }

  return ranked.map((r) => ({ provider: r.entry.provider, model: r.entry.model }));
}

export function getTestFailProvider(): string | null {
  return process.env.AI_TEST_FAIL_PROVIDER || null;
}
