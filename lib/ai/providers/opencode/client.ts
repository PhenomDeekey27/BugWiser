import { AIProvider, AICompletionRequest, AICompletionResponse } from '../base';

export interface OpenCodeZenConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  contextLimit: number;
  outputLimit: number;
}

export class OpenCodeZenProvider implements AIProvider {
  readonly name = 'opencode-zen';
  private config: OpenCodeZenConfig;

  constructor(config: OpenCodeZenConfig) {
    this.config = config;
  }

  async generate(request: AICompletionRequest): Promise<AICompletionResponse> {
    const body = {
      model: request.model || this.config.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.3,
      max_tokens: request.maxTokens ?? 2048,
      response_format: request.responseFormat,
    };

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenCode Zen API error ${response.status}: ${errorBody}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    if (!choice?.message?.content) {
      throw new Error('OpenCode Zen returned empty response');
    }

    return {
      content: choice.message.content,
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

  getModelInfo(_modelUsed: string) {
    return {
      contextLimit: this.config.contextLimit,
      outputLimit: this.config.outputLimit,
    };
  }

  /**
   * Reachability check ONLY — deliberately NOT a generation-capability check.
   * GET /models returns 200 even with an empty/absent Bearer credential, and
   * server-side free-tier generation is rejected with 403 FreeTierError
   * ("OpenCode's free tier can only be used from within OpenCode" — measured;
   * see think/state.md). A generation-tier probe is intentionally not
   * performed here: a free-tier request is always rejected, which would fail
   * connection validation and drop OpenCode from user-facing model discovery,
   * and paid inference must never be consumed by health validation.
   * LIMITATION (documented, unchanged behavior): healthy=true proves endpoint
   * reachability only, not generation access.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
