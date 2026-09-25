// Model Intelligence - centralized model analysis system.
// Provider change detected -> discover models -> normalize -> AI classify -> store -> cache

import { createBackgroundClient } from '@/lib/supabase/background';
import type { ProviderName } from '../catalog/types';
export type { ProviderName };
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
  source: 'registry' | 'live';
  registryScores?: { coding: number; reasoning: number; speed: number; longContext: number };
}

export interface ClassifiedModel extends NormalizedModel {
  codingScore: number;
  reasoningScore: number;
  speedScore: number;
  longContextScore: number;
  valueScore: number;
  overallScore: number;
  recommendedCategories: string[];
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

async function discoverModels(userId: string): Promise<NormalizedModel[]> {
  const connected = await getProviderConnections(userId);
  const connectedIds = (Object.keys(connected) as ProviderName[]).filter((p) => connected[p]);
  console.log('[model-intelligence] getProviderConnections returned:', connected);
  if (connectedIds.length === 0) {
    console.log('[model-intelligence] No connected providers');
    return [];
  }
  console.log('[model-intelligence] Connected providers:', connectedIds);

  const nowIso = new Date().toISOString();
  console.log('[model-intelligence] STATIC_MODEL_REGISTRY count:', STATIC_MODEL_REGISTRY.length);
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
    }));
  console.log('[model-intelligence] Static models after filtering:', staticModels.length);
  let liveModels: NormalizedModel[] = [];
  try {
    const liveByProvider = await fetchLiveModels(userId);
    console.log('[model-intelligence] Live providers response:', liveByProvider.map((g) => g.providerId + '(' + g.models.length + ')'));
    console.log('[model-intelligence] Live models count:', liveModels.length);
    for (const group of liveByProvider) {
      if (!connectedIds.includes(group.providerId)) {
        console.log('[model-intelligence] Skipping live group provider', group.providerId, 'not in connectedIds');
        continue;
      }
      console.log('[model-intelligence] Processing live models for provider', group.providerId, 'count:', group.models.length);
      for (const m of group.models) {
        const staticEntry = STATIC_MODEL_REGISTRY.find((s) => s.providerId === group.providerId && s.modelId === m.modelId);
        // 'live' provenance only when the live payload carried an actual price;
        // registry-backed live entries (openai/gemini/deepseek/zai) inherit the
        // registry fallback, unknown when neither source has pricing.
        const liveHasPrice = m.price.input != null || m.price.output != null;
        const usesStaticPrice = !liveHasPrice && !!(staticEntry && (staticEntry.price.input != null || staticEntry.price.output != null));
        liveModels.push({
          provider: m.providerId,
          modelId: m.modelId,
          displayName: m.displayName,
          isFree: m.price.isFree,
          inputPrice: m.price.input,
          outputPrice: m.price.output,
          priceSource: liveHasPrice ? 'live' : usesStaticPrice ? 'registry' : 'unknown',
          priceFetchedAt: liveHasPrice || usesStaticPrice ? nowIso : null,
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
        });
      }
    }
  } catch (err) {
    console.warn('[model-intelligence] Live fetch failed:', err);
  }

  console.log('[model-intelligence] Merging static (', staticModels.length, ') with live (', liveModels.length, ') models');
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
  console.log('[model-intelligence] Final catalog:', byProvider, 'total:', result.length);
  return result;
}

function selectFreeModelForClassification(models: NormalizedModel[]): NormalizedModel | null {
  const freeModels = models.filter((m) => m.isFree && m.contextWindow >= 8000);
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
    return { ...m, codingScore, reasoningScore, speedScore, longContextScore, valueScore, overallScore, recommendedCategories: categories };
  }).sort((a, b) => b.overallScore - a.overallScore);
}

function registryBoost(m: NormalizedModel, base: number): number {
  if (!m.registryScores) return base;
  const avg = (m.registryScores.coding + m.registryScores.reasoning + m.registryScores.speed + m.registryScores.longContext) / 4;
  return Math.round(base * 0.6 + (avg / 5) * 100 * 0.4);
}

function computeCodingScore(m: NormalizedModel): number {
  let score = 30;
  if (m.supportsCoding) score += 20;
  if (m.supportsReasoning) score += 10;
  if (m.supportsToolCalling) score += 8;
  if (m.contextWindow >= 100_000) score += 7;
  if (m.contextWindow >= 200_000) score += 5;
  const base = Math.min(80, score);
  if (m.registryScores) return registryBoost(m, base);
  return base;
}

function computeReasoningScore(m: NormalizedModel): number {
  let score = 25;
  if (m.supportsReasoning) score += 25;
  if (m.supportsToolCalling) score += 10;
  if (m.contextWindow >= 100_000) score += 10;
  if (m.contextWindow >= 200_000) score += 5;
  const base = Math.min(75, score);
  if (m.registryScores) return registryBoost(m, base);
  return base;
}

function computeSpeedScore(m: NormalizedModel): number {
  let base: number;
  if (m.isFree) base = 70;
  else if (m.inputPrice != null && m.inputPrice < 0.3) base = 65;
  else if (m.inputPrice != null && m.inputPrice < 1) base = 58;
  else if (m.inputPrice != null && m.inputPrice < 3) base = 48;
  else base = 38;
  if (m.registryScores) return registryBoost(m, base);
  return base;
}

function computeLongContextScore(m: NormalizedModel): number {
  if (m.registryScores) {
    const base = m.contextWindow >= 1_000_000 ? 80 : m.contextWindow >= 200_000 ? 70 : m.contextWindow >= 100_000 ? 55 : 30;
    return registryBoost(m, base);
  }
  if (m.contextWindow >= 1_000_000) return 85;
  if (m.contextWindow >= 200_000) return 70;
  if (m.contextWindow >= 100_000) return 55;
  if (m.contextWindow >= 48_000) return 40;
  if (m.contextWindow >= 24_000) return 25;
  return 15;
}

function computeValueScore(m: NormalizedModel): number {
  if (m.isFree) return 70;
  if (m.inputPrice == null || m.outputPrice == null) return 50;
  const combined = m.inputPrice * 2 + m.outputPrice;
  const quality = (m.supportsCoding ? 1 : 0) + (m.supportsReasoning ? 1 : 0) + (m.supportsToolCalling ? 0.5 : 0);
  const costEfficiency = combined <= 0.5 ? 5 : combined <= 1.5 ? 4 : combined <= 3 ? 3 : combined <= 6 ? 2 : 1;
  return Math.round(quality * 12 + costEfficiency * 12);
}

/**
 * Classification outcome. `applied: false` means the classifier's output was
 * unusable (HTTP failure, unparseable, skipped, or fewer scored entries than
 * models — the typical truncation case) and deterministic metadata scoring
 * was used. Callers MUST NOT report classified_by_ai=true for `applied: false`
 * results: stamping a failed classification misled the UI and meta stats while
 * hundreds of models carried identical constant scores.
 */
interface ClassificationOutcome {
  models: ClassifiedModel[];
  applied: boolean;
}

/**
 * Above this many models the classification call provably cannot succeed: each
 * scored entry costs ~40-50 output tokens and max_tokens is 4096, so anything
 * beyond ~80 models is ALWAYS truncated (observed: 576-model catalog → partial
 * JSON → zip-fill assigned constant 50/50/50/50 scores to hundreds of models).
 * Skipping the doomed call removes ~5-15s of pure latency from every rebuild
 * AND removes the corruption source; deterministic metadata scoring is used
 * instead. Small catalogs still benefit from genuine AI classification.
 */
const AI_CLASSIFY_MAX_MODELS = 80;

async function aiClassify(userId: string, models: NormalizedModel[], freeModel: NormalizedModel): Promise<ClassificationOutcome> {
  if (models.length > AI_CLASSIFY_MAX_MODELS) {
    return { models: deterministicRank(models), applied: false };
  }
  const modelList = models.map((m, i) =>
    (i + 1) + '. ' + m.provider + '/' + m.modelId + ' -- ' + m.displayName +
    ' | free=' + m.isFree + ' | price=$' + (m.inputPrice ?? '?') + '/' + (m.outputPrice ?? '?') +
    ' | ctx=' + m.contextWindow + ' | reasoning=' + m.supportsReasoning + ' tools=' + m.supportsToolCalling + ' coding=' + m.supportsCoding
  ).join('\n');

  const prompt = 'You are a model classification engine. Analyze these AI models and assign scores (0-100).\n\nMODELS:\n' + modelList + '\n\nFor EACH model return a JSON object: codingScore, reasoningScore, speedScore, longContextScore, valueScore, overallScore (all 0-100), recommendedCategories (array from ["best-coding","best-reasoning","fast","long-context","best-value","free"]).\nReturn ONLY a JSON array. Example:\n[{"codingScore":85,"reasoningScore":70,"speedScore":60,"longContextScore":80,"valueScore":75,"overallScore":74,"recommendedCategories":["best-coding"]}]';

  const creds = await resolveUserCredentials(userId);
  const apiKey = creds[freeModel.provider] || envKeyForProvider(freeModel.provider);
  if (!apiKey) throw new Error('No API key for ' + freeModel.provider);

  const baseUrl = getBaseUrl(freeModel.provider);
  const response = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({ model: freeModel.modelId, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 4096 }),
  });

  if (!response.ok) throw new Error('AI classification call failed: ' + response.status);

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return { models: deterministicRank(models), applied: false };

  try {
    const scores = JSON.parse(jsonMatch[0]) as Array<{ codingScore: number; reasoningScore: number; speedScore: number; longContextScore: number; valueScore: number; overallScore: number; recommendedCategories: string[] }>;
    // The classifier frequently truncates its list (max_tokens, refusals).
    // Zip-mapping past the response length silently assigned the 50/50
    // fallback tuple to every unmatched model — flattening hundreds of
    // distinct models into identical generic scores (observed: hundreds of
    // rows all stored 50/50/50/50). A shorter-than-models response is
    // therefore unusable → deterministic metadata scoring for ALL models.
    if (!Array.isArray(scores) || scores.length < models.length) {
      return { models: deterministicRank(models), applied: false };
    }
    return {
      models: models.map((m, i) => {
        const s = scores[i] || {};
        const codingScore = clamp(s.codingScore ?? 50);
        const reasoningScore = clamp(s.reasoningScore ?? 50);
        const speedScore = clamp(s.speedScore ?? 50);
        const longContextScore = clamp(s.longContextScore ?? 50);
        const valueScore = clamp(s.valueScore ?? 50);
        const overallScore = clamp(s.overallScore ?? Math.round(codingScore * 0.3 + reasoningScore * 0.25 + speedScore * 0.15 + longContextScore * 0.15 + valueScore * 0.15));
        return { ...m, codingScore, reasoningScore, speedScore, longContextScore, valueScore, overallScore, recommendedCategories: s.recommendedCategories || [] };
      }).sort((a, b) => b.overallScore - a.overallScore),
      applied: true,
    };
  } catch {
    return { models: deterministicRank(models), applied: false };
  }
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

function clamp(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
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
  const rows = result.models.map((m) => ({
    user_id: userId, provider: m.provider, model_id: m.modelId, display_name: m.displayName,
    is_free: m.isFree, input_price: m.inputPrice, output_price: m.outputPrice,
    price_source: m.priceSource, price_fetched_at: m.priceFetchedAt,
    context_window: m.contextWindow, max_output_tokens: m.maxOutputTokens,
    supports_reasoning: m.supportsReasoning, supports_tool_calling: m.supportsToolCalling,
    supports_structured_output: m.supportsStructuredOutput, supports_coding: m.supportsCoding,
    supports_vision: m.supportsVision, coding_score: m.codingScore, reasoning_score: m.reasoningScore,
    speed_score: m.speedScore, long_context_score: m.longContextScore, value_score: m.valueScore,
    overall_score: m.overallScore, recommended_categories: m.recommendedCategories,
    availability: m.availability, source: result.classifiedByAi ? 'ai_classified' : m.source,
    provider_fingerprint: result.providerFingerprint, last_analyzed_at: result.analyzedAt,
  }));

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
  // Truthful counts: 'source' may say ai_classified for all rows, but the
  // classification itself is deterministic metadata-derived scoring unless
  // classifiedByAi — counts reflect the actual result object, and
  // classifiedByAi is only true when the classifier returned a COMPLETE score
  // list (see aiClassify).
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
  const models: ClassifiedModel[] = rows.map((r) => ({
    provider: r.provider as ProviderName, modelId: r.model_id, displayName: r.display_name,
    isFree: r.is_free, inputPrice: r.input_price, outputPrice: r.output_price,
    // Default pre-migration rows to 'unknown' — do not assume stale prices are
    // live or registry-confirmed.
    priceSource: r.price_source ?? 'unknown', priceFetchedAt: r.price_fetched_at ?? null,
    contextWindow: r.context_window, maxOutputTokens: r.max_output_tokens,
    supportsReasoning: r.supports_reasoning, supportsToolCalling: r.supports_tool_calling,
    supportsStructuredOutput: r.supports_structured_output, supportsCoding: r.supports_coding,
    supportsVision: r.supports_vision, availability: r.availability, source: r.source,
    codingScore: r.coding_score, reasoningScore: r.reasoning_score, speedScore: r.speed_score,
    longContextScore: r.long_context_score, valueScore: r.value_score, overallScore: r.overall_score,
    recommendedCategories: r.recommended_categories || [],
  }));
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

/**
 * Kept as the documented fingerprint/staleness entry point (single refresh
 * mechanism — getOrBuildCatalog owns all freshness logic).
 * Returns the persisted catalog when it is fresh AND matches the current
 * provider set; otherwise rebuilds (deduped).
 */
export async function refreshCatalogIfNeeded(userId: string): Promise<ModelIntelligenceResult> {
  const connected = await getProviderConnections(userId);
  const currentFingerprint = buildProviderFingerprint(connected);
  const existing = await loadCatalog(userId);
  if (
    existing &&
    existing.providerFingerprint === currentFingerprint &&
    !isCatalogStale(existing.analyzedAt)
  ) {
    return existing;
  }
  return rebuildCatalogOnce(userId);
}
