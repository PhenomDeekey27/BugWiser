// Auto with a single configured provider/model.
//
// Auto must resolve candidates from the providers and models the user can
// actually execute — not from a hosted free-model catalog. Exactly one usable
// model is used for EVERY analysis stage, whether that model comes from a local
// OpenAI-compatible endpoint or a single hosted API key.
//
// Covers: one local provider (real router + mocked HTTP), one hosted provider
// across all five stages, multiple providers, an unavailable provider, an
// explicitly unavailable model, a stale/failing catalog, Strict Free with and
// without a genuine free path, and manual-mode preservation.

import { strict as assert } from 'node:assert';
import { generate, type GenerateResult } from './lib/ai/gateway';
import type { RunRequest, RunResponse } from './lib/ai/model-router';
import type { ResolvedRouting } from './lib/ai/routing';
import type { CatalogModel } from './app/models/page';
import type { ModelDefinition } from './lib/ai/catalog/types';

// Deterministic env: only the credentials injected through routing exist.
const ENV_KEYS = [
  'GEMINI_API_KEY',
  'DEEPSEEK_API_KEY',
  'ZAI_API_KEY',
  'OPENCODE_ZEN_API_KEY',
  'OPENROUTER_API_KEY',
  'CHUTES_API_KEY',
  'OPENAI_API_KEY',
] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  savedEnv[key] = process.env[key];
  delete process.env[key];
}

const STAGES = [
  'relevant_file_discovery',
  'root_cause_analysis',
  'evidence_extraction',
  'solution_generation',
  'patch_generation',
] as const;

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

/** Minimal ClassifiedModel-shaped row accepted by toCatalogModel. */
function model(
  provider: string,
  modelId: string,
  overrides: Partial<Record<string, unknown>> = {}
): CatalogModel {
  return {
    provider,
    modelId,
    displayName: modelId,
    contextWindow: 262_144,
    maxOutputTokens: null,
    inputPrice: null,
    outputPrice: null,
    isFree: false,
    priceSource: 'unknown',
    priceFetchedAt: null,
    supportsReasoning: true,
    supportsToolCalling: true,
    supportsStructuredOutput: true,
    supportsCoding: true,
    supportsVision: false,
    availability: 'available',
    codingScore: 70,
    reasoningScore: 70,
    speedScore: 70,
    longContextScore: 70,
    valueScore: 50,
    overallScore: 70,
    recommendedCategories: [],
    scoreOrigin: 'deterministic',
    ...overrides,
  } as unknown as CatalogModel;
}

function localDefinition(): ModelDefinition {
  return {
    providerId: 'local',
    modelId: 'server-a',
    displayName: 'Server A',
    contextWindow: 262_144,
    maxOutputTokens: null,
    price: { input: null, output: null, isFree: false },
    supportsReasoning: true,
    supportsToolCalling: true,
    supportsStructuredOutput: true,
    capabilities: [],
    availability: 'available',
    scores: { coding: 4, reasoning: 4, speed: 4, longContext: 5 },
    tags: [],
    source: 'live',
    priceSource: 'unknown',
  } as unknown as ModelDefinition;
}

function routing(
  tokens: Record<string, string>,
  options: {
    strategy?: ResolvedRouting['selectedStrategy'];
    mode?: 'auto' | 'manual';
    manualModel?: { provider: string; model: string };
    stageOverride?: { provider: string; model: string } | null;
  } = {}
): ResolvedRouting {
  const mode = options.mode ?? 'auto';
  const manual = options.manualModel;
  return {
    runArgs: {
      providerTokens: tokens as never,
      disabledProviders: new Set(),
      stageOverrides: options.stageOverride as never,
      ...(mode === 'manual' && manual
        ? { manualModel: manual as never }
        : {}),
    },
    selectedStrategy: options.strategy ?? 'auto',
    preferenceReadFailed: false,
    stageOverrideUnavailable: false,
    selection:
      mode === 'manual' && manual
        ? {
            mode,
            provider: manual.provider as never,
            model: manual.model,
            reason: 'Manual mode: user-selected model used for all AI stages.',
          }
        : {
            mode: 'auto',
            provider: null,
            model: null,
            reason: 'Auto mode: BugWiser selects the best available model per stage.',
          },
  };
}

interface Captured {
  request: RunRequest;
}

function captureRouter(response?: Partial<RunResponse>) {
  const captured: Captured[] = [];
  const run = async (request: RunRequest): Promise<RunResponse> => {
    captured.push({ request });
    const modelId = request.stageOverrides?.model || 'fallback-model';
    return {
      content: 'ok',
      model: modelId,
      provider: request.stageOverrides?.provider || 'openrouter',
      fallbackCount: 0,
      attemptedProviders: [
        { provider: (request.stageOverrides?.provider || 'openrouter') as never, model: modelId },
      ],
      ...response,
    };
  };
  return { captured, run: run as never };
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    resolveLocalEndpoint: async () => null,
    resolveRouting: async () => routing({}),
    loadAnalysisStrategy: async () => 'auto',
    getCatalog: async () => ({ models: [] }),
    runWithFallback: captureRouter().run,
    recordAssignment: async () => undefined,
    fetchLocalModels: async () => [],
    ...overrides,
  } as never;
}

async function generateForStages(
  makeDeps: () => ReturnType<typeof deps>
): Promise<GenerateResult[]> {
  const results: GenerateResult[] = [];
  for (const task of STAGES) {
    results.push(
      await generate(
        {
          analysisId: 'analysis-1',
          userId: 'user-1',
          task,
          messages: [{ role: 'user', content: `payload for ${task}` }],
        },
        makeDeps()
      )
    );
  }
  return results;
}

async function main() {
  await check('one local provider: the local model runs EVERY stage through its own endpoint', async () => {
    const calls: Array<{ url: string; body: { model: string } }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
      calls.push({
        url: String(input),
        body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}'),
      });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'local completion' } }],
          model: 'server-a',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as typeof fetch;

    try {
      const baseUrl = 'http://127.0.0.1:18701/v1';
      const results = await generateForStages(() =>
        deps({
          resolveLocalEndpoint: async () => ({ baseUrl }),
          resolveRouting: async () => routing({}),
          getCatalog: async () => ({ models: [] }),
          // Stale/missing persisted catalog: runtime discovery finds the model.
          fetchLocalModels: async () => [localDefinition()],
          // Real router: prove the request reaches the local endpoint.
          runWithFallback: undefined,
        })
      );

      assert.equal(calls.length, STAGES.length, 'one request per stage');
      for (const call of calls) {
        assert.equal(call.url, `${baseUrl}/chat/completions`);
        assert.equal(call.body.model, 'server-a');
      }
      for (const result of results) {
        assert.deepEqual(result.selection, {
          mode: 'auto',
          provider: 'local',
          model: 'server-a',
          reason:
            'Auto: the single configured model local/server-a is used for every AI stage.',
        });
      }
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  await check('one hosted provider: the same model is passed to all five stages', async () => {
    const captured: RunRequest[] = [];
    const responses: GenerateResult[] = [];
    for (const task of STAGES) {
      const router = captureRouter();
      const result = await generate(
        {
          analysisId: 'analysis-2',
          userId: 'user-2',
          task,
          messages: [{ role: 'user', content: 'stage' }],
        },
        deps({
          resolveRouting: async () => routing({ openrouter: 'token-fixture' }),
          getCatalog: async () => ({
            models: [model('openrouter', 'acme/model-a')],
          }),
          runWithFallback: router.run,
        })
      );
      captured.push(router.captured[0].request);
      responses.push(result);
    }

    for (const request of captured) {
      assert.deepEqual(request.stageOverrides, {
        provider: 'openrouter',
        model: 'acme/model-a',
      });
      assert.equal(request.strategy, 'auto');
      assert.equal(request.strictFree, false);
    }
    for (const response of responses) {
      assert.equal(response.selection.provider, 'openrouter');
      assert.equal(response.selection.model, 'acme/model-a');
    }
  });

  await check('multiple providers/models: no single-model shortcut and both stay candidates', async () => {
    const router = captureRouter();
    const result = await generate(
      {
        analysisId: 'analysis-3',
        userId: 'user-3',
        task: 'root_cause_analysis',
        messages: [{ role: 'user', content: 'stage' }],
      },
      deps({
        resolveRouting: async () =>
          routing({ openrouter: 'token-a', openai: 'token-b' }),
        getCatalog: async () => ({
          models: [
            model('openrouter', 'acme/model-a'),
            model('openai', 'acme/model-b'),
          ],
        }),
        runWithFallback: router.run,
      })
    );

    const request = router.captured[0].request;
    assert.equal(request.stageOverrides, undefined, 'no forced override with a real choice');
    const ids = (request.automaticCandidates ?? []).map(
      (candidate) => `${candidate.provider}/${candidate.model}`
    );
    assert.deepEqual(ids.sort(), [
      'openai/acme/model-b',
      'openrouter/acme/model-a',
    ]);
    assert.equal(result.selection.mode, 'auto');
    assert.equal(result.selection.provider, null);
  });

  await check('provider configured in the catalog but not connected: no candidate and a clear error', async () => {
    await assert.rejects(
      () =>
        generate(
          {
            analysisId: 'analysis-4',
            userId: 'user-4',
            task: 'root_cause_analysis',
            messages: [{ role: 'user', content: 'stage' }],
          },
          deps({
            resolveRouting: async () => routing({}),
            getCatalog: async () => ({ models: [model('chutes', 'acme/model-z')] }),
            // Real router: the structured availability error is what is asserted.
            runWithFallback: undefined,
          })
        ),
      /No AI provider is configured for task: root_cause_analysis/
    );
  });

  await check('explicitly unavailable model is excluded from single-model Auto', async () => {
    const router = captureRouter();
    await generate(
      {
        analysisId: 'analysis-5',
        userId: 'user-5',
        task: 'root_cause_analysis',
        messages: [{ role: 'user', content: 'stage' }],
      },
      deps({
        resolveRouting: async () => routing({ openrouter: 'token-fixture' }),
        getCatalog: async () => ({
          models: [
            model('openrouter', 'acme/model-unavailable', {
              availability: 'unavailable',
            }),
          ],
        }),
        runWithFallback: router.run,
      })
    );

    const request = router.captured[0].request;
    assert.equal(request.stageOverrides, undefined, 'an unavailable model is never forced');
    const ids = (request.automaticCandidates ?? []).map(
      (candidate) => `${candidate.provider}/${candidate.model}`
    );
    assert.ok(
      !ids.includes('openrouter/acme/model-unavailable'),
      'an explicitly unavailable model must not be an Auto candidate'
    );
  });

  await check('catalog refresh failure + one local model: discovery still runs the stage', async () => {
    const router = captureRouter();
    const result = await generate(
      {
        analysisId: 'analysis-6',
        userId: 'user-6',
        task: 'patch_generation',
        messages: [{ role: 'user', content: 'stage' }],
      },
      deps({
        resolveLocalEndpoint: async () => ({ baseUrl: 'http://127.0.0.1:18706/v1' }),
        getCatalog: async () => {
          throw new Error('catalog refresh failed');
        },
        fetchLocalModels: async () => [localDefinition()],
        runWithFallback: router.run,
      })
    );

    const request = router.captured[0].request;
    assert.deepEqual(request.stageOverrides, { provider: 'local', model: 'server-a' });
    assert.equal(request.catalogState, 'ready', 'discovery replaced the failed catalog');
    assert.equal(result.selection.provider, 'local');
  });

  await check('Strict Free keeps a genuine free path (no paid single-model bypass)', async () => {
    const router = captureRouter();
    const result = await generate(
      {
        analysisId: 'analysis-7',
        userId: 'user-7',
        task: 'root_cause_analysis',
        messages: [{ role: 'user', content: 'stage' }],
      },
      deps({
        resolveRouting: async () => routing({ openrouter: 'token-fixture' }, { strategy: 'free' }),
        getCatalog: async () => ({
          models: [
            model('openrouter', 'acme/free-a', {
              isFree: true,
              inputPrice: 0,
              outputPrice: 0,
              priceSource: 'live',
            }),
          ],
        }),
        runWithFallback: router.run,
      })
    );

    const request = router.captured[0].request;
    assert.equal(request.strictFree, true, 'Free is preserved when a free path exists');
    assert.equal(request.stageOverrides, undefined);
    assert.deepEqual(request.freeCandidates, [
      { provider: 'openrouter', model: 'acme/free-a' },
    ]);
    assert.equal(request.strategy, 'free');
    assert.equal(result.selection.mode, 'auto');
  });

  await check('Strict Free with no free path and exactly one paid model uses it for the stage', async () => {
    const router = captureRouter();
    const result = await generate(
      {
        analysisId: 'analysis-8',
        userId: 'user-8',
        task: 'solution_generation',
        messages: [{ role: 'user', content: 'stage' }],
      },
      deps({
        resolveRouting: async () => routing({ openrouter: 'token-fixture' }, { strategy: 'free' }),
        getCatalog: async () => ({ models: [model('openrouter', 'acme/paid-a')] }),
        runWithFallback: router.run,
      })
    );

    const request = router.captured[0].request;
    assert.equal(request.strictFree, false, 'no free path exists; the configured model runs');
    assert.deepEqual(request.stageOverrides, {
      provider: 'openrouter',
      model: 'acme/paid-a',
    });
    assert.equal(request.strategy, 'auto', 'never claim a paid model is free');
    assert.equal(result.selection.provider, 'openrouter');
    assert.match(result.selection.reason, /single configured model/);
  });

  await check('manual mode is never overridden by the single-model shortcut', async () => {
    const router = captureRouter();
    const manual = { provider: 'openrouter', model: 'acme/manual-model' };
    await generate(
      {
        analysisId: 'analysis-9',
        userId: 'user-9',
        task: 'root_cause_analysis',
        messages: [{ role: 'user', content: 'stage' }],
      },
      deps({
        resolveRouting: async () =>
          routing({ openrouter: 'token-fixture' }, { mode: 'manual', manualModel: manual }),
        getCatalog: async () => ({ models: [model('openrouter', 'acme/other-model')] }),
        runWithFallback: router.run,
      })
    );

    const request = router.captured[0].request;
    assert.deepEqual(request.manualModel, manual);
    assert.equal(request.stageOverrides, undefined);
  });

  await check('a sole model below the stage context gate is still attempted (runtime fallback)', async () => {
    const router = captureRouter();
    await generate(
      {
        analysisId: 'analysis-10',
        userId: 'user-10',
        task: 'evidence_extraction',
        messages: [{ role: 'user', content: 'stage' }],
      },
      deps({
        resolveRouting: async () => routing({ openrouter: 'token-fixture' }),
        getCatalog: async () => ({
          models: [model('openrouter', 'acme/small-context', { contextWindow: 8_000 })],
        }),
        runWithFallback: router.run,
      })
    );

    const request = router.captured[0].request;
    assert.deepEqual(request.stageOverrides, {
      provider: 'openrouter',
      model: 'acme/small-context',
    });
    assert.equal(request.automaticCandidates?.length, 1, 'the sole model is the candidate');
  });

  if (failures > 0) {
    console.error(`\n${failures} Auto single-provider check(s) failed`);
    process.exit(1);
  }
  console.log('\nALL PASS');
}

main()
  .catch((err) => {
    console.error('SPEC CRASH :: ' + ((err as Error).stack || String(err)));
    process.exit(1);
  })
  .finally(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });
