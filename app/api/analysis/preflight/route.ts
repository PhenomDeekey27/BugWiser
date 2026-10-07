import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOrBuildCatalog, type ClassifiedModel } from '@/lib/ai/model-intelligence';

// getOrBuildCatalog runs on the request path and may include a relayed local
// models probe (≤15s) on first build — headroom beyond platform defaults.
export const maxDuration = 60;

interface ModelStrategy {
  tier: 'free' | 'balanced' | 'fast' | 'auto';
  label: string;
  provider: string;
  model: string;
  isFree: boolean;
  costLevel: 'free' | 'low' | 'medium' | 'high';
  speed: 'slow' | 'moderate' | 'fast';
  reason: string;
  contextWindow: number;
  perStage?: Array<{
    stage: string;
    provider: string;
    model: string;
    reason: string;
  }>;
}

// Analysis stages and their requirements
const AI_STAGES = [
  { key: 'relevant_file_discovery', label: 'File Discovery', preferCheap: true, preferSpeed: true, preferCoding: false, preferReasoning: false },
  { key: 'root_cause_analysis', label: 'Root Cause Analysis', preferCheap: false, preferSpeed: false, preferCoding: false, preferReasoning: true },
  { key: 'evidence_extraction', label: 'Evidence Extraction', preferCheap: true, preferSpeed: true, preferCoding: false, preferReasoning: false },
  { key: 'solution_generation', label: 'Solution Generation', preferCheap: false, preferSpeed: false, preferCoding: true, preferReasoning: true },
  { key: 'patch_generation', label: 'Patch Generation', preferCheap: false, preferSpeed: false, preferCoding: true, preferReasoning: true },
];

function sortByKey(models: ClassifiedModel[], key: keyof ClassifiedModel): ClassifiedModel[] {
  return [...models].sort((a, b) => {
    const av = typeof a[key] === 'number' ? (a[key] as number) : 0;
    const bv = typeof b[key] === 'number' ? (b[key] as number) : 0;
    return bv - av;
  });
}

function pickForStage(
  models: ClassifiedModel[],
  stage: typeof AI_STAGES[number],
  exclude: Set<string>
): ClassifiedModel | null {
  const scored = models
    .filter((m) => !exclude.has(`${m.provider}/${m.modelId}`))
    .map((m) => {
      let composite: number;
      if (stage.preferReasoning) {
        composite = m.reasoningScore * 0.5 + m.codingScore * 0.2 + m.valueScore * 0.2 + m.speedScore * 0.1;
      } else if (stage.preferCoding) {
        composite = m.codingScore * 0.4 + m.reasoningScore * 0.3 + m.valueScore * 0.15 + m.speedScore * 0.15;
      } else if (stage.preferSpeed) {
        composite = m.speedScore * 0.4 + m.valueScore * 0.3 + m.codingScore * 0.15 + m.reasoningScore * 0.15;
      } else if (stage.preferCheap) {
        composite = m.valueScore * 0.4 + m.speedScore * 0.3 + m.codingScore * 0.15 + m.reasoningScore * 0.15;
      } else {
        composite = m.overallScore;
      }
      return { model: m, composite };
    })
    .sort((a, b) => b.composite - a.composite);

  return scored[0]?.model ?? null;
}

function pickDistinctForTier(
  models: ClassifiedModel[],
  sortKey: keyof Pick<ClassifiedModel, 'codingScore' | 'reasoningScore' | 'speedScore' | 'valueScore' | 'overallScore'>,
  exclude: Set<string>,
  fallback: ClassifiedModel | null
): ClassifiedModel | null {
  const sorted = sortByKey(models, sortKey);
  for (const m of sorted) {
    const id = `${m.provider}/${m.modelId}`;
    if (!exclude.has(id)) return m;
  }
  return fallback && !exclude.has(`${fallback.provider}/${fallback.modelId}`) ? fallback : null;
}

function buildStrategies(models: ClassifiedModel[]): ModelStrategy[] {
  if (models.length === 0) return [];

  const strategies: ModelStrategy[] = [];
  const usedForDisplay = new Set<string>();

  // ── Free / Lowest Cost ──
  // Sort by VALUE (cost efficiency), prefer free, exclude already-picked
  const freeSorted = [...models]
    .filter((m) => m.isFree)
    .sort((a, b) => b.valueScore - a.valueScore);
  const bestFree = freeSorted[0] ?? null;
  if (bestFree) {
    usedForDisplay.add(`${bestFree.provider}/${bestFree.modelId}`);
    strategies.push({
      tier: 'free',
      label: 'Free / Lowest Cost',
      provider: bestFree.provider,
      model: bestFree.modelId,
      isFree: true,
      costLevel: 'free',
      speed: bestFree.speedScore >= 60 ? 'fast' : bestFree.speedScore >= 40 ? 'moderate' : 'slow',
      reason: `Zero cost. Best value free model: ${bestFree.displayName}.`,
      contextWindow: bestFree.contextWindow,
    });
  }

  // ── Balanced ──
  const balancedSorted = [...models]
    .filter((m) => !usedForDisplay.has(`${m.provider}/${m.modelId}`))
    .sort((a, b) => {
      const aCost = a.isFree ? 0 : (a.inputPrice ?? 5);
      const bCost = b.isFree ? 0 : (b.inputPrice ?? 5);
      const aScore = a.overallScore - aCost * 5;
      const bScore = b.overallScore - bCost * 5;
      return bScore - aScore;
    });
  const bestBalanced = balancedSorted[0] ?? null;
  if (bestBalanced) {
    usedForDisplay.add(`${bestBalanced.provider}/${bestBalanced.modelId}`);
    strategies.push({
      tier: 'balanced',
      label: 'Balanced',
      provider: bestBalanced.provider,
      model: bestBalanced.modelId,
      isFree: bestBalanced.isFree,
      costLevel: bestBalanced.isFree ? 'free' : 'low',
      speed: bestBalanced.speedScore >= 60 ? 'fast' : bestBalanced.speedScore >= 40 ? 'moderate' : 'slow',
      reason: bestBalanced.isFree
        ? `Best quality free model: ${bestBalanced.displayName}.`
        : `Best quality-per-dollar: ${bestBalanced.displayName} ($${bestBalanced.inputPrice}/M input).`,
      contextWindow: bestBalanced.contextWindow,
    });
  }

  // ── Fast / Powerful ──
  const fastSorted = [...models]
    .filter((m) => !usedForDisplay.has(`${m.provider}/${m.modelId}`))
    .sort((a, b) => b.speedScore - a.speedScore || b.overallScore - a.overallScore);
  const bestFast = fastSorted[0] ?? null;
  if (bestFast) {
    usedForDisplay.add(`${bestFast.provider}/${bestFast.modelId}`);
    strategies.push({
      tier: 'fast',
      label: 'Fast / Powerful',
      provider: bestFast.provider,
      model: bestFast.modelId,
      isFree: bestFast.isFree,
      costLevel: bestFast.isFree ? 'free' : 'medium',
      speed: bestFast.speedScore >= 60 ? 'fast' : 'moderate',
      reason: `Fastest response. ${bestFast.displayName} (speed: ${bestFast.speedScore}/100).`,
      contextWindow: bestFast.contextWindow,
    });
  }

  // ── Auto (Recommended) — per-stage model selection ──
  const autoUsed = new Set<string>();
  const perStage = AI_STAGES.map((stage) => {
    const best = pickForStage(models, stage, autoUsed);
    if (best) autoUsed.add(`${best.provider}/${best.modelId}`);
    return {
      stage: stage.label,
      provider: best?.provider ?? models[0].provider,
      model: best?.modelId ?? models[0].modelId,
      reason: best
        ? `${best.displayName} (${best.provider}) — ${stage.preferCheap ? 'cheap & fast' : stage.preferReasoning ? 'strong reasoning' : stage.preferCoding ? 'strong coding' : 'best fit'}`
        : `Fallback model`,
    };
  });

  // For the Auto card display, show the per-stage summary
  const autoStages = [...new Set(perStage.map((s) => `${s.provider}/${s.model}`))];
  const autoBaseModel = perStage[0];
  const autoFree = perStage.every((s) => {
    const m = models.find((m) => m.provider === s.provider && m.modelId === s.model);
    return m?.isFree;
  });

  strategies.push({
    tier: 'auto',
    label: 'Auto (Recommended)',
    provider: autoBaseModel.provider,
    model: autoBaseModel.model,
    isFree: autoFree,
    costLevel: autoFree ? 'free' : 'medium',
    speed: 'moderate',
    reason: autoStages.length > 1
      ? `Mixes ${autoStages.length} models across stages for optimal results.`
      : `Selects the best model per stage based on task requirements.`,
    contextWindow: models[0]?.contextWindow ?? 0,
    perStage,
  });

  return strategies;
}

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Read from stored model intelligence catalog
  const catalog = await getOrBuildCatalog(user.id);

  const connectedProviderIds = [...new Set(catalog.models.map((m) => m.provider))];
  console.log('[preflight] Catalog models:', catalog.models.length, 'providers:', connectedProviderIds);

  if (connectedProviderIds.length === 0) {
    return NextResponse.json({
      strategies: [],
      recommended: 'auto',
      availableProviders: [],
      hasPaidProviders: false,
      hasFreeProviders: false,
    });
  }

  const strategies = buildStrategies(catalog.models);
  const recommended = strategies.some((s) => s.tier === 'auto') ? 'auto'
    : strategies.some((s) => s.tier === 'balanced') ? 'balanced'
    : strategies[0]?.tier ?? 'auto';

  return NextResponse.json({
    strategies,
    recommended,
    availableProviders: connectedProviderIds,
    hasPaidProviders: catalog.models.some((m) => !m.isFree),
    hasFreeProviders: catalog.models.some((m) => m.isFree),
  });
}
