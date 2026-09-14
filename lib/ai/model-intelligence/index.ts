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

async function discoverModels(userId: string): Promise<NormalizedModel[]> {
  const connected = await getProviderConnections(userId);
  const connectedIds = (Object.keys(connected) as ProviderName[]).filter((p) => connected[p]);
  console.log('[model-intelligence] getProviderConnections returned:', connected);
  if (connectedIds.length === 0) {
    console.log('[model-intelligence] No connected providers');
    return [];
  }
  console.log('[model-intelligence] Connected providers:', connectedIds);

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
        liveModels.push({
          provider: m.providerId,
          modelId: m.modelId,
          displayName: m.displayName,
          isFree: m.price.isFree,
          inputPrice: m.price.input,
          outputPrice: m.price.output,
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

async function aiClassify(userId: string, models: NormalizedModel[], freeModel: NormalizedModel): Promise<ClassifiedModel[]> {
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
  if (!jsonMatch) return deterministicRank(models);

  try {
    const scores = JSON.parse(jsonMatch[0]) as Array<{ codingScore: number; reasoningScore: number; speedScore: number; longContextScore: number; valueScore: number; overallScore: number; recommendedCategories: string[] }>;
    return models.map((m, i) => {
      const s = scores[i] || {};
      const codingScore = clamp(s.codingScore ?? 50);
      const reasoningScore = clamp(s.reasoningScore ?? 50);
      const speedScore = clamp(s.speedScore ?? 50);
      const longContextScore = clamp(s.longContextScore ?? 50);
      const valueScore = clamp(s.valueScore ?? 50);
      const overallScore = clamp(s.overallScore ?? Math.round(codingScore * 0.3 + reasoningScore * 0.25 + speedScore * 0.15 + longContextScore * 0.15 + valueScore * 0.15));
      return { ...m, codingScore, reasoningScore, speedScore, longContextScore, valueScore, overallScore, recommendedCategories: s.recommendedCategories || [] };
    }).sort((a, b) => b.overallScore - a.overallScore);
  } catch {
    return deterministicRank(models);
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
    zai: 'https://api.z.ai/v1',
  };
  return urls[provider] || 'https://api.openai.com/v1';
}

function clamp(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

async function storeCatalog(userId: string, result: ModelIntelligenceResult): Promise<void> {
  const db = createBackgroundClient();
  await db.from('model_catalog_meta').upsert({
    user_id: userId, provider_fingerprint: result.providerFingerprint,
    model_count: result.models.length, free_model_count: result.models.filter((m) => m.isFree).length,
    paid_model_count: result.models.filter((m) => !m.isFree).length, classified_by_ai: result.classifiedByAi,
    classification_model: result.classificationModel, last_analyzed_at: result.analyzedAt,
  }, { onConflict: 'user_id' });
  await db.from('model_catalog').delete().eq('user_id', userId);
  const rows = result.models.map((m) => ({
    user_id: userId, provider: m.provider, model_id: m.modelId, display_name: m.displayName,
    is_free: m.isFree, input_price: m.inputPrice, output_price: m.outputPrice,
    context_window: m.contextWindow, max_output_tokens: m.maxOutputTokens,
    supports_reasoning: m.supportsReasoning, supports_tool_calling: m.supportsToolCalling,
    supports_structured_output: m.supportsStructuredOutput, supports_coding: m.supportsCoding,
    supports_vision: m.supportsVision, coding_score: m.codingScore, reasoning_score: m.reasoningScore,
    speed_score: m.speedScore, long_context_score: m.longContextScore, value_score: m.valueScore,
    overall_score: m.overallScore, recommended_categories: m.recommendedCategories,
    availability: m.availability, source: result.classifiedByAi ? 'ai_classified' : m.source,
    provider_fingerprint: result.providerFingerprint, last_analyzed_at: result.analyzedAt,
  }));
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const { error } = await db.from('model_catalog').insert(batch);
    if (error) console.error('[model-intelligence] Store error:', error.message);
  }
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
    contextWindow: r.context_window, maxOutputTokens: r.max_output_tokens,
    supportsReasoning: r.supports_reasoning, supportsToolCalling: r.supports_tool_calling,
    supportsStructuredOutput: r.supports_structured_output, supportsCoding: r.supports_coding,
    supportsVision: r.supports_vision, availability: r.availability, source: r.source,
    codingScore: r.coding_score, reasoningScore: r.reasoning_score, speedScore: r.speed_score,
    longContextScore: r.long_context_score, valueScore: r.value_score, overallScore: r.overall_score,
    recommendedCategories: r.recommended_categories || [],
  }));
  return { models, providerFingerprint: meta.provider_fingerprint, classifiedByAi: meta.classified_by_ai, classificationModel: meta.classification_model, analyzedAt: meta.last_analyzed_at };
}

export async function getOrBuildCatalog(userId: string, forceRefresh = false): Promise<ModelIntelligenceResult> {
  if (!forceRefresh) {
    const existing = await loadCatalog(userId);
    if (existing) return existing;
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
      classified = await aiClassify(userId, models, freeModel);
      classifiedByAi = true;
      classificationModel = freeModel.provider + '/' + freeModel.modelId;
    } catch (err) {
      console.warn('[model-intelligence] AI classification failed:', err);
      classified = deterministicRank(models);
    }
  } else {
    classified = deterministicRank(models);
  }
  const result: ModelIntelligenceResult = { models: classified, providerFingerprint: fingerprint, classifiedByAi, classificationModel, analyzedAt: new Date().toISOString() };
  try { await storeCatalog(userId, result); } catch (err) { console.error('[model-intelligence] Failed to store catalog:', err); }
  return result;
}

export async function refreshCatalogIfNeeded(userId: string): Promise<ModelIntelligenceResult> {
  const connected = await getProviderConnections(userId);
  const currentFingerprint = buildProviderFingerprint(connected);
  const existing = await loadCatalog(userId);
  if (existing && existing.providerFingerprint === currentFingerprint) return existing;
  return getOrBuildCatalog(userId, true);
}
