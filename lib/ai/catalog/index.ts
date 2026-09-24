import { ModelDefinition, ModelCatalog, ProviderName, ModelAvailability } from './types';
import { PROVIDER_DEFINITIONS, STATIC_MODEL_REGISTRY, findStaticModel } from './registry';

function toNumber(v: unknown, fallback: number | null): number | null {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function normalizePriceValue(v: unknown): number | null {
  // OpenRouter raw prices are strings like "0.000003" (USD PER TOKEN).
  // Normalize to the catalog's internal unit (USD per 1M tokens) at the
  // ingestion layer — see toPerMillion() in lib/ai/catalog/live.ts.
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function availabilityOf(model: ModelDefinition): ModelAvailability {
  if (model.availability === 'available') return 'available';
  return model.availability;
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

export const MODEL_REGISTRY: ModelDefinition[] = STATIC_MODEL_REGISTRY;

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

export type { ModelDefinition, ModelCatalog };