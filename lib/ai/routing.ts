import { RunRequest } from './model-router';
import { resolveUserCredentials } from './connection/service';
import { getModelPreference } from './preferences';
import type { ProviderName } from './providers/registry';

export interface ResolvedRouting {
  /** Args to pass to runWithFallback. */
  runArgs: Pick<RunRequest, 'providerTokens' | 'manualModel' | 'stageOverrides'>;
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
export async function resolveAnalysisRouting(userId: string, task?: string): Promise<ResolvedRouting> {
  const [credentials, preference] = await Promise.all([
    resolveUserCredentials(userId),
    getModelPreference(userId),
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

  if (preference.selection_mode === 'manual' && preference.provider && preference.model) {
    if (!credentials[preference.provider]) {
      return {
        runArgs: { providerTokens },
        selection: {
          mode: 'manual',
          provider: null as ProviderName | null,
          model: null as string | null,
          reason: `Model selected but provider "${preference.provider}" is not connected. No fallback to a different model.`,
        },
      };
    }
    return {
      runArgs: {
        providerTokens,
        manualModel: { provider: preference.provider as ProviderName, model: preference.model },
      },
      selection: {
        mode: 'manual',
        provider: preference.provider as ProviderName,
        model: preference.model,
        reason: 'Manual mode: user-selected model used for all AI stages.',
      },
    };
  }

  return {
    runArgs: { providerTokens, stageOverrides: stageOverride },
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