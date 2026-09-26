// Shared ClassifiedModel (model-intelligence) → CatalogModel (models page /
// stageSelection) mapping. Single copy: /api/models and the strict-Free
// runtime path (gateway.generate) must see IDENTICAL model data so runtime
// candidate pools match what the /models page persisted.

import type { ClassifiedModel } from '@/lib/ai/model-intelligence';
import type { CatalogModel } from '@/app/models/page';

export function toCatalogModel(m: ClassifiedModel): CatalogModel {
  return {
    providerId: m.provider,
    modelId: m.modelId,
    displayName: m.displayName,
    contextWindow: m.contextWindow,
    maxOutputTokens: m.maxOutputTokens,
    price: { input: m.inputPrice, output: m.outputPrice, isFree: m.isFree },
    supportsReasoning: m.supportsReasoning,
    supportsToolCalling: m.supportsToolCalling,
    supportsStructuredOutput: m.supportsStructuredOutput,
    priceSource: m.priceSource,
    priceFetchedAt: m.priceFetchedAt,
    capabilities: [
      ...(m.supportsCoding ? ['coding'] : []),
      ...(m.supportsReasoning ? ['reasoning'] : []),
      ...(m.supportsVision ? ['vision'] : []),
      ...(m.supportsToolCalling ? ['tool_calling'] : []),
      ...(m.supportsStructuredOutput ? ['structured_output'] : []),
    ],
    availability: m.availability,
    scores: {
      coding: m.codingScore,
      reasoning: m.reasoningScore,
      speed: m.speedScore,
      longContext: m.longContextScore,
    },
    valueScore: m.valueScore,
    tags: m.recommendedCategories,
    fit: m.overallScore,
    stageFit: {} as Record<string, number>,
    available: true,
  };
}
