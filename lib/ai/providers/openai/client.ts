import { AIProvider, AICompletionRequest, AICompletionResponse } from '../base';

export interface OpenAIConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  contextLimit: number;
  outputLimit: number;
}

export class OpenAIProvider implements AIProvider {
  readonly name = 'openai';
  private config: OpenAIConfig;

  constructor(config: OpenAIConfig) {
    this.config = config;
  }

  async generate(request: AICompletionRequest): Promise<AICompletionResponse> {
    const body = {
      model: request.model || this.config.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.3,
      max_tokens: request.maxTokens ?? 8192,
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
      throw new Error(`OpenAI API error ${response.status}: ${errorBody}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const content = choice?.message?.content;

    if (!content) {
      throw new Error(`OpenAI returned empty response for model ${request.model || this.config.model}`);
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