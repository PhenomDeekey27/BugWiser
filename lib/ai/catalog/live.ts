// Live model-catalog fetchers. Fetches from ANY provider that has a configured API key.
// Called server-side, keys never reach the client.
//
// Transport lives here; ALL raw→normalized interpretation lives in
// lib/ai/catalog/normalizers.ts (normalizeProviderModel — the single normalization
// boundary). Fetchers fetch, normalize each entry, and drop nulls (excluded entries).

import type { ProviderName, ModelDefinition } from './types';
import { envKeyForProvider } from '@/lib/ai/connection/service';
import { normalizeProviderModel } from './normalizers';

type RawEntry = Record<string, unknown>;

function normalizeAll(providerId: ProviderName, entries: unknown[]): ModelDefinition[] {
  const out: ModelDefinition[] = [];
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const n = normalizeProviderModel(providerId, e as RawEntry);
    if (n) out.push(n);
  }
  return out;
}

// ── Provider-specific fetch functions (transport + envelope parsing only) ──

async function fetchOpenRouter(apiKey: string): Promise<ModelDefinition[]> {
  const baseUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`OpenRouter catalog: ${res.status}`);
  const data = await res.json();
  return normalizeAll('openrouter', data?.data || []);
}

async function fetchChutes(apiKey: string): Promise<ModelDefinition[]> {
  const baseUrl = process.env.CHUTES_BASE_URL || 'https://llm.chutes.ai/v1';
  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`Chutes catalog: ${res.status}`);
  const data = await res.json();
  const models: unknown[] = Array.isArray(data) ? data : data?.data || [];
  return normalizeAll('chutes', models);
}

async function fetchOpenCode(apiKey: string): Promise<ModelDefinition[]> {
  const baseUrl = process.env.OPENCODE_ZEN_BASE_URL || 'https://opencode.ai/zen/v1';
  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`OpenCode catalog: ${res.status}`);
  const data = await res.json();
  const models: unknown[] = data?.data || (Array.isArray(data) ? data : []);
  return normalizeAll('opencode', models);
}

async function fetchOpenAI(apiKey: string): Promise<ModelDefinition[]> {
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`OpenAI catalog: ${res.status}`);
  const data = await res.json();
  return normalizeAll('openai', data?.data || []);
}

async function fetchGemini(apiKey: string): Promise<ModelDefinition[]> {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + apiKey, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`Gemini catalog: ${res.status}`);
  const data = await res.json();
  return normalizeAll('gemini', data?.models || []);
}

async function fetchDeepSeek(apiKey: string): Promise<ModelDefinition[]> {
  const res = await fetch('https://api.deepseek.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`DeepSeek catalog: ${res.status}`);
  const data = await res.json();
  return normalizeAll('deepseek', data?.data || []);
}

async function fetchZAI(apiKey: string): Promise<ModelDefinition[]> {
  // Z.AI uses OpenAI-compatible API — same canonical base URL as provider validation (lib/ai/providers/registry.ts)
  const baseUrl = process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4';
  const res = await fetch(`${baseUrl}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`Z.AI catalog: ${res.status}`);
  const data = await res.json();
  return normalizeAll('zai', data?.data || []);
}

// ── Provider fetch registry ──
// Maps each provider to its fetch function + env var fallback

const PROVIDER_FETCHERS: Partial<Record<ProviderName, {
  fetch: (apiKey: string) => Promise<ModelDefinition[]>;
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

  // Fetch from EVERY provider that has a configured key — in PARALLEL.
  // Each provider fails independently into its own slot.
  const tasks: Promise<void>[] = [];
  for (const [providerId, fetcher] of Object.entries(PROVIDER_FETCHERS) as Array<[ProviderName, typeof PROVIDER_FETCHERS[ProviderName]]>) {
    if (!fetcher) continue;
    const apiKey = resolved[providerId] || envKeyForProvider(providerId);
    if (!apiKey) continue;

    tasks.push(
      fetcher.fetch(apiKey)
        .then((models) => {
          outputs.push({ providerId, models });
        })
        .catch((err) => {
          console.warn(`[live-catalog] ${providerId} fetch failed:`, err);
        })
    );
  }
  await Promise.all(tasks);

  return outputs;
}
