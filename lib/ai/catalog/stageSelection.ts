// Per-stage model selection for the /models page setups (Free / Balanced / Quality).
//
// Free is STRICT: only confirmed-free models (price.isFree — explicit zero
// cost) are eligible; when none survives a stage's automatic pool the pick is
// an explicit `unavailable` state, never a paid fallback.
//
// Selection runs entirely on the user's ACTUAL catalog (models from connected
// providers, already scored by the existing model-intelligence system). No
// model names or providers are hardcoded — only stage-to-capability PREFERENCES.

import type { CatalogModel } from '@/app/models/page';
import { estimateCostUsd } from '@/lib/ai/catalog/cost';
import { STAGE_TOKEN_PROFILES } from '@/lib/ai/catalog/stageTokenProfiles';

export type SetupChoice = 'free' | 'balanced' | 'quality';

export const SETUP_TITLES: Record<SetupChoice, string> = {
  free: 'Free',
  balanced: 'Balanced',
  quality: 'Quality',
};

export type StageKey =
  | 'relevant_file_discovery'
  | 'root_cause_analysis'
  | 'evidence_extraction'
  | 'solution_generation'
  | 'patch_generation';

// SINGLE SOURCE OF TRUTH for automatic-setup stage weights (stage-keyed).
// app/api/ai/models/route.ts imports this export — do NOT define a second
// copy there or elsewhere. (config.ts TASK_WEIGHTS is a different, TaskType-
// keyed system used by runtime routing and is intentionally untouched.)
// Evidence extraction is context/extraction-heavy (not discovery-like), hence
// its reasoning/longContext weights differ from the older discovery profile.
export const STAGE_WEIGHTS: Record<StageKey, { coding: number; reasoning: number; speed: number; longContext: number }> = {
  relevant_file_discovery: { coding: 3, reasoning: 1, speed: 3, longContext: 1 },
  root_cause_analysis: { coding: 2, reasoning: 3, speed: 1, longContext: 2 },
  evidence_extraction: { coding: 2, reasoning: 2, speed: 3, longContext: 3 },
  solution_generation: { coding: 3, reasoning: 2, speed: 1, longContext: 2 },
  patch_generation: { coding: 3, reasoning: 2, speed: 1, longContext: 2 },
};

// Context sufficiency minimums per stage (tokens). Context is a REQUIREMENT
// for automatic selection, not a score: models below the stage minimum are
// excluded from the automatic pool (they remain fully visible in the Model
// Library and manual Configure/Change Model selector).
export const STAGE_CONTEXT_MIN: Record<StageKey, number> = {
  relevant_file_discovery: 32_000,
  root_cause_analysis: 128_000,
  evidence_extraction: 200_000,
  solution_generation: 32_000,
  patch_generation: 32_000,
};

// Provider flood protection: after family grouping, keep only the top-N
// candidates per provider per stage (ranked by the existing StageScore).
// This caps catalog-size advantage (a provider with 500 listings gets the
// same 5 shots as one with 5) without forcing any diversity quota — a single
// provider can still win every stage when its candidates genuinely rank best.
export const MAX_CANDIDATES_PER_PROVIDER = 5;

export interface StagePick {
  stageId: StageKey;
  /** Null only when `unavailable` — no model was chosen for this stage. */
  provider: string | null;
  /** Null only when `unavailable` — no model was chosen for this stage. */
  model: string | null;
  /** True when the chosen model has confirmed zero cost (price.isFree). */
  isFree: boolean;
  /**
   * Free setup only: no confirmed-free model survived the stage's automatic
   * pool (family grouping → context gate → provider cap). The stage is
   * explicitly unavailable — Free NEVER falls back to a paid model.
   */
  unavailable?: boolean;
}

function stageScore(model: CatalogModel, weights: { coding: number; reasoning: number; speed: number; longContext: number }): number {
  const norm = weights.coding + weights.reasoning + weights.speed + weights.longContext;
  return (
    (model.scores.coding * weights.coding +
      model.scores.reasoning * weights.reasoning +
      model.scores.speed * weights.speed +
      model.scores.longContext * weights.longContext) /
    norm
  );
}

/** Defined per-1M price, or null when the catalog has no reliable pricing. */
function definedPrice(model: CatalogModel): { input: number; output: number } | null {
  if (model.price.isFree) return { input: 0, output: 0 };
  if (model.price.input == null || model.price.output == null) return null;
  return { input: model.price.input, output: model.price.output };
}

/**
 * Estimated USD cost of running ONE stage request with this model, via the
 * shared Task 2 cost system (cost.ts arithmetic + stageTokenProfiles
 * workloads). Selection must never reimplement price × tokens / 1M.
 *
 * Returns null when pricing is unknown — callers handle that explicitly;
 * unknown pricing is NEVER treated as zero cost.
 */
function stageEstimatedCostUsd(model: CatalogModel, stageId: StageKey): number | null {
  const estimate = estimateCostUsd(
    {
      inputPricePerMillion: model.price.input,
      outputPricePerMillion: model.price.output,
      isFree: model.price.isFree,
    },
    STAGE_TOKEN_PROFILES[stageId]
  );
  return estimate.status === 'unknown' ? null : estimate.usd;
}

// ── Automatic-selection pool: family grouping → context gate → provider top-N ──
// All of the following apply ONLY to the derived pool used by Free/Balanced/
// Quality setup selection. The full catalog always remains available to the
// Model Library and the manual Configure/Change Model selector.

/**
 * Normalizes an access-tier suffix (case-insensitive). Used for tier detection
 * AND stripped from the family key so that a free variant groups with its paid
 * base model. Conservative: full-segment exact matches only.
 */
const ACCESS_TIERS = ['free', 'open', 'beta', 'preview', 'experimental', 'exp'] as const;

/**
 * Conservative near-duplicate family key derived ONLY from the model ID.
 * Segments are split on non-alphanumeric separators; only obvious variant
 * suffixes and access-tier markers are removed — meaningful identity is kept.
 * Examples:
 *   'deepseek-ai/DeepSeek-V4-Flash-0731-TEE'   → 'chutes|deepseek ai deepseek v4 flash'
 *   'deepseek/deepseek-v4-flash:free'          → 'openrouter|deepseek deepseek v4 flash'
 *   'deepseek/deepseek-v4-flash-0731'          → 'openrouter|deepseek deepseek v4 flash'
 *   'meta-llama/llama-3.1-8b-instruct:free'    → 'openrouter|meta llama llama 3.1 8b'
 * Distinct models stay distinct:
 *   'deepseek/deepseek-v4-flash' vs 'deepseek/deepseek-v4-pro' → different keys
 * Note the key is provider-scoped: the same base model on two providers stays
 * two families (cross-provider grouping would be too aggressive here).
 */
export function modelFamilyKey(providerId: string, modelId: string): string {
  const segs = modelId.toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean);
  if (segs.length === 0) return `${providerId}|${modelId.toLowerCase()}`;

  const isQuant = (s: string) => /(^|\d)(q|q\d|iq\d|int\d|fp\d+|awq|gptq|gguf|ggml|exl2|dq|ud)$/.test(s);
  const isMarker = (s: string) => s === 'tee' || s === 'instruct' || s === 'quantized' || s === 'quant' ||
    s === 'bnb' || s === 'mlx' || s === 'int4' || s === 'int8' || s === 'fp8' ||
    s === 'awq' || s === 'gptq' || s === 'gguf' || s === 'ggml' || s === 'exl2';
  const isDateVersion = (s: string) =>
    // 'v'-prefixed releases (v2, v0.3) and date-style snapshot integers
    // (0731, 2507) are suffixes. Bare dotted numbers (glm-4.6, qwen3.5) are
    // model-generation identity and MUST stay.
    /^v\d+(\.\d+)?$/.test(s) || /^\d{4,}$/.test(s);

  // Iteratively strip trailing tier/quant/marker and date/version segments
  // until stable, so combined suffixes like '-instruct:free' or '-0731-tee'
  // normalize to the same family as the plain variant. Always keep at least
  // one segment so a family key never collapses to empty identity.
  const kept = [...segs];
  let changed = true;
  while (changed && kept.length > 1) {
    changed = false;
    const last = kept[kept.length - 1];
    if ((ACCESS_TIERS as readonly string[]).includes(last) || isQuant(last) || isMarker(last)) {
      kept.pop();
      changed = true;
      continue;
    }
    if (kept.length >= 2 && isDateVersion(last)) {
      kept.pop();
      changed = true;
    }
  }

  const remainder = kept.filter(Boolean).join(' ').trim();
  if (!remainder) return `${providerId}|${modelId.toLowerCase()}`;
  return `${providerId}|${remainder}`;
}

/**
 * Picks ONE representative per family for the automatic pool. Deterministic.
 * Priority (the spec's explicit ordering — NOT highest global score):
 *   1. available model
 *   2. better metadata confidence (static/registry entry or registry-backed
 *      scores beat live entries with default/guessed metadata)
 *   3. lower cost (blended USD/1M: 2×input + output, free = 0, unknown = +Inf)
 *   4. longer context
 *   5. stable provider/model ID tiebreak
 */
function betterFamilyRepresentative(a: CatalogModel, b: CatalogModel): CatalogModel {
  if (a.available !== b.available) return a.available ? a : b;
  // Metadata confidence: registry/curated entries have no 'live' tag; live-
  // discovered entries (added by catalog/live.ts) may carry default/guessed
  // metadata, so prefer the curated one when both exist in a family.
  const aConf = a.tags.includes('live') ? 0 : 1;
  const bConf = b.tags.includes('live') ? 0 : 1;
  if (aConf !== bConf) return aConf > bConf ? a : b;
  const pA = definedPrice(a);
  const pB = definedPrice(b);
  const cA = pA ? pA.input * 2 + pA.output : Number.POSITIVE_INFINITY;
  const cB = pB ? pB.input * 2 + pB.output : Number.POSITIVE_INFINITY;
  if (cA !== cB) return cA < cB ? a : b;
  if (a.contextWindow !== b.contextWindow) return a.contextWindow > b.contextWindow ? a : b;
  const idA = `${a.providerId}/${a.modelId}`;
  const idB = `${b.providerId}/${b.modelId}`;
  return idA.localeCompare(idB) <= 0 ? a : b;
}

/**
 * Builds the derived automatic-selection pool from the FULL catalog:
 *   1. family grouping (one representative per near-duplicate family)
 *   2. per-stage context sufficiency gate (STAGE_CONTEXT_MIN)
 *   3. per-provider top-N cap (MAX_CANDIDATES_PER_PROVIDER), ranked by the
 *      existing StageScore so catalog size cannot buy extra lottery tickets
 * The input array is never mutated; manual selection keeps the full catalog.
 */
function buildAutomaticPool(
  availableModels: CatalogModel[],
  stageId: StageKey,
  weights: { coding: number; reasoning: number; speed: number; longContext: number }
): CatalogModel[] {
  // 1. Family grouping — keep one representative per near-duplicate family.
  const families = new Map<string, CatalogModel>();
  for (const m of availableModels) {
    const key = modelFamilyKey(m.providerId, m.modelId);
    const existing = families.get(key);
    families.set(key, existing ? betterFamilyRepresentative(existing, m) : m);
  }
  let pool = Array.from(families.values());

  // 2. Context sufficiency gate (CatalogModel.contextWindow is always a number:
  //    live API → static registry → 128K default, applied at discovery time —
  //    so there is no null case to reinterpret here).
  const contextMin = STAGE_CONTEXT_MIN[stageId] ?? 0;
  pool = pool.filter((m) => m.contextWindow >= contextMin);

  // 3. Provider top-N cap. Rank each provider's candidates by StageScore with
  //    the existing stable tiebreaks, keep the top N, merge across providers.
  const byProvider = new Map<string, CatalogModel[]>();
  for (const m of pool) {
    const list = byProvider.get(m.providerId);
    if (list) list.push(m);
    else byProvider.set(m.providerId, [m]);
  }
  const capped: CatalogModel[] = [];
  for (const list of byProvider.values()) {
    list.sort((a, b) => {
      const d = stageScore(b, weights) - stageScore(a, weights);
      if (d !== 0) return d;
      const dv = (b.valueScore || 0) - (a.valueScore || 0);
      if (dv !== 0) return dv;
      return `${a.providerId}/${a.modelId}`.localeCompare(`${b.providerId}/${b.modelId}`);
    });
    capped.push(...list.slice(0, MAX_CANDIDATES_PER_PROVIDER));
  }
  return capped;
}

/**
 * BALANCED: deterministic price/performance value on the stage-weighted
 * quality score (0–100) vs the ACTUAL stage-specific estimated cost (shared
 * cost helper + per-stage token profiles — an evidence-extraction request
 * costs more than a discovery request for the same model, and the cost term
 * reflects that). Free models carry zero cost and rank by quality alone;
 * paid models must earn their cost. Never simply the cheapest, never simply
 * the highest-quality.
 *
 * Unknown pricing is explicit, never silent zero cost: it takes the worst
 * cost tier (the same sentinel the family grouping uses), so a known-priced
 * candidate always outranks an unknown one. If ALL candidates are unknown,
 * the best stage score wins (deterministic pool order).
 */
// Stage costs are per-analysis cents; this scale puts them on the same
// penalty magnitude as the previous per-1M-price heuristic so the
// cost/quality trade-off stays meaningful against the 0–100 quality scale.
const BALANCED_COST_SCALE = 100;
const BALANCED_COST_MULTIPLIER = 12;
function pickBalanced(
  models: CatalogModel[],
  weights: { coding: number; reasoning: number; speed: number; longContext: number },
  stageId: StageKey
): number {
  let bestIdx = 0;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    const quality = stageScore(m, weights); // 0–100
    const costUsd = stageEstimatedCostUsd(m, stageId);
    // Cheap model: quality dominates. Expensive model: must be much better.
    const costPenalty =
      costUsd === null
        ? Number.POSITIVE_INFINITY // unknown pricing — explicitly worst tier
        : Math.log10(1 + costUsd * BALANCED_COST_SCALE) * BALANCED_COST_MULTIPLIER;
    const value = quality - costPenalty;
    if (value > bestValue) {
      bestValue = value;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * QUALITY: capability-first, not price-blind.
 *
 * 1. Find the best stage-weighted capability score.
 * 2. Qualify every candidate within QUALITY_COMPARABLE_TOLERANCE points of
 *    it ("sufficiently comparable" capability for this stage).
 * 3. Among qualified candidates prefer the lower stage-specific estimated
 *    cost (free = $0 wins comparable paid models; unknown pricing = worst
 *    cost tier, eligible only when all qualified candidates are unknown).
 * 4. A stronger model still wins when its capability advantage exceeds the
 *    tolerance — cheaper-but-materially-weaker candidates are not qualified.
 *
 * Deterministic: strict cost comparison keeps earlier pool order (higher
 * stage score, then valueScore, then stable ID) on cost ties. Deliberately
 * NOT "highest price wins" / "largest model wins".
 */
const QUALITY_COMPARABLE_TOLERANCE = 5; // points on the 0–100 stage-score scale
function pickQuality(
  models: CatalogModel[],
  weights: { coding: number; reasoning: number; speed: number; longContext: number },
  stageId: StageKey
): number {
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < models.length; i++) {
    const s = stageScore(models[i], weights);
    if (s > bestScore) bestScore = s;
  }

  const threshold = bestScore - QUALITY_COMPARABLE_TOLERANCE;
  let bestIdx = 0;
  let bestCost = Number.POSITIVE_INFINITY;
  for (let i = 0; i < models.length; i++) {
    if (stageScore(models[i], weights) < threshold) continue;
    const cost = stageEstimatedCostUsd(models[i], stageId);
    // Unknown pricing → Infinity (worst tier, still eligible as last resort).
    const comparable = cost === null ? Number.POSITIVE_INFINITY : cost;
    if (comparable < bestCost) {
      bestCost = comparable;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Select a model for every stage from the user's available (connected-provider)
 * catalog. Deterministic: same catalog + setup → same picks. Stages are
 * independent — different stages may resolve to different models.
 */
export function selectStageModels(setup: SetupChoice, availableModels: CatalogModel[]): Record<StageKey, StagePick | null> {
  const result = {} as Record<StageKey, StagePick | null>;
  type StageWeights = (typeof STAGE_WEIGHTS)[StageKey];
  for (const [stageId, weights] of Object.entries(STAGE_WEIGHTS) as Array<[StageKey, StageWeights]>) {
    result[stageId] = selectForStage(setup, stageId, availableModels, weights);
  }
  return result;
}

export function selectForStage(
  setup: SetupChoice,
  stageId: StageKey,
  availableModels: CatalogModel[],
  weights?: { coding: number; reasoning: number; speed: number; longContext: number }
): StagePick | null {
  if (availableModels.length === 0) return null;
  const w = weights || STAGE_WEIGHTS[stageId];

  // Derived automatic-selection pool (family grouping → context gate →
  // provider top-N). `availableModels` (the full connected catalog) is NOT
  // mutated — manual selection keeps seeing everything.
  const autoPool = buildAutomaticPool(availableModels, stageId, w);
  if (autoPool.length === 0) {
    // Free: the catalog exists but nothing survived this stage's gates, so no
    // free model can serve it — explicit unavailable state (never a paid pick,
    // never silently "No config"). Balanced/Quality keep the null semantics.
    if (setup === 'free') {
      return { stageId, provider: null, model: null, isFree: false, unavailable: true };
    }
    return null;
  }

  // Score-ordered pool (stable tiebreak on valueScore, then name, for determinism).
  const pool = [...autoPool].sort((a, b) => {
    const d = stageScore(b, w) - stageScore(a, w);
    if (d !== 0) return d;
    const dv = (b.valueScore || 0) - (a.valueScore || 0);
    if (dv !== 0) return dv;
    return `${a.providerId}/${a.modelId}`.localeCompare(`${b.providerId}/${b.modelId}`);
  });

  let chosen: CatalogModel | null = null;

  if (setup === 'free') {
    // STRICT FREE: a model is eligible ONLY when its pricing data explicitly
    // indicates zero cost (price.isFree). Unknown/null pricing is NEVER
    // treated as free (requirement: free ⇔ explicitly zero cost). Among
    // suitable free candidates, choose the highest-scoring model using the
    // existing stage scoring system — the `pool` is already sorted best-first
    // by stage score, so the first free candidate is the best.
    // Deterministic tie-breakers are already established by the pool sort.
    // Price is NOT part of the Free ranking.
    // No confirmed-free candidate → explicit unavailable state. Free NEVER
    // falls back to a paid model (the paid-fallback branch was removed by the
    // strict-Free task; see think/state.md).
    const freePool = pool.filter((m) => m.price.isFree);
    if (freePool.length === 0) {
      return { stageId, provider: null, model: null, isFree: false, unavailable: true };
    }
    chosen = freePool[0];
  } else {
    const idx = setup === 'balanced' ? pickBalanced(pool, w, stageId) : pickQuality(pool, w, stageId);
    chosen = pool[idx] || null;
  }

  if (!chosen) return null;
  return {
    stageId,
    provider: chosen.providerId,
    model: chosen.modelId,
    isFree: chosen.price.isFree,
  };
}
