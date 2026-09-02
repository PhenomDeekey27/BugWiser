// Normalized AI provider & model catalog types.
// UI never depends directly on provider-specific response shapes.

export type ProviderName =
  | 'chutes'
  | 'openrouter'
  | 'opencode'
  | 'openai'
  | 'gemini'
  | 'deepseek'
  | 'zai';

export type ProviderAuthType = 'api_key' | 'oauth' | 'none';

export type ProviderStatus = 'disconnected' | 'connected' | 'error';

export interface ProviderDefinition {
  providerId: ProviderName;
  displayName: string;
  /** Official auth mechanism. Do not assume every provider supports OAuth. */
  authType: ProviderAuthType;
  /** Set when credentials were established server-side and validated. */
  status: ProviderStatus;
  /** Set when the provider was successfully connected. */
  connectedAt: string | null;
  /** Env var that acts as a fallback credential source (BYOK vs server env). */
  envVar?: string;
  /** True when the app can derive an API key purely from server env config. */
  serverConfigured: boolean;
  /** Short marketing description. */
  description: string;
  /** Official catalog/documentation URL. */
  docsUrl: string;
  /** Whether the provider exposes a model catalog API. */
  exposesCatalogApi: boolean;
}

export type ProviderConnection = ProviderDefinition;

export type ModelAvailability = 'available' | 'unavailable' | 'unknown';

export type ModelCapability =
  | 'coding'
  | 'reasoning'
  | 'fast'
  | 'long_context'
  | 'tool_calling'
  | 'structured_output'
  | 'vision';

export interface ModelPrice {
  /** USD per 1M input tokens. Null if unknown. */
  input: number | null;
  /** USD per 1M output tokens. Null if unknown. */
  output: number | null;
  /** True only when the provider confirms free access (zero cost). */
  isFree: boolean;
}

export interface ModelDefinition {
  providerId: ProviderName;
  /** Provider-scoped model identifier, e.g. `deepseek-ai/DeepSeek-V4-Flash-0731-TEE`. */
  modelId: string;
  /** Human friendly display name. */
  displayName: string;
  contextWindow: number;
  maxOutputTokens: number | null;
  price: ModelPrice;
  supportsReasoning: boolean;
  supportsToolCalling: boolean;
  supportsStructuredOutput: boolean;
  capabilities: ModelCapability[];
  availability: ModelAvailability;
  /** 0–5 relative capability scores, aligned with the existing task-weight system. */
  scores: {
    coding: number;
    reasoning: number;
    speed: number;
    longContext: number;
  };
  tags: string[];
  /** Source of this catalog entry. */
  source: 'registry' | 'live';
}

export interface ModelCatalog {
  providers: ProviderDefinition[];
  models: ModelDefinition[];
}

export interface StageAssignment {
  provider: ProviderName;
  model: string;
  /** BugWiser Fit (0–100) for this stage. */
  fit: number;
  reason?: string;
}

export type AnalysisStageKey =
  | 'relevant_file_discovery'
  | 'root_cause_analysis'
  | 'evidence_extraction'
  | 'solution_generation'
  | 'patch_generation';