// Shared model catalog — single source of truth for Models page + Analysis preflight.
//
// Flow:
//   Connected providers change
//   → build catalog from connected providers only
//   → rank + categorize all models
//   → cache results
//   → Models page reads cached catalog
//   → Analysis page reads SAME cached catalog

export { getCatalog, invalidateCatalog, getCatalogCacheStats } from './cache';
export { buildCatalog } from './builder';
export { rankModels, rankModel, filterByCategory, pickBestForStage } from './ranking';
export { buildStrategies, getRecommendedStrategy, getStageAssignments } from './strategies';
export type {
  CatalogModel,
  CatalogProvider,
  ModelCatalog,
  RankedModel,
  ModelCategory,
  ModelStrategy,
  StrategyTier,
  PreflightResult,
} from './types';
