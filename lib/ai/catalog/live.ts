// Live model-catalog fetchers. Only providers with an official catalog API are
// fetched; others rely on the static registry. Called server-side, keys never
// reach the client.

import type { ProviderName, ModelDefinition } from './types';
import { envKeyForProvider } from '@/lib/ai/connection/service';
import { findStaticModel } from './registry';

interface LiveModelEntry {
  providerId: ProviderName;
  modelId: string;
  displayName: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  inputPrice: number | null;
  outputPrice: number | null;
  isFree: boolean;
}

interface OpenRouterModelItem {
  id?: string;
  name?: string;
  context_length?: number;
  architecture?: { modality?: string };
  pricing?: { prompt?: string | number; completion?: string | number };
  top_provider?: { max_completion_tokens?: number };
}

interface ChutesModelItem {
  id?: string;
  model?: string;
  name?: string;
  display_name?: string;
  context_length?: number;
  max_output_tokens?: number;
  pricing?: { input?: unknown; output?: unknown };
  price?: { input?: { value?: unknown }; output?: { value?: unknown } };
}

function mergePrice(staticModel: ModelDefinition | undefined, input: number | null, output: number | null) {
  const staticInput = staticModel?.price.input;
  const staticOutput = staticModel?.price.output;
  const usedInput = input ?? staticInput ?? null;
  const usedOutput = output ?? staticOutput ?? null;
  return {
    input: usedInput,
    output: usedOutput,
    isFree: (input != null && input === 0 && output != null && output === 0) || !!staticModel?.price.isFree,
  };
}

async function fetchOpenRouter(apiKey: string): Promise<LiveModelEntry[]> {
  const baseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`OpenRouter catalog: ${res.status}`);
  }
  const data = await res.json();
  const models: OpenRouterModelItem[] = data?.data || [];

  return models
    .filter((m) => m?.architecture?.modality?.includes('text'))
    .map((m) => {
      const staticModel = findStaticModel('openrouter', m.id || '');
      const input = typeof m.pricing?.prompt === 'string' ? Number(m.pricing.prompt) : null;
      const output = typeof m.pricing?.completion === 'string' ? Number(m.pricing.completion) : null;
      const price = mergePrice(staticModel, Number.isFinite(input) ? input : null, Number.isFinite(output) ? output : null);
      return {
        providerId: 'openrouter' as ProviderName,
        modelId: m.id || '',
        displayName: m.name || m.id || '',
        contextWindow: typeof m.context_length === 'number' ? m.context_length : null,
        maxOutputTokens: m.top_provider?.max_completion_tokens ?? null,
        inputPrice: price.input,
        outputPrice: price.output,
        isFree: m.pricing?.prompt === '0' && m.pricing?.completion === '0',
      };
    });
}

async function fetchChutes(apiKey: string): Promise<LiveModelEntry[]> {
  const baseUrl = process.env.CHUTES_BASE_URL || 'https://llm.chutes.ai/v1';
  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`Chutes catalog: ${res.status}`);
  }
  const data = await res.json();
  // Chutes returns an array of model objects (id, name, context_length, pricing...).
  const models: ChutesModelItem[] = Array.isArray(data) ? data : data?.data || [];

  return models.map((m) => {
    const id = m.id || m.model;
    if (!id) return null;
    const staticModel = findStaticModel('chutes', id);
    const input = m.pricing?.input ?? m.price?.input?.value ?? null;
    const output = m.pricing?.output ?? m.price?.output?.value ?? null;
    const numInput = typeof input === 'number' ? input : input != null ? Number(input) : null;
    const numOutput = typeof output === 'number' ? output : output != null ? Number(output) : null;
    return {
      providerId: 'chutes' as ProviderName,
      modelId: id,
      displayName: m.name || m.display_name || id,
      contextWindow: typeof m.context_length === 'number' ? m.context_length : staticModel?.contextWindow ?? null,
      maxOutputTokens: typeof m.max_output_tokens === 'number' ? m.max_output_tokens : staticModel?.maxOutputTokens ?? null,
      inputPrice: Number.isFinite(numInput) ? numInput : null,
      outputPrice: Number.isFinite(numOutput) ? numOutput : null,
      isFree: staticModel?.price.isFree ?? false,
    };
  }).filter((e): e is LiveModelEntry => !!e);
}

/**
 * Best-effort live catalog merge. Never throws to the client; falls back to the
 * static registry when a live fetch fails.
 */
export async function fetchLiveModels(
  userId: string
): Promise<{ providerId: ProviderName; models: ModelDefinition[] }[]> {
  const resolved = await import('@/lib/ai/connection/service').then((m) => m.resolveUserCredentials(userId));
  const outputs: { providerId: ProviderName; models: ModelDefinition[] }[] = [];

  const openRouterKey = resolved.openrouter || envKeyForProvider('openrouter');
  if (openRouterKey) {
    try {
      const entries = await fetchOpenRouter(openRouterKey);
      outputs.push({
        providerId: 'openrouter',
        models: entries.map(historyEntryToModel),
      });
    } catch (err) {
      console.warn('[live-catalog] OpenRouter fetch failed:', err);
    }
  }

  const chutesKey = resolved.chutes || envKeyForProvider('chutes');
  if (chutesKey) {
    try {
      const entries = await fetchChutes(chutesKey);
      outputs.push({
        providerId: 'chutes',
        models: entries.map(historyEntryToModel),
      });
    } catch (err) {
      console.warn('[live-catalog] Chutes fetch failed:', err);
    }
  }

  return outputs;
}

function historyEntryToModel(e: LiveModelEntry): ModelDefinition {
  const staticModel = findStaticModel(e.providerId, e.modelId);
  return {
    providerId: e.providerId,
    modelId: e.modelId,
    displayName: staticModel?.displayName || e.displayName,
    contextWindow: e.contextWindow ?? staticModel?.contextWindow ?? 128_000,
    maxOutputTokens: e.maxOutputTokens ?? staticModel?.maxOutputTokens ?? 8192,
    price: {
      input: e.inputPrice,
      output: e.outputPrice,
      isFree: e.isFree,
    },
    supportsReasoning: staticModel?.supportsReasoning ?? false,
    supportsToolCalling: staticModel?.supportsToolCalling ?? true,
    supportsStructuredOutput: staticModel?.supportsStructuredOutput ?? true,
    capabilities: staticModel?.capabilities ?? ['coding', 'tool_calling', 'structured_output'],
    availability: 'available',
    scores: staticModel?.scores ?? { coding: 3, reasoning: 3, speed: 3, longContext: 3 },
    tags: staticModel?.tags ? [...new Set([...staticModel.tags, 'live'])] : ['live'],
    source: 'live',
  };
}