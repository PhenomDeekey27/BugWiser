// Task Y — unified provider connection lifecycle (Design B) matrix.
//
// Environment credentials are a SERVER-SIDE credential source in the same
// lifecycle as user connections, with an explicit per-user tombstone. The
// enforced precedence is:
//
//   DISABLED (tombstone row) > USER ROW > SERVER ENV > NONE
//
// Coverage (plan cases A–J):
//   A. env + no user row        → server available → runtime env credential
//   B. env + user connected     → user-connected semantics → runtime follows
//                                 the pre-existing env-first precedence
//   C. env + disabled row       → disabled → no runtime credential → no
//                                 available-provider entry → no discovery fetch
//                                 → no execution through env fallback
//   D. disabled → reconnect     → connected → runtime works again
//   E. user-only connect/del    → unchanged (row delete on disconnect)
//   F. local connect/disconnect → unchanged (endpoint-driven, never env)
//   G. direct instance fallback → forbidEnvFallback throws (fail-closed) and
//                                 the gateway passes disabledProviders through
//   H. multi-user isolation     → user A's tombstone never affects user B
//   I. env removed from server  → disabled/user states remain correct
//   J. no key material in any browser-facing payload or log line
//
// Pure/unit: in-memory store + env save/restore + stubbed fetch. No network
// to real providers, no real database, no paid calls, no secrets in output.
// Generic over PROVIDER_NAMES — nothing is hardcoded to one provider.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { createBackgroundClient } from './lib/supabase/background';
import {
  PROVIDER_NAMES,
  enableServerEnvConnection,
  envVarForProvider,
  getProviderConnectionStates,
  getProviderConnections,
  getDisabledProviders,
  isProviderConfiguredBysEnv,
  removeUserConnection,
  resolveUserCredentials,
  resolveLocalEndpoint,
} from './lib/ai/connection/service';
import { encryptSecret } from './lib/ai/connection/encryption';
import { LOCAL_PROVIDER_ID } from './lib/ai/connection/local';
import {
  buildAvailableProviders,
  runWithFallback,
} from './lib/ai/model-router';
import { createProviderInstanceWithApiKey, isProviderConfigured } from './lib/ai/providers/registry';
import { fetchLiveModels } from './lib/ai/catalog/live';

type BackgroundClient = ReturnType<typeof createBackgroundClient>;

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

type Row = {
  user_id: string;
  provider: string;
  status: string;
  encrypted_api_key: string | null;
  base_url?: string | null;
  connected_at?: string | null;
  updated_at?: string | null;
};

// In-memory provider_connections store speaking ONLY the chains service.ts
// uses: select→eq…(thenable), delete→eq…(thenable), upsert, and
// select→eq…→maybeSingle() (resolveLocalEndpoint). Read-after-write is real,
// so reconnect/disable flows are exercised end to end at the service layer.
function makeStore(seed: Row[] = []): {
  rows: Row[];
  db: BackgroundClient;
  upserts: Row[];
  deletes: Array<Record<string, unknown>>;
} {
  const rows: Row[] = seed.map((r) => ({ ...r }));
  const upserts: Row[] = [];
  const deletes: Array<Record<string, unknown>> = [];

  const filterRows = (filters: Record<string, unknown>): Row[] =>
    rows.filter((r) =>
      Object.entries(filters).every(([c, v]) => (r as Record<string, unknown>)[c] === v)
    );

  const db = {
    from(table: string) {
      assert.equal(table, 'provider_connections');
      return {
        select() {
          const filters: Record<string, unknown> = {};
          const builder: Record<string, unknown> = {
            eq: (column: string, value: unknown) => {
              filters[column] = value;
              return builder;
            },
            maybeSingle: () => {
              const singleBuilder: Record<string, unknown> = {};
              (singleBuilder as { then: unknown }).then = (
                onFulfilled?: (v: { data: Row | null; error: null }) => unknown
              ) => {
                const found = filterRows(filters)[0] ?? null;
                return Promise.resolve({ data: found ? { ...found } : null, error: null }).then(
                  onFulfilled as never
                );
              };
              return singleBuilder;
            },
          };
          (builder as { then: unknown }).then = (
            onFulfilled?: (v: { data: Row[]; error: null }) => unknown
          ) =>
            Promise.resolve({ data: filterRows(filters).map((r) => ({ ...r })), error: null }).then(
              onFulfilled as never
            );
          return builder;
        },
        delete() {
          const filters: Record<string, unknown> = {};
          const builder: Record<string, unknown> = {
            eq: (column: string, value: unknown) => {
              filters[column] = value;
              return builder;
            },
          };
          (builder as { then: unknown }).then = (
            onFulfilled?: (v: { data: null; error: null }) => unknown
          ) => {
            deletes.push({ ...filters });
            for (let i = rows.length - 1; i >= 0; i--) {
              if (
                Object.entries(filters).every(
                  ([c, v]) => (rows[i] as Record<string, unknown>)[c] === v
                )
              ) {
                rows.splice(i, 1);
              }
            }
            return Promise.resolve({ data: null, error: null }).then(onFulfilled as never);
          };
          return builder;
        },
        upsert(payload: Row) {
          const builder: Record<string, unknown> = {};
          (builder as { then: unknown }).then = (
            onFulfilled?: (v: { data: null; error: null }) => unknown
          ) => {
            upserts.push({ ...payload });
            const idx = rows.findIndex(
              (r) => r.user_id === payload.user_id && r.provider === payload.provider
            );
            if (idx >= 0) rows[idx] = { ...payload };
            else rows.push({ ...payload });
            return Promise.resolve({ data: null, error: null }).then(onFulfilled as never);
          };
          return builder;
        },
      };
    },
  } as unknown as BackgroundClient;

  return { rows, db, upserts, deletes };
}

const USER_A = 'task-y-user-a';
const USER_B = 'task-y-user-b';

async function main(): Promise<void> {
  const envMapped = PROVIDER_NAMES.filter((p) => envVarForProvider(p) !== '');
  assert.ok(envMapped.length > 0, 'expected at least one env-mapped provider');
  const p = envMapped[0];
  const envVar = envVarForProvider(p);

  const savedEnv = new Map<string, string | undefined>();
  for (const e of envMapped) savedEnv.set(envVarForProvider(e), process.env[envVarForProvider(e)]);
  const restoreEnv = (): void => {
    for (const [v, value] of savedEnv) {
      if (value === undefined) delete process.env[v];
      else process.env[v] = value;
    }
  };
  const clearAllEnv = (): void => {
    for (const e of envMapped) delete process.env[envVarForProvider(e)];
  };
  const setEnv = (value: string): void => {
    clearAllEnv();
    process.env[envVar] = value;
  };

  // fetch stub: records provider catalog calls WITHOUT their URLs (some
  // fetchers put a key in the query string) and returns a minimal payload.
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  let fetchPaths: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetchCalls++;
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    fetchPaths.push(raw.split('?')[0]);
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: 'test-model-1' }] }),
    } as Response;
  }) as typeof fetch;
  const resetFetch = (): void => {
    fetchCalls = 0;
    fetchPaths = [];
  };

  try {
    // ── A ──
    await check('A: env + no user row ⇒ server available + runtime env credential', async () => {
      setEnv(`test-secret-${envVar}`);
      const store = makeStore();
      const states = await getProviderConnectionStates(USER_A, store.db);
      assert.equal(states[p].state, 'server');
      assert.equal(states[p].connected, true);
      assert.equal(states[p].connectionSource, 'server');
      const creds = await resolveUserCredentials(USER_A, store.db);
      assert.equal(creds[p], `test-secret-${envVar}`, 'env credential resolves at runtime');
      const available = buildAvailableProviders({
        task: 't',
        messages: [],
        providerTokens: creds,
      });
      assert.ok(available.has(p), 'env-configured provider is available when not disabled');
    });

    // ── B ──
    await check('B: env + user connected ⇒ user-connected semantics, env-first runtime (unchanged)', async () => {
      setEnv(`test-secret-${envVar}`);
      const userKey = 'user-owned-key-9876';
      const store = makeStore([
        {
          user_id: USER_A,
          provider: p,
          status: 'connected',
          encrypted_api_key: encryptSecret(userKey),
        },
      ]);
      const states = await getProviderConnectionStates(USER_A, store.db);
      assert.equal(states[p].state, 'user', 'user row beats server env for STATE');
      assert.equal(states[p].connectionSource, 'user');
      assert.equal(states[p].connected, true);
      const creds = await resolveUserCredentials(USER_A, store.db);
      assert.equal(
        creds[p],
        `test-secret-${envVar}`,
        'pre-existing runtime precedence kept: env outranks the stored user key'
      );
      assert.notEqual(creds[p], userKey);
    });

    // ── C ──
    await check('C: env + disabled row ⇒ disabled, no credential, no availability, no discovery', async () => {
      setEnv(`test-secret-${envVar}`);
      const store = makeStore([
        { user_id: USER_A, provider: p, status: 'disabled', encrypted_api_key: null },
      ]);

      const states = await getProviderConnectionStates(USER_A, store.db);
      assert.equal(states[p].state, 'disabled');
      assert.equal(states[p].connected, false);
      assert.equal(states[p].connectionSource, null);
      const connections = await getProviderConnections(USER_A, store.db);
      assert.equal(connections[p], false, 'display must not read connected while disabled');
      const disabled = await getDisabledProviders(USER_A, store.db);
      assert.ok(disabled.has(p));

      const creds = await resolveUserCredentials(USER_A, store.db);
      assert.equal(creds[p], undefined, 'no runtime credential — env is suppressed');

      const available = buildAvailableProviders({
        task: 't',
        messages: [],
        providerTokens: creds,
        disabledProviders: disabled,
      });
      assert.ok(!available.has(p), 'disabled provider must not be an available runtime provider');
      // Stale tokens must not re-enable it either (tombstone checked first).
      const availableStale = buildAvailableProviders({
        task: 't',
        messages: [],
        providerTokens: { [p]: `stale-${p}-token` },
        disabledProviders: disabled,
      });
      assert.ok(!availableStale.has(p), 'tombstone beats even an explicit stale token');

      // Discovery: no fetch for the disabled provider (credential injected to
      // prove the TOMBSTONE — not a missing key — is what blocks the call).
      resetFetch();
      const live = await fetchLiveModels(USER_A, {
        resolveLocalEndpoint: async () => null,
        resolveUserCredentials: async () => ({ [p]: `test-secret-${envVar}` }),
        resolveDisabledProviders: async () => disabled,
      });
      assert.equal(fetchCalls, 0, 'no discovery fetch may use the env credential for a disabled provider');
      assert.equal(live.groups.length, 0);

      // Execution: a strict-Free chain containing only the disabled provider
      // fails structurally WITHOUT ever attempting the provider.
      resetFetch();
      await assert.rejects(
        () =>
          runWithFallback({
            task: 'root_cause_analysis',
            messages: [{ role: 'user', content: 'hi' }],
            strictFree: true,
            freeCandidates: [{ provider: p, model: 'test-model-1' }],
            providerTokens: creds,
            disabledProviders: disabled,
          }),
        /No free model is available/i,
        'structured strict-Free failure, never an execution'
      );
      assert.equal(fetchCalls, 0, 'no model execution through env fallback');
    });

    // ── D ──
    await check('D: disabled → reconnect ⇒ connected, tombstone cleared, runtime works again', async () => {
      setEnv(`test-secret-${envVar}`);
      const store = makeStore([
        { user_id: USER_A, provider: p, status: 'disabled', encrypted_api_key: null },
      ]);
      const before = await getProviderConnectionStates(USER_A, store.db);
      assert.equal(before[p].state, 'disabled');

      const result = await enableServerEnvConnection(USER_A, p, store.db);
      assert.equal(result.ok, true);
      const rowsForP = store.rows.filter((r) => r.user_id === USER_A && r.provider === p);
      assert.equal(rowsForP.length, 1, 'exactly one row — tombstone REPLACED, not duplicated');
      assert.equal(rowsForP[0].status, 'connected');
      assert.equal(rowsForP[0].encrypted_api_key, null, 'keyless reconnect stores no credential');

      const after = await getProviderConnectionStates(USER_A, store.db);
      assert.equal(after[p].state, 'server');
      assert.equal(after[p].connected, true);
      assert.equal(after[p].disabled, false);

      const creds = await resolveUserCredentials(USER_A, store.db);
      assert.equal(creds[p], `test-secret-${envVar}`, 'env credential available again');
      const disabled = await getDisabledProviders(USER_A, store.db);
      assert.ok(!disabled.has(p), 'tombstone is gone');
      const available = buildAvailableProviders({
        task: 't',
        messages: [],
        providerTokens: creds,
        disabledProviders: disabled,
      });
      assert.ok(available.has(p), 'runtime availability restored');
    });

    // ── E ──
    await check('E: user-only connected → disconnect ⇒ row deleted, unchanged behavior', async () => {
      clearAllEnv();
      const userKey = 'user-only-key-5555';
      const store = makeStore([
        {
          user_id: USER_A,
          provider: p,
          status: 'connected',
          encrypted_api_key: encryptSecret(userKey),
        },
      ]);
      const states = await getProviderConnectionStates(USER_A, store.db);
      assert.equal(states[p].state, 'user');
      const creds = await resolveUserCredentials(USER_A, store.db);
      assert.equal(creds[p], userKey, 'user key decrypts and resolves');

      // Route mirror: NOT env-configured ⇒ plain row deletion.
      assert.equal(isProviderConfiguredBysEnv(p), false);
      await removeUserConnection(USER_A, p, store.db);
      assert.equal(store.deletes.length, 1);
      assert.equal(store.upserts.length, 0, 'non-env disconnect must not upsert');

      const after = await getProviderConnectionStates(USER_A, store.db);
      assert.equal(after[p].state, 'none');
      assert.equal(after[p].connected, false);
      const credsAfter = await resolveUserCredentials(USER_A, store.db);
      assert.equal(credsAfter[p], undefined);
    });

    // ── F ──
    await check('F: local connected → disconnect ⇒ endpoint flow unchanged, never env-affected', async () => {
      setEnv(`test-secret-${envVar}`); // every other provider's env must not touch local
      const store = makeStore([
        {
          user_id: USER_A,
          provider: LOCAL_PROVIDER_ID,
          status: 'connected',
          encrypted_api_key: null,
          base_url: 'http://127.0.0.1:8000/v1',
        },
      ]);
      const states = await getProviderConnectionStates(USER_A, store.db);
      assert.equal(states[LOCAL_PROVIDER_ID].state, 'user');
      assert.equal(states[LOCAL_PROVIDER_ID].connected, true);
      const endpoint = await resolveLocalEndpoint(USER_A, store.db);
      assert.equal(endpoint?.baseUrl, 'http://127.0.0.1:8000/v1');

      // Route mirror: local is never env-configured ⇒ plain row deletion.
      assert.equal(isProviderConfiguredBysEnv(LOCAL_PROVIDER_ID), false);
      await removeUserConnection(USER_A, LOCAL_PROVIDER_ID, store.db);
      assert.equal(store.deletes.length, 1);
      assert.equal(store.upserts.length, 0, 'local must never be tombstoned');

      const after = await getProviderConnectionStates(USER_A, store.db);
      assert.equal(after[LOCAL_PROVIDER_ID].connected, false);
      const endpointAfter = await resolveLocalEndpoint(USER_A, store.db);
      assert.equal(endpointAfter, null, 'stored endpoint is gone with the row');
    });

    // ── G ──
    await check('G: direct provider-instance env fallback is fail-closed for a disabled user', () => {
      setEnv(`test-secret-${envVar}`);
      // No explicit key + fail-closed flag ⇒ THROW, never fall back to env.
      assert.throws(
        () => createProviderInstanceWithApiKey(p, undefined, { forbidEnvFallback: true }),
        /disabled for this user/i,
        'env credential must be unreachable when forbidEnvFallback is set'
      );
      // An explicit user-supplied key is still allowed (not an env fallback).
      const instance = createProviderInstanceWithApiKey(p, 'explicit-user-key', {
        forbidEnvFallback: true,
      });
      assert.ok(instance, 'explicit key bypasses the env fallback ban');
      // Positive control: WITHOUT the flag the historic env fallback exists
      // (unchanged for non-tombstoned callers such as validation).
      const legacy = createProviderInstanceWithApiKey(p, undefined);
      assert.ok(legacy, 'historic env fallback kept for callers without the flag');
      // And the deployment-wide env check itself is untouched.
      assert.equal(isProviderConfigured(p), true);

      // Composition-root pin: the gateway passes the user's tombstone set all
      // the way down to runWithFallback — without this line the router gates
      // would never see it and a disabled provider could execute via env.
      const gatewaySrc = readFileSync(join(process.cwd(), 'lib', 'ai', 'gateway.ts'), 'utf8');
      assert.ok(
        /disabledProviders:\s*routing\.runArgs\.disabledProviders/.test(gatewaySrc),
        'gateway must forward routing.runArgs.disabledProviders to runWithFallback'
      );
    });

    // ── H ──
    await check('H: multi-user isolation — A disabled, B still gets the env provider', async () => {
      setEnv(`test-secret-${envVar}`);
      const store = makeStore([
        { user_id: USER_A, provider: p, status: 'disabled', encrypted_api_key: null },
      ]);
      const statesA = await getProviderConnectionStates(USER_A, store.db);
      const statesB = await getProviderConnectionStates(USER_B, store.db);
      assert.equal(statesA[p].state, 'disabled');
      assert.equal(statesB[p].state, 'server', "B's tombstone set is independent of A's");
      assert.equal(statesB[p].connected, true);

      const credsA = await resolveUserCredentials(USER_A, store.db);
      const credsB = await resolveUserCredentials(USER_B, store.db);
      assert.equal(credsA[p], undefined, 'A gets no env credential');
      assert.equal(credsB[p], `test-secret-${envVar}`, 'B still gets the env credential');

      const disabledB = await getDisabledProviders(USER_B, store.db);
      assert.ok(!disabledB.has(p), "B must not inherit A's tombstone");
      const availableB = buildAvailableProviders({
        task: 't',
        messages: [],
        providerTokens: credsB,
        disabledProviders: disabledB,
      });
      assert.ok(availableB.has(p), 'B can still execute the env provider');
    });

    // ── I ──
    await check('I: env removed from server ⇒ disabled/user states remain correct', async () => {
      clearAllEnv();
      const userKey = 'persist-user-key-777';
      const store = makeStore([
        { user_id: USER_A, provider: p, status: 'disabled', encrypted_api_key: null },
        {
          user_id: USER_B,
          provider: p,
          status: 'connected',
          encrypted_api_key: encryptSecret(userKey),
        },
      ]);
      const statesA = await getProviderConnectionStates(USER_A, store.db);
      assert.equal(statesA[p].state, 'disabled', 'tombstone persists without env (never re-enabled)');
      assert.equal(statesA[p].connected, false);

      const statesB = await getProviderConnectionStates(USER_B, store.db);
      assert.equal(statesB[p].state, 'user', 'a keyed user row keeps working without env');
      assert.equal(statesB[p].connected, true);
      const credsB = await resolveUserCredentials(USER_B, store.db);
      assert.equal(credsB[p], userKey, 'row credential resolves after env removal');

      // Env RE-APPEARS: the tombstone still wins (disable is durable).
      setEnv(`test-secret-${envVar}`);
      const statesA2 = await getProviderConnectionStates(USER_A, store.db);
      assert.equal(statesA2[p].state, 'disabled', 'disable survives env rotation');
      const credsA2 = await resolveUserCredentials(USER_A, store.db);
      assert.equal(credsA2[p], undefined, 'still no env credential for A');
    });

    // ── J ──
    await check('J: no API key in any browser-facing payload or log line', async () => {
      const envValue = `test-secret-${envVar}`;
      const userKey = 'super-secret-user-key-42';
      setEnv(envValue);
      const store = makeStore([
        {
          user_id: USER_B,
          provider: p,
          status: 'connected',
          encrypted_api_key: encryptSecret(userKey),
        },
        { user_id: USER_A, provider: p, status: 'disabled', encrypted_api_key: null },
      ]);

      const states = await getProviderConnectionStates(USER_A, store.db);
      const connections = await getProviderConnections(USER_A, store.db);
      const payloads = JSON.stringify({ states, connections });
      assert.ok(!payloads.includes(envValue), 'env value must never reach a browser payload');
      assert.ok(!payloads.includes(userKey), 'user key plaintext must never reach a payload');
      assert.ok(!payloads.includes(envVar), 'env var name must never reach a payload');
      const storedCiphertext =
        store.rows.find((r) => r.user_id === USER_B && r.provider === p)?.encrypted_api_key ?? '';
      assert.ok(storedCiphertext.length > 0, 'sanity: the user row really carries ciphertext');
      assert.ok(!payloads.includes(storedCiphertext), 'stored ciphertext must never reach a payload');
      // The resolved credential map itself is server-side only — it must not
      // have been merged into either browser-facing payload.
      const credentials = await resolveUserCredentials(USER_B, store.db);
      assert.ok(credentials[p], 'sanity: server-side credential resolves');
      assert.ok(!payloads.includes(credentials[p] as string), 'resolved credential stays server-side');

      // Log capture across a full resolution cycle: no key material logged.
      const logLines: string[] = [];
      const original = { log: console.log, warn: console.warn, error: console.error };
      console.log = (...args: unknown[]) => logLines.push(args.map(String).join(' '));
      console.warn = (...args: unknown[]) => logLines.push(args.map(String).join(' '));
      console.error = (...args: unknown[]) => logLines.push(args.map(String).join(' '));
      try {
        await resolveUserCredentials(USER_B, store.db);
        await resolveUserCredentials(USER_A, store.db);
        await getProviderConnectionStates(USER_A, store.db);
        await getProviderConnections(USER_A, store.db);
      } finally {
        console.log = original.log;
        console.warn = original.warn;
        console.error = original.error;
      }
      const logs = logLines.join('\n');
      assert.ok(!logs.includes(envValue), 'env value must never be logged');
      assert.ok(!logs.includes(userKey), 'user key must never be logged');
      assert.ok(!logs.includes(envVar), 'env var name must never be logged');
      // Discovery fetch recording never stores URLs (some carry ?key=).
      resetFetch();
      await fetchLiveModels(USER_B, {
        resolveLocalEndpoint: async () => null,
        resolveUserCredentials: async () => ({ [p]: envValue }),
        resolveDisabledProviders: async () => new Set(),
      });
      assert.ok(
        fetchPaths.every((path) => !path.includes(envValue) && !path.includes('?key=')),
        'recorded fetch paths must be stripped of query strings/keys'
      );
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv();
  }
}

main()
  .then(() => {
    console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILED');
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error('SPEC CRASH :: ' + ((err as Error).stack || String(err)));
    process.exit(1);
  });
