import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getOrBuildCatalog } from '@/lib/ai/model-intelligence';
import { getModelPreference } from '@/lib/ai/preferences';
import { getProviderConnections, isProviderConfiguredBysEnv } from '@/lib/ai/connection/service';
import type { ProviderName } from '@/lib/ai/catalog/types';
import { PROVIDER_DEFINITIONS } from '@/lib/ai/catalog/registry';
import { reconcileStageOverrides, type StageOverrideOrigin } from '@/lib/ai/catalog/overrideReconcile';
import { toCatalogModel } from '@/lib/ai/catalog/toCatalogModel';

export async function GET() {
  try {
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

    const connectedIds = new Set(
      (Object.keys(connections) as ProviderName[]).filter((p) => connections[p])
    );

    const providers = PROVIDER_DEFINITIONS
      .filter((def) => connectedIds.has(def.providerId as ProviderName))
      .map((def) => {
        const pid = def.providerId as ProviderName;
        const providerModels = catalog.models.filter((m) => m.provider === pid);
        return {
          providerId: pid,
          displayName: def.displayName,
          authType: def.authType,
          status: 'connected' as const,
          serverConfigured: isProviderConfiguredBysEnv(pid),
          connected: true,
          modelCount: providerModels.length,
          hasFreeModels: providerModels.some((m) => m.isFree),
          hasPaidModels: providerModels.some((m) => !m.isFree),
          description: def.description,
          docsUrl: def.docsUrl,
        };
      });

    const disconnectedProviders = PROVIDER_DEFINITIONS
      .filter((def) => !connectedIds.has(def.providerId as ProviderName))
      .map((def) => ({
        providerId: def.providerId,
        displayName: def.displayName,
        authType: def.authType,
        status: 'disconnected' as const,
        serverConfigured: isProviderConfiguredBysEnv(def.providerId as ProviderName),
        connected: false,
        modelCount: 0,
        hasFreeModels: false,
        hasPaidModels: false,
        description: def.description,
        docsUrl: def.docsUrl,
      }));

    const allProviders = [...providers, ...disconnectedProviders];

    // Reconcile persisted stage_overrides against the CURRENT connected
    // catalog: overrides pointing at models that no longer exist (provider
    // disconnected, live model vanished) are dropped deterministically so
    // they cannot silently override fresh automatic selection. Informational
    // only here — the UI reconciles its own saved copy via the same helper.
    const catalogModelsForReconcile = catalog.models.map((m) => ({
      providerId: m.provider as string,
      modelId: m.modelId,
      available: m.availability !== 'unavailable',
    }));
    const reconcile = reconcileStageOverrides(
      preference.stage_overrides ?? null,
      catalogModelsForReconcile
    );

    // Self-healing persistence: when saved overrides reference models that no
    // longer exist in the current connected catalog, persist the reconciled
    // set so the runtime (which reads the raw preference row) can no longer
    // attempt phantom models. Deterministic: only fires when something was
    // actually dropped; the kept set is exactly what this response serves.
    if (reconcile.changed) {
      const { saveModelPreference } = await import('@/lib/ai/preferences');
      await saveModelPreference(user.id, {
        selection_mode: preference.selection_mode === 'manual' ? 'manual' : 'auto',
        selected_strategy: preference.selected_strategy,
        provider: preference.provider,
        model: preference.model,
        stage_overrides: reconcile.kept as Record<string, { provider: ProviderName | null; model: string | null; unavailable?: boolean; origin?: StageOverrideOrigin }>,
      });
      console.warn(
        `[api/models] Dropped ${reconcile.droppedStages.length} stale stage_overrides (models no longer in connected catalog):`,
        reconcile.droppedStages.join(', ')
      );
    }

    const models = catalog.models.map(toCatalogModel);

    return NextResponse.json({
      providers: allProviders,
      models,
      preference: { ...preference, stage_overrides: reconcile.kept },
      stageOverridesReconciled: reconcile.changed,
      droppedStageOverrides: reconcile.droppedStages,
      classifiedByAi: catalog.classifiedByAi,
      classificationModel: catalog.classificationModel,
      analyzedAt: catalog.analyzedAt,
    });
  } catch (error) {
    const err = error as Error;
    console.error('[api/models] Error:', err.message);
    return NextResponse.json({ error: 'Failed to load model catalog' }, { status: 500 });
  }
}
