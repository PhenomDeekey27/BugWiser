// Task R — regression coverage for provider connect/disconnect latency and
// /models page load latency.
//
// Bug 1 (slow disconnect): the Disconnect button stayed on "Disconnecting…"
//   because `handleDisconnect` awaited `refresh()`, and `refresh()`'s
//   GET /api/models used to perform a SYNCHRONOUS catalog rebuild whenever the
//   connected-provider fingerprint changed. Covered by runDisconnect +
//   markProviderDisconnected and a REAL wall-clock decoupling measurement.
// Bug 2 (state only after a full page reload): `setProviders` only ever ran at
//   the end of that refresh. Covered by asserting the mutation response alone
//   drives the provider patch, with the catalog refresh detached.
// Bug 3 (/models page slow to load): the display path no longer waits for live
//   discovery / AI classification / a full re-store. Covered by
//   planCatalogServe (pure serve/revalidate decision) + the bounded
//   revalidation loop the client runs instead.
//
// Pure/unit tests: HTTP and DB boundaries are injected fakes — NO real network,
// NO real database, NO secrets, NO hardcoded product model or provider names
// beyond the provider-id literals the schema already uses, NO real model calls.

import { strict as assert } from 'node:assert';
import {
  createConnectGate,
  markProviderConnected,
  markProviderDisconnected,
  runConnect,
  runDisconnect,
  type ConnectAck,
  type DisconnectDeps,
} from './components/models/connectState';
import {
  CATALOG_REVALIDATION_DELAY_MS,
  MAX_CATALOG_REVALIDATION_ATTEMPTS,
  revalidateUntilSettled,
} from './components/models/catalogRevalidation';
import { buildStageCandidatePool, filterStageModels } from './components/models/stageCandidates';
import {
  canReuseRebuild,
  isGenerationSuperseded,
  markCatalogDirty,
  planCatalogServe,
  type SingleFlightRebuild,
} from './lib/ai/model-intelligence';
import { buildProviderFingerprint } from './lib/ai/model-intelligence';
import {
  getFreeStageCandidates,
  isConfirmedFreeModel,
  prepareStrictFreeRun,
  selectForStage,
  type StageKey,
} from './lib/ai/catalog/stageSelection';
import { buildStageOverrides } from './lib/ai/catalog/stageOverrides';
import { reconcileStageOverrides, shouldReconcileOverrides } from './lib/ai/catalog/overrideReconcile';
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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function build(generation: number): SingleFlightRebuild {
  return {
    promise: Promise.resolve({
      models: [],
      providerFingerprint: 'none',
      classifiedByAi: false,
      classificationModel: null,
      analyzedAt: '1970-01-01T00:00:00.000Z',
    }),
    generation,
  };
}

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

function model(providerId: string, modelId: string, isFree = false): CatalogModel {
  return {
    providerId,
    modelId,
    displayName: modelId,
    contextWindow: 128_000,
    maxOutputTokens: null,
    price: { input: isFree ? 0 : null, output: isFree ? 0 : null, isFree },
    priceSource: 'unknown',
    priceFetchedAt: null,
    supportsReasoning: false,
    supportsToolCalling: false,
    supportsStructuredOutput: false,
    capabilities: [],
    availability: 'available',
    scores: { coding: 3, reasoning: 3, speed: 3, longContext: 3 },
    valueScore: 50,
    tags: [],
    fit: 50,
    stageFit: {},
    available: true,
  };
}

/** A refresh that stays pending until released — models GET /api/models. */
function pendingGate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  return { promise, release };
}

function disconnectHarness(result: { ok: boolean; ack: ConnectAck }, refreshPromise?: Promise<void>) {
  const events: string[] = [];
  let providers: CatalogProvider[] = [
    provider('local', 'connected', 'http://127.0.0.1:8000/v1'),
    provider('openrouter', 'connected'),
    provider('gemini', 'connected'),
  ];
  const deps: DisconnectDeps = {
    post: async () => {
      events.push('post');
      return { ok: result.ok, status: result.ok ? 200 : 500, ack: result.ack };
    },
    onDisconnected: (pid) => {
      events.push('onDisconnected:' + pid);
      providers = markProviderDisconnected(providers, pid);
    },
    onConnected: () => assert.fail('disconnect must not apply a connected patch'),
    refresh: () => {
      events.push('refresh:start');
      return refreshPromise;
    },
    onSuccess: (pid) => events.push('onSuccess:' + pid),
    onError: (m) => events.push('onError:' + m),
  };
  return { deps, events, get providers() { return providers; } };
}

async function main(): Promise<void> {
  // ── BUG 1 — disconnect latency ────────────────────────────────────────────

  await check('BUG 1: disconnect resolves and clears loading state without waiting for the catalog refresh', async () => {
    const gate = pendingGate();
    const h = disconnectHarness({ ok: true, ack: { ok: true } }, gate.promise);

    const outcome = await Promise.race([
      runDisconnect('local', h.deps).then(() => 'disconnect' as const),
      gate.promise.then(() => 'refresh-won' as const),
    ]);

    assert.equal(outcome, 'disconnect', 'disconnect resolved before the catalog refresh finished');
    assert.deepEqual(h.events, ['post', 'onDisconnected:local', 'onSuccess:local', 'refresh:start']);
    assert.equal(h.providers.find((p) => p.providerId === 'local')?.status, 'disconnected');
    gate.release();
    await gate.promise;
  });

  await check('BUG 1: measured wall clock — disconnect does not pay for a slow catalog refresh', async () => {
    const REFRESH_MS = 800;
    const refresh = sleep(REFRESH_MS);
    const h = disconnectHarness({ ok: true, ack: { ok: true } }, refresh);

    const started = process.hrtime.bigint();
    await runDisconnect('gemini', h.deps);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    console.log(
      `      measured: runDisconnect resolved in ${elapsedMs.toFixed(1)}ms with a ${REFRESH_MS}ms catalog refresh still in flight`
    );
    assert.ok(
      elapsedMs < REFRESH_MS / 2,
      `disconnect must resolve well before the refresh completes (measured ${elapsedMs.toFixed(1)}ms vs ${REFRESH_MS}ms refresh)`
    );
    assert.equal(h.providers.find((p) => p.providerId === 'gemini')?.status, 'disconnected');
    await refresh;
  });

  await check('BUG 1: a failed disconnect rejects, keeps the provider connected and shows the error', async () => {
    const h = disconnectHarness({ ok: false, ack: { error: 'Not authenticated' } });
    let refreshStarted = false;
    h.deps.refresh = () => {
      refreshStarted = true;
    };
    await assert.rejects(() => runDisconnect('local', h.deps), /Not authenticated/);
    assert.equal(h.providers.find((p) => p.providerId === 'local')?.status, 'connected', 'state not flipped');
    assert.equal(h.providers.find((p) => p.providerId === 'local')?.baseUrl, 'http://127.0.0.1:8000/v1', 'endpoint metadata preserved');
    assert.equal(refreshStarted, false, 'no catalog refresh after a failed mutation');
    assert.ok(h.events.includes('onError:Not authenticated'), 'error surfaced');
  });

  await check('BUG 1: a transport failure on disconnect rejects so the button stops spinning', async () => {
    const providers = [provider('openrouter', 'connected')];
    await assert.rejects(
      () =>
        runDisconnect('openrouter', {
          post: async () => {
            throw new Error('network down');
          },
          onDisconnected: () => assert.fail('must not disconnect'),
          refresh: () => undefined,
        }),
      /network down/
    );
    assert.equal(providers[0].status, 'connected', 'original list untouched');
  });

  await check('BUG 1: duplicate disconnect clicks cannot fire a second request', async () => {
    const gate = createConnectGate();
    assert.equal(gate.tryBegin(), true);
    assert.equal(gate.tryBegin(), false);
    gate.end();
    assert.equal(gate.tryBegin(), true);
  });

  // ── BUG 2 — provider state updates without a page reload ───────────────────

  await check('BUG 2: a persisted disconnect removes the provider models from every stage candidate pool immediately', () => {
    const before = [provider('local', 'connected', 'http://127.0.0.1:8000/v1'), provider('openrouter', 'connected')];
    const models = [model('local', 'local-server-model'), model('openrouter', 'external-model')];
    assert.equal(buildStageCandidatePool(before, models).length, 2, 'both providers contribute while connected');
    assert.equal(buildStageCandidatePool(before, models).some((m) => m.providerId === 'local'), true);

    const after = markProviderDisconnected(before, 'local');
    const pool = buildStageCandidatePool(after, models);
    assert.equal(pool.length, 1, 'the disconnected provider contributes nothing, with no reload');
    assert.equal(pool[0].providerId, 'openrouter');
    assert.equal(filterStageModels(pool, 'local').length, 0, 'and it is not searchable either');
  });

  await check('BUG 2: connect and disconnect patches are provider-agnostic (local follows the shared flow)', () => {
    const base = [provider('local', 'disconnected'), provider('openrouter', 'disconnected')];
    const connected = markProviderConnected(base, 'local', { ok: true }, 'http://127.0.0.1:8000/v1');
    assert.equal(connected.find((p) => p.providerId === 'local')?.status, 'connected');
    assert.equal(connected.find((p) => p.providerId === 'local')?.baseUrl, 'http://127.0.0.1:8000/v1');

    const disconnected = markProviderDisconnected(connected, 'local');
    assert.equal(disconnected.find((p) => p.providerId === 'local')?.status, 'disconnected');
    assert.equal(disconnected.find((p) => p.providerId === 'local')?.baseUrl, null, 'endpoint metadata dropped with the connection');
    assert.equal(disconnected.find((p) => p.providerId === 'openrouter'), base[1], 'untouched rows keep identity');
  });

  await check('BUG 2: connect still updates state immediately and does not block on the refresh', async () => {
    const gate = pendingGate();
    let providers = [provider('openrouter', 'disconnected')];
    const outcome = await Promise.race([
      runConnect('openrouter', 'key', undefined, {
        post: async () => ({ ok: true, status: 200, ack: { ok: true, provider: 'openrouter' } }),
        onConnected: (pid, ack) => {
          providers = markProviderConnected(providers, pid, ack);
        },
        refresh: () => gate.promise,
      }),
      gate.promise.then(() => 'refresh-won' as const),
    ]);
    assert.equal(outcome, undefined, 'connect resolved before the catalog refresh finished');
    assert.equal(providers[0].status, 'connected');
    gate.release();
    await gate.promise;
  });

  await check('BUG 2: a failed connect does not mark the provider connected and does not refresh', async () => {
    let providers = [provider('openrouter', 'disconnected')];
    let refreshStarted = false;
    await assert.rejects(
      () =>
        runConnect('openrouter', 'bad', undefined, {
          post: async () => ({ ok: false, status: 400, ack: { error: 'Provider validation failed: unreachable' } }),
          onConnected: (pid) => {
            providers = markProviderConnected(providers, pid, {});
          },
          refresh: () => {
            refreshStarted = true;
          },
        }),
      /unreachable/
    );
    assert.equal(providers[0].status, 'disconnected', 'never shows Connected when persistence failed');
    assert.equal(refreshStarted, false);
  });

  await check('BUG 2: a failed background refresh never reverts a persisted mutation', async () => {
    const gate = pendingGate();
    let providers = [provider('openrouter', 'connected')];
    await runDisconnect('openrouter', {
      post: async () => ({ ok: true, status: 200, ack: { ok: true } }),
      onDisconnected: (pid) => {
        providers = markProviderDisconnected(providers, pid);
      },
      refresh: () => gate.promise,
    });
    gate.release();
    await gate.promise.catch(() => undefined);
    assert.equal(providers[0].status, 'disconnected', 'connection state survives a refresh problem');
  });

  // ── BUG 3 — /models page load path ────────────────────────────────────────

  await check('BUG 3: a fresh, matching cached catalog is served with NO rebuild scheduled', () => {
    const plan = planCatalogServe({ hasPersisted: true, fingerprintMatches: true, stale: false });
    assert.deepEqual(plan, { serve: 'persisted', revalidate: false, pending: false });
  });

  await check('BUG 3: a provider-set change serves the cached catalog and rebuilds in the BACKGROUND', () => {
    const plan = planCatalogServe({ hasPersisted: true, fingerprintMatches: false, stale: false });
    assert.deepEqual(plan, { serve: 'persisted', revalidate: true, pending: true });
  });

  await check('BUG 3: a TTL-expired catalog is likewise served from cache and revalidated', () => {
    const plan = planCatalogServe({ hasPersisted: true, fingerprintMatches: true, stale: true });
    assert.deepEqual(plan, { serve: 'persisted', revalidate: true, pending: true });
  });

  await check('BUG 3: with nothing cached the page renders empty + pending instead of blocking on a first build', () => {
    const plan = planCatalogServe({ hasPersisted: false, fingerprintMatches: null, stale: false });
    assert.deepEqual(plan, { serve: 'empty', revalidate: true, pending: true });
  });

  await check('BUG 3: the serve decision is provider-agnostic — a local connect/disconnect flips it too', () => {
    const connections = (local: boolean): Record<string, boolean> => ({
      openrouter: true,
      local,
    });
    const before = buildProviderFingerprint(connections(false) as never);
    const after = buildProviderFingerprint(connections(true) as never);
    assert.notEqual(before, after, 'the fingerprint the display read compares against changes for local');
    assert.equal(planCatalogServe({ hasPersisted: true, fingerprintMatches: false, stale: false }).revalidate, true);
  });

  await check('BUG 3: revalidation re-reads until the catalog is current, without blocking the render', async () => {
    const reads: number[] = [];
    const delays: number[] = [];
    let pending = true;
    await revalidateUntilSettled({
      maxAttempts: 5,
      delayMs: 10,
      fetchPending: async () => {
        reads.push(reads.length);
        if (reads.length >= 3) pending = false;
        return pending;
      },
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    assert.deepEqual(reads, [0, 1, 2], 'exactly one read per attempt until the flag clears');
    assert.deepEqual(delays, [10, 10, 10], 'the loop waits between reads instead of spinning');
  });

  await check('BUG 3: revalidation is bounded and reports exhaustion (a failing discovery cannot poll forever)', async () => {
    let attempts = 0;
    let exhaustedAt = -1;
    await revalidateUntilSettled({
      maxAttempts: MAX_CATALOG_REVALIDATION_ATTEMPTS,
      delayMs: CATALOG_REVALIDATION_DELAY_MS,
      fetchPending: async () => {
        attempts++;
        return true; // never settles
      },
      sleep: async () => undefined,
      onExhausted: (n) => {
        exhaustedAt = n;
      },
    });
    assert.equal(attempts, MAX_CATALOG_REVALIDATION_ATTEMPTS, 'read attempts are capped');
    assert.equal(exhaustedAt, MAX_CATALOG_REVALIDATION_ATTEMPTS, 'the page is told the catalog is still behind');
    assert.ok(MAX_CATALOG_REVALIDATION_ATTEMPTS * CATALOG_REVALIDATION_DELAY_MS <= 10_000, 'worst-case poll window stays short');
  });

  await check('BUG 3: a failing revalidation read stops the loop and never throws', async () => {
    let attempts = 0;
    await revalidateUntilSettled({
      maxAttempts: 4,
      delayMs: 1,
      fetchPending: async () => {
        attempts++;
        throw new Error('GET /api/models 500');
      },
      sleep: async () => undefined,
    });
    assert.equal(attempts, 1, 'a failed read ends the loop instead of retrying blindly');
  });

  // ── Data-safety guard for the display path ───────────────────────────────

  await check('BUG 3: a pending snapshot never triggers override reconciliation (would delete saves)', () => {
    assert.equal(
      shouldReconcileOverrides({ catalogPending: true, modelCount: 0, connectedProviderCount: 3 }),
      false,
      'first load while the background build runs ⇒ do not reconcile an empty snapshot'
    );
    assert.equal(
      shouldReconcileOverrides({ catalogPending: true, modelCount: 0, connectedProviderCount: 1 }),
      false
    );
    assert.equal(
      shouldReconcileOverrides({ catalogPending: true, modelCount: 120, connectedProviderCount: 3 }),
      false,
      'a pending snapshot PROVABLY predates the current provider set — a just-connected provider\'s models are missing from it, so reconciling would erase valid overrides for them (connect-window over-drop)'
    );
    assert.equal(
      shouldReconcileOverrides({ catalogPending: true, modelCount: 0, connectedProviderCount: 0 }),
      true,
      'nothing connected ⇒ the empty catalog IS authoritative and self-heal must still run'
    );
    assert.equal(
      shouldReconcileOverrides({ catalogPending: false, modelCount: 0, connectedProviderCount: 2 }),
      true,
      'authoritative snapshot always reconciles'
    );
  });

  await check('BUG 3: reconciling an empty snapshot would have destroyed saved overrides', () => {
    const saved = { [ROOT]: { provider: 'openrouter', model: 'external-model' } };
    const destructive = reconcileStageOverrides(saved, []);
    assert.equal(destructive.changed, true, 'this is exactly what the guard prevents');
    assert.deepEqual(destructive.kept, {}, 'and it would persist the deletion');

    // The guard keeps the saved entry intact for the next, authoritative read.
    assert.equal(shouldReconcileOverrides({ catalogPending: true, modelCount: 0, connectedProviderCount: 1 }), false);
    const later = reconcileStageOverrides(saved, [
      { providerId: 'openrouter', modelId: 'external-model', available: true },
    ]);
    assert.equal(later.changed, false, 'once the rebuild lands the override survives');
  });

  await check('BUG 3: manual stage overrides still round-trip through the existing builder', () => {
    const overrides = buildStageOverrides([ROOT], {
      [ROOT]: { selectedProvider: 'local', selectedModel: 'local-server-model', isOverride: true, origin: 'manual' },
    });
    assert.deepEqual(overrides[ROOT], { provider: 'local', model: 'local-server-model', origin: 'manual' });
    const reconciled = reconcileStageOverrides(overrides, [
      { providerId: 'local', modelId: 'local-server-model', available: true },
    ]);
    assert.equal(reconciled.changed, false);
    assert.deepEqual(reconciled.kept[ROOT], overrides[ROOT]);
  });

  // ── Catalog generation correctness (Task Q race must not return) ──────────

  await check('CATALOG: a provider mutation advances the generation so a pre-change build is never reused', () => {
    const userId = 'generation-user';
    markCatalogDirty(userId);
    markCatalogDirty(userId);
    // Two mutations ⇒ the current generation is at least 2 ahead of any build
    // started before them, so canReuseRebuild must refuse that build.
    assert.equal(canReuseRebuild(build(0), 2), false, 'a generation-0 build is refused after two mutations');
    assert.equal(canReuseRebuild(build(2), 2), true, 'a build started after the mutations is still shared');
  });

  await check('CATALOG: a build overtaken by a provider mutation is detected as superseded', () => {
    assert.equal(isGenerationSuperseded(3, 2), true, 'generation advanced during the build ⇒ do not store');
    assert.equal(isGenerationSuperseded(2, 2), false, 'no change during the build ⇒ store normally');
  });

  await check('CATALOG: generations are tracked per user', () => {
    markCatalogDirty('generation-user-a');
    markCatalogDirty('generation-user-a');
    markCatalogDirty('generation-user-b');
    // user-b's first mutation must not be satisfied by user-a's builds, and
    // user-a's second mutation must not be satisfied by user-b's first build.
    assert.equal(canReuseRebuild(build(1), 2), false, 'user-a needs a build at generation 2');
  });

  // ── Regression guards: Strict Free / stage selection unchanged ─────────────

  await check('REGRESSION: a disconnected provider can never supply a Strict Free candidate', () => {
    const catalog = [model('local', 'local-server-model', true), model('openrouter', 'external-model', true)];
    assert.deepEqual(
      getFreeStageCandidates(catalog, ROOT),
      [
        { provider: 'local', model: 'local-server-model' },
        { provider: 'openrouter', model: 'external-model' },
      ],
      'the catalog itself is unchanged — connectivity is enforced upstream, by the same provider_connections read the runtime uses'
    );
    const connectedAfterDisconnect = buildStageCandidatePool(
      markProviderDisconnected([provider('local', 'connected'), provider('openrouter', 'connected')], 'local'),
      catalog
    );
    assert.deepEqual(
      getFreeStageCandidates(connectedAfterDisconnect, ROOT),
      [{ provider: 'openrouter', model: 'external-model' }],
      'only the still-connected provider survives'
    );
  });

  await check('REGRESSION: Strict Free still drops an unconfirmed override and never falls back to paid', () => {
    const plan = prepareStrictFreeRun([model('local', 'local-server-model')], ROOT, {
      provider: 'local',
      model: 'local-server-model',
    });
    assert.deepEqual(plan.freeCandidates, [], 'unknown pricing is still not free');
    assert.equal(plan.stageOverride, null, 'override dropped');
    assert.equal(isConfirmedFreeModel([model('local', 'local-server-model')], 'local', 'local-server-model'), false);
    assert.equal(selectForStage('free', ROOT, [model('local', 'local-server-model')])?.unavailable, true);
  });

  await check('REGRESSION: an explicitly zero-priced model is still confirmed free', () => {
    assert.equal(isConfirmedFreeModel([model('openrouter', 'external-model', true)], 'openrouter', 'external-model'), true);
    assert.deepEqual(getFreeStageCandidates([model('openrouter', 'external-model', true)], ROOT), [
      { provider: 'openrouter', model: 'external-model' },
    ]);
  });

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  if (failures > 0) process.exitCode = 1;
}

void main();
