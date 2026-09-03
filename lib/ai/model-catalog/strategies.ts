// Strategy builder — constructs analysis strategies from the shared catalog.
// Used by both Models page and Analysis preflight.

import type { ProviderName, RankedModel, ModelStrategy, StrategyTier, ModelCatalog } from './types';
import type { AnalysisTask } from '../config';

const AI_STAGES: AnalysisTask[] = [
  'relevant_file_discovery',
  'root_cause_analysis',
  'evidence_extraction',
  'solution_generation',
  'patch_generation',
];

const STAGE_LABELS: Record<AnalysisTask, string> = {
  relevant_file_discovery: 'File Discovery',
  root_cause_analysis: 'Root Cause Analysis',
  evidence_extraction: 'Evidence Extraction',
  solution_generation: 'Solution Generation',
  patch_generation: 'Patch Generation',
};

const STAGE_WEIGHTS: Record<AnalysisTask, { coding: number; reasoning: number; speed: number; longContext: number }> = {
  relevant_file_discovery: { coding: 3, reasoning: 1, speed: 3, longContext: 1 },
  root_cause_analysis: { coding: 2, reasoning: 3, speed: 1, longContext: 2 },
  evidence_extraction: { coding: 2, reasoning: 1, speed: 3, longContext: 1 },
  solution_generation: { coding: 3, reasoning: 2, speed: 1, longContext: 2 },
  patch_generation: { coding: 3, reasoning: 2, speed: 1, longContext: 2 },
};

function pickForStage(
  models: RankedModel[],
  weights: { coding: number; reasoning: number; speed: number; longContext: number },
  filter?: (m: RankedModel) => boolean
): RankedModel | null {
  const candidates = filter ? models.filter(filter) : models;
  if (candidates.length === 0) return null;

  const norm = weights.coding + weights.reasoning + weights.speed + weights.longContext;
  const scored = candidates.map((m) => ({
    model: m,
    score:
      (m.scores.coding * weights.coding +
        m.scores.reasoning * weights.reasoning +
        m.scores.speed * weights.speed +
        m.scores.longContext * weights.longContext) / norm,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0].model;
}

function strategyFromModel(
  tier: StrategyTier,
  model: RankedModel,
  reason: string,
  perStage?: ModelStrategy['perStage']
): ModelStrategy {
  return {
    tier,
    label:
      tier === 'free' ? 'Free / Lowest Cost'
      : tier === 'balanced' ? 'Balanced'
      : tier === 'fast' ? 'Fast / Powerful'
      : 'Auto (Recommended)',
    provider: model.providerId,
    model: model.modelId,
    isFree: model.price.isFree,
    costLevel: model.price.isFree ? 'free' : 'low',
    speed: model.scores.speed >= 4 ? 'fast' : model.scores.speed >= 2 ? 'moderate' : 'slow',
    reason,
    contextWindow: model.contextWindow,
    perStage,
  };
}

export function buildStrategies(catalog: ModelCatalog): ModelStrategy[] {
  const connected = catalog.models.filter((m) =>
    catalog.providers.some((p) => p.providerId === m.providerId && p.connected)
  );

  if (connected.length === 0) return [];

  const freeModels = connected.filter((m) => m.price.isFree);
  const paidModels = connected.filter((m) => !m.price.isFree);
  const strategies: ModelStrategy[] = [];

  // Free tier: best free model
  const bestFree = pickForStage(freeModels, { coding: 3, reasoning: 3, speed: 2, longContext: 2 });
  if (bestFree) {
    strategies.push(strategyFromModel(
      'free',
      bestFree,
      `Free model — zero cost. Best available: ${bestFree.displayName} from ${bestFree.providerId}.`
    ));
  }

  // Balanced: best value model (prefer free, then cheap paid)
  const balancedCandidates = [...freeModels, ...paidModels.filter((m) => m.price.input != null && m.price.input < 1)];
  const bestBalanced = pickForStage(
    balancedCandidates.length > 0 ? balancedCandidates : connected,
    { coding: 3, reasoning: 3, speed: 2, longContext: 2 }
  );
  if (bestBalanced) {
    const costLabel = bestBalanced.price.isFree ? 'free' : 'low cost';
    strategies.push(strategyFromModel(
      'balanced',
      bestBalanced,
      `Balanced — good quality at ${costLabel}. Strong across all analysis stages.`
    ));
  }

  // Fast: best speed model
  const bestFast = pickForStage(connected, { coding: 1, reasoning: 1, speed: 5, longContext: 1 });
  if (bestFast) {
    strategies.push(strategyFromModel(
      'fast',
      bestFast,
      `Fast / Powerful — best speed and responsiveness. ${bestFast.price.isFree ? 'Free' : 'May incur cost'}.`
    ));
  }

  // Auto: per-stage optimal selection (mix providers/models)
  const perStage = AI_STAGES.map((stage) => {
    const weights = STAGE_WEIGHTS[stage];
    const best = pickForStage(connected, weights);
    return {
      stage: STAGE_LABELS[stage],
      provider: best?.providerId ?? connected[0].providerId,
      model: best?.modelId ?? connected[0].modelId,
      reason: best
        ? `Best fit for ${STAGE_LABELS[stage]}: ${best.displayName}`
        : `Fallback for ${STAGE_LABELS[stage]}`,
    };
  });

  const autoBase = strategies.find((s) => s.tier === 'balanced') ?? strategies[0];
  if (autoBase) {
    strategies.push({
      ...autoBase,
      tier: 'auto',
      label: 'Auto (Recommended)',
      reason: 'Auto — selects the best model per stage based on task complexity, context needs, and provider availability.',
      perStage,
    });
  }

  return strategies;
}

export function getRecommendedStrategy(strategies: ModelStrategy[]): StrategyTier {
  if (strategies.some((s) => s.tier === 'auto')) return 'auto';
  if (strategies.some((s) => s.tier === 'balanced')) return 'balanced';
  return strategies[0]?.tier ?? 'auto';
}

export function getStageAssignments(
  strategy: ModelStrategy,
  catalog: ModelCatalog
): Array<{ stage: string; provider: ProviderName; model: string; reason: string }> {
  if (strategy.perStage) return strategy.perStage;

  // For non-auto strategies, use the same model for all stages
  return AI_STAGES.map((stage) => ({
    stage: STAGE_LABELS[stage],
    provider: strategy.provider,
    model: strategy.model,
    reason: `${strategy.label} strategy for ${STAGE_LABELS[stage]}`,
  }));
}
