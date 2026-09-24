import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOrBuildCatalog } from '@/lib/ai/model-intelligence';
import { getModelPreference } from '@/lib/ai/preferences';
import { getProviderConnections } from '@/lib/ai/connection/service';
import { buildStageAssignments } from '@/lib/ai/strategy-selection';
import type { ProviderName } from '@/lib/ai/model-catalog/types';

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

const STAGE_WEIGHTS: Record<string, { coding: number; reasoning: number; speed: number; longContext: number }> = {
  relevant_file_discovery: { coding: 3, reasoning: 1, speed: 3, longContext: 1 },
  root_cause_analysis: { coding: 2, reasoning: 3, speed: 1, longContext: 2 },
  evidence_extraction: { coding: 2, reasoning: 1, speed: 3, longContext: 1 },
  solution_generation: { coding: 3, reasoning: 2, speed: 1, longContext: 2 },
  patch_generation: { coding: 3, reasoning: 2, speed: 1, longContext: 2 },
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

  // Build stage assignments based on user's preference
  const selectionMode = preference.selection_mode || 'auto';
  // Handle 'manual' mode by converting to 'auto' for strategy selection
  const strategyMode = selectionMode === 'manual' ? 'auto' : selectionMode;
  // For preset mode, use auto as fallback for API (presets are client-side)
  const apiStrategyMode = selectionMode === 'preset' ? 'auto' : strategyMode;
  // Build stage assignments - filter out undefined/null overrides
  const stageAssignments = buildStageAssignments(apiStrategyMode, availableProviders, preference.stage_overrides as any);

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
      const weights = STAGE_WEIGHTS[task] as any;
      const norm = weights.coding + weights.reasoning + weights.speed + weights.longContext;
      const score = (model.registryScores.coding * weights.coding + model.registryScores.reasoning * weights.reasoning + model.registryScores.speed * weights.speed + model.registryScores.longContext * weights.longContext) / norm;
      fit = Math.round(score * 10);
      reason = `Score: ${fit}/100 for ${assignment.task}`;
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

  const selectedStrategy = (preference.selection_mode || 'auto') as 'auto' | 'free' | 'free_paid' | 'fully_paid' | 'custom';

  return NextResponse.json({
    selectedStrategy,
    strategies,
    stages,
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
