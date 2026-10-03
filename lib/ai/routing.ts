import { RunRequest } from './model-router';
import { resolveUserCredentials, resolveLocalEndpoint, getDisabledProviders } from './connection/service';
import { getModelPreference, type SelectedStrategy } from './preferences';
import type { ProviderName } from './providers/registry';

export interface ResolvedRouting {
  /** Args to pass to runWithFallback. */
  runArgs: Pick<RunRequest, 'providerTokens' | 'manualModel' | 'stageOverrides' | 'disabledProviders'>;
  /** The user's CURRENT strategy from user_model_preferences (live — not the analysis-row snapshot). */
  selectedStrategy: SelectedStrategy;
  preferenceReadFailed: boolean;
  /**
   * Strict-Free unavailable marker for THIS stage: stage_overrides[task] =
   * {provider: null, model: null, unavailable: true}. False in manual mode
   * (manual ignores per-stage overrides entirely).
   */
  stageOverrideUnavailable: boolean;
  selection: {
    mode: 'auto' | 'manual';
    provider: ProviderName | null;
    model: string | null;
    reason: string;
  };
}

/**
 * Analysis stage IDs that user_model_preferences.stage_overrides is keyed by.
 * Same IDs as the runtime analysis tasks (lib/ai/config.ts) and the /models
 * page STAGES config — both were verified to use these exact keys.
 */
const ANALYSIS_TASK_IDS: ReadonlySet<string> = new Set([
  'relevant_file_discovery',
  'root_cause_analysis',
  'evidence_extraction',
  'solution_generation',
  'patch_generation',
]);

/** Returns the saved override for one stage, or null when absent/invalid. */
function resolveStageOverride(
  stageOverrides: Record<string, { provider: ProviderName | null; model: string | null }> | undefined,
  task: string
): { provider: ProviderName; model: string } | null {
  if (!stageOverrides || !ANALYSIS_TASK_IDS.has(task)) return null;
  const override = stageOverrides[task];
  if (!override?.provider || !override?.model) return null;
  return { provider: override.provider, model: override.model };
}

/**
 * Resolves routing for a given analysis owner (user):
 * - Resolves the user's provider credentials (env + stored connections).
 * - Loads the user's persistent selection (auto or manual).
 * - In auto mode, resolves the user's saved per-stage model override
 *   (user_model_preferences.stage_overrides) for the given task/stage.
 *
 * The model-router remains the source of truth for availability, scoring, and
 * fallback; this only determines the first candidate and the credential set.
 */
export interface RoutingDependencies {
  resolveCredentials?: typeof resolveUserCredentials;
  loadPreference?: typeof getModelPreference;
  /** Consulted ONLY for a manual selection of the `local` provider. */
  resolveLocalEndpoint?: typeof resolveLocalEndpoint;
  resolveDisabledProviders?: typeof getDisabledProviders;
}

export async function resolveAnalysisRouting(
  userId: string,
  task?: string,
  dependencies: RoutingDependencies = {}
): Promise<ResolvedRouting> {
  const [credentials, preference, disabledProviders] = await Promise.all([
    (dependencies.resolveCredentials ?? resolveUserCredentials)(userId),
    (dependencies.loadPreference ?? getModelPreference)(userId),
    (dependencies.resolveDisabledProviders ?? getDisabledProviders)(userId),
  ]);

  const providerTokens = Object.fromEntries(
    Object.entries(credentials).filter(([, v]) => !!v)
  ) as Partial<Record<ProviderName, string>>;

  // Auto mode: use the per-stage model saved on /models (stage_overrides is
  // keyed by stage ID, e.g. 'root_cause_analysis'). Manual mode keeps its
  // existing behavior: the single selected model runs every stage.
  const stageOverride =
    task && preference.selection_mode !== 'manual'
      ? resolveStageOverride(preference.stage_overrides, task)
      : null;
  // Strict-Free unavailable marker (null/null + unavailable) — resolved here
  // so the gateway can fail the stage structurally instead of falling through
  // to an automatic (potentially paid) chain.
  const stageOverrideUnavailable =
    preference.selection_mode !== 'manual' &&
    !!task &&
    ANALYSIS_TASK_IDS.has(task) &&
    preference.stage_overrides?.[task]?.unavailable === true;

  if (preference.selection_mode === 'manual' && preference.provider && preference.model) {
    // Connection check: every provider EXCEPT `local` is connected by its
    // resolved API key. `local` is connected by its STORED ENDPOINT (base
    // URL) — a keyless local connection is valid, while a stored key without
    // a usable endpoint can never execute. Not connected ⇒ the SAME fail-closed
    // error as every other provider (Task C: no silent substitution, identical
    // for every strategy).
    let providerConnected: boolean;
    if (preference.provider === 'local') {
      const endpoint = await (dependencies.resolveLocalEndpoint ?? resolveLocalEndpoint)(userId);
      providerConnected = !!endpoint?.baseUrl;
    } else {
      providerConnected = !!credentials[preference.provider];
    }
    if (!providerConnected) {
      throw new Error(
        `Model selected but provider "${preference.provider}" is not connected. No fallback to a different model. Reconnect the provider or switch to Auto mode.`
      );
    }
    return {
      runArgs: {
        providerTokens,
        manualModel: { provider: preference.provider as ProviderName, model: preference.model },
        disabledProviders,
      },
      selectedStrategy: preference.selected_strategy,
      preferenceReadFailed: preference.readFailed === true,
      stageOverrideUnavailable: false,
      selection: {
        mode: 'manual',
        provider: preference.provider as ProviderName,
        model: preference.model,
        reason: 'Manual mode: user-selected model used for all AI stages.',
      },
    };
  }

  return {
    runArgs: { providerTokens, stageOverrides: stageOverride, disabledProviders },
    selectedStrategy: preference.selected_strategy,
    preferenceReadFailed: preference.readFailed === true,
    stageOverrideUnavailable,
    selection: {
      mode: 'auto',
      provider: null,
      model: null,
      reason: stageOverride
        ? `Auto mode: using user-configured model ${stageOverride.provider}/${stageOverride.model} for stage "${task}".`
        : 'Auto mode: BugWiser selects the best available model per stage.',
    },
  };
}

export function isStrictFreeSelection(
  routing: Pick<ResolvedRouting, 'selectedStrategy' | 'preferenceReadFailed' | 'selection'>
): boolean {
  return (routing.selectedStrategy === 'free' || routing.preferenceReadFailed) && routing.selection.mode === 'auto';
}