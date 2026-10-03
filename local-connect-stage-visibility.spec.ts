// Task Q — regression coverage for the two production integration bugs found
// in the real manual test of the Local LLM flow.
//
// Bug 1 (stuck "Connecting..."): the connect handler awaited the catalog
//   refresh, and GET /api/models performs a SYNCHRONOUS catalog rebuild when
//   the connected-provider fingerprint changed — so the spinner was bound to a
//   full provider re-discovery. Covered by runConnect/markProviderConnected +
//   the connect gate.
// Bug 2 (local models invisible in stage selection): a forced rebuild issued
//   AFTER a connect was allowed to JOIN a rebuild that started BEFORE it, so
//   the catalog served to the page (and therefore the stage modal) never
//   contained the newly connected provider's models. Covered by
//   canReuseRebuild's generation rule + the extracted stage candidate pool.
//
// Pure/unit tests: HTTP and DB boundaries are injected fakes — NO real network,
// NO real database, NO secrets, NO hardcoded product model names, NO Strict
// Free changes.

import { strict as assert } from 'node:assert';
import {
  createConnectGate,
  markProviderConnected,
  runConnect,
} from './components/models/connectState';
import {
  bucketStageModels,
  buildStageCandidatePool,
  filterStageModels,
  RECOMMENDED_LIMIT,
} from './components/models/stageCandidates';
import { canReuseRebuild, type SingleFlightRebuild } from './lib/ai/model-intelligence';
import {
  getFreeStageCandidates,
  isConfirmedFreeModel,
  prepareStrictFreeRun,
  selectForStage,
  type StageKey,
} from './lib/ai/catalog/stageSelection';
import { buildStageOverrides } from './lib/ai/catalog/stageOverrides';
import {
  canRegister,
  createInitialLocalFlowState,
  localFlowReducer,
  type LocalFlowState,
} from './components/models/localProviderFlow';
import type { CatalogModel, CatalogProvider } from './app/models/page';

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

const ROOT: StageKey = 'relevant_file_discovery';

// ── Fixtures ────────────────────────────────────────────────────────────────

function provider(providerId: string, status: CatalogProvider['status'], baseUrl?: string): CatalogProvider {
  return {
    providerId,
    displayName: providerId,
    authType: 'api_key',
    status,
    connectedAt: null,
    serverConfigured: false,
    description: '',
    docsUrl: '',
    baseUrl: baseUrl ?? null,
  };
}

function model(
  providerId: string,
  modelId: string,
  opts: {
    isFree?: boolean;
    input?: number | null;
    output?: number | null;
    contextWindow?: number;
    valueScore?: number;
    scores?: { coding: number; reasoning: number; speed: number; longContext: number };
    available?: boolean;
  } = {}
): CatalogModel {
  const isFree = opts.isFree === true;
  return {
    providerId,
    modelId,
    displayName: modelId,
    contextWindow: opts.contextWindow ?? 128_000,
    maxOutputTokens: null,
    price: { input: opts.input ?? null, output: opts.output ?? null, isFree },
    priceSource: 'unknown',
    priceFetchedAt: null,
    supportsReasoning: false,
    supportsToolCalling: false,
    supportsStructuredOutput: false,
    capabilities: [],
    availability: 'available',
    scores: opts.scores ?? { coding: 3, reasoning: 3, speed: 3, longContext: 3 },
    valueScore: opts.valueScore ?? 50,
    tags: [],
    fit: 50,
    stageFit: {},
    available: opts.available !== false,
  };
}

/** Local endpoint that advertises no pricing (the common self-hosted case). */
const localUnknown = (id: string, extra: Partial<Parameters<typeof model>[2]> = {}) =>
  model('local', id, { isFree: false, input: null, output: null, ...extra });

/** Local endpoint that advertises explicit 0/0 pricing. */
const localExplicitZero = (id: string) =>
  model('local', id, { isFree: true, input: 0, output: 0 });

const externalPriced = (id: string, extra: Partial<Parameters<typeof model>[2]> = {}) =>
  model('openrouter', id, { isFree: false, input: 1, output: 2, ...extra });
const externalFree = (id: string) => model('openrouter', id, { isFree: true, input: 0, output: 0 });

const CONNECTED_LOCAL = provider('local', 'connected', 'http://127.0.0.1:8000/v1');

// ── Bug 1 — connect flow ────────────────────────────────────────────────────

// A refresh promise the test releases by hand — models the GET /api/models call
// that used to hold the "Connecting..." spinner open.
function makeGate(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = () => res();
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function main(): Promise<void> {
  // ── Bug 1 ─────────────────────────────────────────────────────────────────

  await check('BUG 1: successful connect resolves even while the catalog refresh is still running', async () => {
    const gate = makeGate();
    const events: string[] = [];
    const requests: string[] = [];
    let providers: CatalogProvider[] = [provider('local', 'disconnected')];

    const settled = await Promise.race([
      runConnect('local', '', { baseUrl: 'http://127.0.0.1:8000/v1' }, {
        post: async () => {
          requests.push('local');
          return { ok: true, status: 200, ack: { ok: true, provider: 'local', status: 'connected', modelCount: 3 } };
        },
        onConnected: (pid, ack) => {
          events.push('onConnected:' + pid);
          providers = markProviderConnected(providers, pid, ack, 'http://127.0.0.1:8000/v1');
        },
        refresh: () => gate.promise, // still blocked
        onSuccess: () => events.push('success'),
      }),
      gate.promise.then(() => 'refresh-won' as const),
    ]);

    assert.equal(settled, undefined, 'runConnect resolved before the refresh finished');
    assert.deepEqual(requests, ['local'], 'exactly one registration request');
    assert.deepEqual(events, ['onConnected:local', 'success'], 'provider applied + success toast, in order');
    assert.equal(providers[0].status, 'connected', 'provider shows Connected immediately — no page reload needed');
    assert.equal(providers[0].baseUrl, 'http://127.0.0.1:8000/v1', 'submitted endpoint is reflected immediately');
    gate.resolve();
    await gate.promise;
  });

  await check('BUG 1: a rejected background refresh never surfaces as a connect failure', async () => {
    const gate = makeGate();
    const errors: string[] = [];
    await runConnect('local', '', undefined, {
      post: async () => ({ ok: true, status: 200, ack: { ok: true } }),
      onConnected: () => undefined,
      refresh: () => gate.promise,
      onError: (m) => errors.push(m),
    });
    gate.reject(new Error('catalog GET failed'));
    await gate.promise.catch(() => undefined);
    assert.deepEqual(errors, [], 'catalog refresh failure is not reported as a connect failure');
  });

  await check('BUG 1: a synchronous refresh throw never surfaces as a connect failure', async () => {
    const errors: string[] = [];
    await runConnect('openrouter', 'sk-not-a-real-key', undefined, {
      post: async () => ({ ok: true, status: 200, ack: { ok: true } }),
      onConnected: () => undefined,
      refresh: () => {
        throw new Error('boom');
      },
      onError: (m) => errors.push(m),
    });
    assert.deepEqual(errors, [], 'a throwing refresh is swallowed');
  });

  await check('BUG 1: a failed connect rejects and surfaces the server message (loading state clears)', async () => {
    const errors: string[] = [];
    let connected = false;
    let requests = 0;
    let refreshStarted = false;
    await assert.rejects(
      () =>
        runConnect('local', '', { baseUrl: 'http://127.0.0.1:8000/v1' }, {
          post: async () => {
            requests++;
            return {
              ok: false,
              status: 400,
              ack: { error: 'Provider validation failed: could not reach local' },
            };
          },
          onConnected: () => {
            connected = true;
          },
          refresh: () => {
            refreshStarted = true;
          },
          onError: (m) => errors.push(m),
        }),
      /could not reach local/
    );
    assert.equal(connected, false, 'a failed connect never marks the provider connected');
    assert.equal(refreshStarted, false, 'a failed connect does not trigger a catalog refresh');
    assert.deepEqual(errors, ['Provider validation failed: could not reach local'], 'error surfaced');
    assert.equal(requests, 1, 'exactly one registration request');
  });

  await check('BUG 1: a transport failure rejects so the caller clears its loading state', async () => {
    const errors: string[] = [];
    await assert.rejects(
      () =>
        runConnect('openrouter', 'k', undefined, {
          post: async () => {
            throw new Error('network down');
          },
          onConnected: () => assert.fail('must not connect'),
          refresh: () => undefined,
          onError: (m) => errors.push(m),
        }),
      /network down/
    );
    assert.deepEqual(errors, ['network down']);
  });

  await check('BUG 1: duplicate clicks cannot fire a second registration request', () => {
    const gate = createConnectGate();
    assert.equal(gate.tryBegin(), true, 'first click starts the request');
    assert.equal(gate.tryBegin(), false, 'second click while in flight is rejected');
    gate.end();
    assert.equal(gate.tryBegin(), true, 'a later attempt is allowed again');

    // End-to-end through the form state machine: register-failure returns the
    // flow to a registrable state, so the gate (not the phase) is what makes a
    // duplicate impossible mid-request.
    let state: LocalFlowState = localFlowReducer(
      localFlowReducer(
        createInitialLocalFlowState('http://127.0.0.1:8000/v1'),
        { type: 'test-success', modelCount: 2, baseUrl: 'http://127.0.0.1:8000/v1' }
      ),
      { type: 'register-start' }
    );
    assert.equal(state.phase, 'registering');
    assert.equal(canRegister(state), false, 'cannot register again while registering');
    state = localFlowReducer(state, { type: 'register-failure', error: 'nope' });
    assert.equal(state.phase, 'verified');
    assert.equal(state.error, 'nope', 'failure keeps the form usable with the error shown');
    assert.equal(canRegister(state), true, 'retry with the same verified endpoint is allowed');
  });

  await check('BUG 1: markProviderConnected touches only the target provider and preserves the row', () => {
    const before = [provider('local', 'disconnected'), provider('openrouter', 'disconnected')];
    const after = markProviderConnected(before, 'openrouter', { ok: true }, undefined);
    assert.equal(after[0], before[0], 'untouched provider keeps identity');
    assert.equal(after[1].status, 'connected');
    assert.equal(after[1].baseUrl, null, 'no endpoint metadata is invented for non-local providers');
  });

  // ── Bug 2 — rebuild generation (server) ───────────────────────────────────

  await check('BUG 2: a post-connect rebuild never joins a pre-connect build', () => {
    const build = (generation: number): SingleFlightRebuild => ({
      promise: Promise.resolve({
        models: [],
        providerFingerprint: 'none',
        classifiedByAi: false,
        classificationModel: null,
        analyzedAt: '1970-01-01T00:00:00.000Z',
      }),
      generation,
    });
    assert.equal(
      canReuseRebuild(build(0), 1),
      false,
      'generation bumped by the connect ⇒ the in-flight pre-connect build is NOT reused'
    );
    assert.equal(
      canReuseRebuild(build(1), 1),
      true,
      'the background refresh and the racing page GET still share ONE build'
    );
    assert.equal(canReuseRebuild(undefined, 0), false, 'nothing in flight ⇒ a build starts');
    assert.equal(canReuseRebuild(build(2), 1), false, 'a newer build is never handed back either');
  });

  // ── Bug 2 — stage candidate pool (client) ─────────────────────────────────

  await check('BUG 2: a connected local model is in the stage candidate pool and searchable by provider id', () => {
    const providers = [CONNECTED_LOCAL, provider('openrouter', 'connected')];
    const models = [localUnknown('local=server-a'), externalFree('external-a')];
    const pool = buildStageCandidatePool(providers, models);
    assert.equal(pool.length, 2, 'every connected provider contributes');
    assert.ok(pool.some((m) => m.providerId === 'local'), 'the local model is present');
    assert.equal(
      filterStageModels(pool, 'local').length,
      1,
      'searching the provider id finds the local model'
    );
    assert.equal(
      filterStageModels(pool, 'local=server').length,
      1,
      'searching a local model id prefix finds it'
    );
    assert.equal(filterStageModels(pool, '').length, 2, 'empty query returns the whole pool');
    assert.equal(filterStageModels(pool, 'nothing-matches').length, 0);
  });

  await check('BUG 2: a disconnected provider contributes nothing (same rule for local)', () => {
    const pool = buildStageCandidatePool(
      [provider('local', 'disconnected'), provider('openrouter', 'connected')],
      [localUnknown('local=a'), externalFree('external-a')]
    );
    assert.deepEqual(pool.map((m) => m.providerId), ['openrouter']);
  });

  await check('BUG 2: unavailable models are excluded from the stage pool', () => {
    const pool = buildStageCandidatePool(
      [CONNECTED_LOCAL],
      [localUnknown('local=a'), localUnknown('local=b', { available: false })]
    );
    assert.deepEqual(pool.map((m) => m.modelId), ['local=a']);
  });

  await check('BUG 2: unknown pricing is bucketed as non-free, never promoted to free', () => {
    const buckets = bucketStageModels([localUnknown('local=a'), localExplicitZero('local=b'), externalFree('external-c')]);
    assert.deepEqual(
      buckets.free.map((m) => m.modelId),
      ['local=b', 'external-c'],
      'the free bucket holds only CONFIRMED zero-cost models (explicit 0/0 authority, unchanged)'
    );
    assert.deepEqual(buckets.other.map((m) => m.modelId), ['local=a'], 'unknown pricing is not free');
    assert.equal(buckets.recommended.length, Math.min(RECOMMENDED_LIMIT, 3));
  });

  await check('BUG 2: bucketing never mutates the candidate array', () => {
    const models = [localUnknown('local=a', { valueScore: 1 }), localUnknown('local=b', { valueScore: 9 })];
    const before = models.map((m) => m.modelId);
    bucketStageModels(models);
    filterStageModels(models, 'local').sort((a, b) => b.valueScore - a.valueScore);
    assert.deepEqual(models.map((m) => m.modelId), before, 'input array untouched');
  });

  await check('BUG 2: a local model can be selected as a manual stage override', () => {
    const overrides = buildStageOverrides([ROOT], {
      [ROOT]: {
        selectedProvider: 'local',
        selectedModel: 'local=server-a',
        isOverride: true,
        origin: 'manual',
        unavailable: false,
      },
    });
    assert.deepEqual(overrides[ROOT], { provider: 'local', model: 'local=server-a', origin: 'manual' });
    // Manual selection has NO free gate — an unknown-priced local model is a
    // legitimate override (runtime strict-Free verification is separate).
    assert.equal(isConfirmedFreeModel([localUnknown('local=server-a')], 'local', 'local=server-a'), false);
  });

  // ── Bug 2 — setup semantics (Balanced / Quality / Strict Free) ────────────

  await check('BUG 2: Balanced selects a known-priced external model over an unknown-priced local one', () => {
    const pick = selectForStage('balanced', ROOT, [externalPriced('external-a'), localUnknown('local=a')]);
    assert.equal(pick?.provider, 'openrouter', 'existing Balanced cost policy unchanged');
  });

  await check('BUG 2: Balanced can still select an unknown-priced local model when it is the only candidate', () => {
    const pick = selectForStage('balanced', ROOT, [localUnknown('local=a')]);
    assert.equal(pick?.provider, 'local');
    assert.equal(pick?.model, 'local=a');
    assert.equal(pick?.isFree, false, 'selectable without being treated as free');
  });

  await check('BUG 2: Quality can select an unknown-priced local model and prefers priced peers inside tolerance', () => {
    const only = selectForStage('quality', ROOT, [localUnknown('local=a')]);
    assert.equal(only?.provider, 'local', 'selectable on its own');

    const comparable = selectForStage('quality', ROOT, [
      localUnknown('local=a', { scores: { coding: 3, reasoning: 3, speed: 3, longContext: 3 } }),
      externalPriced('external-a', { scores: { coding: 3, reasoning: 3, speed: 3, longContext: 3 } }),
    ]);
    assert.equal(comparable?.provider, 'openrouter', 'within tolerance the priced candidate still wins');
  });

  await check('BUG 2: an explicitly zero-priced local model wins Free/Strict Free via the existing authority', () => {
    const free = selectForStage('free', ROOT, [
      localUnknown('local=decoy', { scores: { coding: 99, reasoning: 99, speed: 99, longContext: 99 } }),
      localExplicitZero('local=zero'),
    ]);
    assert.equal(free?.provider, 'local');
    assert.equal(free?.model, 'local=zero');
    assert.equal(free?.isFree, true);

    assert.deepEqual(
      getFreeStageCandidates([localExplicitZero('local=zero')], ROOT),
      [{ provider: 'local', model: 'local=zero' }],
      'explicit 0/0 is confirmed free at runtime'
    );
  });

  await check('BUG 2: an unknown-priced local model never enters Strict Free', () => {
    assert.deepEqual(getFreeStageCandidates([localUnknown('local=a')], ROOT), []);
    assert.deepEqual(getFreeStageCandidates([localUnknown('local=a'), externalFree('external-a')], ROOT), [
      { provider: 'openrouter', model: 'external-a' },
    ]);
    assert.equal(isConfirmedFreeModel([localUnknown('local=a')], 'local', 'local=a'), false);

    const plan = prepareStrictFreeRun(
      [localUnknown('local=a')],
      ROOT,
      { provider: 'local', model: 'local=a' }
    );
    assert.deepEqual(plan.freeCandidates, [], 'no free candidates from an unpriced local model');
    assert.equal(plan.stageOverride, null, 'the unverified local override is dropped under Strict Free');
  });

  await check('BUG 2: Free setup marks a stage unavailable when only unknown-priced local models exist', () => {
    const pick = selectForStage('free', ROOT, [localUnknown('local=a')]);
    assert.equal(pick?.unavailable, true, 'no silent paid/unknown fallback');
    assert.equal(pick?.provider, null);
    assert.equal(pick?.isFree, false);
  });

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  if (failures > 0) process.exitCode = 1;
}

void main();
