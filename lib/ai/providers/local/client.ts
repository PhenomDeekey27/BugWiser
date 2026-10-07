import { AIProvider, AICompletionRequest, AICompletionResponse } from '../base';
import { hasVersionSegment } from '@/lib/ai/connection/local';
import {
  createRelayAwareFetch,
  RELAY_GENERATION_TIMEOUT_MS,
  RELAY_HEALTH_TIMEOUT_MS,
} from '@/lib/ai/connection/relay';

export interface LocalProviderConfig {
  /** Normalized base URL from the user's stored local connection (non-secret). */
  baseUrl: string;
  /** Optional — many local servers require no authentication. */
  apiKey?: string;
  /**
   * The owning user. Enables the browser relay: when deployed, requests to
   * this local endpoint are executed by the user's own open tab
   * (lib/ai/connection/relay.ts) because the server cannot reach loopback.
   * Absent ⇒ plain direct fetch (unchanged behavior).
   */
  userId?: string;
  model: string;
  contextLimit: number;
  outputLimit: number;
}

// Execution client for the per-user local OpenAI-compatible endpoint.
//
// It mirrors providers/openai/client.ts (the existing OpenAI-compatible
// format) so the request/response contract is unchanged: POST
// `${baseUrl}/chat/completions`, the same JSON body shape, the same
// `OpenAI-style` response parsing, and the same error message format.
// The ONLY local differences:
//   - `Authorization: Bearer` is sent ONLY when a key was stored (a keyless
//     local connection is valid — Task J convention),
//   - the endpoint candidates follow the SAME version-segment rule the
//     connection test/discovery probe uses: a base URL ending in `…/v1` is
//     used as-is; an unversioned base tries `${base}/chat/completions` first
//     and falls back to `${base}/v1/chat/completions` on 404.
//
// The base URL always comes from the stored connection (never an env var,
// never another provider's endpoint), and no timeout is added — generation
// clients in this codebase have no per-request timeout and that behavior is
// preserved. When a `userId` is present and the target relays (deployed),
// the request instead travels through the user's open browser tab with a
// RELAY_GENERATION_TIMEOUT_MS poll budget — a local model can take minutes,
// and the tab (not the server) is what actually reaches 127.0.0.1.
export class LocalProvider implements AIProvider {
  readonly name = 'local';
  private config: LocalProviderConfig;

  constructor(config: LocalProviderConfig) {
    this.config = config;
  }

  private base(): string {
    return this.config.baseUrl.replace(/\/+$/, '');
  }

  private candidates(resource: 'models' | 'chat/completions'): string[] {
    const base = this.base();
    const list = [`${base}/${resource}`];
    if (!hasVersionSegment(base)) list.push(`${base}/v1/${resource}`);
    return list;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const key = (this.config.apiKey ?? '').trim();
    if (key) headers.Authorization = `Bearer ${key}`;
    return headers;
  }

  async generate(request: AICompletionRequest): Promise<AICompletionResponse> {
    const body = {
      model: request.model || this.config.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.3,
      max_tokens: request.maxTokens ?? 8192,
      response_format: request.responseFormat,
    };

    const candidates = this.candidates('chat/completions');
    const fetchFn = createRelayAwareFetch(this.config.userId, {
      timeoutMs: RELAY_GENERATION_TIMEOUT_MS,
    });
    let response: Response | null = null;
    for (let i = 0; i < candidates.length; i++) {
      const res = await fetchFn(candidates[i], {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
      });
      // 404 means this path convention does not exist — try the alternate
      // (same candidate rule as the discovery probe). Every other status is a
      // real answer from the endpoint and is handled below.
      if (res.status === 404 && i < candidates.length - 1) continue;
      response = res;
      break;
    }
    if (!response) {
      throw new Error('Local endpoint error 404: no chat completions endpoint is available.');
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Local endpoint error ${response.status}: ${errorBody}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const content = choice?.message?.content;

    if (!content) {
      throw new Error(
        `Local endpoint returned empty response for model ${request.model || this.config.model}`
      );
    }

    return {
      content,
      model: data.model || request.model,
      provider: this.name,
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens ?? 0,
            outputTokens: data.usage.completion_tokens ?? 0,
            totalTokens: data.usage.total_tokens ?? 0,
          }
        : undefined,
    };
  }

  getModelInfo() {
    return {
      contextLimit: this.config.contextLimit,
      outputLimit: this.config.outputLimit,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const headers: Record<string, string> = {};
      const key = (this.config.apiKey ?? '').trim();
      if (key) headers.Authorization = `Bearer ${key}`;
      const candidates = this.candidates('models');
      const fetchFn = createRelayAwareFetch(this.config.userId, {
        timeoutMs: RELAY_HEALTH_TIMEOUT_MS,
      });
      for (let i = 0; i < candidates.length; i++) {
        const response = await fetchFn(candidates[i], { headers });
        if (response.status === 404 && i < candidates.length - 1) continue;
        return response.ok;
      }
      return false;
    } catch {
      return false;
    }
  }
}
