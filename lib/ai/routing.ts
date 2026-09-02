import { RunRequest } from './model-router';
import { resolveUserCredentials } from './connection/service';
import { getModelPreference } from './preferences';
import type { ProviderName } from './providers/registry';

export interface ResolvedRouting {
  /** Args to pass to runWithFallback. */
  runArgs: Pick<RunRequest, 'providerTokens' | 'manualModel'>;
  selection: {
    mode: 'auto' | 'manual';
    provider: ProviderName | null;
    model: string | null;
    reason: string;
  };
}

/**
 * Resolves routing for a given analysis owner (user):
 * - Resolves the user's provider credentials (env + stored connections).
 * - Loads the user's persistent selection (auto or manual).
 *
 * The model-router remains the source of truth for availability, scoring, and
 * fallback; this only determines the first candidate and the credential set.
 */
export async function resolveAnalysisRouting(userId: string): Promise<ResolvedRouting> {
  const [credentials, preference] = await Promise.all([
    resolveUserCredentials(userId),
    getModelPreference(userId),
  ]);

  const providerTokens = Object.fromEntries(
    Object.entries(credentials).filter(([, v]) => !!v)
  ) as Partial<Record<ProviderName, string>>;

  if (preference.selection_mode === 'manual' && preference.provider && preference.model) {
    if (!credentials[preference.provider]) {
      return {
        runArgs: { providerTokens },
        selection: {
          mode: 'manual',
          provider: preference.provider,
          model: preference.model,
          reason: `Model selected but provider "${preference.provider}" is not connected. No fallback to a different model.`,
        },
      };
    }
    return {
      runArgs: {
        providerTokens,
        manualModel: { provider: preference.provider, model: preference.model },
      },
      selection: {
        mode: 'manual',
        provider: preference.provider,
        model: preference.model,
        reason: 'Manual mode: user-selected model used for all AI stages.',
      },
    };
  }

  return {
    runArgs: { providerTokens },
    selection: {
      mode: 'auto',
      provider: null,
      model: null,
      reason: 'Auto mode: BugWiser selects the best available model per stage.',
    },
  };
}