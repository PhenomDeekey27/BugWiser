import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOrBuildCatalog } from '@/lib/ai/model-intelligence';
import { getModelPreference } from '@/lib/ai/preferences';
import { getProviderConnections } from '@/lib/ai/connection/service';
import { buildStageAssignments } from '@/lib/ai/strategy-selection';
import { STAGE_WEIGHTS } from '@/lib/ai/catalog/stageSelection';
import { reconcileStageOverrides } from '@/lib/ai/catalog/overrideReconcile';
import type { ProviderName } from '@/lib/ai/catalog/types';

const AI_STAGES = [
  'relevant_file_discovery',
  'root_cause_analysis',
  'evidence_extraction',
  'solution_generation',
  'patch_generation',
];

const STAGE_LABELS: Record<string, string> = {
  relevant_file_discovery: 'File Discovery',
  root_cause_analysis: 'Root Cause Analysis',
  evidence_extraction: 'Evidence Extraction',
  solution_generation: 'Solution Generation',
  patch_generation: 'Patch Generation',
};

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const [catalog, preference, connections] = await Promise.all([
    getOrBuildCatalog(user.id),
    getModelPreference(user.id),
    getProviderConnections(user.id),
  ]);

  // Build available providers set
  const availableProviders = new Set(
    (Object.keys(connections) as ProviderName[]).filter((p) => connections[p])
  );

  // Reconcile persisted stage_overrides against the CURRENT connected catalog
  // (same policy as /api/models): stale entries are dropped deterministically
  // so neither this endpoint nor the runtime can act on phantom models.
  const reconcile = reconcileStageOverrides(
    (preference.stage_overrides ?? null) as Record<string, { provider: string | null; model: string | null; unavailable?: boolean }> | null,
    catalog.models.map((m) => ({
      providerId: m.provider as string,
      modelId: m.modelId,
      available: m.availability !== 'unavailable',
    }))
  );
  const effectiveOverrides = reconcile.kept as typeof preference.stage_overrides;

  // Build stage assignments based on user's preference.
  const selectionMode = preference.selection_mode || 'auto';

  // Resolve the effective strategy mode used for automatic stage assignment.
  // Manual mode is preserved exactly (converts to 'auto' for strategy
  // resolution, so manual stage overrides keep working as before).
  // In auto/preset mode, an explicitly saved selected_strategy (free /
  // free_paid / fully_paid / custom) takes priority over selection_mode so
  // that a persisted setup strategy (e.g. 'free') actually controls the
  // automatic selection. If selected_strategy is missing, null, or invalid,
  // it falls back to 'auto' — the existing safe default, so older
  // preferences keep working unchanged.
  // Note: 'balanced' / 'quality' are /models UI setups with no dedicated
  // engine mode, so they resolve to 'auto' here; their concrete per-stage
  // picks are persisted in stage_overrides and honored by EVERY engine mode
  // (applyStageOverrides), so the assignments below still reflect what the
  // user configured.
  const strategyMode = resolveStrategyMode(selectionMode, preference);

  // Build stage assignments - reconciled overrides only (stale entries dropped).
  const stageAssignments = buildStageAssignments(strategyMode, availableProviders, effectiveOverrides as any);

  // Transform stage assignments to strategy page format
  const stages = AI_STAGES.map((task) => {
    const assignment = stageAssignments.find((a) => a.task === task);
    if (!assignment) {
      return { id: task, label: 'Unknown', taskType: 'unknown' as const, provider: '', model: '', displayName: '', isFree: false, inputPrice: null, outputPrice: null, reason: 'Unknown' };
    }

    // Find model in catalog
    const model = catalog.models.find((m) => m.modelId === assignment.model && m.provider === assignment.provider);
    const displayName = model ? model.displayName : 'Unknown';
    const isFree = model ? model.isFree : false;
    const inputPrice = model ? model.inputPrice : null;
    const outputPrice = model ? model.outputPrice : null;

    // Calculate stage fit score
    let fit = 0;
    let reason = `Best fit for ${assignment.task}`;
    if (model && model.registryScores) {
      const weights = STAGE_WEIGHTS[task as keyof typeof STAGE_WEIGHTS];
      if (weights) {
        const norm = weights.coding + weights.reasoning + weights.speed + weights.longContext;
        const score = (model.registryScores.coding * weights.coding + model.registryScores.reasoning * weights.reasoning + model.registryScores.speed * weights.speed + model.registryScores.longContext * weights.longContext) / norm;
        fit = Math.round(score * 10);
        reason = `Score: ${fit}/100 for ${assignment.task}`;
      }
    }

    return {
      id: task,
      label: STAGE_LABELS[task],
      taskType: task,
      provider: assignment.provider,
      model: assignment.model,
      displayName,
      isFree,
      inputPrice,
      outputPrice,
      reason,
      fit,
    };
  });

  // Build strategies list
  const strategies = [
    { id: 'free', label: 'Free', description: 'All stages use the best FREE model per stage.' },
    { id: 'free_paid', label: 'Free + Paid', description: 'Discovery & evidence → FREE; analysis & generation → PAID.' },
    { id: 'fully_paid', label: 'Fully Paid', description: 'All stages use the best PAID model per stage.' },
    { id: 'auto', label: 'Auto (Recommended)', description: 'Per-stage optimal selection based on task complexity.' },
    { id: 'custom', label: 'Custom', description: 'Base auto strategy with optional stage overrides.' },
  ];

  // Echo the user's SAVED strategy (balanced/quality included) rather than
  // the resolved engine mode — the resolved mode is an internal detail and
  // the persisted picks live in stage_overrides regardless.
  const savedStrategy = preference.selected_strategy;
  const selectedStrategy = (savedStrategy === 'free' || savedStrategy === 'free_paid' || savedStrategy === 'fully_paid' || savedStrategy === 'custom' || savedStrategy === 'balanced' || savedStrategy === 'quality' ? savedStrategy : strategyMode) as 'auto' | 'free' | 'free_paid' | 'fully_paid' | 'custom' | 'balanced' | 'quality';

  return NextResponse.json({
    selectedStrategy,
    strategies,
    stages,
    stageOverridesReconciled: reconcile.changed,
    droppedStageOverrides: reconcile.droppedStages,
    catalog: {
      providerFingerprint: catalog.providerFingerprint,
      models: catalog.models.map((m) => ({
        providerId: m.provider,
        modelId: m.modelId,
        displayName: m.displayName,
        contextWindow: m.contextWindow,
        maxOutputTokens: m.maxOutputTokens,
        price: {
          input: m.inputPrice,
          output: m.outputPrice,
          isFree: m.isFree,
        },
        priceSource: m.priceSource,
        priceFetchedAt: m.priceFetchedAt,
        supportsReasoning: m.supportsReasoning,
        supportsToolCalling: m.supportsToolCalling,
        supportsStructuredOutput: m.supportsStructuredOutput,
        capabilities: m.supportsCoding,
        availability: m.availability,
        scores: {
          coding: m.registryScores?.coding || 0,
          reasoning: m.registryScores?.reasoning || 0,
          speed: m.registryScores?.speed || 0,
          longContext: m.registryScores?.longContext || 0,
        },
        valueScore: m.valueScore,
        tags: m.recommendedCategories,
        fit: m.overallScore,
        stageFit: {},
      })),
    },
    preference,
    analyzedAt: catalog.analyzedAt,
  });
}

/**
 * Resolves the effective strategy mode passed to buildStageAssignments().
 *
 * - Manual mode is preserved exactly: it always resolves to 'auto' for
 *   strategy resolution, so manual stage overrides keep working as before.
 * - In auto/preset mode, an explicitly saved selected_strategy that maps to a
 *   buildStageAssignments mode (free / free_paid / fully_paid / custom) takes
 *   priority over selection_mode. This ensures a persisted setup strategy
 *   (e.g. 'free') actually controls the automatic stage assignment instead of
 *   being overwritten.
 * - If selected_strategy is missing, null, invalid, or a UI-setup mode
 *   ('balanced' / 'quality' — no dedicated engine mode), it falls back to
 *   'auto' — the existing safe default, so older preferences keep working
 *   unchanged. UI-setup picks still apply via persisted stage_overrides,
 *   which every engine mode honors (applyStageOverrides).
 */
function resolveStrategyMode(selectionMode: string, preference: { selected_strategy?: string }): 'auto' | 'free' | 'free_paid' | 'fully_paid' | 'custom' {
  // Preset mode: presets are client-side, so the API always falls back to
  // 'auto' for stage assignment regardless of any selected_strategy value.
  if (selectionMode === 'preset') {
    return 'auto';
  }

  // Manual mode is preserved exactly: strategy resolution uses auto, so
  // manual stage overrides keep working as before.
  if (selectionMode === 'manual') {
    return 'auto';
  }

  const validStrategy = preference.selected_strategy;
  const selectedStrategyValid =
    typeof validStrategy === 'string' &&
    ['auto', 'free', 'free_paid', 'fully_paid', 'custom', 'balanced', 'quality'].includes(validStrategy);

  if (selectedStrategyValid) {
    const mode = validStrategy;
    if (mode === 'free' || mode === 'free_paid' || mode === 'fully_paid' || mode === 'custom') {
      return mode;
    }
    // 'auto', 'balanced', 'quality', or any invalid value -> fall back to auto.
    return 'auto';
  }
  // Missing or invalid selected_strategy -> safe 'auto' default.
  return 'auto';
}
