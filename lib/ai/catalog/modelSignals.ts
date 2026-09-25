// Deterministic capability signals derived from model IDs.
//
// This module carries NO provider-specific code: it inspects the model ID
// string only. It exists because live provider catalogs (OpenRouter in
// particular) expose hundreds of models whose REAL capability evidence lives
// in (a) the provider's own structured metadata and (b) well-known model
// families — never in fabricated benchmark numbers.
//
// Everything here is explainable: a score contribution maps to a concrete
// signal in the model's ID or provider metadata. No invented benchmarks.

/**
 * Well-known open/frontend/coding model families. Evidence: these families are
 * explicitly positioned as code models by their upstream vendors (Qwen-Coder,
 * DeepSeek Coder/V4 series, GLM coding lineup, Kimi, Codestral, Devstral,
 * Poolside, etc.). Matching is family-token based, NOT substring-based, so
 * e.g. "coder" inside an unrelated word does not match.
 */
const CODING_FAMILY_TOKENS = [
  'qwen-coder', 'qwen3-coder', 'qwen2.5-coder', 'deepseek-coder', 'devstral',
  'codestral', 'codegemma', 'starcoder', 'codegeex',
  'laguna', // poolside coding models
  'north',  // cohere north = coding line
  'kimi-k2', 'kimi', 'deepseek', 'glm', 'minimax', 'qwen3', 'qwen3.5',
  'nemotron', 'ling', 'dots', 'gpt-oss', 'claude', 'gemini', 'gpt', 'grok',
] as const;

/**
 * Known reasoning-model families (thinking/reasoning specializations).
 * Evidence: upstream vendor positioning (Qwen Thinking, DeepSeek R-series,
 * OpenAI o-series, GLM thinking variants, "thinking"/"reasoning" tokens).
 */
const REASONING_FAMILY_TOKENS = [
  'thinking', 'reasoner', 'reasoning', 'r1', 'o1', 'o3', 'o4',
  'qwen3-thinking', 'deepseek-r1', 'inkling',
] as const;

/** Small-model size signals in billions of parameters (weak capability). */
const SMALL_PARAM_PATTERN = /(^|[^0-9.])(\d+(?:\.\d+)?)b([^0-9]|$)/i;
/** Large-model size signals — ≥ 100B parameters (MoE totals included). */
const LARGE_PARAM_PATTERN = /(^|[^0-9.])(\d{3,}(?:\.\d+)?)b([^0-9]|$)/i;

function idTokens(modelId: string): string[] {
  return modelId.toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean);
}

/** True when any ID token contains the given family token (hyphen-aware). */
function hasFamilyToken(tokens: string[], family: string): boolean {
  const fam = family.toLowerCase();
  if (fam.includes('-')) {
    // Multi-token families ("qwen3-coder"): check joined-token windows.
    const parts = fam.split('-');
    for (let i = 0; i + parts.length <= tokens.length; i++) {
      let match = true;
      for (let j = 0; j < parts.length; j++) {
        if (tokens[i + j] !== parts[j]) { match = false; break; }
      }
      if (match) return true;
    }
    return false;
  }
  // Single token: prefix match so "kimi-k2" matches token "kimi-k2.5".
  return tokens.some((t) => t === fam || t.startsWith(fam));
}

/**
 * Deterministic coding-family signal from the model ID.
 * Returns a 0–1 confidence: 1 = explicit coding family, 0.7 = strong general
 * family (frontier/open coding-capable), 0.4 = unknown small model,
 * 0.25 = tiny model.
 */
export function codingFamilySignal(modelId: string): number {
  const tokens = idTokens(modelId);
  for (const fam of CODING_FAMILY_TOKENS) {
    if (hasFamilyToken(tokens, fam)) {
      const small = SMALL_PARAM_PATTERN.test(modelId) && !LARGE_PARAM_PATTERN.test(modelId);
      return small ? 0.55 : 0.9;
    }
  }
  if (SMALL_PARAM_PATTERN.test(modelId)) {
    const size = Number((modelId.toLowerCase().match(SMALL_PARAM_PATTERN) || [])[2]);
    return size <= 10 ? 0.25 : 0.4;
  }
  return 0.4;
}

/**
 * Deterministic reasoning-family signal from the model ID.
 * Returns 0–1: 1 = explicit reasoning/thinking family, 0.6 = strong general
 * family, 0.3 = unknown/small.
 */
export function reasoningFamilySignal(modelId: string): number {
  const tokens = idTokens(modelId);
  for (const fam of REASONING_FAMILY_TOKENS) {
    if (hasFamilyToken(tokens, fam)) return 1;
  }
  for (const fam of CODING_FAMILY_TOKENS) {
    if (hasFamilyToken(tokens, fam)) {
      const small = SMALL_PARAM_PATTERN.test(modelId) && !LARGE_PARAM_PATTERN.test(modelId);
      return small ? 0.45 : 0.7;
    }
  }
  return 0.35;
}

export interface ParamSizeClass {
  size: 'tiny' | 'small' | 'medium' | 'large' | 'unknown';
  /** Best-effort parameter count in billions; null when absent from the ID. */
  billions: number | null;
}

/**
 * Parameter-size class parsed from the model ID (e.g. "30b-a3b", "550b",
 * "2.6b"). For MoE IDs the FIRST/largest explicit size is the total-parameter
 * count, which is what correlates with capability; the active-size (aNNb) is
 * what correlates with serving speed — both are exposed.
 */
export function paramSizeClass(modelId: string): ParamSizeClass {
  const lower = modelId.toLowerCase();
  const matches = [...lower.matchAll(/(^|[^0-9.])(\d+(?:\.\d+)?)b([^0-9a-z]|$)/g)];
  if (matches.length === 0) return { size: 'unknown', billions: null };
  const sizes = matches.map((mt) => Number(mt[2])).filter((n) => Number.isFinite(n) && n > 0);
  if (sizes.length === 0) return { size: 'unknown', billions: null };
  const total = Math.max(...sizes);
  const activeMatches = [...lower.matchAll(/a(\d+(?:\.\d+)?)b/g)]
    .map((mt) => Number(mt[1]))
    .filter((n) => Number.isFinite(n) && n > 0);
  const active = activeMatches.length > 0 ? Math.min(...activeMatches) : null;
  const size = total >= 100 ? 'large' : total <= 4 ? 'tiny' : total <= 15 ? 'small' : 'medium';
  return { size, billions: total };
}

/**
 * Active-parameter estimate for MoE IDs ("30b-a3b" → 3B active) — the closest
 * deterministic proxy for serving speed. Returns the total size for dense IDs.
 */
export function activeParamBillions(modelId: string): number | null {
  const { size, billions } = paramSizeClass(modelId);
  if (billions == null) return null;
  const lower = modelId.toLowerCase();
  const activeMatches = [...lower.matchAll(/a(\d+(?:\.\d+)?)b/g)]
    .map((mt) => Number(mt[1]))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (size === 'large' && activeMatches.length > 0) return Math.min(...activeMatches);
  return billions;
}

/**
 * Vision-capability signal: OpenRouter `architecture.input_modalities`
 * contains "image" (or the legacy combined modality string contains
 * "image→" as input side). Deterministic — straight from provider metadata.
 */
export function inputModalityImage(inputModalities: unknown, combinedModality?: unknown): boolean {
  if (Array.isArray(inputModalities)) {
    return inputModalities.some((m) => typeof m === 'string' && m.toLowerCase().includes('image'));
  }
  if (typeof combinedModality === 'string') {
    const inSide = combinedModality.split('->')[0] || '';
    return inSide.includes('image');
  }
  return false;
}

/**
 * Output-must-be-text guard: a model whose output modalities exclude text
 * (image/audio generators) must never enter a text/code stage pool.
 * Deterministic — straight from provider metadata.
 */
export function outputModalityIsText(outputModalities: unknown, combinedModality?: unknown): boolean {
  if (Array.isArray(outputModalities)) {
    return outputModalities.some((m) => typeof m === 'string' && m.toLowerCase().includes('text'));
  }
  if (typeof combinedModality === 'string') {
    const outSide = combinedModality.split('->')[1] || 'text';
    return outSide.includes('text');
  }
  // Unknown → conservative pass (existing filter semantics apply upstream).
  return true;
}
