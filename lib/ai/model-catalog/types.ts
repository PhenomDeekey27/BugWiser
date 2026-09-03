// Shared model catalog types — single source of truth for Models page + Analysis preflight.

import type { ProviderName } from '../catalog/types';

export type { ProviderName };

export interface CatalogModel {
  providerId: ProviderName;
  modelId: string;
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number | null;
  price: { input: number | null; output: number | null; isFree: boolean };
  supportsReasoning: boolean;
  supportsToolCalling: boolean;
  supportsStructuredOutput: boolean;
  capabilities: string[];
  scores: { coding: number; reasoning: number; speed: number; longContext: number };
  tags: string[];
  source: 'registry' | 'live';
}

export interface CatalogProvider {
  providerId: ProviderName;
  displayName: string;
  authType: 'api_key' | 'oauth' | 'none';
  connected: boolean;
  modelCount: number;
  hasFreeModels: boolean;
  hasPaidModels: boolean;
  description: string;
  docsUrl: string;
}

export type ModelCategory =
  | 'best-coding'
  | 'best-reasoning'
  | 'fast'
  | 'long-context'
  | 'best-value'
  | 'free'
  | 'paid'
  | 'all';

export interface RankedModel extends CatalogModel {
  overallFit: number;
  categoryFit: Record<ModelCategory, number>;
}

export interface ModelCatalog {
  providers: CatalogProvider[];
  models: RankedModel[];
  generatedAt: string;
  providerFingerprint: string;
}

export type StrategyTier = 'free' | 'balanced' | 'fast' | 'auto';

export interface ModelStrategy {
  tier: StrategyTier;
  label: string;
  provider: ProviderName;
  model: string;
  isFree: boolean;
  costLevel: 'free' | 'low' | 'medium' | 'high';
  speed: 'slow' | 'moderate' | 'fast';
  reason: string;
  contextWindow: number;
  perStage?: Array<{
    stage: string;
    provider: ProviderName;
    model: string;
    reason: string;
  }>;
}

export interface PreflightResult {
  strategies: ModelStrategy[];
  recommended: StrategyTier;
  availableProviders: ProviderName[];
  hasPaidProviders: boolean;
  hasFreeProviders: boolean;
}
