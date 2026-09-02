import { ModelCatalog, ModelDefinition, ProviderName, ModelAvailability } from './types';
import { PROVIDER_DEFINITIONS, STATIC_MODEL_REGISTRY, findStaticModel } from './registry';

// Aggregates the model catalog from the static registry plus any live catalog
// sources (OpenRouter, Chutes /models). The UI never sees provider-specific
// response shapes.

function toNumber(v: unknown, fallback: number | null): number | null {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function normalizePriceValue(v: unknown): number | null {
  // OpenRouter prices are strings like "0.11" or "2.5" (USD per 1M tokens).
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function availabilityOf(model: ModelDefinition): ModelAvailability {
  if (model.availability === 'available') return 'available';
  return model.availability;
}

function mergeLiveIntoStatic(
  staticModel: ModelDefinition | undefined,
  live: Record<string, unknown>
): ModelDefinition | undefined {
  if (!staticModel) return undefined;
  const rawContext = live.context_length;
  const contextLength = typeof rawContext === 'number' && Number.isFinite(rawContext)
    ? rawContext
    : staticModel.contextWindow;
  const maxOutput = toNumber(
    live.maxOutputTokens ?? (live.top_provider as Record<string, unknown> | undefined)?.max_completion_tokens,
    staticModel.maxOutputTokens
  );
  return {
    ...staticModel,
    contextWindow: contextLength,
    maxOutputTokens: maxOutput,
    availability: 'available',
    source: 'live',
    tags: staticModel.tags ? [...new Set([...staticModel.tags, 'live'])] : ['live'],
    price: staticModel.price,
  };
}

export function getModelCatalog(): ModelCatalog {
  // For now the catalog is entirely registry-based (server authoritative).
  // Live OpenRouter/Chutes enrichment is applied server-side in the API layer.
  const models: ModelDefinition[] = STATIC_MODEL_REGISTRY.map((m) => ({
    ...m,
    availability: availabilityOf(m),
  }));

  return {
    providers: PROVIDER_DEFINITIONS,
    models,
  };
}

export { PROVIDER_DEFINITIONS, STATIC_MODEL_REGISTRY, findStaticModel };
export type { ProviderName, ModelAvailability };
export { normalizePriceValue, toNumber };

export function isModelSupported(model: ModelDefinition): boolean {
  return model.availability !== 'unavailable';
}

export function modelsForProvider(catalog: ModelCatalog, providerId: string): ModelDefinition[] {
  return catalog.models.filter((m) => m.providerId === providerId);
}

export function findModel(catalog: ModelCatalog, providerId: string, modelId: string): ModelDefinition | undefined {
  return catalog.models.find(
    (m) => m.providerId === providerId && m.modelId === modelId
  );
}

export { mergeLiveIntoStatic };