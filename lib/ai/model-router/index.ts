import { AIProvider, AICompletionRequest, AICompletionResponse } from '../providers/base';
import {
  createProviderInstanceWithApiKey,
  ProviderName,
  isProviderConfigured,
} from '../providers/registry';
import { selectModelsForTask, getTestFailProvider, TaskModelEntry, getModelById } from '../config';
import {
  buildStageAssignments,
  StrategyMode,
  StageAssignment,
} from '../strategy-selection';

export interface RunRequest {
  task: string;
  messages: AICompletionRequest['messages'];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: AICompletionRequest['responseFormat'];
  /**
   * Explicitly resolved provider credentials (e.g. user-connected keys).
   * Env-configured providers are always included.
   */
  providerTokens?: Partial<Record<ProviderName, string>>;
  /**
   * Manual mode: the exact model the user selected. Used FIRST for every AI
   * stage of the analysis. Fallback still applies on recoverable failures,
   * but this model is never silently swapped for a higher-scoring one.
   */
  manualModel?: { provider: ProviderName; model: string } | null;
  /**
   * Optional per-stage model override from user preferences.
   * If present, this model is placed FIRST for this stage's fallback chain,
   * then the auto-ranked models are used as fallback.
   */
  stageOverrides?: { provider: ProviderName; model: string } | null;
  /**
   * Strategy mode: 'auto', 'free', 'free_paid', 'fully_paid', or 'custom'.
   * Controls the per-stage model selection policy.
   *
   * - auto: per-stage optimal selection (default, auto-resolves to 'custom' with stageOverrides)
   * - free: every stage uses the best FREE model per-stage.
   * - free_paid: file discovery & evidence → FREE, analysis & generation → PAID.
   * - fully_paid: every stage uses the best PAID model per-stage.
   * - custom: inherits auto strategy, with optional stage_overrides.
   */
  strategy?: 'auto' | 'free' | 'free_paid' | 'fully_paid' | 'custom';
}

export interface RunResponse extends AICompletionResponse {
  fallbackCount: number;
  attemptedProviders: Array<{ provider: ProviderName; model: string; error?: string }>;
}

export interface ContextBudgetCheck {
  fits: boolean;
  estimatedTokens: number;
  modelContextWindow: number;
  utilizationPercent: number;
  recommendation: 'proceed' | 'reduce_source' | 'reduce_metadata' | 'chunk_source';
}

type ErrorCategory =
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'server_error'
  | 'provider_error'
  | 'invalid_request'
  | 'context_too_large'
  | 'network'
  | 'unknown';

function classifyError(error: Error): ErrorCategory {
  const msg = error.message.toLowerCase();

  if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('authentication') || msg.includes('invalid api key')) {
    return 'auth';
  }
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) {
    return 'rate_limit';
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return 'timeout';
  }
  if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504') || msg.includes('internal server error') || msg.includes('bad gateway') || msg.includes('service unavailable')) {
    return 'server_error';
  }
  if (msg.includes('insufficient balance') || msg.includes('payment') || msg.includes('credits') || msg.includes('billing')) {
    return 'provider_error';
  }
  if (msg.includes('404') || msg.includes('not found') || msg.includes('no longer available') || msg.includes('model not found') || msg.includes('does not exist')) {
    return 'provider_error';
  }
  if (msg.includes('capacity') || msg.includes('overloaded') || msg.includes('quota')) {
    return 'provider_error';
  }
  if (msg.includes('context') && (msg.includes('too long') || msg.includes('exceed') || msg.includes('limit') || msg.includes('too large'))) {
    return 'context_too_large';
  }
  if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('fetch failed') || msg.includes('network')) {
    return 'network';
  }
  if (msg.includes('400') || msg.includes('bad request') || msg.includes('malformed')) {
    return 'invalid_request';
  }
  return 'unknown';
}

function isTestFailure(providerName: ProviderName, error: Error): boolean {
  const testFail = getTestFailProvider();
  if (!testFail) return false;
  return providerName === testFail && error.message.includes('[TEST_INJECT]');
}

function estimateTokensFromMessages(messages: AICompletionRequest['messages']): number {
  let total = 0;
  for (const msg of messages) {
    total += Math.ceil(msg.content.length / 4);
  }
  return total;
}

export function checkContextBudget(
  messages: AICompletionRequest['messages'],
  provider: ProviderName,
  model: string
): ContextBudgetCheck {
  const estimatedTokens = estimateTokensFromMessages(messages);
  const modelEntry = getModelById(`${provider}/${model}`);
  const contextWindow = modelEntry?.contextWindow || 128_000;
  const utilizationPercent = Math.round((estimatedTokens / contextWindow) * 100);

  const SAFETY_THRESHOLD = 0.7;
  const fits = estimatedTokens < contextWindow * SAFETY_THRESHOLD;

  let recommendation: ContextBudgetCheck['recommendation'] = 'proceed';
  if (!fits) {
    if (utilizationPercent > 90) {
      recommendation = 'chunk_source';
    } else if (utilizationPercent > 75) {
      recommendation = 'reduce_source';
    } else {
      recommendation = 'reduce_metadata';
    }
  }

  return {
    fits,
    estimatedTokens,
    modelContextWindow: contextWindow,
    utilizationPercent,
    recommendation,
  };
}

export function logAttempt(
  task: string,
  provider: ProviderName,
  model: string,
  success: boolean,
  duration: number,
  error?: string,
  fallbackCount?: number
) {
  const status = success ? 'SUCCESS' : 'FAILED';
  const fallbackInfo = fallbackCount !== undefined ? ` [fallback #${fallbackCount}]` : '';
  console.log(
    `[model-router] ${status} | task=${task} | provider=${provider} | model=${model} | ${duration}ms${fallbackInfo}${error ? ` | error=${error}` : ''}`
  );
}

const providerInstances = new Map<string, AIProvider>();

function instanceKey(provider: ProviderName, model: string, apiKey: string | undefined): string {
  const keySuffix = apiKey ? apiKey.slice(-8) : 'env';
  return `${provider}:${model}:${keySuffix}`;
}

function getOrCreateProvider(
  entry: TaskModelEntry,
  apiKey: string | undefined
): AIProvider {
  const key = instanceKey(entry.provider, entry.model, apiKey);
  if (!providerInstances.has(key)) {
    providerInstances.set(key, createProviderInstanceWithApiKey(entry.provider, apiKey));
  }
  return providerInstances.get(key)!;
}

function buildAvailableProviders(request: RunRequest): Set<ProviderName> {
  const available = new Set<ProviderName>();
  const providers: ProviderName[] = [
    'gemini', 'deepseek', 'zai', 'opencode', 'openrouter', 'chutes', 'openai',
  ];
  for (const p of providers) {
    if (isProviderConfigured(p)) available.add(p);
    const token = request.providerTokens?.[p];
    if (token && token.length > 0) available.add(p);
  }
  return available;
}

export async function runWithFallback(request: RunRequest): Promise<RunResponse> {
  const estimatedTokens = estimateTokensFromMessages(request.messages);
  const availableProviders = buildAvailableProviders(request);

  const autoChain = selectModelsForTask(
    request.task,
    estimatedTokens,
    new Set(),
    availableProviders
  );

  const stageOverride = request.stageOverrides;
  const manual = request.manualModel;
  const manualEntry = manual
    ? { provider: manual.provider, model: manual.model }
    : null;
  const overrideEntry = stageOverride
    ? { provider: stageOverride.provider, model: stageOverride.model }
    : null;

  const strategy = request.strategy;

  // Strategy-based fallback chain
  const stageAssignments = buildStageAssignments(
    strategy || 'auto',
    availableProviders
  );

  const chain: TaskModelEntry[] = [];

  // Build chain: stage override > manual model > strategy-chain (deduplicated)
  if (overrideEntry) {
    chain.push(overrideEntry);
    for (const candidate of autoChain) {
      if (candidate.provider === overrideEntry.provider && candidate.model === overrideEntry.model) {
        continue;
      }
      chain.push(candidate);
    }
  } else if (manualEntry) {
    chain.push(manualEntry);
    for (const candidate of autoChain) {
      if (candidate.provider === manualEntry.provider && candidate.model === manualEntry.model) {
        continue;
      }
      chain.push(candidate);
    }
  } else {
    // Strategy-based fallback chain
    const stageMap = new Map<string, { provider: ProviderName; model: string }>();
    for (const assignment of stageAssignments) {
      stageMap.set(assignment.task, {
        provider: assignment.provider,
        model: assignment.model,
      });
    }

    for (const assignment of stageAssignments) {
      if (assignment.task === request.task) {
        chain.push({
          provider: assignment.provider,
          model: assignment.model,
        });
      }
    }

    // Then the remaining auto-chain (as fallback candidates), without
    // duplicating any models already in the chain.
    const chainModels = new Set(chain.map(c => `${c.provider}/${c.model}`));
    for (const candidate of autoChain) {
      const key = `${candidate.provider}/${candidate.model}`;
      if (!chainModels.has(key)) {
        chain.push(candidate);
        chainModels.add(key);
      }
    }
  }

  const attempted: RunResponse['attemptedProviders'] = [];
  const failedModels = new Set<string>();
  let fallbackCount = 0;
  let lastError = new Error('All providers in fallback chain failed');

  console.log(
    `[model-router] Task: ${request.task} | strategy: ${strategy || 'auto'} | manual: ${manualEntry ? 'yes' : 'no'} | estimated tokens: ${estimatedTokens} | candidates: ${chain.length}`
  );

  for (const entry of chain) {
    if (!availableProviders.has(entry.provider)) {
      continue;
    }

    const modelId = `${entry.provider}/${entry.model}`;
    if (failedModels.has(modelId)) {
      continue;
    }

    const apiKey = request.providerTokens?.[entry.provider];
    const provider = getOrCreateProvider(entry, apiKey);
    const startTime = Date.now();

    try {
      console.log(
        `[model-router] Attempt ${fallbackCount + 1}: ${modelId} for task: ${request.task}${manualEntry ? ' [manual primary]' : ''}`
      );

      const completion = await provider.generate({
        messages: request.messages,
        model: entry.model,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
        responseFormat: request.responseFormat,
      });

      const duration = Date.now() - startTime;
      logAttempt(request.task, entry.provider, entry.model, true, duration, undefined, fallbackCount);

      return {
        ...completion,
        fallbackCount,
        attemptedProviders: [...attempted, { provider: entry.provider, model: entry.model }],
      };
    } catch (err) {
      const duration = Date.now() - startTime;
      const error = err instanceof Error ? err : new Error(String(err));
      const category = classifyError(error);
      const errorMsg = `${category}: ${error.message.slice(0, 200)}`;

      logAttempt(request.task, entry.provider, entry.model, false, duration, errorMsg, fallbackCount);
      attempted.push({ provider: entry.provider, model: entry.model, error: errorMsg });
      failedModels.add(modelId);

      if (isTestFailure(entry.provider, error)) {
        console.log(`[model-router] Test-injected failure for ${entry.provider} — continuing fallback`);
        fallbackCount++;
        lastError = error;
        continue;
      }

      if (category === 'auth') {
        console.error(
          `[model-router] Authentication error with ${entry.provider} — NOT fallback-worthy. Throwing.`
        );
        throw new Error(
          `Authentication failed with ${entry.provider}: ${error.message.slice(0, 500)}. ` +
          `Check that ${entry.provider.toUpperCase()}_API_KEY is set correctly.`
        );
      }

      if (category === 'invalid_request') {
        const isModelNotFound = error.message.includes('not a valid model') ||
          error.message.includes('model not found') ||
          error.message.includes('does not exist') ||
          error.message.includes('Unknown Model') ||
          error.message.includes('unknown model');

        if (isModelNotFound) {
          console.warn(
            `[model-router] Model ${modelId} not found — skipping to next model`
          );
          fallbackCount++;
          lastError = error;
          continue;
        }

        console.error(
          `[model-router] Invalid request error with ${entry.provider} — NOT fallback-worthy.`
        );
        throw new Error(
          `Invalid request to ${entry.provider}: ${error.message.slice(0, 500)}`
        );
      }

      if (category === 'context_too_large') {
        console.warn(
          `[model-router] Context too large for ${entry.provider}/${entry.model} — trying next model with larger context`
        );
        fallbackCount++;
        lastError = error;
        continue;
      }

      fallbackCount++;
      lastError = error;
    }
  }

  if (fallbackCount === 0) {
    throw new Error(
      `No configured providers available for task: ${request.task}. ` +
      `Configure at least one provider API key.`
    );
  }

  throw lastError;
}

export function getModels(): string[] {
  const chain = selectModelsForTask('relevant_file_discovery');
  return chain.map((e) => `${e.provider}/${e.model}`);
}