// Model ranking and categorization — deterministic scoring, no AI calls.

import type { CatalogModel, RankedModel, ModelCategory } from './types';

const CATEGORY_WEIGHTS: Record<ModelCategory, { coding: number; reasoning: number; speed: number; longContext: number } | null> = {
  'best-coding': { coding: 5, reasoning: 2, speed: 1, longContext: 1 },
  'best-reasoning': { coding: 2, reasoning: 5, speed: 1, longContext: 2 },
  'fast': { coding: 1, reasoning: 1, speed: 5, longContext: 1 },
  'long-context': { coding: 1, reasoning: 1, speed: 1, longContext: 5 },
  'best-value': { coding: 2, reasoning: 2, speed: 2, longContext: 2 },
  'free': null,
  'paid': null,
  'all': null,
};

function contextScore(ctx: number): number {
  if (ctx >= 1_000_000) return 5;
  if (ctx >= 200_000) return 4.5;
  if (ctx >= 100_000) return 4;
  if (ctx >= 48_000) return 3;
  if (ctx >= 24_000) return 2;
  return 1;
}

function costScore(input: number | null, output: number | null, isFree: boolean): number {
  if (isFree) return 5;
  if (input == null || output == null) return 2.5;
  const combined = input * 2 + output;
  if (combined <= 0.5) return 5;
  if (combined <= 1.5) return 4;
  if (combined <= 3) return 3;
  if (combined <= 6) return 2;
  return 1;
}

function weightedScore(
  model: CatalogModel,
  weights: { coding: number; reasoning: number; speed: number; longContext: number }
): number {
  const norm = weights.coding + weights.reasoning + weights.speed + weights.longContext;
  const taskScore =
    (model.scores.coding / 5) * weights.coding +
    (model.scores.reasoning / 5) * weights.reasoning +
    (model.scores.speed / 5) * weights.speed +
    (contextScore(model.contextWindow) / 5) * weights.longContext;
  const cost = costScore(model.price.input, model.price.output, model.price.isFree);
  const capBonus = (model.supportsStructuredOutput ? 2 : 0) + (model.supportsToolCalling ? 1.5 : 0);
  return (taskScore * 0.7 + cost * 0.2 + (capBonus / 10) * 0.1) * 100;
}

function valueScore(model: CatalogModel): number {
  const coding = model.scores.coding;
  const reasoning = model.scores.reasoning;
  const quality = (coding + reasoning) / 2;
  const cost = costScore(model.price.input, model.price.output, model.price.isFree);
  return quality * 10 + cost * 10;
}

export function rankModel(model: CatalogModel): RankedModel {
  const categoryFit: Record<ModelCategory, number> = {
    'best-coding': 0,
    'best-reasoning': 0,
    'fast': 0,
    'long-context': 0,
    'best-value': 0,
    'free': model.price.isFree ? 100 : 0,
    'paid': model.price.isFree ? 0 : 100,
    'all': 0,
  };

  for (const [cat, weights] of Object.entries(CATEGORY_WEIGHTS)) {
    if (weights) {
      categoryFit[cat as ModelCategory] = Math.round(weightedScore(model, weights));
    }
  }
  categoryFit['best-value'] = Math.round(valueScore(model));
  categoryFit['all'] = Math.round(
    (categoryFit['best-coding'] + categoryFit['best-reasoning'] + categoryFit['fast'] + categoryFit['long-context']) / 4
  );

  const overallFit = Math.round(
    categoryFit['best-coding'] * 0.3 +
    categoryFit['best-reasoning'] * 0.25 +
    categoryFit['fast'] * 0.15 +
    categoryFit['long-context'] * 0.15 +
    categoryFit['best-value'] * 0.15
  );

  return { ...model, overallFit, categoryFit };
}

export function rankModels(models: CatalogModel[]): RankedModel[] {
  return models.map(rankModel).sort((a, b) => b.overallFit - a.overallFit);
}

export function filterByCategory(models: RankedModel[], category: ModelCategory): RankedModel[] {
  if (category === 'all') return models;
  if (category === 'free') return models.filter((m) => m.price.isFree);
  if (category === 'paid') return models.filter((m) => !m.price.isFree);
  return models
    .filter((m) => m.categoryFit[category] > 0)
    .sort((a, b) => b.categoryFit[category] - a.categoryFit[category]);
}

export function pickBestForStage(
  models: RankedModel[],
  stageWeights: { coding: number; reasoning: number; speed: number; longContext: number }
): RankedModel | null {
  if (models.length === 0) return null;
  const scored = models.map((m) => ({
    model: m,
    score: weightedScore(m, stageWeights),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0].model;
}
