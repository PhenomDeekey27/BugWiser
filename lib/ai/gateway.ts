// aiProvider facade — the single entry point the analysis engine calls to run
// an AI completion. It encapsulates auto/manual routing and credential
// resolution so stages don't embed provider-specific logic.

import { createBackgroundClient } from '@/lib/supabase/background';
import { runWithFallback, RunResponse } from './model-router';
import { resolveAnalysisRouting, isStrictFreeSelection } from './routing';
import { recordStageAssignment } from './analysis-selection';
import { getOrBuildCatalog } from './model-intelligence';
import { toCatalogModel } from './catalog/toCatalogModel';
import { prepareStrictFreeRun, getAutomaticStageCandidates } from './catalog/stageSelection';
import type { CatalogModel } from '@/app/models/page';
import type { TaskModelEntry, AutomaticCandidate } from './config';
import type { ProviderName } from './providers/registry';
import type { AICompletionRequest } from './providers/base';

export interface GenerateParams {
  analysisId: string;
  /** Map to the existing analysis task keys, e.g. `root_cause_analysis`. */
  task: string;
  messages: AICompletionRequest['messages'];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: AICompletionRequest['responseFormat'];
  /** Override the user id (normally derived from the analysis row). */
  userId?: string;
}

export interface GenerateResult extends RunResponse {
  selection: {
    mode: 'auto' | 'manual';
    provider: string | null;
    model: string | null;
    reason: string;
  };
  /** True when manual mode fell back to a non-selected model. */
  manualFallbackOccurred: boolean;
}

async function getAnalysisUserId(analysisId: string): Promise<string> {
  const db = createBackgroundClient();
  const { data, error } = await db
    .from('analyses')
    .select('user_id')
    .eq('id', analysisId)
    .single();
  if (error || !data?.user_id) {
    throw new Error(`Analysis not found: ${error?.message || 'missing user'}`);
  }
  return data.user_id as string;
}

export async function generate(params: GenerateParams): Promise<GenerateResult> {
  const userId = params.userId || (await getAnalysisUserId(params.analysisId));
  // Resolve routing for THIS stage; auto mode picks up the user's saved
  // stage_overrides entry for params.task (manual mode is task-independent).
  const routing = await resolveAnalysisRouting(userId, params.task);

  // Get the model strategy from the analysis row
  const analysisId = params.analysisId;
  const { data: analysis } = await createBackgroundClient()
    .from('analyses')
    .select('model_strategy')
    .eq('id', analysisId)
    .single();
  const strategyMode = (analysis?.model_strategy || 'auto') as 'free' | 'free_paid' | 'fully_paid' | 'custom' | 'auto';

  // STRICT FREE: the user's LIVE selected strategy ('free') in auto mode is
  // the contract gate — only confirmed-free models may execute for this
  // analysis stage (primary, overrides, strategy picks, and every fallback
  // hop). It reads the live preference (not the analysis-row snapshot, which
  // is only a creation-time copy) so "selected strategy = free" is enforced
  // exactly as the user last set it. A FAILED preference read also counts as
  // strict (isStrictFreeSelection): unknown preference must not unlock paid
  // models. Manual mode intentionally sits OUTSIDE strict Free: the user's
  // explicit single model wins (existing design).
  const strictFree = isStrictFreeSelection(routing);

  let stageOverride = routing.runArgs.stageOverrides;
  let freeCandidates: TaskModelEntry[] | undefined;
  let confirmedFreeIds: Set<string> | undefined;
  let automaticCandidates: AutomaticCandidate[] | undefined;

  if (strictFree && routing.stageOverrideUnavailable) {
    // Marker stage: runWithFallback fails fast with the structured
    // no-free-model error — no catalog load, no candidate, no paid chain.
    stageOverride = undefined;
  } else {
    // ONE canonical free source: this single catalog load (the same data
    // flow strict Free already used) serves BOTH strict-Free planning and
    // non-strict free-first ranking / engine free classification —
    // confirmedFreeIds below is derived from catalog price.isFree and is the
    // ONLY free authority runtime selection consults (never
    // MODEL_REGISTRY.free). Strict-Free load failures propagate (unchanged);
    // non-strict failures degrade conservatively (no model counts as
    // confirmed free) and never fail the stage.
    let catalogModels: CatalogModel[];
    try {
      const catalog = await getOrBuildCatalog(userId);
      catalogModels = catalog.models.map(toCatalogModel);
    } catch (err) {
      if (strictFree) throw err;
      console.warn('[gateway] Catalog unavailable for free-status resolution — no model counts as confirmed free:', err);
      catalogModels = [];
    }

    confirmedFreeIds = new Set(
      catalogModels
        .filter((m) => m.price.isFree)
        .map((m) => `${m.providerId}/${m.modelId}`)
    );

    if (strictFree) {
      const plan = prepareStrictFreeRun(catalogModels, params.task, stageOverride ?? null);
      freeCandidates = plan.freeCandidates.map((c) => ({
        provider: c.provider as ProviderName,
        model: c.model,
      }));
      stageOverride = plan.stageOverride
        ? { provider: plan.stageOverride.provider as ProviderName, model: plan.stageOverride.model }
        : undefined;
    } else {
      automaticCandidates = getAutomaticStageCandidates(catalogModels, params.task).map((c) => ({
        provider: c.provider as ProviderName,
        model: c.model,
        contextWindow: c.contextWindow,
      }));
    }
  }

  const routed: RunResponse = await runWithFallback({
    task: params.task,
    messages: params.messages,
    temperature: params.temperature,
    maxTokens: params.maxTokens,
    responseFormat: params.responseFormat,
    providerTokens: routing.runArgs.providerTokens,
    manualModel: routing.runArgs.manualModel,
    stageOverrides: stageOverride,
    strategy: strictFree ? 'free' : strategyMode,
    strictFree,
    freeCandidates,
    stageOverrideUnavailable: strictFree && routing.stageOverrideUnavailable,
    confirmedFreeIds,
    automaticCandidates,
  });

  // Detect whether manual mode silently swapped models (should only happen on
  // recoverable failures, and is surfaced to the user).
  const selected = routing.selection.mode === 'manual'
    ? routing.selection.provider && routing.selection.model
      ? `${routing.selection.provider}/${routing.selection.model}`
      : null
    : null;

  const used = `${routed.provider}/${routed.model}`;
  const manualFallbackOccurred =
    routing.selection.mode === 'manual' && !!selected && used !== selected && routed.fallbackCount > 0;

  if (manualFallbackOccurred) {
    console.warn(
      `[gateway] Manual fallback: selected=${selected} but used=${used} (recoverable failure).`
    );
  }

  // Persist the per-stage assignment + routing record.
  try {
    await recordStageAssignment(
      params.analysisId,
      params.task,
      {
        provider: routed.provider as ProviderName,
        model: routed.model,
        fallbackCount: routed.fallbackCount,
        attempted: routed.attemptedProviders.map(({ provider, model }) => ({ provider, model })),
      },
      {
        mode: routing.selection.mode,
        reason: routing.selection.reason,
        manualFallbackOccurred,
      }
    );
  } catch (err) {
    console.warn('[gateway] Failed to persist model selection:', err);
  }

  return {
    ...routed,
    selection: routing.selection as GenerateResult['selection'],
    manualFallbackOccurred,
  };
}

export { runWithFallback };