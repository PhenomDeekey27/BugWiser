import { AIProvider } from './base';
import { OpenCodeZenProvider } from './opencode';
import { GeminiProvider } from './gemini';
import { DeepSeekProvider } from './deepseek';
import { ZAIProvider } from './zai';
import { OpenRouterProvider } from './openrouter';
import { ChutesProvider } from './chutes';
import { OpenAIProvider } from './openai';

export type ProviderName = 'gemini' | 'deepseek' | 'zai' | 'opencode' | 'openrouter' | 'chutes' | 'openai';

export interface ProviderHealthState {
  provider: ProviderName;
  healthy: boolean;
  lastCheck: number;
}

const healthCache = new Map<ProviderName, ProviderHealthState>();
const HEALTH_CACHE_TTL = 60_000;

export function createProviderInstance(providerName: ProviderName): AIProvider {
  switch (providerName) {
    case 'gemini':
      return new GeminiProvider({
        apiKey: process.env.GEMINI_API_KEY || '',
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        contextLimit: 1_048_576,
        outputLimit: 8192,
      });

    case 'deepseek':
      return new DeepSeekProvider({
        apiKey: process.env.DEEPSEEK_API_KEY || '',
        baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
        model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
        contextLimit: 131_072,
        outputLimit: 8192,
      });

    case 'zai':
      return new ZAIProvider({
        apiKey: process.env.ZAI_API_KEY || '',
        baseUrl: process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4',
        model: process.env.ZAI_MODEL || 'glm-4-flash',
        contextLimit: 128_000,
        outputLimit: 4096,
      });

    case 'opencode':
      return new OpenCodeZenProvider({
        apiKey: process.env.OPENCODE_ZEN_API_KEY || '',
        baseUrl: process.env.OPENCODE_ZEN_BASE_URL || 'https://opencode.ai/zen/v1',
        model: '',
        contextLimit: 128_000,
        outputLimit: 4096,
      });

    case 'openrouter':
      return new OpenRouterProvider({
        apiKey: process.env.OPENROUTER_API_KEY || '',
        baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
        model: '',
        contextLimit: 128_000,
        outputLimit: 8192,
      });

    case 'chutes':
      return new ChutesProvider({
        apiKey: process.env.CHUTES_API_KEY || '',
        baseUrl: process.env.CHUTES_BASE_URL || 'https://llm.chutes.ai/v1',
        model: '',
        contextLimit: 131_072,
        outputLimit: 8192,
      });

    case 'openai':
      return new OpenAIProvider({
        apiKey: process.env.OPENAI_API_KEY || '',
        baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        model: '',
        contextLimit: 128_000,
        outputLimit: 8192,
      });

    default:
      throw new Error(`Unknown provider: ${providerName}`);
  }
}

// Construct a provider instance using an explicit API key (e.g. a user-supplied
// connection key) instead of the process env. Falls back to the env key if none
// is supplied.
export function createProviderInstanceWithApiKey(
  providerName: ProviderName,
  apiKey?: string
): AIProvider {
  const key = apiKey && apiKey.length > 0 ? apiKey : envApiKey(providerName);
  switch (providerName) {
    case 'gemini':
      return new GeminiProvider({
        apiKey: key,
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        contextLimit: 1_048_576,
        outputLimit: 8192,
      });
    case 'deepseek':
      return new DeepSeekProvider({
        apiKey: key,
        baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
        model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
        contextLimit: 131_072,
        outputLimit: 8192,
      });
    case 'zai':
      return new ZAIProvider({
        apiKey: key,
        baseUrl: process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4',
        model: process.env.ZAI_MODEL || 'glm-4-flash',
        contextLimit: 128_000,
        outputLimit: 4096,
      });
    case 'opencode':
      return new OpenCodeZenProvider({
        apiKey: key,
        baseUrl: process.env.OPENCODE_ZEN_BASE_URL || 'https://opencode.ai/zen/v1',
        model: '',
        contextLimit: 128_000,
        outputLimit: 4096,
      });
    case 'openrouter':
      return new OpenRouterProvider({
        apiKey: key,
        baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
        model: '',
        contextLimit: 128_000,
        outputLimit: 8192,
      });
    case 'chutes':
      return new ChutesProvider({
        apiKey: key,
        baseUrl: process.env.CHUTES_BASE_URL || 'https://llm.chutes.ai/v1',
        model: '',
        contextLimit: 131_072,
        outputLimit: 8192,
      });
    case 'openai':
      return new OpenAIProvider({
        apiKey: key,
        baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        model: '',
        contextLimit: 128_000,
        outputLimit: 8192,
      });
    default:
      throw new Error(`Unknown provider: ${providerName}`);
  }
}

export function envApiKey(providerName: ProviderName): string {
  switch (providerName) {
    case 'gemini':
      return process.env.GEMINI_API_KEY || '';
    case 'deepseek':
      return process.env.DEEPSEEK_API_KEY || '';
    case 'zai':
      return process.env.ZAI_API_KEY || '';
    case 'opencode':
      return process.env.OPENCODE_ZEN_API_KEY || '';
    case 'openrouter':
      return process.env.OPENROUTER_API_KEY || '';
    case 'chutes':
      return process.env.CHUTES_API_KEY || '';
    case 'openai':
      return process.env.OPENAI_API_KEY || '';
    default:
      return '';
  }
}

export function parseModelIdentifier(modelId: string): { provider: ProviderName; model: string } {
  const slashIndex = modelId.indexOf('/');
  if (slashIndex === -1) {
    return { provider: 'opencode', model: modelId };
  }

  const prefix = modelId.substring(0, slashIndex).toLowerCase();
  const model = modelId.substring(slashIndex + 1);

  const providerMap: Record<string, ProviderName> = {
    gemini: 'gemini',
    google: 'gemini',
    deepseek: 'deepseek',
    zai: 'zai',
    glm: 'zai',
    opencode: 'opencode',
    zen: 'opencode',
    openrouter: 'openrouter',
    or: 'openrouter',
    chutes: 'chutes',
    openai: 'openai',
    'open-ai': 'openai',
  };

  const provider = providerMap[prefix];
  if (!provider) {
    return { provider: 'opencode', model: modelId };
  }

  return { provider, model };
}

export async function checkProviderHealth(providerName: ProviderName): Promise<boolean> {
  const cached = healthCache.get(providerName);
  if (cached && Date.now() - cached.lastCheck < HEALTH_CACHE_TTL) {
    return cached.healthy;
  }

  try {
    const provider = createProviderInstance(providerName);
    const healthy = await provider.healthCheck();
    healthCache.set(providerName, { provider: providerName, healthy, lastCheck: Date.now() });
    return healthy;
  } catch {
    healthCache.set(providerName, { provider: providerName, healthy: false, lastCheck: Date.now() });
    return false;
  }
}

export function isProviderConfigured(providerName: ProviderName): boolean {
  switch (providerName) {
    case 'gemini':
      return !!process.env.GEMINI_API_KEY;
    case 'deepseek':
      return !!process.env.DEEPSEEK_API_KEY;
    case 'zai':
      return !!process.env.ZAI_API_KEY;
    case 'opencode':
      return !!process.env.OPENCODE_ZEN_API_KEY;
    case 'openrouter':
      return !!process.env.OPENROUTER_API_KEY;
    case 'chutes':
      return !!process.env.CHUTES_API_KEY;
    case 'openai':
      return !!process.env.OPENAI_API_KEY;
    default:
      return false;
  }
}
