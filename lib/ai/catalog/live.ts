// Live model-catalog fetchers. Fetches from ANY provider that has a configured API key.
// Called server-side, keys never reach the client.

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

// ── Provider-specific fetch functions ──

async function fetchOpenRouter(apiKey: string): Promise<LiveModelEntry[]> {
  const baseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`OpenRouter catalog: ${res.status}`);
  const data = await res.json();
  const models = data?.data || [];
  return models
    .filter((m: Record<string, unknown>) => {
      const arch = m.architecture as Record<string, unknown> | undefined;
      const mod = arch?.modality as string | undefined;
      return mod?.includes('text');
    })
    .map((m: Record<string, unknown>) => {
      const pricing = m.pricing as Record<string, unknown> | undefined;
      const topProvider = m.top_provider as Record<string, unknown> | undefined;
      const input = typeof pricing?.prompt === 'string' ? Number(pricing.prompt) : null;
      const output = typeof pricing?.completion === 'string' ? Number(pricing.completion) : null;
      return {
        providerId: 'openrouter' as ProviderName,
        modelId: (m.id as string) || '',
        displayName: (m.name as string) || (m.id as string) || '',
        contextWindow: typeof m.context_length === 'number' ? m.context_length : null,
        maxOutputTokens: typeof topProvider?.max_completion_tokens === 'number' ? topProvider.max_completion_tokens : null,
        inputPrice: Number.isFinite(input) ? input : null,
        outputPrice: Number.isFinite(output) ? output : null,
        isFree: pricing?.prompt === '0' && pricing?.completion === '0',
      };
    });
}

async function fetchChutes(apiKey: string): Promise<LiveModelEntry[]> {
  const baseUrl = process.env.CHUTES_BASE_URL || 'https://llm.chutes.ai/v1';
  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`Chutes catalog: ${res.status}`);
  const data = await res.json();
  const models: Array<Record<string, unknown>> = Array.isArray(data) ? data : data?.data || [];
  return models.map((m) => {
    const id = (m.id as string) || (m.model as string);
    if (!id) return null;
    const pricing = m.pricing as Record<string, unknown> | undefined;
    const price = m.price as Record<string, unknown> | undefined;
    const inputVal = pricing?.input ?? (price?.input as Record<string, unknown>)?.value;
    const outputVal = pricing?.output ?? (price?.output as Record<string, unknown>)?.value;
    const numInput = typeof inputVal === 'number' ? inputVal : inputVal != null ? Number(inputVal) : null;
    const numOutput = typeof outputVal === 'number' ? outputVal : outputVal != null ? Number(outputVal) : null;
    return {
      providerId: 'chutes' as ProviderName,
      modelId: id,
      displayName: (m.name as string) || (m.display_name as string) || id,
      contextWindow: typeof m.context_length === 'number' ? m.context_length : null,
      maxOutputTokens: typeof m.max_output_tokens === 'number' ? m.max_output_tokens : null,
      inputPrice: Number.isFinite(numInput) ? numInput : null,
      outputPrice: Number.isFinite(numOutput) ? numOutput : null,
      isFree: false,
    };
  }).filter((e): e is LiveModelEntry => !!e);
}

async function fetchOpenCode(apiKey: string): Promise<LiveModelEntry[]> {
  const baseUrl = process.env.OPENCODE_ZEN_BASE_URL || 'https://opencode.ai/zen/v1';
  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`OpenCode catalog: ${res.status}`);
  const data = await res.json();
  const models: Array<Record<string, unknown>> = data?.data || (Array.isArray(data) ? data : []);
  return models
    .filter((m) => {
      if (!m.id) return false;
      const mods = (m.modalities as string[]) || [];
      return mods.length === 0 || mods.some((mod) => mod.includes('text'));
    })
    .map((m) => {
      const id = m.id as string;
      const pricing = m.pricing as Record<string, unknown> | undefined;
      const input = pricing?.prompt ?? pricing?.input;
      const output = pricing?.completion ?? pricing?.output;
      const numInput = typeof input === 'number' ? input : input != null ? Number(input) : null;
      const numOutput = typeof output === 'number' ? output : output != null ? Number(output) : null;
      const contextWindow = (m.context_length as number) ?? (m.context_window as number) ?? null;
      const isFree = (numInput != null && numInput === 0 && numOutput != null && numOutput === 0);
      return {
        providerId: 'opencode' as ProviderName,
        modelId: id,
        displayName: (m.name as string) || (m.display_name as string) || id,
        contextWindow: typeof contextWindow === 'number' ? contextWindow : null,
        maxOutputTokens: typeof m.max_output_tokens === 'number' ? m.max_output_tokens : null,
        inputPrice: Number.isFinite(numInput) ? numInput : null,
        outputPrice: Number.isFinite(numOutput) ? numOutput : null,
        isFree,
      };
    });
}

async function fetchOpenAI(apiKey: string): Promise<LiveModelEntry[]> {
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`OpenAI catalog: ${res.status}`);
  const data = await res.json();
  const models = data?.data || [];
  // OpenAI doesn't expose pricing in /models; use static registry for pricing
  return models
    .filter((m: Record<string, unknown>) => {
      const owned = (m.owned_by as string) || '';
      const id = (m.id as string) || '';
      return owned === 'openai' && (id.includes('gpt') || id.includes('o1') || id.includes('o3') || id.includes('chat'));
    })
    .map((m: Record<string, unknown>) => {
      const id = (m.id as string) || '';
      const staticModel = findStaticModel('openai', id);
      return {
        providerId: 'openai' as ProviderName,
        modelId: id,
        displayName: staticModel?.displayName || id,
        contextWindow: staticModel?.contextWindow ?? null,
        maxOutputTokens: staticModel?.maxOutputTokens ?? null,
        inputPrice: staticModel?.price.input ?? null,
        outputPrice: staticModel?.price.output ?? null,
        isFree: staticModel?.price.isFree ?? false,
      };
    });
}

async function fetchGemini(apiKey: string): Promise<LiveModelEntry[]> {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + apiKey, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`Gemini catalog: ${res.status}`);
  const data = await res.json();
  const models = data?.models || [];
  return models
    .filter((m: Record<string, unknown>) => {
      const methods = (m.supportedGenerationMethods as string[]) || [];
      return methods.includes('generateContent');
    })
    .map((m: Record<string, unknown>) => {
      const name = (m.name as string) || '';
      const id = name.replace('models/', '');
      const staticModel = findStaticModel('gemini', id);
      const ctx = m.inputTokenLimit as number | undefined;
      return {
        providerId: 'gemini' as ProviderName,
        modelId: id,
        displayName: staticModel?.displayName || (m.displayName as string) || id,
        contextWindow: ctx ?? staticModel?.contextWindow ?? null,
        maxOutputTokens: staticModel?.maxOutputTokens ?? null,
        inputPrice: staticModel?.price.input ?? null,
        outputPrice: staticModel?.price.output ?? null,
        isFree: staticModel?.price.isFree ?? false,
      };
    });
}

async function fetchDeepSeek(apiKey: string): Promise<LiveModelEntry[]> {
  const res = await fetch('https://api.deepseek.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`DeepSeek catalog: ${res.status}`);
  const data = await res.json();
  const models = data?.data || [];
  return models.map((m: Record<string, unknown>) => {
    const id = (m.id as string) || '';
    const staticModel = findStaticModel('deepseek', id);
    return {
      providerId: 'deepseek' as ProviderName,
      modelId: id,
      displayName: staticModel?.displayName || id,
      contextWindow: staticModel?.contextWindow ?? null,
      maxOutputTokens: staticModel?.maxOutputTokens ?? null,
      inputPrice: staticModel?.price.input ?? null,
      outputPrice: staticModel?.price.output ?? null,
      isFree: staticModel?.price.isFree ?? false,
    };
  });
}

async function fetchZAI(apiKey: string): Promise<LiveModelEntry[]> {
  // Z.AI uses OpenAI-compatible API
  const res = await fetch('https://api.z.ai/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`Z.AI catalog: ${res.status}`);
  const data = await res.json();
  const models = data?.data || [];
  return models.map((m: Record<string, unknown>) => {
    const id = (m.id as string) || '';
    const staticModel = findStaticModel('zai', id);
    return {
      providerId: 'zai' as ProviderName,
      modelId: id,
      displayName: staticModel?.displayName || id,
      contextWindow: staticModel?.contextWindow ?? null,
      maxOutputTokens: staticModel?.maxOutputTokens ?? null,
      inputPrice: staticModel?.price.input ?? null,
      outputPrice: staticModel?.price.output ?? null,
      isFree: staticModel?.price.isFree ?? false,
    };
  });
}

// ── Provider fetch registry ──
// Maps each provider to its fetch function + env var fallback

const PROVIDER_FETCHERS: Partial<Record<ProviderName, {
  fetch: (apiKey: string) => Promise<LiveModelEntry[]>;
  envKey?: string;
  baseUrl?: string;
}>> = {
  openrouter: { fetch: fetchOpenRouter },
  chutes: { fetch: fetchChutes },
  opencode: { fetch: fetchOpenCode },
  openai: { fetch: fetchOpenAI },
  gemini: { fetch: fetchGemini },
  deepseek: { fetch: fetchDeepSeek },
  zai: { fetch: fetchZAI },
};

// ── Unified entry point ──

export async function fetchLiveModels(
  userId: string
): Promise<{ providerId: ProviderName; models: ModelDefinition[] }[]> {
  const resolved = await import('@/lib/ai/connection/service').then((m) => m.resolveUserCredentials(userId));
  const outputs: { providerId: ProviderName; models: ModelDefinition[] }[] = [];

  // Fetch from EVERY provider that has a configured key
  for (const [providerId, fetcher] of Object.entries(PROVIDER_FETCHERS) as Array<[ProviderName, typeof PROVIDER_FETCHERS[ProviderName]]>) {
    if (!fetcher) continue;
    const apiKey = resolved[providerId] || envKeyForProvider(providerId);
    if (!apiKey) continue;

    try {
      const entries = await fetcher.fetch(apiKey);
      outputs.push({
        providerId,
        models: entries.map(historyEntryToModel),
      });
    } catch (err) {
      console.warn(`[live-catalog] ${providerId} fetch failed:`, err);
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
