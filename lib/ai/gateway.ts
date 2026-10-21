// aiProvider facade — the single entry point the analysis engine calls to run
// an AI completion. It encapsulates auto/manual routing and credential
// resolution so stages don't embed provider-specific logic.

import { createBackgroundClient } from '@/lib/supabase/background';
import { runWithFallback, RunResponse, buildAvailableProviders } from './model-router';
import { resolveAnalysisRouting, isStrictFreeSelection } from './routing';
import { resolveLocalEndpoint } from './connection/service';
import { relayProbeDeps } from './connection/relay';
import { recordStageAssignment, buildStageAssignmentRecord } from './analysis-selection';
import { getOrBuildCatalog } from './model-intelligence';
import { toCatalogModel, definitionToCatalogModel } from './catalog/toCatalogModel';
import {
  prepareStrictFreeRun,
  getAutomaticStageCandidates,
  getSingleUsableModel,
  listUsableModels,
} from './catalog/stageSelection';
import { fetchLocalModels } from './catalog/live';
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

/**
 * Injectable boundaries. Production passes nothing; the integration spec
 * replaces them to prove the SAME resolved model reaches every stage without
 * a database or a real provider call.
 */
export interface GenerateDependencies {
  resolveLocalEndpoint?: typeof resolveLocalEndpoint;
  resolveRouting?: typeof resolveAnalysisRouting;
  getCatalog?: typeof getOrBuildCatalog;
  loadAnalysisStrategy?: (analysisId: string) => Promise<string | null>;
  runWithFallback?: typeof runWithFallback;
  recordAssignment?: typeof recordStageAssignment;
  fetchLocalModels?: typeof fetchLocalModels;
}

export type RuntimeCatalogState = 'ready' | 'empty' | 'unavailable';


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

async function loadAnalysisStrategy(analysisId: string): Promise<string | null> {
  const { data } = await createBackgroundClient()
    .from('analyses')
    .select('model_strategy')
    .eq('id', analysisId)
    .single();
  return (data?.model_strategy as string | null | undefined) ?? null;
}

// Runtime fallback for a connected local endpoint whose models are missing
// from the persisted catalog (first build failed, catalog storage failed, or
// refresh is stale). Reuses the existing local discovery probe — no second
// model system — and caches the result briefly because generate() runs once
// per analysis stage.
const LOCAL_FALLBACK_TTL_MS = 60_000;
const localFallbackCache = new Map<string, { at: number; models: CatalogModel[] }>();

async function discoverLocalModelsForRuntime(
  userId: string,
  localEndpoint: { baseUrl: string; apiKey?: string },
  fetcher: typeof fetchLocalModels
): Promise<CatalogModel[]> {
  const cacheKey = `${userId}:${localEndpoint.baseUrl}`;
  const cached = localFallbackCache.get(cacheKey);
  if (cached && Date.now() - cached.at < LOCAL_FALLBACK_TTL_MS) return cached.models;

  try {
    const definitions = await fetcher({
      apiKey: localEndpoint.apiKey || '',
      baseUrl: localEndpoint.baseUrl,
      probeDeps: relayProbeDeps(userId, localEndpoint.baseUrl),
    });
    const models = definitions.map(definitionToCatalogModel);
    localFallbackCache.set(cacheKey, { at: Date.now(), models });
    return models;
  } catch (err) {
    console.warn('[gateway] Local model discovery fallback failed:', err);
    // Cache the failure briefly so five stages do not each probe an endpoint
    // that is unreachable.
    localFallbackCache.set(cacheKey, { at: Date.now(), models: [] });
    return [];
  }
}

export async function generate(
  params: GenerateParams,
  dependencies: GenerateDependencies = {}
): Promise<GenerateResult> {
  const userId = params.userId || (await getAnalysisUserId(params.analysisId));
  // The user's stored local endpoint (base URL + optional decrypted key).
  // Resolved ONCE per run (cached in the connection layer) so a local model
  // can only ever execute through its own endpoint. null ⇒ the local provider
  // is treated as disconnected everywhere downstream (candidates are skipped
  // by the router's availability gate; no request is made).
  const localEndpoint = await (dependencies.resolveLocalEndpoint ?? resolveLocalEndpoint)(userId);
  // Resolve routing for THIS stage; auto mode picks up the user's saved
  // stage_overrides entry for params.task (manual mode is task-independent).
  const routing = await (dependencies.resolveRouting ?? resolveAnalysisRouting)(userId, params.task);

  // Get the model strategy from the analysis row
  const analysisId = params.analysisId;
  const analysisStrategy = await (dependencies.loadAnalysisStrategy ?? loadAnalysisStrategy)(analysisId);
  const strategyMode = (analysisStrategy || 'auto') as 'free' | 'free_paid' | 'fully_paid' | 'custom' | 'auto';

  // The providers this user can actually execute: connected credentials +
  // env (minus per-user tombstones) + a usable local endpoint. This is the
  // SAME availability set the router enforces, so catalog rows from a
  // disconnected provider can never become candidates.
  const availableProviders = buildAvailableProviders({
    providerTokens: routing.runArgs.providerTokens,
    disabledProviders: routing.runArgs.disabledProviders,
    localEndpoint,
  });

  // STRICT FREE: the user's LIVE selected strategy ('free') in auto mode is
  // the contract gate — only confirmed-free models may execute for this
  // analysis stage. A FAILED preference read also counts as strict
  // (isStrictFreeSelection): unknown preference must not unlock paid models.
  // Manual mode sits OUTSIDE strict Free: the user's explicit model wins.
  let strictFree = isStrictFreeSelection(routing);

  // ONE catalog read per stage, as before. Failures no longer abort a
  // single-model Auto run: the configured model is still attempted.
  let catalogModels: CatalogModel[] = [];
  let catalogState: RuntimeCatalogState = 'ready';
  let catalogError: unknown = null;
  try {
    const catalog = await (dependencies.getCatalog ?? getOrBuildCatalog)(userId);
    catalogModels = catalog.models.map(toCatalogModel);
  } catch (err) {
    catalogError = err;
    catalogState = 'unavailable';
    console.warn('[gateway] Catalog unavailable — falling back to configured providers:', err);
  }
  if (catalogModels.length === 0 && !catalogError) catalogState = 'empty';

  // A connected local endpoint whose models are missing from the catalog is
  // still a configured provider. Discover them through the existing local
  // probe once (cached) instead of failing the stage on a catalog miss.
  if (
    localEndpoint?.baseUrl &&
    availableProviders.has('local') &&
    !catalogModels.some((m) => m.providerId === 'local')
  ) {
    const discovered = await discoverLocalModelsForRuntime(
      userId,
      localEndpoint,
      dependencies.fetchLocalModels ?? fetchLocalModels
    );
    if (discovered.length > 0) {
      const existing = new Set(catalogModels.map((m) => `${m.providerId}/${m.modelId}`));
      for (const model of discovered) {
        if (!existing.has(`${model.providerId}/${model.modelId}`)) catalogModels.push(model);
      }
      if (catalogState === 'unavailable') catalogState = 'ready';
    }
  }

  const usableCatalog = listUsableModels(catalogModels, availableProviders);

  // Exactly one usable model ⇒ Auto uses it for EVERY stage. This is the
  // single-provider contract: a local endpoint or a single API-key provider
  // must never need a public free-model catalog entry. Manual mode is
  // untouched (the user's explicit model always wins).
  const singleModel =
    routing.selection.mode === 'auto'
      ? getSingleUsableModel(usableCatalog)
      : null;

  let stageOverride = routing.runArgs.stageOverrides;
  let freeCandidates: TaskModelEntry[] | undefined;
  const confirmedFreeIds = new Set(
    usableCatalog
      .filter((m) => m.price.isFree)
      .map((m) => `${m.providerId}/${m.modelId}`)
  );
  let automaticCandidates: AutomaticCandidate[] | undefined;
  let singleModelApplied = false;

  const applySingleModel = (model: CatalogModel): void => {
    singleModelApplied = true;
    stageOverride = {
      provider: model.providerId as ProviderName,
      model: model.modelId,
    };
    console.warn(
      `[gateway] Auto: using the single configured model ${model.providerId}/${model.modelId} for "${params.task}" (and every other stage).`
    );
  };

  if (strictFree) {
    if (catalogError && !singleModel) throw catalogError;

    if (routing.stageOverrideUnavailable) {
      // Marker stage. A single configured model is the ONLY alternative; with
      // no alternative the structured no-free-model error stays intact.
      stageOverride = undefined;
      if (singleModel) {
        strictFree = false;
        applySingleModel(singleModel);
      }
    } else {
      // The plan may DROP the saved override (setup-derived and not confirmed
      // free). When it keeps one, its persisted origin rides along so the
      // router records the user's explicit choice unchanged.
      const plan = prepareStrictFreeRun(usableCatalog, params.task, stageOverride ?? null);
      const hasFreePath = plan.freeCandidates.length > 0 || plan.stageOverride !== null;
      if (hasFreePath) {
        freeCandidates = plan.freeCandidates.map((c) => ({
          provider: c.provider as ProviderName,
          model: c.model,
        }));
        stageOverride = plan.stageOverride
          ? {
              provider: plan.stageOverride.provider as ProviderName,
              model: plan.stageOverride.model,
              ...(plan.stageOverride.origin ? { origin: plan.stageOverride.origin } : {}),
            }
          : undefined;
      } else if (singleModel) {
        // No free path exists, but exactly one model is configured. Auto must
        // use it rather than failing on "no free model available" — the
        // configured model is not required to be in a free catalog.
        strictFree = false;
        applySingleModel(singleModel);
      } else {
        // Keep the strict contract: an empty free chain produces the
        // structured no-free-model error, never a silent paid fallback.
        freeCandidates = [];
        stageOverride = undefined;
      }
    }
  }

  if (!strictFree) {
    automaticCandidates = getAutomaticStageCandidates(usableCatalog, params.task, {
      fallbackToSingleUsableModel: true,
      availableProviders,
    }).map((c) => ({
      provider: c.provider as ProviderName,
      model: c.model,
      contextWindow: c.contextWindow,
    }));

    if (singleModel && !singleModelApplied) applySingleModel(singleModel);
  }

  const routed: RunResponse = await (dependencies.runWithFallback ?? runWithFallback)({
    task: params.task,
    messages: params.messages,
    temperature: params.temperature,
    maxTokens: params.maxTokens,
    responseFormat: params.responseFormat,
    providerTokens: routing.runArgs.providerTokens,
    manualModel: routing.runArgs.manualModel,
    // Per-user tombstones ride the same run: availability, chain gating and
    // instance construction all fail closed for a disabled provider — it can
    // never execute through the deployment env credential.
    disabledProviders: routing.runArgs.disabledProviders,
    stageOverrides: stageOverride,
    // A single-model Auto run uses the automatic path; its guaranteed primary
    // is the stageOverride above. Never pretend a paid single model is 'free'.
    strategy: strictFree ? 'free' : singleModelApplied ? 'auto' : strategyMode,
    strictFree,
    freeCandidates,
    stageOverrideUnavailable: strictFree && routing.stageOverrideUnavailable,
    confirmedFreeIds,
    automaticCandidates,
    localEndpoint,
    userId,
    catalogState,
    configuredProviders: [...availableProviders],
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

  // Report the policy that actually ran. For a single configured model this
  // is the same provider/model for all five stage calls, not a silent switch.
  const selection = singleModelApplied && singleModel
    ? {
        mode: 'auto' as const,
        provider: singleModel.providerId,
        model: singleModel.modelId,
        reason: `Auto: the single configured model ${singleModel.providerId}/${singleModel.modelId} is used for every AI stage.`,
      }
    : routing.selection;

  // Persist the per-stage assignment + routing record. The record is built
  // from the router's ACTUAL result (`routed`), never from the catalog or the
  // saved preference, so model_selection.stages always reflects what ran.
  try {
    await (dependencies.recordAssignment ?? recordStageAssignment)(
      params.analysisId,
      params.task,
      buildStageAssignmentRecord(routed),
      {
        mode: selection.mode,
        reason: selection.reason,
        manualFallbackOccurred,
      }
    );
  } catch (err) {
    console.warn('[gateway] Failed to persist model selection:', err);
  }

  return {
    ...routed,
    selection: selection as GenerateResult['selection'],
    manualFallbackOccurred,
  };
}

export { runWithFallback };