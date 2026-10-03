// Provider-specific model metadata normalizers — the SINGLE normalization boundary.
//
// Raw provider API payload
//     ↓ normalizeProviderModel(providerId, raw)  (this file)
//     ↓ ModelDefinition (normalized, provenance-labeled)
// existing catalog (discoverModels) → existing selection engine
//
// Rules (no exceptions):
//   - live authoritative field > exact-match registry fallback > unknown;
//   - a live null NEVER overwrites known static metadata (exact provider:modelId only);
//   - stale static entries never attach to unrelated models (exact match only);
//   - unknown stays unknown: capability flags without evidence are false AND marked
//     'unknown' — never silent-true defaults;
//   - free is NEVER inferred from model names ("-free", "(free)"); authority is
//     explicit-zero live pricing or an exact static entry with isFree === true.
// A normalizer returns null when the raw entry must not enter the catalog at all
// (non-text modality, past shutdown date).

import type {
  ProviderName,
  ModelDefinition,
  ModelCapability,
  PriceSource,
  ContextSource,
  FreeAuthority,
  CapabilityProvenance,
  CapabilityProvenanceMap,
  MetadataConfidence,
} from './types';
import { findStaticModel } from './registry';
import {
  codingFamilySignal,
  reasoningFamilySignal,
  inputModalityImage,
  outputModalityIsText,
} from './modelSignals';

// ── Shared pricing-unit helpers (moved here from live.ts: single conversion point) ──

// Internal normalized unit everywhere is USD PER 1M TOKENS. Only OpenRouter reports
// per-token prices (→ multiply); every other priced provider reports per-1M natively.
export const PER_TOKEN_TO_PER_MILLION = 1_000_000;

export function toPerMillion(usdPerToken: number | null): number | null {
  if (usdPerToken == null || !Number.isFinite(usdPerToken)) return null;
  return usdPerToken * PER_TOKEN_TO_PER_MILLION;
}

/**
 * Coerces a provider price value (string or number) into a finite number, or null.
 * Negative values (e.g. OpenRouter pseudo-model variable-pricing sentinels) are NOT
 * valid prices → null (unknown), keeping garbage out of DECIMAL price columns and
 * keeping "not a fixed price" distinct from free/paid.
 */
export function toPriceNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Free ⇔ pricing data EXISTS and both sides are exactly 0. Null/missing ⇒ never free. */
export function isExplicitlyFree(input: number | null, output: number | null, known: boolean): boolean {
  return known && input != null && output != null && input === 0 && output === 0;
}

// ── Shared assembly helpers ──

const UNKNOWN_PROVENANCE: CapabilityProvenanceMap = {
  coding: 'unknown',
  reasoning: 'unknown',
  vision: 'unknown',
  toolCalling: 'unknown',
  structuredOutput: 'unknown',
};

function buildCapabilities(flags: {
  coding: boolean;
  reasoning: boolean;
  vision: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
}): ModelCapability[] {
  const caps: ModelCapability[] = [];
  if (flags.coding) caps.push('coding');
  if (flags.reasoning) caps.push('reasoning');
  if (flags.vision) caps.push('vision');
  if (flags.toolCalling) caps.push('tool_calling');
  if (flags.structuredOutput) caps.push('structured_output');
  return caps;
}

function countObservedOrCurated(prov: CapabilityProvenanceMap): number {
  return (Object.values(prov) as CapabilityProvenance[]).filter((p) => p === 'observed' || p === 'curated').length;
}

/** high = live price + live context + ≥3 observed/curated caps; low = nothing known. */
function confidenceOf(priceSource: PriceSource, contextSource: ContextSource, prov: CapabilityProvenanceMap): MetadataConfidence {
  if (priceSource === 'live' && contextSource === 'live' && countObservedOrCurated(prov) >= 3) return 'high';
  if (priceSource === 'unknown' && contextSource === 'default' && countObservedOrCurated(prov) === 0) return 'low';
  return 'medium';
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

/**
 * Applies the exact-match static fallback onto a draft. Live-present values are NEVER
 * touched; static fills ONLY absent pricing/context/capability evidence. Returns the
 * effective price triple + context + provenance actually used.
 */
function applyStaticFallback(
  providerId: ProviderName,
  modelId: string,
  draft: {
    inputPrice: number | null;
    outputPrice: number | null;
    isFree: boolean;
    priceSource: PriceSource;
    freeAuthority: FreeAuthority;
    contextWindow: number | null;
    contextSource: ContextSource | null;
    maxOutputTokens: number | null;
    flags: { coding: boolean; reasoning: boolean; vision: boolean; toolCalling: boolean; structuredOutput: boolean };
    provenance: CapabilityProvenanceMap;
    displayName: string;
  }
): void {
  const staticEntry = findStaticModel(providerId, modelId);
  if (!staticEntry) return;
  const liveHasPrice = draft.inputPrice != null || draft.outputPrice != null;
  if (!liveHasPrice) {
    // Static pricing fills the gap ONLY when it actually has numbers to give.
    // A null/null static price (e.g. zai/glm-4.7-flash) leaves pricing unknown —
    // stamping 'registry' on nulls was a past inconsistency (now forbidden).
    if (staticEntry.price.input != null || staticEntry.price.output != null) {
      draft.inputPrice = staticEntry.price.input;
      draft.outputPrice = staticEntry.price.output;
      draft.priceSource = 'registry';
    }
    // Explicit static free survives a priceless live payload (the OpenCode fix):
    // live null metadata must NOT overwrite authoritative static metadata.
    if (staticEntry.price.isFree) {
      draft.isFree = true;
      draft.freeAuthority = 'registry-confirmed';
      if (draft.priceSource === 'unknown' && draft.inputPrice == null && draft.outputPrice == null) {
        // Static says free but carries no numbers (shouldn't happen with current
        // rows, which pair isFree with 0/0) — keep source honest: still unknown
        // pricing, free by registry confirmation only.
      }
    }
  }
  if (draft.contextWindow == null) {
    draft.contextWindow = staticEntry.contextWindow;
    draft.contextSource = 'registry';
  }
  if (draft.maxOutputTokens == null) {
    draft.maxOutputTokens = staticEntry.maxOutputTokens;
  }
  // Curated capability evidence fills flags the provider did not speak about.
  // Only 'unknown'-provenance flags are eligible — observed/derived live evidence wins.
  const curated = (key: keyof CapabilityProvenanceMap, has: boolean) => {
    if (draft.provenance[key] === 'unknown' && has) {
      (draft.flags as Record<string, boolean>)[key] = true;
      draft.provenance[key] = 'curated';
    }
  };
  curated('coding', staticEntry.capabilities.includes('coding'));
  curated('reasoning', staticEntry.supportsReasoning);
  curated('vision', staticEntry.capabilities.includes('vision'));
  curated('toolCalling', staticEntry.supportsToolCalling);
  curated('structuredOutput', staticEntry.supportsStructuredOutput);
  // Exact-match static display names win (preserves existing catalog naming).
  draft.displayName = staticEntry.displayName;
}

function finalize(
  providerId: ProviderName,
  modelId: string,
  draft: {
    displayName: string;
    inputPrice: number | null;
    outputPrice: number | null;
    isFree: boolean;
    priceSource: PriceSource;
    freeAuthority: FreeAuthority;
    contextWindow: number | null;
    contextSource: ContextSource | null;
    maxOutputTokens: number | null;
    flags: { coding: boolean; reasoning: boolean; vision: boolean; toolCalling: boolean; structuredOutput: boolean };
    provenance: CapabilityProvenanceMap;
    modalities?: { input: string[]; output: string[] };
  }
): ModelDefinition {
  const staticEntry = findStaticModel(providerId, modelId);
  // applyStaticFallback already filled context from static when live lacked it, so
  // reaching here with null means no static row either → honest 128K default.
  const contextWindow = draft.contextWindow ?? 128_000;
  const contextSource: ContextSource = draft.contextSource ?? 'default';
  return {
    providerId,
    modelId,
    priceSource: draft.priceSource,
    displayName: draft.displayName || staticEntry?.displayName || modelId,
    contextWindow,
    maxOutputTokens: draft.maxOutputTokens ?? staticEntry?.maxOutputTokens ?? 8192,
    price: { input: draft.inputPrice, output: draft.outputPrice, isFree: draft.isFree },
    supportsReasoning: draft.flags.reasoning,
    supportsToolCalling: draft.flags.toolCalling,
    supportsStructuredOutput: draft.flags.structuredOutput,
    capabilities: buildCapabilities(draft.flags),
    availability: 'available',
    // 0–5 fallback scores match the static registry scale (selection normalizes elsewhere).
    scores: staticEntry?.scores ?? { coding: 3, reasoning: 3, speed: 3, longContext: 3 },
    tags: staticEntry?.tags ? [...new Set([...staticEntry.tags, 'live'])] : ['live'],
    source: 'live',
    contextSource,
    freeAuthority: draft.freeAuthority,
    capabilityProvenance: { ...draft.provenance },
    metadataConfidence: confidenceOf(draft.priceSource, contextSource, draft.provenance),
    ...(draft.modalities ? { modalities: draft.modalities } : {}),
  };
}

// ── OpenRouter ──
// Behavior preserved from the verified implementation: per-token string pricing,
// explicit "0"+"0" free, context_length + top_provider max output, observed
// supported_parameters/architecture, deterministic coding-family signal.

const OPENROUTER_NON_TEXT_FAMILY = /(^|[^a-z])(lyria|veo|imagen|chirp|sora|whisper|tts|embedding|moderation|content-safety|guard)([^a-z]|$)/;

export function normalizeOpenRouterModel(raw: Record<string, unknown>): ModelDefinition | null {
  const modelId = typeof raw.id === 'string' ? raw.id : '';
  if (!modelId) return null;
  const name = typeof raw.name === 'string' ? raw.name : '';
  // Non-text-generation family guard (provider's own naming for non-code models).
  if (OPENROUTER_NON_TEXT_FAMILY.test(modelId.toLowerCase()) || OPENROUTER_NON_TEXT_FAMILY.test(name.toLowerCase())) return null;
  const arch = raw.architecture as Record<string, unknown> | undefined;
  const mod = arch?.modality as string | undefined;
  // Output must include text; input side stays permissive (vision models are valid).
  if (!outputModalityIsText(arch?.output_modalities, mod) || !mod?.includes('text')) return null;

  const supportedParams = Array.isArray(raw.supported_parameters)
    ? (raw.supported_parameters as unknown[]).map((p) => String(p).toLowerCase())
    : [];
  const param = (n: string) => supportedParams.includes(n);
  const tools = param('tools') || param('tool_choice');
  const reasoning = param('reasoning') || param('include_reasoning') ||
    (raw.reasoning != null && typeof raw.reasoning === 'object');
  const structured = param('response_format') || param('structured_outputs');
  const coding = codingFamilySignal(modelId) >= 0.5;
  const vision = inputModalityImage(arch?.input_modalities, arch?.modality);

  const pricing = raw.pricing as Record<string, unknown> | undefined;
  const inputRaw = toPriceNumber(pricing?.prompt);
  const outputRaw = toPriceNumber(pricing?.completion);
  const hasPricingField = pricing != null && ('prompt' in pricing || 'completion' in pricing);
  // OpenRouter prices are USD PER TOKEN → normalize to USD per 1M.
  const inputPrice = toPerMillion(inputRaw);
  const outputPrice = toPerMillion(outputRaw);
  const isFree = isExplicitlyFree(inputRaw, outputRaw, hasPricingField);

  const topProvider = raw.top_provider as Record<string, unknown> | undefined;
  const draft = {
    displayName: name || modelId,
    inputPrice,
    outputPrice,
    isFree,
    priceSource: (hasPricingField ? 'live' : 'unknown') as PriceSource,
    freeAuthority: (isFree ? 'explicit-zero' : 'none') as FreeAuthority,
    contextWindow: typeof raw.context_length === 'number' ? raw.context_length : null,
    contextSource: (typeof raw.context_length === 'number' ? 'live' : null) as ContextSource | null,
    maxOutputTokens: typeof topProvider?.max_completion_tokens === 'number' ? topProvider.max_completion_tokens : null,
    flags: { coding, reasoning, vision, toolCalling: tools, structuredOutput: structured },
    provenance: {
      coding: 'derived',
      reasoning: 'observed',
      vision: 'observed',
      toolCalling: 'observed',
      structuredOutput: 'observed',
    } as CapabilityProvenanceMap,
    modalities: {
      input: strArray(arch?.input_modalities),
      output: strArray(arch?.output_modalities),
    },
  };
  applyStaticFallback('openrouter', modelId, draft);
  return finalize('openrouter', modelId, draft);
}

// ── Chutes ──
// Fixed field mapping (audit B2/B3/B4): pricing.prompt|completion are USD per 1M
// natively (NO conversion); fallback price.input.usd|price.output.usd; context_length
// is the deployment-effective context (≤ max_model_len arch max); max_output_length
// is the output limit; supported_features + modalities are observed capabilities.

export function normalizeChutesModel(raw: Record<string, unknown>): ModelDefinition | null {
  const modelId = typeof raw.id === 'string' ? raw.id : (typeof raw.model === 'string' ? raw.model : '');
  if (!modelId) return null;
  const pricing = raw.pricing as Record<string, unknown> | undefined;
  const price = raw.price as Record<string, unknown> | undefined;
  const priceInput = price?.input as Record<string, unknown> | undefined;
  const priceOutput = price?.output as Record<string, unknown> | undefined;
  // Primary: pricing.prompt|completion (USD per 1M, numeric). Fallback: price.*.usd.
  // NEVER pricing.input/output or price.*.value — those fields do not exist.
  const inVal = pricing?.prompt ?? priceInput?.usd;
  const outVal = pricing?.completion ?? priceOutput?.usd;
  const numInput = toPriceNumber(inVal);
  const numOutput = toPriceNumber(outVal);
  const hasPriceData =
    (pricing != null && ('prompt' in pricing || 'completion' in pricing)) ||
    priceInput?.usd != null || priceOutput?.usd != null;
  const isFree = isExplicitlyFree(numInput, numOutput, hasPriceData);

  const features = strArray(raw.supported_features).map((f) => f.toLowerCase());
  const feat = (...names: string[]) => names.some((n) => features.includes(n));
  const tools = feat('tools', 'tool_choice', 'tool-calling', 'tool_calling');
  const reasoning = feat('reasoning', 'thinking', 'reasoning_effort');
  const structured = feat('structured_outputs', 'structured-outputs', 'json_mode', 'response_format');
  const coding = codingFamilySignal(modelId) >= 0.5;
  const inMods = strArray(raw.input_modalities);
  const outMods = strArray(raw.output_modalities);
  const vision = inMods.some((m) => m.toLowerCase().includes('image'));

  const draft = {
    displayName: (typeof raw.name === 'string' && raw.name) || (typeof raw.display_name === 'string' && raw.display_name) || modelId,
    inputPrice: numInput,
    outputPrice: numOutput,
    isFree,
    priceSource: (hasPriceData ? 'live' : 'unknown') as PriceSource,
    freeAuthority: (isFree ? 'explicit-zero' : 'none') as FreeAuthority,
    contextWindow: typeof raw.context_length === 'number' ? raw.context_length : null,
    contextSource: (typeof raw.context_length === 'number' ? 'live' : null) as ContextSource | null,
    maxOutputTokens: typeof raw.max_output_length === 'number' ? raw.max_output_length : null,
    flags: { coding, reasoning, vision, toolCalling: tools, structuredOutput: structured },
    provenance: {
      coding: 'derived',
      reasoning: 'observed',
      vision: 'observed',
      toolCalling: 'observed',
      structuredOutput: 'observed',
    } as CapabilityProvenanceMap,
    modalities: { input: inMods, output: outMods },
  };
  applyStaticFallback('chutes', modelId, draft);
  return finalize('chutes', modelId, draft);
}

// ── OpenCode ──
// The payload carries ONLY id/object/created/owned_by — no pricing, context, or
// capability fields. Capability evidence therefore comes only from the shared
// deterministic ID signals, at the SAME thresholds the OpenRouter/Chutes/
// DeepSeek normalizers already use (coding ≥ 0.5; reasoning = the explicit
// tier only). Provenance stays 'unknown' unless a signal actually fires, so
// exact-match static curated capabilities still win via applyStaticFallback.
// Static exact-match entries (explicit free) fill pricing; free is never
// inferred from "-free"/"(free)" naming.

export function normalizeOpenCodeModel(raw: Record<string, unknown>): ModelDefinition | null {
  const modelId = typeof raw.id === 'string' ? raw.id : '';
  if (!modelId) return null;
  const coding = codingFamilySignal(modelId) >= 0.5;
  const reasoning = reasoningFamilySignal(modelId) >= 1;
  const draft = {
    displayName: (typeof raw.name === 'string' && raw.name) || (typeof raw.display_name === 'string' && raw.display_name) || modelId,
    inputPrice: null as number | null,
    outputPrice: null as number | null,
    isFree: false,
    priceSource: 'unknown' as PriceSource,
    freeAuthority: 'none' as FreeAuthority,
    contextWindow: null as number | null,
    contextSource: null as ContextSource | null,
    maxOutputTokens: typeof raw.max_output_tokens === 'number' ? raw.max_output_tokens : null,
    flags: { coding, reasoning, vision: false, toolCalling: false, structuredOutput: false },
    provenance: {
      ...UNKNOWN_PROVENANCE,
      coding: coding ? ('derived' as const) : ('unknown' as const),
      reasoning: reasoning ? ('derived' as const) : ('unknown' as const),
    },
  };
  // Exact-match static entries (e.g. nemotron-3-ultra-free isFree=true) fill pricing,
  // context, and curated caps. Non-matching IDs keep honest unknown/false.
  applyStaticFallback('opencode', modelId, draft);
  return finalize('opencode', modelId, draft);
}

// ── OpenAI ──
// /models exposes id/object/created/owned_by/shutdown_date only. owned_by is NOT a
// reliable provider filter (API now returns 'system' for production models), so the
// code-generation ID shape carries the filter instead. Past shutdown_date ⇒ excluded.
// The payload carries no capability fields, so capability evidence comes only from
// the shared deterministic ID signals at the SAME thresholds the OpenRouter/
// Chutes/DeepSeek normalizers use (coding ≥ 0.5; reasoning = the explicit tier
// only). Provenance stays 'unknown' unless a signal fires, so exact-match static
// curated capabilities still win via applyStaticFallback.

const OPENAI_CODE_ID = /(gpt|o1|o3|o4|chat)/i;
const OPENAI_OWNERS = new Set(['openai', 'system']);
// Functional-name guard: the endpoint exposes no modality fields, so image/audio
// generation and transcription endpoints are excluded by the provider's own
// functional naming (same evidence class as the OpenRouter/Gemini family guards).
const OPENAI_NON_TEXT_FUNCTION = /(image|transcribe|tts|realtime|whisper|dall-e|audio|video|sora)/i;

export function normalizeOpenAIModel(raw: Record<string, unknown>): ModelDefinition | null {
  const modelId = typeof raw.id === 'string' ? raw.id : '';
  if (!modelId) return null;
  const owned = typeof raw.owned_by === 'string' ? raw.owned_by : '';
  if (!OPENAI_OWNERS.has(owned)) return null;
  if (!OPENAI_CODE_ID.test(modelId)) return null;
  if (OPENAI_NON_TEXT_FUNCTION.test(modelId)) return null;
  // Sunset models must not enter the catalog: a shutdown date in the past means
  // the model is gone, regardless of what the listing still returns.
  if (typeof raw.shutdown_date === 'string' && raw.shutdown_date) {
    const t = Date.parse(raw.shutdown_date);
    if (Number.isFinite(t) && t < Date.now()) return null;
  }
  const coding = codingFamilySignal(modelId) >= 0.5;
  const reasoning = reasoningFamilySignal(modelId) >= 1;
  const draft = {
    displayName: modelId,
    inputPrice: null as number | null,
    outputPrice: null as number | null,
    isFree: false,
    priceSource: 'unknown' as PriceSource,
    freeAuthority: 'none' as FreeAuthority,
    contextWindow: null as number | null,
    contextSource: null as ContextSource | null,
    maxOutputTokens: null as number | null,
    flags: { coding, reasoning, vision: false, toolCalling: false, structuredOutput: false },
    provenance: {
      ...UNKNOWN_PROVENANCE,
      coding: coding ? ('derived' as const) : ('unknown' as const),
      reasoning: reasoning ? ('derived' as const) : ('unknown' as const),
    },
  };
  applyStaticFallback('openai', modelId, draft);
  return finalize('openai', modelId, draft);
}

// ── Gemini ──
// models.list exposes input/output token limits, generation methods, and a `thinking`
// flag — but NO pricing and NO modality fields. Non-text families are excluded by the
// provider's own naming (family tokens, not per-model blacklist); image-output and
// transcription endpoints were confirmed leaking and are covered the same way.
// Text-capable agent models (computer-use, robotics, deep-research, omni, antigravity)
// are KEPT: they accept text via generateContent and there is no payload evidence they
// cannot generate text/code.

const GEMINI_NON_TEXT_FAMILY = /(^|[^a-z])(imagen|veo|lyria|chirp|tts|embedding|aqa|transcribe|banana)([^a-z]|$)/;
const GEMINI_IMAGE_OUTPUT_FAMILY = /(^|[^a-z-])image([^a-z]|$)/;

export function normalizeGeminiModel(raw: Record<string, unknown>): ModelDefinition | null {
  const name = typeof raw.name === 'string' ? raw.name : '';
  if (!name) return null;
  const modelId = name.replace('models/', '');
  const methods = strArray(raw.supportedGenerationMethods);
  if (!methods.includes('generateContent')) return null;
  const displayName = typeof raw.displayName === 'string' ? raw.displayName : '';
  const lowId = modelId.toLowerCase();
  const lowName = displayName.toLowerCase();
  if (GEMINI_NON_TEXT_FAMILY.test(lowId) || GEMINI_NON_TEXT_FAMILY.test(lowName)) return null;
  // Image-output endpoints (gemini-*-image*, nano-banana is covered by 'banana' above):
  // providers' own naming for image generation, not text/code generation.
  if (GEMINI_IMAGE_OUTPUT_FAMILY.test(lowId) || GEMINI_IMAGE_OUTPUT_FAMILY.test(lowName)) return null;

  // `thinking: true` is direct provider evidence of reasoning support and stays
  // authoritative; the shared explicit-reasoning ID signal is the fallback when
  // the payload is silent. Coding uses the shared ID signal at the same threshold
  // the OpenRouter/Chutes/DeepSeek normalizers use (≥ 0.5) — provenance 'derived'
  // only when the signal fires, otherwise 'unknown' so exact-match static curated
  // capabilities still win via applyStaticFallback.
  const thinking = raw.thinking === true;
  const coding = codingFamilySignal(modelId) >= 0.5;
  const idReasoning = reasoningFamilySignal(modelId) >= 1;
  const draft = {
    displayName: displayName || modelId,
    inputPrice: null as number | null,
    outputPrice: null as number | null,
    isFree: false,
    priceSource: 'unknown' as PriceSource,
    freeAuthority: 'none' as FreeAuthority,
    // inputTokenLimit is the max input size — the de-facto context ceiling for
    // planning purposes (output is bounded separately by outputTokenLimit).
    contextWindow: typeof raw.inputTokenLimit === 'number' ? raw.inputTokenLimit : null,
    contextSource: (typeof raw.inputTokenLimit === 'number' ? 'live' : null) as ContextSource | null,
    maxOutputTokens: typeof raw.outputTokenLimit === 'number' ? raw.outputTokenLimit : null,
    flags: { coding, reasoning: thinking || idReasoning, vision: false, toolCalling: false, structuredOutput: false },
    provenance: {
      ...UNKNOWN_PROVENANCE,
      coding: coding ? ('derived' as const) : ('unknown' as const),
      reasoning: thinking
        ? ('observed' as const)
        : idReasoning
          ? ('derived' as const)
          : ('unknown' as const),
    },
  };
  applyStaticFallback('gemini', modelId, draft);
  return finalize('gemini', modelId, draft);
}

// ── DeepSeek ──
// Live metadata is used directly: context_window → context, max_output_tokens → max
// output, effort.supported_levels → observed reasoning, modalities → observed vision,
// name → display name. No live pricing exists → static exact-match fallback, else unknown.

export function normalizeDeepSeekModel(raw: Record<string, unknown>): ModelDefinition | null {
  const modelId = typeof raw.id === 'string' ? raw.id : '';
  if (!modelId) return null;
  const effort = raw.effort as Record<string, unknown> | undefined;
  const levels = Array.isArray(effort?.supported_levels) ? (effort?.supported_levels as unknown[]) : [];
  const reasoning = levels.length > 0;
  const inMods = strArray(raw.input_modalities);
  const outMods = strArray(raw.output_modalities);
  const vision = inMods.some((m) => m.toLowerCase().includes('image'));
  const coding = codingFamilySignal(modelId) >= 0.5;
  const draft = {
    displayName: (typeof raw.name === 'string' && raw.name) || modelId,
    inputPrice: null as number | null,
    outputPrice: null as number | null,
    isFree: false,
    priceSource: 'unknown' as PriceSource,
    freeAuthority: 'none' as FreeAuthority,
    contextWindow: typeof raw.context_window === 'number' ? raw.context_window : null,
    contextSource: (typeof raw.context_window === 'number' ? 'live' : null) as ContextSource | null,
    maxOutputTokens: typeof raw.max_output_tokens === 'number' ? raw.max_output_tokens : null,
    flags: { coding, reasoning, vision, toolCalling: false, structuredOutput: false },
    provenance: {
      coding: 'derived',
      reasoning: reasoning ? ('observed' as const) : ('unknown' as const),
      vision: 'observed',
      toolCalling: 'unknown',
      structuredOutput: 'unknown',
    } as CapabilityProvenanceMap,
    modalities: { input: inMods, output: outMods },
  };
  applyStaticFallback('deepseek', modelId, draft);
  return finalize('deepseek', modelId, draft);
}

// ── Z.AI ──
// Payload carries ONLY id/object/created/owned_by. Exact-match static fallback only
// (currently no live ID matches a static row — those rows stay registry-only entries
// and must NOT attach to the plain glm-4.x live IDs). The payload carries no capability
// fields, so capability evidence comes only from the shared deterministic ID signals
// at the SAME thresholds the OpenRouter/Chutes/DeepSeek normalizers use (coding ≥ 0.5;
// reasoning = the explicit tier only). Provenance stays 'unknown' unless a signal
// fires, so exact-match static curated capabilities still win via applyStaticFallback.

export function normalizeZAIModel(raw: Record<string, unknown>): ModelDefinition | null {
  const modelId = typeof raw.id === 'string' ? raw.id : '';
  if (!modelId) return null;
  const coding = codingFamilySignal(modelId) >= 0.5;
  const reasoning = reasoningFamilySignal(modelId) >= 1;
  const draft = {
    displayName: modelId,
    inputPrice: null as number | null,
    outputPrice: null as number | null,
    isFree: false,
    priceSource: 'unknown' as PriceSource,
    freeAuthority: 'none' as FreeAuthority,
    contextWindow: null as number | null,
    contextSource: null as ContextSource | null,
    maxOutputTokens: null as number | null,
    flags: { coding, reasoning, vision: false, toolCalling: false, structuredOutput: false },
    provenance: {
      ...UNKNOWN_PROVENANCE,
      coding: coding ? ('derived' as const) : ('unknown' as const),
      reasoning: reasoning ? ('derived' as const) : ('unknown' as const),
    },
  };
  applyStaticFallback('zai', modelId, draft);
  return finalize('zai', modelId, draft);
}

// ── Local (generic OpenAI-compatible endpoint) ──
// The /models payload of a self-hosted server is usually minimal: id /
// object / created / owned_by, sometimes display_name and max_model_len.
// There is NO assumed pricing, context, or capability metadata:
//   - context: live only when the payload exposes a trustworthy window
//     (max_model_len / context_length / meta.n_ctx / n_ctx — see
//     extractLocalContextWindow), otherwise honest default (finalize's 128K,
//     contextSource 'default');
//   - pricing: read ONLY when a pricing block is present. A pricing block
//     follows the OpenRouter-style schema (prompt/completion, USD per token →
//     per 1M). Absent pricing ⇒ unknown + null + NEVER free (the catalog's
//     explicit-zero / registry-confirmed free rules are preserved — a local
//     model is not "externally free" just because nobody bills for it);
//   - capabilities: shared deterministic ID signals only, at the SAME
//     thresholds the OpenCode/Z.AI/OpenAI normalizers use; no payload evidence
//     ⇒ 'unknown' provenance (never a silent true default).
// No specific local server software is assumed or named.

/**
 * Extracts a trustworthy context window from a generic OpenAI-compatible
 * /models entry. Accepted live signals, in priority order:
 *   1. `max_model_len` (vLLM-style deployment context),
 *   2. `context_length` (OpenRouter-style),
 *   3. `meta.n_ctx` (llama.cpp-style: the server's actual loaded context;
 *      `meta.n_ctx_train` is deliberately NOT read — training context is not
 *      servable capacity).
 *   4. top-level `n_ctx` (generic fallback for servers that expose it flat).
 * Only finite positive numbers are accepted; anything else (missing, null,
 * string, zero, negative, NaN, Infinity, non-object meta) yields null so the
 * caller falls back to the honest 128K default (contextSource 'default').
 * No server software is assumed — these are generic field shapes.
 */
function extractLocalContextWindow(raw: Record<string, unknown>): number | null {
  const asPositiveInt = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
  const topLevel =
    asPositiveInt(raw.max_model_len) ?? asPositiveInt(raw.context_length) ?? asPositiveInt(raw.n_ctx);
  if (topLevel != null) return topLevel;
  const meta = raw.meta;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const nCtx = (meta as Record<string, unknown>).n_ctx;
    const fromMeta = asPositiveInt(nCtx);
    if (fromMeta != null) return fromMeta;
  }
  return null;
}

export function normalizeLocalModel(raw: Record<string, unknown>): ModelDefinition | null {
  const modelId = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!modelId) return null;

  const contextWindow = extractLocalContextWindow(raw);

  const pricing = raw.pricing as Record<string, unknown> | undefined;
  const hasPricingField = pricing != null && ('prompt' in pricing || 'completion' in pricing);
  const inputRaw = toPriceNumber(pricing?.prompt);
  const outputRaw = toPriceNumber(pricing?.completion);
  const priced = hasPricingField && (inputRaw != null || outputRaw != null);
  const inputPrice = toPerMillion(inputRaw);
  const outputPrice = toPerMillion(outputRaw);
  const isFree = isExplicitlyFree(inputRaw, outputRaw, hasPricingField);

  const coding = codingFamilySignal(modelId) >= 0.5;
  const reasoning = reasoningFamilySignal(modelId) >= 1;
  const draft = {
    displayName:
      (typeof raw.display_name === 'string' && raw.display_name) ||
      (typeof raw.name === 'string' && raw.name) ||
      modelId,
    inputPrice,
    outputPrice,
    isFree,
    priceSource: (priced ? 'live' : 'unknown') as PriceSource,
    freeAuthority: (isFree ? 'explicit-zero' : 'none') as FreeAuthority,
    contextWindow,
    contextSource: (contextWindow != null ? 'live' : null) as ContextSource | null,
    maxOutputTokens: typeof raw.max_output_tokens === 'number' ? raw.max_output_tokens : null,
    flags: { coding, reasoning, vision: false, toolCalling: false, structuredOutput: false },
    provenance: {
      ...UNKNOWN_PROVENANCE,
      coding: coding ? ('derived' as const) : ('unknown' as const),
      reasoning: reasoning ? ('derived' as const) : ('unknown' as const),
    } as CapabilityProvenanceMap,
  };
  // No static local rows exist, so this is currently a no-op — kept for
  // symmetry with every other provider (and correct if one is ever added).
  applyStaticFallback('local', modelId, draft);
  return finalize('local', modelId, draft);
}

// ── Dispatch boundary ──

const NORMALIZERS: Record<ProviderName, (raw: Record<string, unknown>) => ModelDefinition | null> = {
  openrouter: normalizeOpenRouterModel,
  opencode: normalizeOpenCodeModel,
  chutes: normalizeChutesModel,
  openai: normalizeOpenAIModel,
  gemini: normalizeGeminiModel,
  deepseek: normalizeDeepSeekModel,
  zai: normalizeZAIModel,
  local: normalizeLocalModel,
};

/**
 * Normalizes one raw provider payload entry, or null when the entry must not
 * enter the catalog. The ONLY raw→normalized path — no competing pipelines.
 */
export function normalizeProviderModel(providerId: ProviderName, raw: Record<string, unknown>): ModelDefinition | null {
  const fn = NORMALIZERS[providerId];
  if (!fn) return null;
  try {
    return fn(raw);
  } catch (err) {
    console.warn(`[normalizers] ${providerId} entry failed to normalize:`, err);
    return null;
  }
}
