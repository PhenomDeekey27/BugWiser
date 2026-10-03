import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getCatalogForDisplay } from '@/lib/ai/model-intelligence';
import { getModelPreference } from '@/lib/ai/preferences';
import { getProviderConnectionStates, isProviderConfiguredBysEnv, resolveLocalEndpoint } from '@/lib/ai/connection/service';
import type { ProviderName } from '@/lib/ai/catalog/types';
import { PROVIDER_DEFINITIONS } from '@/lib/ai/catalog/registry';
import { reconcileStageOverrides, shouldReconcileOverrides, type StageOverrideEntry, type StageOverrideOrigin } from '@/lib/ai/catalog/overrideReconcile';
import { toCatalogModel } from '@/lib/ai/catalog/toCatalogModel';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // The catalog is read DISPLAY-side (stale-while-revalidate): a rebuild —
    // live provider discovery + AI classification + a full re-store — is
    // scheduled in the background instead of blocking this response. Provider
    // connection state below is read straight from provider_connections and is
    // therefore always current, connect/disconnect or not. `catalogPending`
    // tells the client to revalidate once the background build lands.
    const [catalogView, preference, connectionStates, localEndpoint] = await Promise.all([
      getCatalogForDisplay(user.id),
      getModelPreference(user.id),
      getProviderConnectionStates(user.id),
      resolveLocalEndpoint(user.id),
    ]);
    const catalog = catalogView.catalog;

    // Effective per-user lifecycle (DISABLED > USER ROW > SERVER ENV > NONE).
    // `connectionSource` distinguishes a user's own connection from a
    // server-env-backed one, and `disabled` marks the per-user tombstone —
    // safe metadata only, never credential material.
    const connectedIds = new Set(
      (Object.keys(connectionStates) as ProviderName[]).filter((p) => connectionStates[p].connected)
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
          connectionSource: connectionStates[pid].connectionSource,
          disabled: false,
          connected: true,
          modelCount: providerModels.length,
          hasFreeModels: providerModels.some((m) => m.isFree),
          hasPaidModels: providerModels.some((m) => !m.isFree),
          description: def.description,
          docsUrl: def.docsUrl,
          // Non-secret display metadata for the local connection (never a key).
          baseUrl: pid === 'local' ? (localEndpoint?.baseUrl ?? null) : undefined,
        };
      });

    const disconnectedProviders = PROVIDER_DEFINITIONS
      .filter((def) => !connectedIds.has(def.providerId as ProviderName))
      .map((def) => {
        const pid = def.providerId as ProviderName;
        // Defensive: definitions and the lifecycle map are the same 8-provider
        // union today; an unknown id must degrade to 'unavailable', never crash.
        const info = connectionStates[pid];
        return {
          providerId: def.providerId,
          displayName: def.displayName,
          authType: def.authType,
          status: 'disconnected' as const,
          serverConfigured: isProviderConfiguredBysEnv(pid),
          // null for a tombstoned/unavailable provider — a disabled provider
          // is NEVER presented as connected just because an env key exists.
          connectionSource: info?.connectionSource ?? null,
          disabled: info?.disabled === true,
          connected: false,
          modelCount: 0,
          hasFreeModels: false,
          hasPaidModels: false,
          description: def.description,
          docsUrl: def.docsUrl,
        };
      });

    const allProviders = [...providers, ...disconnectedProviders];

    // Reconcile persisted stage_overrides against the CURRENT connected
    // catalog: overrides pointing at models that no longer exist (provider
    // disconnected, live model vanished) are dropped deterministically so
    // they cannot silently override fresh automatic selection. Informational
    // only here — the UI reconciles its own saved copy via the same helper.
    //
    // Guarded by shouldReconcileOverrides: this response may be serving the
    // PERSISTED catalog while a background rebuild runs (or an empty one on a
    // first load). Reconciling — and self-heal PERSISTING — against a snapshot
    // we already know is behind would delete the user's saved overrides.
    const canReconcile = shouldReconcileOverrides({
      catalogPending: catalogView.pending,
      modelCount: catalog.models.length,
      connectedProviderCount: connectedIds.size,
    });
    const catalogModelsForReconcile = catalog.models.map((m) => ({
      providerId: m.provider as string,
      modelId: m.modelId,
      available: m.availability !== 'unavailable',
    }));
    const reconcile = canReconcile
      ? reconcileStageOverrides(preference.stage_overrides ?? null, catalogModelsForReconcile)
      : { kept: (preference.stage_overrides ?? {}) as Record<string, StageOverrideEntry>, droppedStages: [] as string[], changed: false };

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
      // True when the catalog above still predates the current connected
      // provider set (a background rebuild is in flight). The client shows
      // what exists now and revalidates; provider connection state is NOT
      // affected by this flag.
      catalogPending: catalogView.pending,
    });
  } catch (error) {
    const err = error as Error;
    console.error('[api/models] Error:', err.message);
    return NextResponse.json({ error: 'Failed to load model catalog' }, { status: 500 });
  }
}
