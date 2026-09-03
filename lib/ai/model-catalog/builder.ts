// Catalog builder — fetches live models from connected providers, merges with static registry.

import type { ProviderName, CatalogModel, CatalogProvider, ModelCatalog } from './types';
import { STATIC_MODEL_REGISTRY, PROVIDER_DEFINITIONS } from '../catalog/registry';
import { fetchLiveModels } from '../catalog/live';
import { getProviderConnections, resolveUserCredentials } from '../connection/service';
import { rankModels } from './ranking';

function fingerprint(providers: Record<ProviderName, boolean>): string {
  const entries = Object.entries(providers)
    .filter(([, connected]) => connected)
    .sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([p]) => p).join(':');
}

export async function buildCatalog(userId: string): Promise<ModelCatalog> {
  const connected = await getProviderConnections(userId);

  const connectedProviderIds = (Object.keys(connected) as ProviderName[]).filter(
    (p) => connected[p]
  );

  const providers: CatalogProvider[] = PROVIDER_DEFINITIONS.map((def) => {
    const pid = def.providerId as ProviderName;
    const isConn = connected[pid] || false;
    return {
      providerId: pid,
      displayName: def.displayName,
      authType: def.authType,
      connected: isConn,
      modelCount: 0,
      hasFreeModels: false,
      hasPaidModels: false,
      description: def.description,
      docsUrl: def.docsUrl,
    };
  });

  // Start with static models for connected providers only
  const staticModels: CatalogModel[] = STATIC_MODEL_REGISTRY
    .filter((m) => connectedProviderIds.includes(m.providerId as ProviderName))
    .map((m) => ({
      providerId: m.providerId as ProviderName,
      modelId: m.modelId,
      displayName: m.displayName,
      contextWindow: m.contextWindow,
      maxOutputTokens: m.maxOutputTokens,
      price: m.price,
      supportsReasoning: m.supportsReasoning,
      supportsToolCalling: m.supportsToolCalling,
      supportsStructuredOutput: m.supportsStructuredOutput,
      capabilities: m.capabilities,
      scores: m.scores,
      tags: m.tags,
      source: m.source as 'registry' | 'live',
    }));

  // Fetch live models from connected providers
  let liveModels: CatalogModel[] = [];
  try {
    const liveByProvider = await fetchLiveModels(userId);
    for (const group of liveByProvider) {
      if (!connectedProviderIds.includes(group.providerId)) continue;
      const mapped = group.models.map((m) => ({
        providerId: m.providerId,
        modelId: m.modelId,
        displayName: m.displayName,
        contextWindow: m.contextWindow,
        maxOutputTokens: m.maxOutputTokens,
        price: m.price,
        supportsReasoning: m.supportsReasoning,
        supportsToolCalling: m.supportsToolCalling,
        supportsStructuredOutput: m.supportsStructuredOutput,
        capabilities: m.capabilities,
        scores: m.scores,
        tags: m.tags,
        source: m.source as 'registry' | 'live',
      }));
      liveModels = [...liveModels, ...mapped];
    }
  } catch (err) {
    console.warn('[model-catalog] Live fetch failed, using static only:', err);
  }

  // Merge: live overrides static for same provider+model
  const merged = new Map<string, CatalogModel>();
  for (const m of staticModels) {
    merged.set(`${m.providerId}:${m.modelId}`, m);
  }
  for (const m of liveModels) {
    merged.set(`${m.providerId}:${m.modelId}`, m);
  }

  const allModels = Array.from(merged.values());

  // Update provider stats
  for (const p of providers) {
    const pModels = allModels.filter((m) => m.providerId === p.providerId);
    p.modelCount = pModels.length;
    p.hasFreeModels = pModels.some((m) => m.price.isFree);
    p.hasPaidModels = pModels.some((m) => !m.price.isFree);
  }

  const ranked = rankModels(allModels);

  return {
    providers,
    models: ranked,
    generatedAt: new Date().toISOString(),
    providerFingerprint: fingerprint(connected),
  };
}
