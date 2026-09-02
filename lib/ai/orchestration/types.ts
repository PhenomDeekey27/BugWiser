import { ProviderName } from '../providers/registry';

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
}

export interface PreflightResult {
  strategies: ModelStrategy[];
  recommended: StrategyTier;
  availableProviders: ProviderName[];
  hasPaidProviders: boolean;
  hasFreeProviders: boolean;
}

export interface StageModelAssignment {
  task: string;
  strategy: ModelStrategy;
  fallbackStrategy: ModelStrategy;
}

export interface AnalysisRoutingPlan {
  strategy: StrategyTier;
  assignments: StageModelAssignment[];
}
