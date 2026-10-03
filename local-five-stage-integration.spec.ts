// Task S — Local LLM across ALL FIVE analysis stages.
//
// Proves that a connected local OpenAI-compatible model is a first-class
// SELECTABLE and EXECUTABLE model for every analysis stage through the
// EXISTING architecture only:
//
//   Local Provider -> Local Model -> Catalog -> Stage Selection -> Gateway
//   -> Existing Model Router -> Local OpenAI-compatible client -> Local LLM
//
// Everything here is parameterized over the five canonical stages from ONE
// table (STAGES below) with shared helpers — there are no duplicated
// per-stage test implementations. HTTP is mocked at the global fetch
// boundary (the ONLY network layer touched); credential/preference lookups use
// injected fakes. NO real network, NO real database, NO real model calls, NO
// secrets, NO hardcoded product model or provider names beyond the provider-id
// literals the schema already uses.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runWithFallback, type RunRequest } from './lib/ai/model-router';
import { resolveAnalysisRouting } from './lib/ai/routing';
import { deriveStageAttemptView } from './lib/ai/stageAttemptView';
import { buildStageAssignmentRecord } from './lib/ai/analysis-selection';
import { buildStageOverrides } from './lib/ai/catalog/stageOverrides';
import { normalizeLocalModel } from './lib/ai/catalog/normalizers';
import { selectFreeModelForClassification } from './lib/ai/model-intelligence';
import {
  buildStageCandidatePool,
  bucketStageModels,
  filterStageModels,
} from './components/models/stageCandidates';
import {
  STAGE_CONTEXT_MIN,
  STAGE_WEIGHTS,
  getAutomaticStageCandidates,
  getFreeStageCandidates,
  isConfirmedFreeModel,
  prepareStrictFreeRun,
  selectForStage,
  selectStageModels,
  type StageKey,
} from './lib/ai/catalog/stageSelection';
import type { ModelPreference } from './lib/ai/preferences';
import type { CatalogModel, CatalogProvider } from './app/models/page';

// ── Deterministic environment ─────────────────────────────────────────────
// Env-configured providers would inject unpredictable chain entries; every
// provider env key is cleared (and restored at the end) so the ONLY available
// provider in these checks is the one under test. Local availability must come
// from the STORED ENDPOINT alone.
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
/** A well-formed OpenAI-compatible chat completion. */
function chatBody(model: string): unknown {
  return {
    choices: [{ message: { content: `completion-for-${model}` } }],
    model,
    usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 },
  };
}

const realFetch = globalThis.fetch;
globalThis.fetch = (async (
  input: unknown,
  init?: { headers?: unknown; body?: unknown; method?: string }
) => {
  calls.push({
    url: String(input),
    headers: (init?.headers ?? {}) as Record<string, string>,
    body: typeof init?.body === 'string' ? init.body : undefined,
  });
  return handler(calls[calls.length - 1]);
}) as typeof fetch;

function reset(handlerFn: Handler): void {
  calls.length = 0;
  handler = handlerFn;
}

// ── THE single five-stage table ───────────────────────────────────────────
// One parameterized fixture drives every per-stage check below.
interface StageFixture {
  id: StageKey;
  label: string;
  /** Real per-stage generation params, asserted against lib/analysis/*.ts. */
  maxTokens: number;
  /** The stage module that owns this stage's gateway call. */
  module: string;
}
const STAGES: readonly StageFixture[] = [
  { id: 'relevant_file_discovery', label: 'File Discovery', maxTokens: 2048, module: 'relevant-files' },
  { id: 'root_cause_analysis', label: 'Root Cause', maxTokens: 4096, module: 'root-cause' },
  { id: 'evidence_extraction', label: 'Evidence', maxTokens: 4096, module: 'evidence' },
  { id: 'solution_generation', label: 'Solution', maxTokens: 4096, module: 'solution' },
  { id: 'patch_generation', label: 'Patch', maxTokens: 8192, module: 'patch' },
] as const;

// A local endpoint that advertises a context window large enough for every
// stage requirement, so eligibility is never confounded by the context gate.
const WIDE_LOCAL_CONTEXT = 262_144;
// The context a local model gets when its payload exposes no context field
// (normalizers.ts finalize default). Used to document the ONE honest exclusion.
const DEFAULT_LOCAL_CONTEXT = 128_000;
// A different endpoint per stage keeps recorded URLs unambiguous.
const stageBaseUrl = (stage: StageKey, port: number) =>
  `http://127.0.0.1:${port}/v1`;

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

// ── Shared fixtures ──────────────────────────────────────────────────────

function cat(p: Partial<CatalogModel> & { providerId: string; modelId: string }): CatalogModel {
  return {
    displayName: p.modelId,
    contextWindow: 128_000,
    maxOutputTokens: null,
    price: { input: null, output: null, isFree: false },
    priceSource: 'unknown',
    priceFetchedAt: null,
    supportsReasoning: false,
    supportsToolCalling: false,
    supportsStructuredOutput: false,
    capabilities: [],
    availability: 'available',
    scores: { coding: 50, reasoning: 50, speed: 50, longContext: 50 },
    valueScore: 50,
    tags: [],
    fit: 0,
    stageFit: {},
    available: true,
    ...p,
  };
}

/** Local model with UNKNOWN pricing — the common self-hosted case. */
function localUnknown(modelId: string, contextWindow = WIDE_LOCAL_CONTEXT): CatalogModel {
  return cat({
    providerId: 'local',
    modelId,
    contextWindow,
    price: { input: null, output: null, isFree: false },
    priceSource: 'unknown',
  });
}

/** Local model whose endpoint advertised explicit 0/0 (explicit-zero authority). */
function localExplicitFree(modelId: string, contextWindow = WIDE_LOCAL_CONTEXT): CatalogModel {
  return cat({
    providerId: 'local',
    modelId,
    contextWindow,
    price: { input: 0, output: 0, isFree: true },
    priceSource: 'live',
  });
}

/** A known-priced non-local peer with identical capability scores. */
function externalPaid(
  modelId: string,
  contextWindow = WIDE_LOCAL_CONTEXT,
  input = 0.6,
  output = 2.4
): CatalogModel {
  return cat({
    providerId: 'openrouter',
    modelId,
    contextWindow,
    price: { input, output, isFree: false },
    priceSource: 'live',
  });
}

const LOCAL_PROVIDER_ID = 'local';
const LOCAL_MODEL_ID = 'server-a';

function connectedProvider(status: CatalogProvider['status'] = 'connected'): CatalogProvider {
  return {
    providerId: LOCAL_PROVIDER_ID,
    displayName: 'Local LLM',
    authType: 'api_key',
    status,
    connectedAt: null,
    serverConfigured: false,
    description: '',
    docsUrl: '',
    baseUrl: null,
  };
}

/** Auto-selection preference stub with a saved local override for one stage. */
function prefWithOverride(stage: StageKey, provider: string | null, model: string | null) {
  return {
    user_id: 'user-s',
    provider: null,
    model: null,
    selection_mode: 'auto',
    selected_strategy: 'auto',
    stage_overrides: {
      [stage]: {
        provider: provider as never,
        model,
        origin: 'manual',
      },
    },
  } as unknown as ModelPreference;
}

const routingDeps = (pref: ModelPreference) => ({
  resolveCredentials: async () => ({}) as Record<string, string>,
  loadPreference: async () => pref,
  resolveLocalEndpoint: async () => ({ baseUrl: 'http://127.0.0.1:19999/v1' }),
});

/** Shared runner: one stage's override/auto plan executed on the local client. */
async function runStage(
  stage: StageFixture,
  baseUrl: string,
  extra: Partial<RunRequest> = {}
): Promise<{ result: Awaited<ReturnType<typeof runWithFallback>>; sent: RecordedCall }> {
  reset(() => json(200, chatBody(LOCAL_MODEL_ID)));
  const result = await runWithFallback({
    task: stage.id,
    messages: [{ role: 'user', content: `stage payload for ${stage.id}` }],
    temperature: 0.3,
    maxTokens: stage.maxTokens,
    responseFormat: { type: 'json_object' },
    stageOverrides: { provider: LOCAL_PROVIDER_ID, model: LOCAL_MODEL_ID },
    localEndpoint: { baseUrl },
    ...extra,
  });
  return { result, sent: calls[0] };
}

// ── Global (non-parameterized) checks ────────────────────────────────────

async function globalChecks(): Promise<void> {
  await check('stage table matches the canonical STAGE_WEIGHTS / STAGE_CONTEXT_MIN keys (no drift)', () => {
    assert.deepEqual(
      STAGES.map((s) => s.id),
      Object.keys(STAGE_WEIGHTS),
      'the five stage ids must be the canonical ordered keys'
    );
    assert.deepEqual(
      STAGES.map((s) => s.id).sort(),
      Object.keys(STAGE_CONTEXT_MIN).sort()
    );
    assert.equal(STAGES.length, 5);
  });

  await check('each stage generation param asserted against its lib/analysis module', () => {
    for (const stage of STAGES) {
      const src = readFileSync(join(process.cwd(), 'lib', 'analysis', `${stage.module}.ts`), 'utf8');
      assert.ok(
        src.includes(`task: '${stage.id}'`),
        `${stage.module}.ts must call the gateway with task '${stage.id}'`
      );
      assert.ok(
        src.includes(`maxTokens: ${stage.maxTokens}`),
        `${stage.module}.ts must pass maxTokens: ${stage.maxTokens}`
      );
    }
  });

  await check('every stage module routes through the one gateway (no per-stage execution path)', () => {
    for (const stage of STAGES) {
      const src = readFileSync(join(process.cwd(), 'lib', 'analysis', `${stage.module}.ts`), 'utf8');
      assert.match(src, /from '@\/lib\/ai\/gateway'/, `${stage.module}.ts must import the single gateway`);
      assert.ok(!/runWithFallback\(/.test(src.replace(/import[^\n]*\n/g, '')), `${stage.module}.ts must not call the router directly`);
    }
  });

  await check('normalizeLocalModel: unknown pricing stays isFree:false / priceSource unknown / freeAuthority none', () => {
    const def = normalizeLocalModel({ id: LOCAL_MODEL_ID });
    assert.ok(def);
    assert.equal(def.price.isFree, false, 'unknown pricing is NEVER free');
    assert.equal(def.price.input, null);
    assert.equal(def.price.output, null);
    assert.equal(def.priceSource, 'unknown');
    assert.equal(def.freeAuthority, 'none');
  });

  await check('normalizeLocalModel: absent context field yields the honest default, not a fabricated window', () => {
    const def = normalizeLocalModel({ id: LOCAL_MODEL_ID });
    assert.ok(def);
    assert.equal(def.contextWindow, DEFAULT_LOCAL_CONTEXT);
    assert.equal(def.contextSource, 'default');
  });

  await check('normalizeLocalModel: an advertised context field IS honoured (live provenance)', () => {
    const def = normalizeLocalModel({ id: LOCAL_MODEL_ID, max_model_len: WIDE_LOCAL_CONTEXT });
    assert.ok(def);
    assert.equal(def.contextWindow, WIDE_LOCAL_CONTEXT);
    assert.equal(def.contextSource, 'live');
  });

  await check('classifier: a local model is never chosen as the classifier generation model', () => {
    const local = normalizeLocalModel({
      id: LOCAL_MODEL_ID,
      pricing: { prompt: '0', completion: '0' },
    });
    assert.ok(local);
    assert.equal(local.price.isFree, true, 'explicit 0/0 is free under the existing authority');
    assert.equal(
      selectFreeModelForClassification([local as never]),
      null,
      'local stays blocked as a classifier GENERATOR only'
    );
  });
}

// ── Per-stage parameterized checks ───────────────────────────────────────

let stageIndex = 0;

async function stageChecks(stage: StageFixture): Promise<void> {
  stageIndex += 1;
  const baseUrl = stageBaseUrl(stage.id, 19100 + stageIndex);
  const name = (what: string) => `stage[${stage.label}] ${what}`;

  // ── 1. UI model-selection source ────────────────────────────────────────
  await check(name('local model is selectable in the stage candidate pool when connected'), () => {
    const pool = buildStageCandidatePool(
      [connectedProvider('connected')],
      [localUnknown(LOCAL_MODEL_ID), externalPaid('peer-a')]
    );
    assert.ok(
      pool.some((m) => m.providerId === LOCAL_PROVIDER_ID && m.modelId === LOCAL_MODEL_ID),
      'a connected local model must appear in the stage modal pool'
    );
  });

  await check(name('local model is not selectable while the local provider is disconnected'), () => {
    const pool = buildStageCandidatePool(
      [connectedProvider('disconnected')],
      [localUnknown(LOCAL_MODEL_ID)]
    );
    assert.equal(pool.length, 0, 'a disconnected provider contributes nothing for ANY provider');
  });

  await check(name('local model is findable in the stage modal and bucketed as non-free (unknown pricing)'), () => {
    const pool = buildStageCandidatePool([connectedProvider()], [localUnknown(LOCAL_MODEL_ID)]);
    assert.equal(filterStageModels(pool, LOCAL_PROVIDER_ID).length, 1, 'search by provider id');
    assert.equal(filterStageModels(pool, LOCAL_MODEL_ID).length, 1, 'search by model id');
    const buckets = bucketStageModels(pool);
    assert.equal(buckets.free.length, 0, 'unknown pricing is never labelled Free');
    assert.equal(buckets.other.length, 1);
  });

  // ── 2. Saved stage override ─────────────────────────────────────────────
  await check(name('a manual local override is saved for this stage'), () => {
    const stageIds = STAGES.map((s) => s.id);
    const overrides = buildStageOverrides(stageIds, {
      [stage.id]: {
        selectedProvider: LOCAL_PROVIDER_ID,
        selectedModel: LOCAL_MODEL_ID,
        isOverride: true,
        origin: 'manual',
      },
    });
    assert.deepEqual(overrides[stage.id], {
      provider: LOCAL_PROVIDER_ID,
      model: LOCAL_MODEL_ID,
      origin: 'manual',
    });
    assert.equal(
      Object.keys(overrides).length,
      1,
      'saving one stage must not write the other stages'
    );
  });

  // ── 3. Routing resolution ───────────────────────────────────────────────
  await check(name('the saved local override resolves into runArgs for this stage'), async () => {
    const routing = await resolveAnalysisRouting('user-s', stage.id, routingDeps(prefWithOverride(stage.id, LOCAL_PROVIDER_ID, LOCAL_MODEL_ID)));
    assert.equal(routing.selection.mode, 'auto');
    assert.deepEqual(routing.runArgs.stageOverrides, {
      provider: LOCAL_PROVIDER_ID,
      model: LOCAL_MODEL_ID,
    });
    assert.match(routing.selection.reason, new RegExp(`stage "${stage.id}"`));
  });

  // ── 4. Eligibility (context gate honored, never bypassed) ───────────────
  await check(
    name(
      `a local model advertising ${WIDE_LOCAL_CONTEXT} context is an automatic candidate (requirement ${STAGE_CONTEXT_MIN[stage.id]})`
    ),
    () => {
      const candidates = getAutomaticStageCandidates([localUnknown(LOCAL_MODEL_ID)], stage.id);
      assert.deepEqual(candidates, [
        { provider: LOCAL_PROVIDER_ID, model: LOCAL_MODEL_ID, contextWindow: WIDE_LOCAL_CONTEXT },
      ]);
    }
  );

  await check(name('automatic eligibility tracks STAGE_CONTEXT_MIN exactly'), () => {
    // Below the requirement ⇒ excluded. Exactly at the requirement ⇒ included.
    const below = getAutomaticStageCandidates(
      [localUnknown(LOCAL_MODEL_ID, STAGE_CONTEXT_MIN[stage.id] - 1)],
      stage.id
    );
    assert.equal(below.length, 0, 'a context window below the stage requirement must be excluded');
    const at = getAutomaticStageCandidates(
      [localUnknown(LOCAL_MODEL_ID, STAGE_CONTEXT_MIN[stage.id])],
      stage.id
    );
    assert.equal(at.length, 1, 'the stage requirement is inclusive');
  });

  await check(name('insufficient context excludes it automatically but never from manual selection'), () => {
    const tiny = localUnknown(LOCAL_MODEL_ID, 8_000);
    assert.equal(getAutomaticStageCandidates([tiny], stage.id).length, 0);
    const pool = buildStageCandidatePool([connectedProvider()], [tiny]);
    assert.equal(pool.length, 1, 'manual Configure keeps the full connected catalog');
    const overrides = buildStageOverrides([stage.id], {
      [stage.id]: { selectedProvider: LOCAL_PROVIDER_ID, selectedModel: LOCAL_MODEL_ID, isOverride: true },
    });
    assert.deepEqual(overrides[stage.id], { provider: LOCAL_PROVIDER_ID, model: LOCAL_MODEL_ID });
  });

  await check(name('provider cap and family grouping are applied to local like any provider'), () => {
    const many = Array.from({ length: 12 }, (_, i) => localUnknown(`local-family-${i}`));
    const pool = getAutomaticStageCandidates(many, stage.id);
    assert.ok(pool.length > 0 && pool.length <= 5, `provider cap must bound local candidates (got ${pool.length})`);
  });

  // ── 5. Strategies ───────────────────────────────────────────────────────
  await check(name('Balanced selects the local model when it is the only candidate'), () => {
    const pick = selectForStage('balanced', stage.id, [localUnknown(LOCAL_MODEL_ID)]);
    assert.ok(pick);
    assert.equal(pick.provider, LOCAL_PROVIDER_ID);
    assert.equal(pick.model, LOCAL_MODEL_ID);
    assert.equal(pick.isFree, false, 'unknown pricing is never reported as free');
    assert.notEqual(pick.unavailable, true);
  });

  await check(name('Balanced prefers a known-priced peer over unknown-priced local (worst cost tier)'), () => {
    const pick = selectForStage('balanced', stage.id, [
      localUnknown(LOCAL_MODEL_ID),
      externalPaid('peer-a'),
    ]);
    assert.ok(pick);
    assert.equal(pick.provider, 'openrouter', 'a known-priced candidate outranks unknown pricing');
  });

  await check(name('Balanced prefers a confirmed-free local model on cost'), () => {
    const pick = selectForStage('balanced', stage.id, [
      localUnknown(LOCAL_MODEL_ID),
      localExplicitFree('local-free'),
    ]);
    assert.ok(pick);
    assert.equal(pick.model, 'local-free');
    assert.equal(pick.isFree, true);
  });

  await check(name('Quality selects the local model when it is the only candidate'), () => {
    const pick = selectForStage('quality', stage.id, [localUnknown(LOCAL_MODEL_ID)]);
    assert.ok(pick);
    assert.equal(pick.provider, LOCAL_PROVIDER_ID);
    assert.equal(pick.model, LOCAL_MODEL_ID);
  });

  await check(name('Quality prefers a known-priced peer inside the comparability tolerance'), () => {
    const pick = selectForStage('quality', stage.id, [
      localUnknown(LOCAL_MODEL_ID),
      externalPaid('peer-a'),
    ]);
    assert.ok(pick);
    assert.equal(pick.provider, 'openrouter');
  });

  await check(name('Quality keeps the local model when its capability advantage exceeds the tolerance'), () => {
    const strongLocal = localUnknown(LOCAL_MODEL_ID);
    const weakPeer = externalPaid('peer-a');
    weakPeer.scores = { coding: 40, reasoning: 40, speed: 40, longContext: 40 };
    const pick = selectForStage('quality', stage.id, [strongLocal, weakPeer]);
    assert.ok(pick);
    assert.equal(pick.provider, LOCAL_PROVIDER_ID, 'a materially stronger model still wins Quality');
  });

  // ── 6. Strict Free (must NOT be weakened) ───────────────────────────────
  await check(name('Strict Free setup excludes unknown-priced local for this stage'), () => {
    const catalog = [localUnknown(LOCAL_MODEL_ID)];
    const pick = selectForStage('free', stage.id, catalog);
    assert.ok(pick);
    assert.equal(pick.unavailable, true, 'Free never falls back to an unconfirmed-free local model');
    assert.equal(pick.provider, null);
    assert.deepEqual(getFreeStageCandidates(catalog, stage.id), []);
    assert.equal(isConfirmedFreeModel(catalog, LOCAL_PROVIDER_ID, LOCAL_MODEL_ID), false);
  });

  await check(name('Strict Free drops an unconfirmed local override for this stage'), () => {
    const plan = prepareStrictFreeRun([localUnknown(LOCAL_MODEL_ID)], stage.id, {
      provider: LOCAL_PROVIDER_ID,
      model: LOCAL_MODEL_ID,
    });
    assert.equal(plan.stageOverride, null, 'the override must be dropped, not honored');
    assert.deepEqual(plan.freeCandidates, []);
  });

  await check(name('Strict Free includes a local model advertising explicit 0/0 (existing authority, unchanged)'), () => {
    const catalog = [localExplicitFree(LOCAL_MODEL_ID)];
    assert.deepEqual(getFreeStageCandidates(catalog, stage.id), [
      { provider: LOCAL_PROVIDER_ID, model: LOCAL_MODEL_ID },
    ]);
    assert.equal(isConfirmedFreeModel(catalog, LOCAL_PROVIDER_ID, LOCAL_MODEL_ID), true);
    const plan = prepareStrictFreeRun(catalog, stage.id, {
      provider: LOCAL_PROVIDER_ID,
      model: LOCAL_MODEL_ID,
    });
    assert.deepEqual(plan.stageOverride, { provider: LOCAL_PROVIDER_ID, model: LOCAL_MODEL_ID });
  });

  await check(name('Strict Free runtime chain for this stage is confirmed-free local only'), async () => {
    reset(() => json(200, chatBody(LOCAL_MODEL_ID)));
    const plan = prepareStrictFreeRun([localExplicitFree(LOCAL_MODEL_ID)], stage.id, null);
    const result = await runWithFallback({
      task: stage.id,
      messages: [{ role: 'user', content: 'free stage' }],
      strictFree: true,
      freeCandidates: plan.freeCandidates.map((c) => ({
        provider: c.provider as never,
        model: c.model,
      })),
      localEndpoint: { baseUrl },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${baseUrl}/chat/completions`);
    assert.equal(result.provider, LOCAL_PROVIDER_ID);
    assert.equal(result.fallbackCount, 0);
  });

  await check(name('Strict Free with only unknown-priced local fails structured BEFORE any HTTP'), async () => {
    reset(() => json(200, { should: 'never be called' }));
    await assert.rejects(
      () =>
        runWithFallback({
          task: stage.id,
          messages: [{ role: 'user', content: 'free stage' }],
          strictFree: true,
          freeCandidates: [],
          localEndpoint: { baseUrl },
        }),
      new RegExp(`No free model is available for this stage \\(task: ${stage.id}\\)`)
    );
    assert.equal(calls.length, 0);
  });

  // ── 7. Runtime execution reaches the local client ───────────────────────
  await check(name('executes on the local client: endpoint, model id, body, response parsing, usage'), async () => {
    const { result, sent } = await runStage(stage, baseUrl);
    assert.equal(calls.length, 1, 'exactly one request; no other provider endpoint is touched');
    assert.equal(sent.url, `${baseUrl}/chat/completions`, 'the stored base URL is the only address targeted');
    const body = JSON.parse(sent.body ?? '{}');
    assert.equal(body.model, LOCAL_MODEL_ID, 'the model id comes from the local /models listing');
    assert.equal(body.temperature, 0.3, 'existing per-stage temperature contract');
    assert.equal(body.max_tokens, stage.maxTokens, 'existing per-stage max_tokens contract');
    assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.ok(Array.isArray(body.messages) && body.messages.length === 1);
    assert.equal(result.content, `completion-for-${LOCAL_MODEL_ID}`, 'OpenAI-compatible response parsing');
    assert.equal(result.provider, LOCAL_PROVIDER_ID);
    assert.equal(result.model, LOCAL_MODEL_ID);
    assert.deepEqual(result.usage, { inputTokens: 11, outputTokens: 5, totalTokens: 16 });
    assert.equal(result.fallbackCount, 0);
    assert.deepEqual(result.attemptedProviders, [
      { provider: LOCAL_PROVIDER_ID, model: LOCAL_MODEL_ID },
    ]);
  });

  await check(name('a keyless connection sends no Authorization header'), async () => {
    const { sent } = await runStage(stage, baseUrl);
    assert.equal(sent.headers.Authorization, undefined);
  });

  await check(name('a keyed connection sends Bearer to its own endpoint only'), async () => {
    reset(() => json(200, chatBody(LOCAL_MODEL_ID)));
    await runWithFallback({
      task: stage.id,
      messages: [{ role: 'user', content: 'keyed' }],
      stageOverrides: { provider: LOCAL_PROVIDER_ID, model: LOCAL_MODEL_ID },
      localEndpoint: { baseUrl, apiKey: 'local-key-fixture-1234' },
      providerTokens: { openrouter: 'peer-key-must-not-be-used' },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers.Authorization, 'Bearer local-key-fixture-1234');
    assert.ok(!calls[0].url.includes('openrouter'));
  });

  await check(name('an unversioned stored base URL keeps the existing /v1 candidate fallback'), async () => {
    const rootBase = `http://127.0.0.1:${19200 + stageIndex}`;
    reset((call) =>
      call.url === `${rootBase}/v1/chat/completions`
        ? json(200, chatBody(LOCAL_MODEL_ID))
        : json(404, { error: 'no route' })
    );
    const result = await runWithFallback({
      task: stage.id,
      messages: [{ role: 'user', content: 'unversioned' }],
      stageOverrides: { provider: LOCAL_PROVIDER_ID, model: LOCAL_MODEL_ID },
      localEndpoint: { baseUrl: rootBase },
    });
    assert.deepEqual(calls.map((c) => c.url), [
      `${rootBase}/chat/completions`,
      `${rootBase}/v1/chat/completions`,
    ]);
    assert.equal(result.provider, LOCAL_PROVIDER_ID);
  });

  await check(name('local failure falls back per existing policy, with Task E metadata intact'), async () => {
    reset((call) =>
      call.url.startsWith(baseUrl)
        ? json(500, { error: 'internal failure' })
        : json(200, chatBody('peer-fallback'))
    );
    const result = await runWithFallback({
      task: stage.id,
      messages: [{ role: 'user', content: 'fallback' }],
      stageOverrides: { provider: LOCAL_PROVIDER_ID, model: LOCAL_MODEL_ID },
      automaticCandidates: [{ provider: 'openrouter', model: 'peer-fallback', contextWindow: 128_000 }],
      providerTokens: { openrouter: 'peer-key-fixture' },
      localEndpoint: { baseUrl },
    });
    assert.equal(calls.length, 2);
    assert.ok(calls[0].url.startsWith(baseUrl), 'the local attempt targets the stored endpoint');
    assert.ok(!calls[1].url.startsWith(baseUrl), 'the fallback never reuses the local endpoint');
    assert.equal(result.provider, 'openrouter');
    assert.equal(result.model, 'peer-fallback');
    assert.equal(result.fallbackCount, 1);
    assert.equal(result.attemptedProviders.length, 2);
    assert.match(result.attemptedProviders[0].error ?? '', /^server_error: Local endpoint error 500/);
  });

  await check(name('a context-shaped local rejection is classified context_too_large and skipped'), async () => {
    reset((call) =>
      call.url.startsWith(baseUrl)
        ? json(400, { error: 'prompt exceeds the context limit of this model' })
        : json(200, chatBody('peer-fallback'))
    );
    const result = await runWithFallback({
      task: stage.id,
      messages: [{ role: 'user', content: 'too long' }],
      stageOverrides: { provider: LOCAL_PROVIDER_ID, model: LOCAL_MODEL_ID },
      automaticCandidates: [{ provider: 'openrouter', model: 'peer-fallback', contextWindow: 128_000 }],
      providerTokens: { openrouter: 'peer-key-fixture' },
      localEndpoint: { baseUrl },
    });
    assert.equal(result.provider, 'openrouter');
    assert.match(result.attemptedProviders[0].error ?? '', /^context_too_large:/);
  });

  await check(name('a local auth failure is not fallback-worthy and never leaks the key'), async () => {
    reset(() => json(401, { error: 'unauthorized' }));
    let message = '';
    try {
      await runWithFallback({
        task: stage.id,
        messages: [{ role: 'user', content: 'auth' }],
        stageOverrides: { provider: LOCAL_PROVIDER_ID, model: LOCAL_MODEL_ID },
        automaticCandidates: [{ provider: 'openrouter', model: 'peer-fallback', contextWindow: 128_000 }],
        providerTokens: { openrouter: 'peer-key-fixture' },
        localEndpoint: { baseUrl, apiKey: 'local-key-fixture-1234' },
      });
    } catch (err) {
      message = (err as Error).message;
    }
    assert.match(message, /^Authentication failed with local:/);
    assert.ok(!message.includes('local-key-fixture-1234'), 'the key must never appear in errors');
    assert.equal(calls.length, 1, 'auth is not fallback-worthy — no further attempts');
  });

  await check(name('an empty local completion is an error, never a silent empty stage result'), async () => {
    reset(() => json(200, { choices: [{ message: { content: '' } }] }));
    await assert.rejects(
      () =>
        runWithFallback({
          task: stage.id,
          messages: [{ role: 'user', content: 'empty' }],
          stageOverrides: { provider: LOCAL_PROVIDER_ID, model: LOCAL_MODEL_ID },
          localEndpoint: { baseUrl },
        }),
      new RegExp(`Local endpoint returned empty response for model ${LOCAL_MODEL_ID}`)
    );
  });

  await check(name('a disconnected local provider: zero HTTP and the structured existing error'), async () => {
    reset(() => json(200, { should: 'never be called' }));
    let message = '';
    try {
      await runWithFallback({
        task: stage.id,
        messages: [{ role: 'user', content: 'disconnected' }],
        stageOverrides: { provider: LOCAL_PROVIDER_ID, model: LOCAL_MODEL_ID },
        providerTokens: { local: 'key-without-endpoint-fixture' },
      });
    } catch (err) {
      message = (err as Error).message;
    }
    assert.match(
      message,
      new RegExp(`No configured providers available for task: ${stage.id}`)
    );
    assert.equal(calls.length, 0, 'no HTTP may happen when the local provider is disconnected');
    assert.ok(!message.includes('key-without-endpoint-fixture'), 'credentials never appear in errors');
  });

  await check(name('a local candidate with no endpoint is skipped, never borrowed from another provider'), async () => {
    reset(() => json(200, chatBody('peer-only')));
    const result = await runWithFallback({
      task: stage.id,
      messages: [{ role: 'user', content: 'skip local' }],
      stageOverrides: { provider: LOCAL_PROVIDER_ID, model: LOCAL_MODEL_ID },
      automaticCandidates: [{ provider: 'openrouter', model: 'peer-only', contextWindow: 128_000 }],
      providerTokens: { openrouter: 'peer-key-fixture' },
      // no localEndpoint — disconnected local
    });
    assert.equal(result.provider, 'openrouter', 'the local candidate is skipped, not mis-routed');
    assert.equal(result.fallbackCount, 0, 'a skipped candidate is not a fallback hop (existing router semantics)');
    assert.deepEqual(
      result.attemptedProviders.map((a) => a.provider),
      ['openrouter'],
      'only executed attempts are recorded'
    );
  });

  // ── 8. model_selection.stages metadata ─────────────────────────────────
  await check(name('model_selection.stages records the executed local model with no fallback'), async () => {
    const { result } = await runStage(stage, baseUrl);
    const record = buildStageAssignmentRecord(result);
    assert.deepEqual(record, {
      provider: LOCAL_PROVIDER_ID,
      model: LOCAL_MODEL_ID,
      fallbackCount: 0,
      attempted: [{ provider: LOCAL_PROVIDER_ID, model: LOCAL_MODEL_ID }],
    });
    const view = deriveStageAttemptView(record);
    assert.equal(view.state, 'initial');
    assert.equal(view.selected, `${LOCAL_PROVIDER_ID} · ${LOCAL_MODEL_ID}`);
    assert.equal(view.actual, `${LOCAL_PROVIDER_ID} · ${LOCAL_MODEL_ID}`);
    assert.equal(view.attempts, 1);
  });

  await check(name('model_selection.stages records the ACTUAL fallback model, never the selected local one'), async () => {
    reset((call) =>
      call.url.startsWith(baseUrl)
        ? json(500, { error: 'internal failure' })
        : json(200, chatBody('peer-fallback'))
    );
    const result = await runWithFallback({
      task: stage.id,
      messages: [{ role: 'user', content: 'metadata fallback' }],
      stageOverrides: { provider: LOCAL_PROVIDER_ID, model: LOCAL_MODEL_ID },
      automaticCandidates: [{ provider: 'openrouter', model: 'peer-fallback', contextWindow: 128_000 }],
      providerTokens: { openrouter: 'peer-key-fixture' },
      localEndpoint: { baseUrl },
    });
    const record = buildStageAssignmentRecord(result);
    assert.equal(record.provider, 'openrouter', 'the record reflects what executed, not what was selected');
    assert.equal(record.model, 'peer-fallback');
    assert.equal(record.fallbackCount, 1);
    assert.deepEqual(record.attempted, [
      { provider: LOCAL_PROVIDER_ID, model: LOCAL_MODEL_ID },
      { provider: 'openrouter', model: 'peer-fallback' },
    ]);
    const view = deriveStageAttemptView(record);
    assert.equal(view.state, 'fallback');
    assert.equal(view.selected, `${LOCAL_PROVIDER_ID} · ${LOCAL_MODEL_ID}`);
    assert.equal(view.actual, 'openrouter · peer-fallback');
  });

  await check(name('buildStageAssignmentRecord carries no per-attempt error text and no catalog input'), () => {
    const record = buildStageAssignmentRecord({
      provider: LOCAL_PROVIDER_ID,
      model: LOCAL_MODEL_ID,
      fallbackCount: 1,
      attemptedProviders: [
        { provider: LOCAL_PROVIDER_ID, model: LOCAL_MODEL_ID, error: 'server_error: secret-ish' } as never,
        { provider: 'openrouter', model: 'peer-fallback' },
      ],
    });
    assert.deepEqual(record.attempted, [
      { provider: LOCAL_PROVIDER_ID, model: LOCAL_MODEL_ID },
      { provider: 'openrouter', model: 'peer-fallback' },
    ]);
    assert.ok(!JSON.stringify(record).includes('secret-ish'), 'attempt error text is not persisted here');
  });
}

// ── Cross-stage checks ───────────────────────────────────────────────────

async function crossStageChecks(): Promise<void> {
  await check('selectStageModels (all five stages): a wide-context local model is eligible for EVERY stage', () => {
    const picks = selectStageModels('balanced', [
      localUnknown(LOCAL_MODEL_ID),
      localUnknown('local-alt'),
    ]);
    for (const stage of STAGES) {
      const pick = picks[stage.id];
      assert.ok(pick, `${stage.id} must resolve`);
      assert.equal(pick.provider, LOCAL_PROVIDER_ID, `${stage.id} must be able to pick local`);
      assert.notEqual(pick.unavailable, true);
    }
  });

  await check('selectStageModels (all five stages): Free setup marks unknown-priced local unavailable for EVERY stage', () => {
    const picks = selectStageModels('free', [localUnknown(LOCAL_MODEL_ID)]);
    for (const stage of STAGES) {
      const pick = picks[stage.id];
      assert.ok(pick);
      assert.equal(pick.unavailable, true, `${stage.id} must stay unavailable under Strict Free`);
    }
  });

  await check('documented limitation: default local context eligibility == (default >= stage minimum), per stage', () => {
    const catalog = [localUnknown(LOCAL_MODEL_ID, DEFAULT_LOCAL_CONTEXT)];
    const excluded: string[] = [];
    for (const stage of STAGES) {
      const eligible = getAutomaticStageCandidates(catalog, stage.id).length === 1;
      const expected = DEFAULT_LOCAL_CONTEXT >= STAGE_CONTEXT_MIN[stage.id];
      assert.equal(eligible, expected, `${stage.id}: default ${DEFAULT_LOCAL_CONTEXT} vs min ${STAGE_CONTEXT_MIN[stage.id]}`);
      if (!expected) excluded.push(`${stage.id}(min ${STAGE_CONTEXT_MIN[stage.id]})`);
    }
    // Evidence extraction is the stage whose requirement currently exceeds the
    // honest 128K default. Kept as an assertion (not a comment) so the
    // documented limitation can never silently become wrong: if a future
    // change lowered that requirement, or raised the default, this fails.
    assert.deepEqual(
      excluded,
      ['evidence_extraction(min 200000)'],
      'exact set of stages a default-context local model cannot serve automatically'
    );
    // And it is still fully reachable by the routes that must not bypass the gate.
    assert.equal(
      buildStageCandidatePool([connectedProvider()], catalog).length,
      1,
      'manual Configure keeps the full connected catalog for every stage'
    );
    assert.equal(
      buildStageOverrides(['evidence_extraction'], {
        evidence_extraction: {
          selectedProvider: LOCAL_PROVIDER_ID,
          selectedModel: LOCAL_MODEL_ID,
          isOverride: true,
        },
      })['evidence_extraction'].provider,
      LOCAL_PROVIDER_ID,
      'a manual override is still selectable for the excluded stage'
    );
  });

  await check('the local client is instantiated only through the stored per-user endpoint', async () => {
    const { createProviderInstance, createProviderInstanceWithApiKey } = await import(
      './lib/ai/providers/registry'
    );
    assert.throws(() => createProviderInstance('local'), /no env-configured instance/i);
    assert.throws(() => createProviderInstanceWithApiKey('local', 'any-key'), /per-user base URL/i);
    const instance = createProviderInstanceWithApiKey('local', undefined, {
      baseUrl: 'http://127.0.0.1:19998/v1',
    });
    assert.equal(instance.name, 'local');
  });
}

async function main(): Promise<void> {
  await globalChecks();
  for (const stage of STAGES) {
    await stageChecks(stage);
  }
  await crossStageChecks();
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
