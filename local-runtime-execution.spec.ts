// Tasks O + P — Local runtime execution: stored endpoint → existing
// gateway/router chain → structured outcomes.
//
// Proves that a connected local model executes through the EXISTING
// runWithFallback pipeline (no separate local router), that the stored
// base URL is the ONLY address a local request may target, that a missing
// endpoint fails closed before any HTTP, that Task C fail-closed routing
// and Task E fallback metadata (`fallbackCount` / `attemptedProviders` →
// deriveStageAttemptView) are preserved, and that Strict Free can neither
// execute an unverified model nor leak keys.
//
// Network is mocked at the global fetch boundary (the ONLY network layer
// touched here); routing connection/preference lookups use injected fakes.
// NO real network, NO real database, NO secrets.

import { strict as assert } from 'node:assert';
import { runWithFallback, type RunRequest } from './lib/ai/model-router';
import { resolveAnalysisRouting, isStrictFreeSelection } from './lib/ai/routing';
import { deriveStageAttemptView } from './lib/ai/stageAttemptView';
import {
  createProviderInstance,
  createProviderInstanceWithApiKey,
} from './lib/ai/providers/registry';
import type { ModelPreference } from './lib/ai/preferences';

// ── Deterministic environment ─────────────────────────────────────────────
// Env-configured providers would add unpredictable automatic-chain entries;
// the specs therefore run with every provider env key cleared (restored at
// the end). Local availability must come from the STORED ENDPOINT only.
const ENV_KEYS = [
  'GEMINI_API_KEY',
  'DEEPSEEK_API_KEY',
  'ZAI_API_KEY',
  'OPENCODE_ZEN_API_KEY',
  'OPENROUTER_API_KEY',
  'CHUTES_API_KEY',
  'OPENAI_API_KEY',
  'BENCHMARK_DEEPSEEK',
  'AI_TEST_FAIL_PROVIDER',
] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) {
  savedEnv[k] = process.env[k];
  delete process.env[k];
}

// ── fetch stub (restored at the end) ──────────────────────────────────────
interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body?: string;
}
type Handler = (call: RecordedCall) => Response;
const calls: RecordedCall[] = [];
let handler: Handler = () => json(500, { error: 'unexpected request — handler not set' });

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function chatBody(model: string): unknown {
  return {
    choices: [{ message: { content: 'completion-from-endpoint' } }],
    model,
    usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
  };
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: { headers?: unknown; body?: unknown; method?: string }) => {
  const call: RecordedCall = {
    url: String(input),
    headers: (init?.headers ?? {}) as Record<string, string>,
    body: typeof init?.body === 'string' ? init.body : undefined,
  };
  calls.push(call);
  return handler(call);
}) as typeof fetch;

function reset(handlerFn: Handler): void {
  calls.length = 0;
  handler = handlerFn;
}

const MESSAGES: RunRequest['messages'] = [{ role: 'user', content: 'Investigate this issue.' }];

let failures = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log('PASS ' + name);
  } catch (err) {
    failures++;
    console.error('FAIL ' + name + ' :: ' + ((err as Error).message || String(err)));
  }
}

async function main(): Promise<void> {
  await check('keyless local: stored base URL is the ONLY address a local request targets', async () => {
    const base = 'http://127.0.0.1:18001/v1';
    reset(() => json(200, chatBody('local-primary')));
    const res = await runWithFallback({
      task: 'root_cause_analysis',
      messages: MESSAGES,
      stageOverrides: { provider: 'local', model: 'local-primary' },
      localEndpoint: { baseUrl: base },
    });
    assert.equal(calls.length, 1, 'exactly one request — no other provider endpoint is touched');
    assert.equal(calls[0].url, `${base}/chat/completions`);
    assert.equal(calls[0].headers.Authorization, undefined, 'keyless connection sends no Authorization header');
    const sent = JSON.parse(calls[0].body ?? '{}');
    assert.equal(sent.model, 'local-primary');
    assert.ok(Array.isArray(sent.messages) && sent.messages.length === 1);
    assert.equal(sent.temperature, 0.3, 'existing default temperature contract');
    assert.equal(sent.max_tokens, 8192, 'existing default max tokens contract');
    assert.equal(res.provider, 'local');
    assert.equal(res.model, 'local-primary');
    assert.equal(res.content, 'completion-from-endpoint');
    assert.equal(res.fallbackCount, 0);
    assert.deepEqual(res.attemptedProviders, [{ provider: 'local', model: 'local-primary' }]);
  });

  await check('keyed local: Authorization Bearer goes only to its own endpoint', async () => {
    const base = 'http://127.0.0.1:18002/v1';
    reset(() => json(200, chatBody('local-keyed')));
    const res = await runWithFallback({
      task: 'root_cause_analysis',
      messages: MESSAGES,
      stageOverrides: { provider: 'local', model: 'local-keyed' },
      localEndpoint: { baseUrl: base, apiKey: 'sk-local-key-1234' },
      providerTokens: { openrouter: 'openrouter-key-should-not-be-used' },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${base}/chat/completions`);
    assert.equal(calls[0].headers.Authorization, 'Bearer sk-local-key-1234');
    assert.equal(res.provider, 'local');
  });

  await check('unversioned base URL: 404 falls back to the /v1 convention (probe parity)', async () => {
    const base = 'http://127.0.0.1:18003';
    reset((call) =>
      call.url === `${base}/v1/chat/completions`
        ? json(200, chatBody('local-unversioned'))
        : json(404, { error: 'no route' })
    );
    const res = await runWithFallback({
      task: 'root_cause_analysis',
      messages: MESSAGES,
      stageOverrides: { provider: 'local', model: 'local-unversioned' },
      localEndpoint: { baseUrl: base },
    });
    assert.deepEqual(
      calls.map((c) => c.url),
      [`${base}/chat/completions`, `${base}/v1/chat/completions`]
    );
    assert.equal(res.provider, 'local');
  });

  await check('automaticCandidates can route a local model with no override', async () => {
    const base = 'http://127.0.0.1:18004/v1';
    reset(() => json(200, chatBody('auto-local')));
    const res = await runWithFallback({
      task: 'root_cause_analysis',
      messages: MESSAGES,
      automaticCandidates: [{ provider: 'local', model: 'auto-local', contextWindow: 128_000 }],
      localEndpoint: { baseUrl: base },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${base}/chat/completions`);
    assert.equal(res.provider, 'local');
    assert.equal(res.model, 'auto-local');
  });

  await check('missing endpoint: local candidate never executes — structured error, zero HTTP', async () => {
    reset(() => json(200, { should: 'never be called' }));
    let message = '';
    try {
      await runWithFallback({
        task: 'root_cause_analysis',
        messages: MESSAGES,
        stageOverrides: { provider: 'local', model: 'local-primary' },
        providerTokens: { local: 'key-without-endpoint-9999' },
        // no localEndpoint — disconnected
      });
    } catch (err) {
      message = (err as Error).message;
    }
    assert.match(message, /No configured providers available for task: root_cause_analysis/);
    assert.equal(calls.length, 0, 'no HTTP may happen when no provider is available');
    assert.ok(!message.includes('key-without-endpoint-9999'), 'credential never appears in errors');
  });

  await check('registry factory: local requires an explicit base URL, never an env instance', () => {
    assert.throws(
      () => createProviderInstance('local'),
      /no env-configured instance/i
    );
    assert.throws(
      () => createProviderInstanceWithApiKey('local', 'sk-any'),
      /per-user base URL/i,
      'A–M contract: factory still throws without options.baseUrl'
    );
    const instance = createProviderInstanceWithApiKey('local', undefined, {
      baseUrl: 'http://127.0.0.1:18005/v1',
    });
    assert.equal(instance.name, 'local');
  });

  await check('manual routing: connected keyless local runs with NO API key required', async () => {
    const base = 'http://127.0.0.1:18006/v1';
    const routing = await resolveAnalysisRouting('user-1', 'root_cause_analysis', {
      resolveCredentials: async () => ({}),
      loadPreference: async (): Promise<ModelPreference> => ({
        user_id: 'user-1',
        provider: 'local',
        model: 'local-manual',
        selection_mode: 'manual',
        selected_strategy: 'custom',
      }),
      resolveLocalEndpoint: async () => ({ baseUrl: base }),
    });
    assert.equal(routing.selection.mode, 'manual');
    assert.deepEqual(routing.runArgs.manualModel, { provider: 'local', model: 'local-manual' });

    reset(() => json(200, chatBody('local-manual')));
    const res = await runWithFallback({
      task: 'root_cause_analysis',
      messages: MESSAGES,
      ...routing.runArgs,
      localEndpoint: { baseUrl: base },
    });
    assert.equal(calls[0].url, `${base}/chat/completions`);
    assert.equal(res.provider, 'local');
    assert.equal(res.model, 'local-manual');
  });

  await check('manual routing: disconnected local fails closed with the UNCHANGED Task C error', async () => {
    const manualPreference: ModelPreference = {
      user_id: 'user-1',
      provider: 'local',
      model: 'local-manual',
      selection_mode: 'manual',
      selected_strategy: 'custom',
    };
    await assert.rejects(
      () =>
        resolveAnalysisRouting('user-1', 'root_cause_analysis', {
          resolveCredentials: async () => ({}),
          loadPreference: async () => manualPreference,
          resolveLocalEndpoint: async () => null,
        }),
      {
        message:
          'Model selected but provider "local" is not connected. No fallback to a different model. Reconnect the provider or switch to Auto mode.',
      }
    );
  });

  await check('auto routing: saved per-stage local override flows through runArgs', async () => {
    const base = 'http://127.0.0.1:18007/v1';
    const routing = await resolveAnalysisRouting('user-1', 'root_cause_analysis', {
      resolveCredentials: async () => ({}),
      loadPreference: async (): Promise<ModelPreference> => ({
        user_id: 'user-1',
        provider: null,
        model: null,
        selection_mode: 'auto',
        selected_strategy: 'auto',
        stage_overrides: { root_cause_analysis: { provider: 'local', model: 'auto-override' } },
      }),
      resolveLocalEndpoint: async () => null,
    });
    assert.equal(routing.selection.mode, 'auto');
    assert.deepEqual(routing.runArgs.stageOverrides, { provider: 'local', model: 'auto-override' });
    assert.equal(routing.runArgs.manualModel, undefined);

    reset(() => json(200, chatBody('auto-override')));
    const res = await runWithFallback({
      task: 'root_cause_analysis',
      messages: MESSAGES,
      ...routing.runArgs,
      localEndpoint: { baseUrl: base },
    });
    assert.equal(JSON.parse(calls[0].body ?? '{}').model, 'auto-override');
    assert.equal(res.provider, 'local');
  });

  await check('fallback: local failure falls through to a non-local provider with Task E metadata intact', async () => {
    const base = 'http://127.0.0.1:18008/v1';
    reset((call) =>
      call.url.startsWith(base)
        ? json(500, { error: 'internal failure' })
        : json(200, chatBody('fallback-ext'))
    );
    const res = await runWithFallback({
      task: 'root_cause_analysis',
      messages: MESSAGES,
      stageOverrides: { provider: 'local', model: 'local-primary' },
      automaticCandidates: [{ provider: 'openrouter', model: 'fallback-ext', contextWindow: 128_000 }],
      providerTokens: { openrouter: 'test-openrouter-key' },
      localEndpoint: { baseUrl: base },
    });
    assert.equal(calls.length, 2, 'local first, then exactly one fallback attempt');
    assert.ok(calls[0].url.startsWith(base), 'first attempt hits the stored local base URL');
    assert.ok(!calls[1].url.startsWith(base), 'fallback does NOT reuse the local endpoint');

    assert.equal(res.provider, 'openrouter');
    assert.equal(res.model, 'fallback-ext');
    assert.equal(res.fallbackCount, 1);
    assert.equal(res.attemptedProviders.length, 2);
    assert.equal(res.attemptedProviders[0].provider, 'local');
    assert.match(res.attemptedProviders[0].error ?? '', /^server_error: Local endpoint error 500/);
    assert.equal(res.attemptedProviders[1].provider, 'openrouter');

    const view = deriveStageAttemptView({
      provider: res.provider,
      model: res.model,
      fallbackCount: res.fallbackCount,
      attempted: res.attemptedProviders,
    });
    assert.equal(view.state, 'fallback');
    assert.equal(view.selected, 'local · local-primary');
    assert.equal(view.actual, 'openrouter · fallback-ext');
    assert.equal(view.attempts, 2);
    assert.equal(view.fallbackCount, 1);
  });

  await check('auth failure on local: NOT fallback-worthy, key never leaks into the error', async () => {
    const base = 'http://127.0.0.1:18009/v1';
    reset(() => json(401, { error: 'unauthorized' }));
    let message = '';
    try {
      await runWithFallback({
        task: 'root_cause_analysis',
        messages: MESSAGES,
        stageOverrides: { provider: 'local', model: 'local-keyed' },
        localEndpoint: { baseUrl: base, apiKey: 'sek-must-not-leak-9876' },
      });
    } catch (err) {
      message = (err as Error).message;
    }
    assert.match(message, /^Authentication failed with local:/);
    assert.ok(!message.includes('sek-must-not-leak-9876'), 'API key must never appear in errors');
    assert.equal(calls.length, 1, 'auth is not fallback-worthy — no further attempts');
  });

  await check('STRICT FREE runtime: a verified free local candidate executes via the stored endpoint', async () => {
    const base = 'http://127.0.0.1:18010/v1';
    reset(() => json(200, chatBody('local-free-verified')));
    const res = await runWithFallback({
      task: 'root_cause_analysis',
      messages: MESSAGES,
      strictFree: true,
      freeCandidates: [{ provider: 'local', model: 'local-free-verified' }],
      localEndpoint: { baseUrl: base },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${base}/chat/completions`);
    assert.equal(res.provider, 'local');
    assert.equal(res.fallbackCount, 0);
  });

  await check('STRICT FREE runtime: empty free pool fails structured BEFORE any HTTP', async () => {
    reset(() => json(200, { should: 'never be called' }));
    await assert.rejects(
      () =>
        runWithFallback({
          task: 'root_cause_analysis',
          messages: MESSAGES,
          strictFree: true,
          freeCandidates: [],
          localEndpoint: { baseUrl: 'http://127.0.0.1:18011/v1' },
        }),
      /No free model is available for this stage/
    );
    assert.equal(calls.length, 0, 'strict-Free failure must never reach the network');
  });

  await check('isStrictFreeSelection: auto+free (or preference read failure) marks the run Strict Free', () => {
    assert.equal(
      isStrictFreeSelection({
        selectedStrategy: 'free',
        preferenceReadFailed: false,
        selection: { mode: 'auto', provider: null, model: null, reason: '' },
      }),
      true
    );
    assert.equal(
      isStrictFreeSelection({
        selectedStrategy: 'auto',
        preferenceReadFailed: true,
        selection: { mode: 'auto', provider: null, model: null, reason: '' },
      }),
      true,
      'a failed preference read still fails closed into Strict Free'
    );
    assert.equal(
      isStrictFreeSelection({
        selectedStrategy: 'free',
        preferenceReadFailed: false,
        selection: { mode: 'manual', provider: 'local', model: 'm', reason: '' },
      }),
      false,
      'manual mode is never strict-Free (the selected model is authoritative)'
    );
  });
}

main()
  .then(() => {
    globalThis.fetch = realFetch;
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILED');
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    globalThis.fetch = realFetch;
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    console.error('SPEC CRASH :: ' + ((err as Error).stack || String(err)));
    process.exit(1);
  });
