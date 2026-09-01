import { AIProvider, AICompletionRequest, AICompletionResponse } from '../base';

export interface OpenRouterConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  contextLimit: number;
  outputLimit: number;
}

export class OpenRouterProvider implements AIProvider {
  readonly name = 'openrouter';
  private config: OpenRouterConfig;

  constructor(config: OpenRouterConfig) {
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
        'HTTP-Referer': 'https://repolens.app',
        'X-Title': 'BugWiser',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${errorBody}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    if (!choice?.message?.content) {
      throw new Error('OpenRouter returned empty response');
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

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
