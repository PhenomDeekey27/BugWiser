// Model Intelligence - centralized model analysis system.
// Provider change detected -> discover models -> normalize -> AI classify -> store -> cache

import { createBackgroundClient } from '@/lib/supabase/background';
import type {
  ProviderName,
  ContextSource,
  FreeAuthority,
  CapabilityProvenanceMap,
  MetadataConfidence,
} from '../catalog/types';
export type { ProviderName };
import { paramSizeClass, activeParamBillions } from '../catalog/modelSignals';
import { PROVIDER_DEFINITIONS, STATIC_MODEL_REGISTRY } from '../catalog/registry';
import { fetchLiveModels } from '../catalog/live';
import { getProviderConnections, resolveUserCredentials, envKeyForProvider } from '../connection/service';

export interface NormalizedModel {
  provider: ProviderName;
  modelId: string;
  displayName: string;
  isFree: boolean;
  inputPrice: number | null;
  outputPrice: number | null;
  /** Where the price numbers came from. 'unknown' = no reliable pricing. */
  priceSource: 'live' | 'registry' | 'unknown';
  /** When this price was last confirmed, ISO string. Null when unknown. */
  priceFetchedAt: string | null;
  contextWindow: number;
  maxOutputTokens: number | null;
  supportsReasoning: boolean;
  supportsToolCalling: boolean;
  supportsStructuredOutput: boolean;
  supportsCoding: boolean;
  supportsVision: boolean;
  availability: 'available' | 'unavailable' | 'unknown';
  /**
   * Entry provenance: where the ROW came from. Fresh discovery rows are always
   * 'registry' | 'live'; 'ai_classified' appears only on legacy persisted rows
   * written before per-row score origins existed (parsePersistedSource).
   */
  source: 'registry' | 'live' | 'ai_classified';
  registryScores?: { coding: number; reasoning: number; speed: number; longContext: number };
  /** Normalization provenance (passthrough from normalizeProviderModel; recomputed per build, not persisted). */
  contextSource?: ContextSource;
  freeAuthority?: FreeAuthority;
  capabilityProvenance?: CapabilityProvenanceMap;
  metadataConfidence?: MetadataConfidence;
  modalities?: { input: string[]; output: string[] };
}

/**
 * Where a row's SCORES came from — independent of entry provenance (`source`).
 * Mirrors RelevantFile.source in types/index.ts. Persisted per-row through the
 * existing `source` column via persistedSource()/parsePersistedSource().
 */
export type ScoreOrigin = 'ai' | 'deterministic';

export interface ClassifiedModel extends NormalizedModel {
  codingScore: number;
  reasoningScore: number;
  speedScore: number;
  longContextScore: number;
  valueScore: number;
  overallScore: number;
  recommendedCategories: string[];
  /** Actual score origin for THIS row (never inferred from catalog-level flags). */
  scoreOrigin: ScoreOrigin;
}

export interface ModelIntelligenceResult {
  models: ClassifiedModel[];
  providerFingerprint: string;
  classifiedByAi: boolean;
  classificationModel: string | null;
  analyzedAt: string;
}

export function buildProviderFingerprint(connected: Record<ProviderName, boolean>): string {
  const entries = Object.entries(connected)
    .filter(([, v]) => v)
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([p]) => p).join(':') || 'none';
}

/**
 * Catalog freshness window. A persisted catalog older than this is treated as
 * stale: loadCatalog() keeps working (offline safety), but getOrBuildCatalog()
 * will silently rebuild with fresh provider data instead of serving it.
 * Provider pricing moves often enough that unbounded staleness makes cost
 * estimates and free/paid selection unreliable.
 */
export const CATALOG_TTL_MS = 60 * 60 * 1000; // 1 hour

function isCatalogStale(analyzedAt: string | null | undefined): boolean {
  if (!analyzedAt) return true;
  const t = Date.parse(analyzedAt);
  if (!Number.isFinite(t)) return true;
  return Date.now() - t > CATALOG_TTL_MS;
}

// Debug tracing for catalog/selection investigation. Gated: enable with
// AI_DEBUG_SELECTION=true (never on in production by default).
const AI_DEBUG = process.env.AI_DEBUG_SELECTION === 'true';
function debugLog(...args: unknown[]): void {
  if (AI_DEBUG) console.log('[model-intelligence:debug]', ...args);
}

async function discoverModels(userId: string): Promise<NormalizedModel[]> {
  const connected = await getProviderConnections(userId);
  const connectedIds = (Object.keys(connected) as ProviderName[]).filter((p) => connected[p]);
  if (AI_DEBUG) debugLog('getProviderConnections returned:', connected);
  if (connectedIds.length === 0) {
    debugLog('No connected providers');
    return [];
  }
  debugLog('Connected providers:', connectedIds.join(','));

  const nowIso = new Date().toISOString();
  const staticModels: NormalizedModel[] = STATIC_MODEL_REGISTRY
    .filter((m) => connectedIds.includes(m.providerId as ProviderName))
    .map((m) => ({
      provider: m.providerId as ProviderName,
      modelId: m.modelId,
      displayName: m.displayName,
      isFree: m.price.isFree,
      inputPrice: m.price.input,
      outputPrice: m.price.output,
      // Static registry pricing: provenance reflects that. Entries with null
      // prices are 'unknown' — they must NOT read as confirmed zero cost.
      priceSource: m.price.input == null && m.price.output == null ? 'unknown' : 'registry',
      priceFetchedAt: m.price.input == null && m.price.output == null ? null : nowIso,
      contextWindow: m.contextWindow,
      maxOutputTokens: m.maxOutputTokens,
      supportsReasoning: m.supportsReasoning,
      supportsToolCalling: m.supportsToolCalling,
      supportsStructuredOutput: m.supportsStructuredOutput,
      supportsCoding: m.capabilities.includes('coding'),
      supportsVision: m.capabilities.includes('vision'),
      availability: m.availability === 'available' ? 'available' : 'unknown',
      source: 'registry' as const,
      registryScores: m.scores,
      // Static rows are curated fallback metadata (never live-observed).
      contextSource: 'registry' as const,
      freeAuthority: (m.price.isFree ? 'registry-confirmed' : 'none') as FreeAuthority,
      capabilityProvenance: {
        coding: 'curated',
        reasoning: 'curated',
        vision: 'curated',
        toolCalling: 'curated',
        structuredOutput: 'curated',
      } as CapabilityProvenanceMap,
      metadataConfidence: 'medium' as const,
    }));
  console.log('[model-intelligence] Static models after filtering:', staticModels.length);
  let liveModels: NormalizedModel[] = [];
  try {
    const liveByProvider = await fetchLiveModels(userId);
    debugLog('live providers:', liveByProvider.map((g) => g.providerId + '(' + g.models.length + ')').join(','));
    for (const group of liveByProvider) {
      if (!connectedIds.includes(group.providerId)) {
        debugLog('Skipping live group provider', group.providerId, 'not in connectedIds');
        continue;
      }
      for (const m of group.models) {
        const staticEntry = STATIC_MODEL_REGISTRY.find((s) => s.providerId === group.providerId && s.modelId === m.modelId);
        // Provenance comes from normalizeProviderModel (live payload evidence vs
        // exact-match static fill vs unknown). The normalizer already enforced:
        // live nulls never overwrite static metadata, and 'registry' is never
        // stamped on null prices — so no recompute here, just passthrough.
        const priceSource = m.priceSource ?? 'unknown';
        liveModels.push({
          provider: m.providerId,
          modelId: m.modelId,
          displayName: m.displayName,
          isFree: m.price.isFree,
          inputPrice: m.price.input,
          outputPrice: m.price.output,
          priceSource,
          priceFetchedAt: priceSource !== 'unknown' ? nowIso : null,
          contextWindow: m.contextWindow,
          maxOutputTokens: m.maxOutputTokens,
          supportsReasoning: m.supportsReasoning,
          supportsToolCalling: m.supportsToolCalling,
          supportsStructuredOutput: m.supportsStructuredOutput,
          supportsCoding: m.capabilities.includes('coding'),
          supportsVision: m.capabilities.includes('vision'),
          availability: m.availability === 'available' ? 'available' : 'unknown',
          source: 'live' as const,
          registryScores: staticEntry?.scores,
          contextSource: m.contextSource,
          freeAuthority: m.freeAuthority,
          capabilityProvenance: m.capabilityProvenance,
          metadataConfidence: m.metadataConfidence,
          modalities: m.modalities,
        });
      }
    }
  } catch (err) {
    console.warn('[model-intelligence] Live fetch failed:', err);
  }

  console.log('[model-intelligence] Merged static (%d) + live (%d) models', staticModels.length, liveModels.length);
  const merged = new Map<string, NormalizedModel>();
  for (const m of staticModels) merged.set(m.provider + ':' + m.modelId, m);
  for (const m of liveModels) {
    const existing = merged.get(m.provider + ':' + m.modelId);
    merged.set(m.provider + ':' + m.modelId, {
      ...m,
      registryScores: m.registryScores ?? existing?.registryScores,
    });
  }

  const result = Array.from(merged.values());
  const byProvider: Record<string, number> = {};
  for (const m of result) {
    byProvider[m.provider] = (byProvider[m.provider] || 0) + 1;
  }
  debugLog('Final catalog by provider:', JSON.stringify(byProvider), 'total:', result.length);
  return result;
}

/**
 * Providers whose FREE-tier models reject server-side generation. OpenCode Zen
 * answers POST /chat/completions with HTTP 403 FreeTierError ("OpenCode's free
 * tier can only be used from within OpenCode") for every server-side caller —
 * measured, see think/state.md. This restriction is scoped to the SERVER-SIDE
 * CLASSIFIER's generation-model choice ONLY: user-facing Free selection,
 * price.isFree, confirmedFreeIds, Free stage cards and strict-Free runtime keep
 * seeing these models as confirmed free. Provider-aware by normalized provider
 * identity (never model-ID hardcoding), no provider ranking, no replacement
 * model preference.
 */
const CLASSIFIER_BLOCKED_PROVIDERS: ReadonlySet<ProviderName> = new Set(['opencode']);

/**
 * The classifier's generation model: confirmed-free (strict — a paid model can
 * never be selected), context-capable, and eligible for server-side generation
 * (CLASSIFIER_BLOCKED_PROVIDERS above). Score formula, stable-sort tie-break
 * and input order are unchanged; no model is hardcoded as a replacement. Null
 * when nothing qualifies — the caller uses the existing deterministic fallback
 * (getOrBuildCatalog's null branch), never a paid model.
 * Exported as a probe hook (tests exercise eligibility + fallback directly).
 */
export function selectFreeModelForClassification(models: NormalizedModel[]): NormalizedModel | null {
  const freeModels = models.filter(
    (m) => m.isFree && m.contextWindow >= 8000 && !CLASSIFIER_BLOCKED_PROVIDERS.has(m.provider)
  );
  if (freeModels.length === 0) return null;
  const scored = freeModels.map((m) => ({
    model: m,
    score: (m.supportsCoding ? 2 : 0) + (m.supportsReasoning ? 2 : 0) + (m.supportsToolCalling ? 1 : 0),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0].model;
}

function deterministicRank(models: NormalizedModel[]): ClassifiedModel[] {
  return models.map((m) => {
    const codingScore = computeCodingScore(m);
    const reasoningScore = computeReasoningScore(m);
    const speedScore = computeSpeedScore(m);
    const longContextScore = computeLongContextScore(m);
    const valueScore = computeValueScore(m);
    const overallScore = Math.round(
      codingScore * 0.3 + reasoningScore * 0.25 + speedScore * 0.15 + longContextScore * 0.15 + valueScore * 0.15
    );
    const categories: string[] = [];
    if (codingScore >= 60) categories.push('best-coding');
    if (reasoningScore >= 60) categories.push('best-reasoning');
    if (speedScore >= 60) categories.push('fast');
    if (longContextScore >= 60) categories.push('long-context');
    if (valueScore >= 60) categories.push('best-value');
    if (m.isFree) categories.push('free');
    return { ...m, codingScore, reasoningScore, speedScore, longContextScore, valueScore, overallScore, recommendedCategories: categories, scoreOrigin: 'deterministic' as const };
  }).sort((a, b) => b.overallScore - a.overallScore);
}

// ── Deterministic, metadata-derived capability scoring ──
//
// Every point of these scores maps to concrete evidence in the model's record:
//   - capability booleans (tool calling / reasoning / structured output) come
//     from the provider's own catalog metadata where available (OpenRouter
//     supported_parameters) — see lib/ai/catalog/live.ts and modelSignals.ts;
//   - context scores map to the provider-reported context_length;
//   - speed uses ONLY the deterministic size/active-size signals parsed from
//     the model ID (MoE active params are the closest honest proxy) plus the
//     free-tier serving behavior. NO benchmark numbers are invented.
//
// The goal is DISCRIMINATION backed by data: distinct metadata must produce
// distinct scores, so stage selection reflects real differences instead of
// collapsing hundreds of models into 3-4 identical buckets.

/** Maps context_length to a 0–100 long-context score (piecewise, documented). */
function contextToScore(ctx: number): number {
  if (ctx >= 1_000_000) return 95;
  if (ctx >= 512_000) return 85;
  if (ctx >= 256_000) return 75;
  if (ctx >= 200_000) return 70;
  if (ctx >= 128_000) return 55;
  if (ctx >= 48_000) return 40;
  if (ctx >= 32_000) return 30;
  if (ctx >= 16_000) return 20;
  return 10;
}

/** Deterministic speed score: active parameter size from the model ID. */
function speedScoreFor(m: NormalizedModel, ctx: number): number {
  const active = activeParamBillions(m.modelId);
  let base: number;
  if (active == null) base = 50; // no size signal in the ID
  else if (active <= 4) base = 92;
  else if (active <= 10) base = 84;
  else if (active <= 30) base = 74;
  else if (active <= 70) base = 62;
  else if (active <= 120) base = 50;
  else if (active <= 250) base = 40;
  else base = 30;
  // Larger context windows are slower per request in practice; a small
  // deterministic correction (−1 pt per 128K above 128K, floor 0).
  const ctxPenalty = Math.max(0, Math.floor((ctx - 128_000) / 128_000));
  return Math.max(0, base - ctxPenalty);
}

function computeCodingScore(m: NormalizedModel): number {
  // Coding capability = explicit coding flag (provider-evidence based) +
  // tool calling (agentic coding needs it) + reasoning + long context.
  let score = 25;
  if (m.supportsCoding) score += 35;
  if (m.supportsToolCalling) score += 15;
  if (m.supportsReasoning) score += 10;
  if (m.contextWindow >= 128_000) score += 5;
  if (m.contextWindow >= 256_000) score += 5;
  // Model-family size refinement: large parameter counts signal higher
  // ceiling capability for code understanding.
  const size = paramSizeClass(m.modelId);
  if (size.size === 'large') score += 5;
  if (size.size === 'tiny') score -= 15;
  if (m.registryScores) {
    // Registry-curated entries (verified metadata) blend in their curated
    // 0–5 coding score; live-derived evidence stays dominant.
    const curated = (m.registryScores.coding / 5) * 100;
    return Math.round(Math.min(100, Math.max(0, score * 0.7 + curated * 0.3)));
  }
  return Math.round(Math.min(100, Math.max(0, score)));
}

function computeReasoningScore(m: NormalizedModel): number {
  // Reasoning = explicit reasoning support (provider metadata) + context
  // headroom (long chains of thought need room) + family/size signals.
  let score = 20;
  if (m.supportsReasoning) score += 35;
  else score -= 10; // provider metadata explicitly lacks reasoning params
  if (m.supportsToolCalling) score += 8;
  score += Math.round(contextToScore(m.contextWindow) * 0.2); // up to +19
  const size = paramSizeClass(m.modelId);
  if (size.size === 'large') score += 8;
  if (size.size === 'tiny') score -= 15;
  if (m.registryScores) {
    const curated = (m.registryScores.reasoning / 5) * 100;
    return Math.round(Math.min(100, Math.max(0, score * 0.7 + curated * 0.3)));
  }
  return Math.round(Math.min(100, Math.max(0, score)));
}

function computeSpeedScore(m: NormalizedModel): number {
  return Math.round(Math.min(100, Math.max(0, speedScoreFor(m, m.contextWindow))));
}

function computeLongContextScore(m: NormalizedModel): number {
  if (m.registryScores) {
    const curated = (m.registryScores.longContext / 5) * 100;
    const derived = contextToScore(m.contextWindow);
    return Math.round(Math.min(100, Math.max(0, derived * 0.6 + curated * 0.4)));
  }
  return contextToScore(m.contextWindow);
}

function computeValueScore(m: NormalizedModel): number {
  if (m.isFree) return 95;
  if (m.inputPrice == null || m.outputPrice == null) return 40; // unknown pricing — worse than any known price
  const combined = m.inputPrice * 2 + m.outputPrice; // blended per-1M USD
  // Piecewise cost-efficiency bands (deterministic, explainable).
  const costEfficiency = combined <= 0.3 ? 5 : combined <= 0.75 ? 4 : combined <= 1.5 ? 3 : combined <= 3 ? 2 : 1;
  const quality = (m.supportsCoding ? 1 : 0) + (m.supportsReasoning ? 1 : 0) + (m.supportsToolCalling ? 0.5 : 0);
  return Math.round(quality * 12 + costEfficiency * 12);
}

/**
 * Classification outcome. `applied: false` means NO batch's output was usable
 * (every batch: HTTP failure, unparseable, skipped, or fewer scored entries
 * than the batch — the typical truncation case) and deterministic metadata
 * scoring was used for the whole catalog. Callers MUST NOT report
 * classified_by_ai=true for `applied: false` results: stamping a failed
 * classification misled the UI and meta stats while hundreds of models carried
 * identical constant scores. With batching, `applied: true` means at LEAST one
 * batch's AI scores were accepted — batches that failed still carry their own
 * deterministic scores (the same partial tolerance the per-entry gap fallback
 * already had).
 */
interface ClassificationOutcome {
  models: ClassifiedModel[];
  applied: boolean;
}

/**
 * Maximum models per AI classification REQUEST. Each scored entry costs ~40-50
 * output tokens and max_tokens is 8192 (raised from 4096 on 2026-09-30 after
 * reasoning output hit finish_reason=length with null content), so requests far
 * beyond this size are ALWAYS truncated (observed at 4096: 576-model catalog →
 * partial JSON → zip-fill assigned constant 50/50/50/50 scores to hundreds of
 * models). Catalogs larger than this are NOT skipped: they are split into
 * bounded, sequential batches of at most this size, each independently
 * validated and merged, so no single response can hit the output budget.
 * Do NOT raise this to "fit" a catalog.
 */
const AI_CLASSIFY_MAX_MODELS = 80;

/**
 * Deterministic, order-preserving split of the catalog into chunks of at most
 * AI_CLASSIFY_MAX_MODELS per request. Input order is untouched (the catalog is
 * already deterministically ordered), boundaries are pure index arithmetic —
 * same catalog → same batches, no randomization, no provider/model preference,
 * and the batch index never enters any prompt or score.
 */
export function splitClassificationBatches<T>(models: T[]): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < models.length; i += AI_CLASSIFY_MAX_MODELS) {
    batches.push(models.slice(i, i + AI_CLASSIFY_MAX_MODELS));
  }
  return batches;
}

interface BatchScoreEntry {
  codingScore: number;
  reasoningScore: number;
  speedScore: number;
  longContextScore: number;
  valueScore: number;
  overallScore?: number;
  recommendedCategories?: string[];
}

/**
 * Maps ONE batch's raw model response onto its models (prompt order = array
 * index = batch order, so identity association is positional and exact).
 * Returns null when the batch output is unusable: non-string/empty content,
 * no JSON array, unparseable JSON, non-array JSON, or fewer scored entries
 * than the batch (the truncation case) — the caller then falls back to
 * deterministic scoring for ALL models of THIS batch only. NEVER zip-fills: a
 * response shorter than the batch is rejected outright. A response as long as
 * the batch with a gap at some index gives THAT model its own deterministic
 * score — never a fabricated constant (that constant fill is what
 * historically flattened hundreds of distinct models into identical
 * 50/50/50/50 scores).
 *
 * `onIssue` (optional) receives a SANTIZED diagnostic note — fixed category
 * literals or plain counts only (e.g. `incomplete:12/80`,
 * `schema:3-of-80-entries`), never response content, prompts, or scores — so
 * callers can log WHY a batch was rejected without leaking model output.
 */
export function applyBatchScores(
  batch: NormalizedModel[],
  content: string,
  onIssue?: (note: string) => void
): ClassifiedModel[] | null {
  const reject = (note: string): null => {
    onIssue?.(note);
    return null;
  };
  if (typeof content !== 'string') return reject('nonstring-content');
  if (content.trim() === '') return reject('empty-content');
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return reject('no-json-array');
  let scores: unknown;
  try {
    scores = JSON.parse(jsonMatch[0]);
  } catch {
    return reject('json-parse-error');
  }
  if (!Array.isArray(scores)) return reject('not-an-array');
  if (scores.length < batch.length) return reject(`incomplete:${scores.length}/${batch.length}`);
  const list = scores as BatchScoreEntry[];
  let schemaIssues = 0;
  const result = batch.map((m, i) => {
    const s = list[i];
    // NO constant fill: an entry the classifier did not actually score must NOT
    // receive a fabricated 50/50/50/50 tuple. Unscored entries fall back to
    // the deterministic metadata ranking for this model instead.
    if (!s || typeof s !== 'object') {
      schemaIssues++;
      const [fallback] = deterministicRank([m]);
      return fallback;
    }
    const codingScore = clamp(s.codingScore);
    const reasoningScore = clamp(s.reasoningScore);
    const speedScore = clamp(s.speedScore);
    const longContextScore = clamp(s.longContextScore);
    const valueScore = clamp(s.valueScore);
    const overallScore = clamp(s.overallScore ?? Math.round(codingScore * 0.3 + reasoningScore * 0.25 + speedScore * 0.15 + longContextScore * 0.15 + valueScore * 0.15));
    return { ...m, codingScore, reasoningScore, speedScore, longContextScore, valueScore, overallScore, recommendedCategories: s.recommendedCategories || [], scoreOrigin: 'ai' as const };
  });
  if (schemaIssues > 0) onIssue?.(`schema:${schemaIssues}-of-${batch.length}-entries`);
  return result;
}

/**
 * Reduces an HTTP-200 error object to a short category token: a numeric (or
 * charset-whitelisted) code/type, ≤64 chars, else `category=unknown`. The
 * error `message`, raw body, headers, and anything that could echo the prompt
 * or model output are deliberately discarded — only this token may reach a
 * log line or thrown Error.
 */
function safeErrorCategory(err: unknown): string {
  if (typeof err === 'number') return 'code=' + err;
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; type?: unknown; error_type?: unknown };
    if (typeof e.code === 'number') return 'code=' + e.code;
    if (typeof e.code === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(e.code)) return 'code=' + e.code;
    for (const candidate of [e.error_type, e.type]) {
      if (typeof candidate === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(candidate)) return 'type=' + candidate;
    }
  }
  return 'category=unknown';
}

/** One bounded classifier request. Throws on transport/HTTP failure — thrown
 * messages carry ONLY the HTTP status or a sanitized error category (never
 * headers, keys, bodies, prompts, or model output). Returns null when the
 * response parsed but is unusable (applyBatchScores rules); rejection
 * categories surface through `onIssue`. Exported as a probe hook (tests
 * exercise the diagnostics against mocked fetch responses). */
export async function classifyBatch(
  batch: NormalizedModel[],
  freeModel: NormalizedModel,
  apiKey: string,
  baseUrl: string,
  onIssue?: (note: string) => void
): Promise<ClassifiedModel[] | null> {
  const modelList = batch.map((m, i) =>
    (i + 1) + '. ' + m.provider + '/' + m.modelId + ' -- ' + m.displayName +
    ' | free=' + m.isFree + ' | price=$' + (m.inputPrice ?? '?') + '/' + (m.outputPrice ?? '?') +
    ' | ctx=' + m.contextWindow + ' | reasoning=' + m.supportsReasoning + ' tools=' + m.supportsToolCalling + ' coding=' + m.supportsCoding
  ).join('\n');

  const prompt = 'You are a model classification engine. Analyze these AI models and assign scores (0-100).\n\nMODELS:\n' + modelList + '\n\nFor EACH model return a JSON object: codingScore, reasoningScore, speedScore, longContextScore, valueScore, overallScore (all 0-100), recommendedCategories (array from ["best-coding","best-reasoning","fast","long-context","best-value","free"]).\nReturn ONLY a JSON array. Example:\n[{"codingScore":85,"reasoningScore":70,"speedScore":60,"longContextScore":80,"valueScore":75,"overallScore":74,"recommendedCategories":["best-coding"]}]';

  const response = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({ model: freeModel.modelId, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 8192 }),
  });
  if (!response.ok) throw new Error('AI classification call failed: ' + response.status);
  const data = await response.json();
  // Gateways (OpenRouter documented) report post-accept failures as HTTP 200
  // whose body holds an `error` and no `choices`. A status-only check passes
  // that, and the empty content would then masquerade as a model-output
  // problem — surface it instead as an API error with a sanitized category.
  if (!data?.choices?.[0]) {
    if (data?.error) throw new Error('classifier http200 api error: ' + safeErrorCategory(data.error));
    throw new Error('classifier http200 missing choices');
  }
  // Shape diagnostics BEFORE any content coercion. Note tokens are strictly
  // sanitized: fixed category literals, booleans, and whitelist-matched enums.
  // NEVER refusal text, reasoning text, tool-call payloads, response bodies,
  // prompts, credentials, or model-generated content.
  const choice = data.choices[0];
  const metaFlags: string[] = [];
  // finish_reason lives on the CHOICE (OpenAI-compatible shape). Whitelist:
  // lowercase enum charset only, else the flag is omitted entirely.
  const finish = choice?.finish_reason;
  if (typeof finish === 'string' && /^[a-z0-9_]{1,32}$/.test(finish)) metaFlags.push('finish_reason=' + finish);
  const message = choice?.message;
  if (!message || typeof message !== 'object') {
    onIssue?.(['missing-message', ...metaFlags].join('|'));
    return null;
  }
  if (message.refusal) metaFlags.push('refusal-present');
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) metaFlags.push('tool-calls-present');
  const reasoning = message.reasoning ?? message.reasoning_content;
  if ((typeof reasoning === 'string' && reasoning.trim() !== '') || (Array.isArray(reasoning) && reasoning.length > 0)) {
    metaFlags.push('reasoning-present');
  }
  const content = message.content;
  if (content === null || content === undefined) {
    onIssue?.(['null-content', ...metaFlags].join('|'));
    return null;
  }
  if (typeof content !== 'string') {
    onIssue?.(['nonstring-content', ...metaFlags].join('|'));
    return null;
  }
  if (content.trim() === '') {
    onIssue?.(['empty-content', ...metaFlags].join('|'));
    return null;
  }
  const noteWithFlags = (note: string): string =>
    metaFlags.length > 0 && (note === 'json-parse-error' || note === 'no-json-array')
      ? [note, ...metaFlags].join('|')
      : note;
  return applyBatchScores(batch, content, onIssue ? (note) => onIssue?.(noteWithFlags(note)) : undefined);
}

// Exported as a probe hook (tests exercise batching/fallback against a local
// mock); callers inside the app go through getOrBuildCatalog only.
export async function aiClassify(userId: string, models: NormalizedModel[], freeModel: NormalizedModel): Promise<ClassificationOutcome> {
  const batches = splitClassificationBatches(models);
  if (batches.length === 0) return { models: deterministicRank(models), applied: false };

  // Credentials/endpoint resolve ONCE before any request — a missing key still
  // throws to the caller exactly as the single-request implementation did
  // (whole catalog deterministic, classified_by_ai=false).
  const creds = await resolveUserCredentials(userId);
  const apiKey = creds[freeModel.provider] || envKeyForProvider(freeModel.provider);
  if (!apiKey) throw new Error('No API key for ' + freeModel.provider);
  const baseUrl = getBaseUrl(freeModel.provider);

  // Sequential batches: no concurrency to manage, no rate-limit fan-out, one
  // output budget (8192 tokens, raised from 4096) per ≤80-model request — the
  // proven-safe envelope.
  const merged: ClassifiedModel[] = [];
  let appliedBatches = 0;
  let appliedModels = 0;
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    let scored: ClassifiedModel[] | null = null;
    let issueNote = '';
    const onIssue = (note: string) => {
      if (!issueNote) issueNote = note; // first sanitized rejection category wins
    };
    try {
      scored = await classifyBatch(batch, freeModel, apiKey, baseUrl, onIssue);
    } catch (err) {
      console.warn(`[model-intelligence] AI classification batch ${i + 1}/${batches.length} failed:`, err);
    }
    if (scored) {
      merged.push(...scored);
      appliedBatches++;
      appliedModels += batch.length;
    } else {
      // Failed/truncated batch falls back to deterministic scoring for ITS
      // models only — successful batches stay applied and are never re-scored.
      merged.push(...deterministicRank(batch));
    }
    console.log(`[model-intelligence] classification batch ${i + 1}/${batches.length} (${batch.length} models): ${scored ? 'ai-applied' : 'deterministic-fallback'}${issueNote ? ` [${issueNote}]` : ''}`);
  }
  console.log(`[model-intelligence] classification total: ${appliedModels}/${models.length} models AI-scored (${appliedBatches}/${batches.length} batches applied)`);
  // One global sort mirrors the single-request behavior (stable sort keeps
  // batch order for ties). Batch index is not a scoring signal anywhere.
  merged.sort((a, b) => b.overallScore - a.overallScore);
  return { models: merged, applied: appliedBatches > 0 };
}

function getBaseUrl(provider: ProviderName): string {
  const urls: Record<string, string> = {
    openrouter: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    chutes: process.env.CHUTES_BASE_URL || 'https://llm.chutes.ai/v1',
    opencode: process.env.OPENCODE_ZEN_BASE_URL || 'https://opencode.ai/zen/v1',
    openai: 'https://api.openai.com/v1',
    gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
    deepseek: 'https://api.deepseek.com/v1',
    zai: 'https://api.z.ai/api/paas/v4',
  };
  return urls[provider] || 'https://api.openai.com/v1';
}

function clamp(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0; // classifier omitted/garbled this field — 0, never a fake mid score
  return Math.max(0, Math.min(100, Math.round(n)));
}

const AI_SOURCE_STAMP = 'ai_classified';
const AI_SOURCE_PREFIX = 'ai_classified:';

/**
 * Encodes THIS row's score origin + entry provenance into the existing
 * `source` column (no schema migration):
 *   'ai_classified:registry' | 'ai_classified:live'
 *       — scores came from the AI classifier; entry provenance survives the
 *         colon. Written ONLY for rows the classifier actually scored, so a
 *         partial batch failure can no longer stamp fallback rows as AI.
 *   'registry' | 'live'
 *       — deterministic (metadata-derived) scores AND entry provenance,
 *         byte-identical to what the pre-fix writer produced.
 *   'ai_classified'
 *       — legacy catalog-wide stamp (pre-fix, when classifiedByAi=true);
 *         parsePersistedSource keeps reading it.
 */
export function persistedSource(m: Pick<ClassifiedModel, 'source' | 'scoreOrigin'>): string {
  if (m.scoreOrigin === 'ai') {
    return m.source === 'registry' || m.source === 'live' ? AI_SOURCE_PREFIX + m.source : AI_SOURCE_STAMP;
  }
  // Deterministic rows always come from fresh discovery ('registry'|'live').
  // The ':live' fallback only guards the unreachable legacy combination (a
  // pre-fix 'ai_classified' source on a deterministic row), keeping the
  // encoded value inside the documented domain without claiming AI.
  return m.source === 'registry' ? 'registry' : 'live';
}

/** Inverse of persistedSource — parses a stored `source` value. */
export function parsePersistedSource(raw: string | null | undefined): { source: NormalizedModel['source']; scoreOrigin: ScoreOrigin } {
  if (raw != null && raw.startsWith(AI_SOURCE_PREFIX)) {
    const entry = raw.slice(AI_SOURCE_PREFIX.length);
    // Unknown composite suffix: the 'ai_classified:' prefix still proves the
    // score origin; keep the legacy provenance-less value rather than invent one.
    return { source: entry === 'registry' || entry === 'live' ? entry : AI_SOURCE_STAMP, scoreOrigin: 'ai' };
  }
  if (raw === AI_SOURCE_STAMP) return { source: AI_SOURCE_STAMP, scoreOrigin: 'ai' }; // legacy pre-fix stamp
  if (raw === 'registry' || raw === 'live') return { source: raw, scoreOrigin: 'deterministic' };
  // No writer has produced any other value. Default conservatively: a row
  // without a recognisable stamp must NEVER read as AI-classified.
  return { source: 'live', scoreOrigin: 'deterministic' };
}

/**
 * One `model_catalog` upsert row (exported so tests can round-trip the exact
 * persistence mapping without a database). `source` carries the per-row score
 * origin via persistedSource().
 */
export function toCatalogRow(
  m: ClassifiedModel,
  ctx: { userId: string; providerFingerprint: string; analyzedAt: string }
): ModelCatalogRow {
  return {
    user_id: ctx.userId, provider: m.provider, model_id: m.modelId, display_name: m.displayName,
    is_free: m.isFree, input_price: m.inputPrice, output_price: m.outputPrice,
    price_source: m.priceSource, price_fetched_at: m.priceFetchedAt,
    context_window: m.contextWindow, max_output_tokens: m.maxOutputTokens,
    supports_reasoning: m.supportsReasoning, supports_tool_calling: m.supportsToolCalling,
    supports_structured_output: m.supportsStructuredOutput, supports_coding: m.supportsCoding,
    supports_vision: m.supportsVision, coding_score: m.codingScore, reasoning_score: m.reasoningScore,
    speed_score: m.speedScore, long_context_score: m.longContextScore, value_score: m.valueScore,
    overall_score: m.overallScore, recommended_categories: m.recommendedCategories,
    availability: m.availability, source: persistedSource(m),
    provider_fingerprint: ctx.providerFingerprint, last_analyzed_at: ctx.analyzedAt,
  };
}

/** Row shape written to/read from `model_catalog` by the helpers above. */
export interface ModelCatalogRow {
  user_id?: string;
  provider: string;
  model_id: string;
  display_name: string;
  is_free: boolean;
  input_price: number | null;
  output_price: number | null;
  price_source?: string | null;
  price_fetched_at?: string | null;
  context_window: number;
  max_output_tokens: number | null;
  supports_reasoning: boolean;
  supports_tool_calling: boolean;
  supports_structured_output: boolean;
  supports_coding: boolean;
  supports_vision: boolean;
  availability: string;
  source?: string | null;
  coding_score: number;
  reasoning_score: number;
  speed_score: number;
  long_context_score: number;
  value_score: number;
  overall_score: number;
  recommended_categories?: string[] | null;
  provider_fingerprint?: string;
  last_analyzed_at?: string;
}

/** Inverse of toCatalogRow (exported for tests). */
export function fromCatalogRow(r: ModelCatalogRow): ClassifiedModel {
  const parsed = parsePersistedSource(r.source);
  return {
    provider: r.provider as ProviderName, modelId: r.model_id, displayName: r.display_name,
    isFree: r.is_free, inputPrice: r.input_price, outputPrice: r.output_price,
    // Default pre-migration rows to 'unknown' — do not assume stale prices are
    // live or registry-confirmed.
    priceSource: (r.price_source ?? 'unknown') as NormalizedModel['priceSource'], priceFetchedAt: r.price_fetched_at ?? null,
    contextWindow: r.context_window, maxOutputTokens: r.max_output_tokens,
    supportsReasoning: r.supports_reasoning, supportsToolCalling: r.supports_tool_calling,
    supportsStructuredOutput: r.supports_structured_output, supportsCoding: r.supports_coding,
    supportsVision: r.supports_vision, availability: r.availability as NormalizedModel['availability'],
    source: parsed.source, scoreOrigin: parsed.scoreOrigin,
    codingScore: r.coding_score, reasoningScore: r.reasoning_score, speedScore: r.speed_score,
    longContextScore: r.long_context_score, valueScore: r.value_score, overallScore: r.overall_score,
    recommendedCategories: r.recommended_categories || [],
  };
}

async function storeCatalog(userId: string, result: ModelIntelligenceResult): Promise<void> {
  const db = createBackgroundClient();
  // Meta-level provenance: the most authoritative price confirmation across
  // the catalog (live beats registry beats unknown; freshest timestamp wins).
  const rank = { live: 2, registry: 1, unknown: 0 } as const;
  const bestPrice = result.models.reduce<{ source: 'live' | 'registry' | 'unknown'; at: string | null }>((best, m) => {
    const src = m.priceSource ?? 'unknown';
    if (rank[src] > rank[best.source]) return { source: src, at: m.priceFetchedAt ?? null };
    if (rank[src] === rank[best.source] && m.priceFetchedAt && (!best.at || m.priceFetchedAt > best.at)) {
      return { source: src, at: m.priceFetchedAt };
    }
    return best;
  }, { source: 'unknown', at: null });
  // Per-row score origin: each row's `source` reflects whether THIS row was
  // AI-scored (ai_classified:<entry>) or deterministically scored (<entry>) —
  // never stamped catalog-wide from result.classifiedByAi (that over-credited
  // deterministic fallback rows whenever only some batches applied).
  const rows = result.models.map((m) =>
    toCatalogRow(m, { userId, providerFingerprint: result.providerFingerprint, analyzedAt: result.analyzedAt })
  );

  // Upsert row-by-row (chunked), THEN write meta LAST.
  //
  // Why not delete-then-insert: the old sequence (meta upsert → DELETE all →
  // INSERT) left the catalog EMPTY whenever any insert batch failed, and
  // loadCatalog() then returned null → the very next request went through a
  // full synchronous rebuild (all provider fetches + classification + writes)
  // — the 20s /api/models loop. Persisted rows also vanish while a batch is
  // in flight. An upsert on (user_id, provider, model_id) keeps the previous
  // catalog intact when a batch fails and makes every write idempotent.
  //
  // Why meta LAST: meta.last_analyzed_at is the freshness clock. Writing meta
  // first marked the catalog fresh while rows were still being (re)written, so
  // a crash mid-store pinned a stale catalog until TTL expiry; writing meta
  // last means a failed store leaves the OLD meta (old analyzedAt) → the next
  // request correctly sees stale and retries the refresh.
  let stored = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const { error } = await db.from('model_catalog').upsert(batch, { onConflict: 'user_id,provider,model_id' });
    if (error) {
      console.error('[model-intelligence] Store error:', error.message);
      continue;
    }
    stored += batch.length;
  }

  // Remove rows that dropped out of the rebuilt catalog (disconnected
  // provider, vanished model) — delete-by-fingerprint, so a failed rebuild
  // never destroys the previous catalog's data.
  if (stored > 0) {
    const { error: delErr } = await db.from('model_catalog')
      .delete()
      .eq('user_id', userId)
      .neq('provider_fingerprint', result.providerFingerprint);
    if (delErr) console.error('[model-intelligence] Cleanup error:', delErr.message);
  }

  // Meta LAST (see above): freshness clock only advances after rows persisted.
  // Truthful counts: classified_by_ai is a CATALOG-level flag meaning "at least
  // one classifier batch was accepted" (see aiClassify); per-row score origin
  // lives in each row's `source` (see persistedSource) and is never derived
  // from this flag.
  await db.from('model_catalog_meta').upsert({
    user_id: userId, provider_fingerprint: result.providerFingerprint,
    model_count: result.models.length, free_model_count: result.models.filter((m) => m.isFree).length,
    paid_model_count: result.models.filter((m) => !m.isFree).length, classified_by_ai: result.classifiedByAi,
    classification_model: result.classificationModel, last_analyzed_at: result.analyzedAt,
    price_source: bestPrice.source, price_fetched_at: bestPrice.at,
  }, { onConflict: 'user_id' });
}

async function loadCatalog(userId: string): Promise<ModelIntelligenceResult | null> {
  const db = createBackgroundClient();
  const { data: meta, error: metaErr } = await db.from('model_catalog_meta').select('*').eq('user_id', userId).maybeSingle();
  if (metaErr || !meta) return null;
  const { data: rows, error: rowsErr } = await db.from('model_catalog').select('*').eq('user_id', userId).order('overall_score', { ascending: false });
  if (rowsErr || !rows || rows.length === 0) return null;
  const models: ClassifiedModel[] = rows.map((r) => fromCatalogRow(r as ModelCatalogRow));
  // Enrich with CURRENT static registry scores (no registry_scores DB column):
  // keeps loaded live rows from being stuck with build-time default scores.
  for (const m of models) {
    const s = STATIC_MODEL_REGISTRY.find((e) => e.providerId === m.provider && e.modelId === m.modelId);
    if (s) m.registryScores = s.scores;
  }
  return { models, providerFingerprint: meta.provider_fingerprint, classifiedByAi: meta.classified_by_ai, classificationModel: meta.classification_model, analyzedAt: meta.last_analyzed_at };
}

// Single-flight guard: dedupes concurrent force rebuilds for the same user so
// a connect/disconnect background refresh and a racing page request share one
// build instead of interleaving provider fetches and model_catalog rewrites.
const inFlightRebuilds = new Map<string, Promise<ModelIntelligenceResult>>();

/**
 * Force-rebuilds the catalog for a user, collapsing concurrent calls into a
 * single build. Connect/disconnect routes and the manual refresh endpoint
 * should use this instead of getOrBuildCatalog(userId, true) so that a
 * background refresh and a page GET triggered right after connect cannot run
 * two competing builds (duplicate provider API calls, interleaved deletes).
 */
export function rebuildCatalogOnce(userId: string): Promise<ModelIntelligenceResult> {
  let p = inFlightRebuilds.get(userId);
  if (!p) {
    p = getOrBuildCatalog(userId, true).finally(() => {
      inFlightRebuilds.delete(userId);
    });
    inFlightRebuilds.set(userId, p);
  }
  return p;
}

export async function getOrBuildCatalog(userId: string, forceRefresh = false): Promise<ModelIntelligenceResult> {
  if (!forceRefresh) {
    const existing = await loadCatalog(userId);
    if (existing) {
      const connected = await getProviderConnections(userId);
      const fingerprint = buildProviderFingerprint(connected);

      if (existing.providerFingerprint !== fingerprint) {
        // Provider set changed (connect/disconnect): the persisted catalog no
        // longer matches reality. Rebuild synchronously (deduped) so the
        // request that follows an explicit user action reflects it; keep the
        // last-known catalog only if the rebuild fails or comes back empty.
        try {
          const rebuilt = await rebuildCatalogOnce(userId);
          if (rebuilt.models.length > 0) return rebuilt;
        } catch (err) {
          console.warn('[model-intelligence] Fingerprint rebuild failed, serving persisted catalog:', err);
        }
        return existing;
      }

      if (isCatalogStale(existing.analyzedAt)) {
        // Merely time-stale: serve the persisted catalog immediately (do not
        // block routine page loads) and refresh in the background, deduped.
        rebuildCatalogOnce(userId).catch((err) =>
          console.warn('[model-intelligence] Background staleness refresh failed:', err)
        );
      }

      return existing;
    }
  }
  const models = await discoverModels(userId);
  if (models.length === 0) {
    return { models: [], providerFingerprint: 'none', classifiedByAi: false, classificationModel: null, analyzedAt: new Date().toISOString() };
  }
  const connected = await getProviderConnections(userId);
  const fingerprint = buildProviderFingerprint(connected);
  const freeModel = selectFreeModelForClassification(models);
  let classified: ClassifiedModel[];
  let classifiedByAi = false;
  let classificationModel: string | null = null;
  if (freeModel) {
    try {
      const outcome = await aiClassify(userId, models, freeModel);
      classified = outcome.models;
      // classifiedByAi is TRUE only when the classifier's output was actually
      // applied (complete, parseable score list). aiClassify itself falls back
      // to deterministicRank on any unusable output; stamping those fallbacks
      // as 'AI classified' was misleading (UI + meta stats).
      classifiedByAi = outcome.applied;
      classificationModel = outcome.applied ? freeModel.provider + '/' + freeModel.modelId : null;
    } catch (err) {
      console.warn('[model-intelligence] AI classification failed:', err);
      classified = deterministicRank(models);
      classifiedByAi = false;
      classificationModel = null;
    }
  } else {
    classified = deterministicRank(models);
  }
  const result: ModelIntelligenceResult = { models: classified, providerFingerprint: fingerprint, classifiedByAi, classificationModel, analyzedAt: new Date().toISOString() };
  try { await storeCatalog(userId, result); } catch (err) { console.error('[model-intelligence] Failed to store catalog:', err); }
  return result;
}
