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

/** Where the normalized price numbers came from. Never 'live'/'registry' with null prices. */
export type PriceSource = 'live' | 'registry' | 'unknown';

/** Where the normalized context window came from. */
export type ContextSource = 'live' | 'registry' | 'default';

/**
 * Authority behind `isFree === true`. 'explicit-zero' = the live provider payload
 * carried explicit zero pricing; 'registry-confirmed' = an exact static-registry entry
 * explicitly marks the model free and the live payload had no pricing to contradict it.
 * 'none' otherwise. Free is NEVER inferred from model names.
 */
export type FreeAuthority = 'explicit-zero' | 'registry-confirmed' | 'none';

/**
 * Per-flag capability provenance. 'observed' = provider payload evidence;
 * 'curated' = exact static-registry entry; 'derived' = deterministic ID/family signal;
 * 'unknown' = no evidence (flag must be false — never a silent true default).
 */
export type CapabilityProvenance = 'observed' | 'curated' | 'derived' | 'unknown';

export interface CapabilityProvenanceMap {
  coding: CapabilityProvenance;
  reasoning: CapabilityProvenance;
  vision: CapabilityProvenance;
  toolCalling: CapabilityProvenance;
  structuredOutput: CapabilityProvenance;
}

/** Overall trust in a normalized entry. high = live price + live context + ≥3 observed caps. */
export type MetadataConfidence = 'high' | 'medium' | 'low';

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
  /**
   * Where the normalized price came from. Always set by normalizeProviderModel;
   * absent only on pre-normalization static rows (the catalog layer fills it).
   */
  priceSource?: PriceSource;
  /** Where the context window came from (absent on pre-normalization static rows). */
  contextSource?: ContextSource;
  /** Authority behind isFree (absent on pre-normalization static rows). */
  freeAuthority?: FreeAuthority;
  /** Per-flag capability provenance (absent on pre-normalization static rows). */
  capabilityProvenance?: CapabilityProvenanceMap;
  /** Overall metadata trust (absent on pre-normalization static rows). */
  metadataConfidence?: MetadataConfidence;
  /** Raw input/output modalities when the provider exposes them; undefined otherwise. */
  modalities?: { input: string[]; output: string[] };
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