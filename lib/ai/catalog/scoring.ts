import { ModelDefinition, AnalysisStageKey } from './types';
import { TASK_WEIGHTS } from '../config';

// BugWiser Fit — a BugWiser-specific suitability score (0–100). This is a
// recommendation derived from the existing task-weight system, NOT an external
// benchmark.

const STAGE_TO_TASK: Record<AnalysisStageKey, keyof typeof TASK_WEIGHTS> = {
  relevant_file_discovery: 'simple_coding',
  root_cause_analysis: 'complex_debugging',
  evidence_extraction: 'evidence_extraction',
  solution_generation: 'code_generation',
  patch_generation: 'code_generation',
};

interface FitInput {
  coding: number;      // 0–5
  reasoning: number;   // 0–5
  speed: number;       // 0–5
  longContext: number; // 0–5
  contextWindow: number;
  inputPrice: number | null;   // USD / 1M input
  outputPrice: number | null;  // USD / 1M output
  isFree: boolean;
  supportsToolCalling: boolean;
  supportsStructuredOutput: boolean;
}

const STRUCTURED_BONUS = 4;
const TOOL_BONUS = 3;

function costEfficiency(priceInput: number | null, priceOutput: number | null, isFree: boolean): number {
  if (isFree) return 5;
  if (priceInput == null || priceOutput == null) return 2.5;
  // Combine normalized input/output pricing (USD per 1M). Cheaper is better.
  const combined = priceInput * 2 + priceOutput;
  if (combined <= 0.5) return 5;
  if (combined <= 1.5) return 4;
  if (combined <= 3) return 3;
  if (combined <= 6) return 2;
  return 1;
}

function contextScoreModel(contextWindow: number): number {
  if (contextWindow >= 1_000_000) return 5;
  if (contextWindow >= 200_000) return 4.5;
  if (contextWindow >= 100_000) return 4;
  if (contextWindow >= 48_000) return 3;
  if (contextWindow >= 24_000) return 2;
  return 1;
}

// score =
//   coding*wC + reasoning*wR + speed*wS + context*wL
//   + costScore + capabilityBonus
// normalized to 0–100.
export function computeFit(model: ModelDefinition, weights: { coding: number; reasoning: number; speed: number; longContext: number }): number {
  const input: FitInput = {
    coding: model.scores.coding,
    reasoning: model.scores.reasoning,
    speed: model.scores.speed,
    longContext: model.scores.longContext,
    contextWindow: model.contextWindow,
    inputPrice: model.price.input,
    outputPrice: model.price.output,
    isFree: model.price.isFree,
    supportsToolCalling: model.supportsToolCalling,
    supportsStructuredOutput: model.supportsStructuredOutput,
  };
  return normalizeFit(scoreModel(input, weights));
}

function scoreModel(input: FitInput, weights: { coding: number; reasoning: number; speed: number; longContext: number }): number {
  const netk = 0.8; // capability terms scaled lower than primary weights
  const capScale = 2.0;

  const capabilityBonus =
    (input.supportsStructuredOutput ? STRUCTURED_BONUS : 0) +
    (input.supportsToolCalling ? TOOL_BONUS : 0);

  const costScore = costEfficiency(input.inputPrice, input.outputPrice, input.isFree);

  const taskScore =
    (input.coding / 5) * weights.coding +
    (input.reasoning / 5) * weights.reasoning +
    (input.speed / 5) * weights.speed +
    (contextScoreModel(input.contextWindow) / 5) * weights.longContext;

  return (
    netk * taskScore +
    netk * costScore +
    capScale * (capabilityBonus / 10)
  );
}

function normalizeFit(raw: number): number {
  const maxPossible = 0.8 * (5 * 4) + 0.8 * 5 + 2.0 * ((6 + 4 + 3) / 10);
  const normalized = Math.round((raw / maxPossible) * 100);
  return Math.max(0, Math.min(100, normalized));
}

export function getStageWeights(stage: AnalysisStageKey) {
  return STAGE_TO_TASK[stage];
}

export function fitForStage(model: ModelDefinition, stage: AnalysisStageKey): number {
  const weights = TASK_WEIGHTS[getStageWeights(stage)];
  return computeFit(model, weights);
}

export function rankModelsForStage(
  models: ModelDefinition[],
  stage: AnalysisStageKey
): Array<{ model: ModelDefinition; fit: number }> {
  return models
    .map((model) => ({ model, fit: fitForStage(model, stage) }))
    .sort((a, b) => b.fit - a.fit);
}

// Adapted from the same task-type map used by the router, for cross-analysis
// default recommendations (used by the UI when no stage is focused).
export function getDefaultFitWeights() {
  // Represents the "Recommended for BugWiser" default workflow: strong coding,
  // strong reasoning, large context, tool calling, cost efficiency.
  return { coding: 3, reasoning: 3, speed: 2, longContext: 2 };
}

export function computeOverallFit(model: ModelDefinition): number {
  return computeFit(model, getDefaultFitWeights());
}