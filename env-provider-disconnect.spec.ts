// Task W Problem 1 → Task Y unified lifecycle — env-provider disconnect.
//
// Original bug (Task W): Disconnecting an env-configured provider reported
//   success but getProviderConnections ORs server env keys into `connected`,
//   so the next GET reported it connected again — a silent reconnect. Task W's
//   interim fix (HTTP 409 + hidden button) is REPLACED by Task Y's Design B:
//   env credentials are a credential source in the same lifecycle as user
//   connections, with an explicit per-user tombstone.
// Behavior under test (generic over PROVIDER_NAMES — no Gemini/one-provider
//   hardcoding, no credentials ever exposed):
//   - disconnect of an env-mapped provider ⇒ upsert {status:'disabled',
//     key=NULL} — never a refusal, never a stored credential;
//   - the tombstoned state STABLY reads back as disabled/not-connected across
//     refreshes while the env key exists (no flip-flop);
//   - non-env providers (user-key rows) keep plain row deletion — unchanged;
//   - the local provider is never env-backed: plain deletion, unchanged;
//   - the client applies the server's `status:'disabled'` ack (Disabled/
//     Reconnect card) and never flips state on a FAILURE response;
//   - no API key or env var name ever appears in a payload.
// Pure/unit: fake in-memory DB + injected post callbacks — no network, no
// real database, no secrets in output, no paid calls.

import { strict as assert } from 'node:assert';
import type { createBackgroundClient } from './lib/supabase/background';
import {
  PROVIDER_NAMES,
  disableUserConnection,
  envVarForProvider,
  getProviderConnectionStates,
  getProviderConnections,
  isProviderConfiguredBysEnv,
  removeUserConnection,
} from './lib/ai/connection/service';
import { runDisconnect, markProviderDisabled, type DisconnectDeps } from './components/models/connectState';
import type { CatalogProvider } from './app/models/page';
import type { ProviderName } from './lib/ai/catalog/types';

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

const USER_ID = 'task-w-user';

type Row = {
  user_id: string;
  provider: string;
  status: string;
  encrypted_api_key: string | null;
};

// In-memory provider_connections store speaking ONLY the chains the service
// uses (select→eq, delete→eq→eq, upsert), so read-after-write is real.
function makeStore(seed: Row[] = []): {
  rows: Row[];
  db: BackgroundClient;
  upserts: Row[];
  deletes: Array<Record<string, unknown>>;
} {
  const rows: Row[] = [...seed];
  const upserts: Row[] = [];
  const deletes: Array<Record<string, unknown>> = [];

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
          };
          (builder as { then: unknown }).then = (
            onFulfilled?: (v: { data: Row[]; error: null }) => unknown
          ) => {
            const data = rows.filter((r) =>
              Object.entries(filters).every(([c, v]) => (r as Record<string, unknown>)[c] === v)
            );
            return Promise.resolve({ data: data.map((r) => ({ ...r })), error: null }).then(
              onFulfilled as never
            );
          };
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
              if (Object.entries(filters).every(([c, v]) => (rows[i] as Record<string, unknown>)[c] === v)) {
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

// Mirrors app/api/models/connections/[provider]/route.ts DELETE decision order:
// env-mapped ⇒ tombstone upsert; everything else ⇒ row deletion. NO refusal.
async function deleteRoute(
  pid: ProviderName,
  db: BackgroundClient
): Promise<{ status: number; disconnectStatus?: string; error?: string }> {
  if (isProviderConfiguredBysEnv(pid)) {
    const result = await disableUserConnection(USER_ID, pid, db);
    if (!result.ok) return { status: 500, error: result.error };
    return { status: 200, disconnectStatus: 'disabled' };
  }
  await removeUserConnection(USER_ID, pid, db);
  return { status: 200, disconnectStatus: 'disconnected' };
}

function provider(providerId: string, serverConfigured: boolean): CatalogProvider {
  return {
    providerId,
    displayName: providerId,
    authType: 'api_key',
    status: 'connected',
    connectedAt: null,
    serverConfigured,
    description: '',
    docsUrl: '',
    baseUrl: null,
  };
}

async function main(): Promise<void> {
  const envMapped = PROVIDER_NAMES.filter((p) => envVarForProvider(p) !== '');
  assert.ok(envMapped.length > 0, 'expected at least one env-mapped provider');

  const savedEnv = new Map<string, string | undefined>();
  const save = (envVar: string): void => {
    if (!savedEnv.has(envVar)) savedEnv.set(envVar, process.env[envVar]);
  };
  const restoreEnv = (): void => {
    for (const [envVar, value] of savedEnv) {
      if (value === undefined) delete process.env[envVar];
      else process.env[envVar] = value;
    }
  };

  try {
    await check('every env-mapped provider disconnects via tombstone (no 409, no credential stored)', async () => {
      for (const p of envMapped) {
        const envVar = envVarForProvider(p);
        save(envVar);
        process.env[envVar] = `test-secret-${envVar}-${Date.now()}`;
        const store = makeStore();
        const res = await deleteRoute(p, store.db);
        assert.equal(res.status, 200, `${p}: disconnect must succeed (never refused)`);
        assert.equal(res.disconnectStatus, 'disabled', `${p}: ack must carry status 'disabled'`);
        assert.equal(store.upserts.length, 1, `${p}: exactly one tombstone upsert`);
        assert.equal(store.upserts[0].status, 'disabled');
        assert.equal(store.upserts[0].encrypted_api_key, null, `${p}: tombstone must store NO key`);
        assert.equal(store.deletes.length, 0, `${p}: env path must not delete rows`);
        delete process.env[envVar];
      }
    });

    await check('tombstoned state reads back NOT connected while env exists — stable across refreshes', async () => {
      for (const p of envMapped) {
        const envVar = envVarForProvider(p);
        save(envVar);
        process.env[envVar] = `test-secret-${envVar}`;
        const store = makeStore([
          { user_id: USER_ID, provider: p, status: 'disabled', encrypted_api_key: null },
        ]);
        const first = await getProviderConnectionStates(USER_ID, store.db);
        const second = await getProviderConnectionStates(USER_ID, store.db);
        assert.equal(first[p].state, 'disabled', `${p}: tombstone beats server env`);
        assert.equal(first[p].connected, false, `${p}: disabled must not read connected`);
        assert.equal(first[p].connectionSource, null, `${p}: disabled has no credential source`);
        assert.deepEqual(second[p], first[p], `${p}: refresh must read the identical state`);
        delete process.env[envVar];
      }
    });

    await check('disconnect of a NON-env provider still deletes the row (unchanged)', async () => {
      const p = envMapped[0];
      const envVar = envVarForProvider(p);
      save(envVar);
      delete process.env[envVar];
      const store = makeStore([
        { user_id: USER_ID, provider: p, status: 'connected', encrypted_api_key: 'enc-fake' },
      ]);
      const res = await deleteRoute(p, store.db);
      assert.equal(res.status, 200);
      assert.equal(res.disconnectStatus, 'disconnected');
      assert.equal(store.deletes.length, 1);
      assert.equal(store.deletes[0].user_id, USER_ID);
      assert.equal(store.deletes[0].provider, p);
      assert.equal(store.upserts.length, 0, 'non-env path must not upsert');
      const after = await getProviderConnections(USER_ID, store.db);
      assert.equal(after[p], false, 'row gone ⇒ stable disconnected');
    });

    await check('local disconnect path stays a plain deletion end to end (never env-backed)', async () => {
      assert.equal(envVarForProvider('local'), '');
      assert.equal(isProviderConfiguredBysEnv('local'), false);
      const store = makeStore([
        { user_id: USER_ID, provider: 'local', status: 'connected', encrypted_api_key: null },
      ]);
      const res = await deleteRoute('local', store.db);
      assert.equal(res.status, 200);
      assert.equal(res.disconnectStatus, 'disconnected');
      assert.equal(store.deletes.length, 1);
      assert.equal(store.deletes[0].provider, 'local');
      assert.equal(store.upserts.length, 0, 'local must never be tombstoned');
      const after = await getProviderConnections(USER_ID, store.db);
      assert.equal(after.local, false);
    });

    await check('client applies the status:disabled ack as Disabled (not plain Disconnected)', () => {
      const providers = [provider('env-provider', true)];
      let ackStatus: string | undefined;
      const deps: DisconnectDeps = {
        post: async () => ({ ok: true, status: 200, ack: { ok: true, status: 'disabled' } }),
        refresh: () => undefined,
        onDisconnected: (_pid, ack) => {
          ackStatus = ack?.status;
          providers.splice(0, providers.length, ...markProviderDisabled(providers, 'env-provider'));
        },
      };
      return runDisconnect('env-provider', deps).then(() => {
        assert.equal(ackStatus, 'disabled', "server ack status must reach the client");
        assert.equal(providers[0].status, 'disconnected');
        assert.equal(providers[0].disabled, true, 'card must enter the Disabled/Reconnect state');
      });
    });

    await check('client never flips state when the disconnect FAILS', async () => {
      const providers = [provider('env-provider', true)];
      const errors: string[] = [];
      let disconnectedApplied = 0;
      const deps: DisconnectDeps = {
        post: async () => ({ ok: false, status: 500, ack: { error: 'Failed to disconnect provider' } }),
        refresh: () => undefined,
        onError: (message) => errors.push(message),
        onDisconnected: () => {
          disconnectedApplied++;
        },
      };
      await assert.rejects(
        () => runDisconnect('env-provider', deps),
        (err: Error) => errors.length > 0 && err.message === errors[errors.length - 1],
        'runDisconnect must reject with the server message'
      );
      assert.equal(disconnectedApplied, 0, 'provider state must NOT flip on a failure');
      assert.equal(providers[0].status, 'connected', 'card keeps showing connected');
    });

    await check('no API key or env var name appears in any disconnect payload', async () => {
      for (const p of envMapped) {
        const envVar = envVarForProvider(p);
        save(envVar);
        const secret = `test-secret-${envVar}`;
        process.env[envVar] = secret;
        const store = makeStore();
        const res = await deleteRoute(p, store.db);
        const serialized = JSON.stringify({ res, upserts: store.upserts });
        assert.ok(!serialized.includes(secret), `${p}: key value must never appear`);
        assert.ok(!serialized.includes(envVar), `${p}: env var name must never appear`);
        const states = await getProviderConnectionStates(USER_ID, store.db);
        const stateJson = JSON.stringify(states);
        assert.ok(!stateJson.includes(secret), `${p}: states payload must never carry the key`);
        for (const info of Object.values(states)) {
          assert.equal(typeof info.connected, 'boolean');
          assert.equal(typeof info.disabled, 'boolean');
        }
        delete process.env[envVar];
      }
    });
  } finally {
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
