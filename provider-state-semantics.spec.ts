// Task X → Task Y — provider connection state semantics (Design B matrix).
//
// Task X investigated the redesign; Task Y IMPLEMENTED it. The semantics are
// now pinned in their FINAL form — one lifecycle state per provider per user:
//
//   DISABLED (tombstone row) > USER ROW (connected) > SERVER ENV > NONE
//
//   State A: env key, no user row      → 'server'  (connected, connectionSource 'server')
//   State B: env key + user row        → 'user'    (connected, connectionSource 'user')
//   State B2: env key + disabled row   → 'disabled'(NOT connected — tombstone wins)
//   State C: env removed, key row      → 'user'    (normal lifecycle resumes)
//   State D: env removed, no row       → 'none'    (disconnected)
//   State E: 'error' row never vetoes  → env decides ('server'/'none')
//   State F: local                     → row-driven only, never env-affected
//
// Invariants under test:
//   - precedence is exactly DISABLED > USER ROW > SERVER ENV > NONE;
//   - (connected=false, serverConfigured=true) IS representable — the old
//     "env ⇒ connected, disconnect refused" invariant is gone;
//   - display payloads carry booleans/safe metadata only — never key material
//     and never the env var names.
//
// Pure/unit: fake DB + env save/restore — no network, no real database, no
// secrets in output, no paid calls. Generic over PROVIDER_NAMES (no provider
// is hardcoded as the example).

import { strict as assert } from 'node:assert';
import type { createBackgroundClient } from './lib/supabase/background';
import {
  PROVIDER_NAMES,
  envVarForProvider,
  getProviderConnectionStates,
  getProviderConnections,
  isProviderConfiguredBysEnv,
  resolveProviderLifecycleState,
} from './lib/ai/connection/service';

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

const USER_ID = 'task-x-user';

// Fake DB for connection-state reads (select → eq, awaited), row list fixed.
function selectDb(rows: Array<{ provider: string; status: string; encrypted_api_key?: string | null }>): BackgroundClient {
  return {
    from(table: string) {
      assert.equal(table, 'provider_connections');
      return {
        select() {
          const builder: Record<string, unknown> = {
            eq: () => builder,
          };
          (builder as { then: unknown }).then = (
            onFulfilled?: (v: { data: unknown[]; error: null }) => unknown
          ) => Promise.resolve({ data: rows, error: null }).then(onFulfilled as never);
          return builder;
        },
      };
    },
  } as unknown as BackgroundClient;
}

async function main(): Promise<void> {
  const envMapped = PROVIDER_NAMES.filter((p) => envVarForProvider(p) !== '');
  assert.ok(envMapped.length > 0, 'expected at least one env-mapped provider');
  const userDriven = PROVIDER_NAMES.filter((p) => envVarForProvider(p) === '');
  assert.ok(userDriven.includes('local'), 'local must be user-driven (no env var)');
  const p = envMapped[0];
  const connectedRow = { status: 'connected', encrypted_api_key: 'enc-fake' };
  const keylessRow = { status: 'connected', encrypted_api_key: null };
  const disabledRow = { status: 'disabled', encrypted_api_key: null };
  const errorRow = { status: 'error', encrypted_api_key: 'enc-fake' };

  // Snapshot every env-mapped var up front; checks set/clear freely and the
  // finally block restores the exact original environment.
  const savedEnv = new Map<string, string | undefined>();
  for (const e of envMapped) {
    const envVar = envVarForProvider(e);
    savedEnv.set(envVar, process.env[envVar]);
  }
  const restoreEnv = (): void => {
    for (const [envVar, value] of savedEnv) {
      if (value === undefined) delete process.env[envVar];
      else process.env[envVar] = value;
    }
  };

  try {
    await check('precedence pin: DISABLED > USER ROW > SERVER ENV > NONE (pure resolver)', () => {
      // DISABLED wins over env AND over a would-be user row status.
      assert.equal(resolveProviderLifecycleState(p, disabledRow, true), 'disabled');
      assert.equal(resolveProviderLifecycleState(p, disabledRow, false), 'disabled');
      // USER ROW beats SERVER ENV.
      assert.equal(resolveProviderLifecycleState(p, connectedRow, true), 'user');
      assert.equal(resolveProviderLifecycleState(p, connectedRow, false), 'user');
      // SERVER ENV when no row vetoes/allows it.
      assert.equal(resolveProviderLifecycleState(p, null, true), 'server');
      assert.equal(resolveProviderLifecycleState(p, errorRow, true), 'server');
      assert.equal(resolveProviderLifecycleState(p, errorRow, false), 'none');
      // NONE when neither exists (keyless row + no env ⇒ no credential at all).
      assert.equal(resolveProviderLifecycleState(p, null, false), 'none');
      assert.equal(resolveProviderLifecycleState(p, keylessRow, false), 'none');
      // Keyless connected row + env ⇒ re-enabled server credential.
      assert.equal(resolveProviderLifecycleState(p, keylessRow, true), 'server');
      // Local: never env — a row (even keyless) is the credential.
      assert.equal(resolveProviderLifecycleState('local', keylessRow, false), 'user');
      assert.equal(resolveProviderLifecycleState('local', null, false), 'none');
      assert.equal(resolveProviderLifecycleState('local', disabledRow, true), 'disabled');
    });

    await check('State A: env key + no row ⇒ connected with connectionSource "server"', async () => {
      for (const e of envMapped) {
        const envVar = envVarForProvider(e);
        process.env[envVar] = `test-secret-${envVar}`;
        const states = await getProviderConnectionStates(USER_ID, selectDb([]));
        assert.equal(states[e].state, 'server', `${e}: state 'server'`);
        assert.equal(states[e].connected, true, `${e}: server-available reads connected`);
        assert.equal(states[e].connectionSource, 'server', `${e}: source is server, not user`);
        assert.equal(states[e].disabled, false);
        assert.equal(isProviderConfiguredBysEnv(e), true, `${e}: serverConfigured hint`);
        delete process.env[envVar];
      }
    });

    await check('State B: env key + user row ⇒ connectionSource "user" (user-connected semantics)', async () => {
      for (const e of envMapped) {
        const envVar = envVarForProvider(e);
        process.env[envVar] = `test-secret-${envVar}`;
        const states = await getProviderConnectionStates(
          USER_ID,
          selectDb([{ provider: e, ...connectedRow }])
        );
        assert.equal(states[e].state, 'user', `${e}: state 'user'`);
        assert.equal(states[e].connected, true);
        assert.equal(states[e].connectionSource, 'user', `${e}: own row beats server label`);
        delete process.env[envVar];
      }
    });

    await check('State B2: env key + DISABLED row ⇒ disabled, NOT connected (tombstone wins)', async () => {
      for (const e of envMapped) {
        const envVar = envVarForProvider(e);
        process.env[envVar] = `test-secret-${envVar}`;
        const states = await getProviderConnectionStates(
          USER_ID,
          selectDb([{ provider: e, ...disabledRow }])
        );
        assert.equal(states[e].state, 'disabled', `${e}: tombstone beats env`);
        assert.equal(states[e].connected, false, `${e}: disabled must never read connected`);
        assert.equal(states[e].connectionSource, null, `${e}: no credential source while disabled`);
        assert.equal(states[e].disabled, true);
        const connectedMap = await getProviderConnections(USER_ID, selectDb([{ provider: e, ...disabledRow }]));
        assert.equal(connectedMap[e], false, `${e}: /models connected flag false`);
        delete process.env[envVar];
      }
    });

    await check('invariant REVERSED: (disconnected + serverConfigured) is representable and stable', async () => {
      for (const e of envMapped) {
        const envVar = envVarForProvider(e);
        process.env[envVar] = `test-secret-${envVar}`;
        const rows = [{ provider: e, ...disabledRow }];
        const first = await getProviderConnections(USER_ID, selectDb(rows));
        const second = await getProviderConnections(USER_ID, selectDb(rows));
        assert.equal(first[e], false, `${e}: disabled ⇒ disconnected even with env present`);
        assert.equal(isProviderConfiguredBysEnv(e), true, `${e}: serverConfigured still true`);
        assert.deepEqual(second, first, `${e}: two consecutive refreshes read identical`);
        delete process.env[envVar];
      }
    });

    await check('State C: env removed + key row remains ⇒ normal lifecycle resumes', async () => {
      for (const e of envMapped) delete process.env[envVarForProvider(e)];
      const rows = [{ provider: p, ...connectedRow }];
      const connected = await getProviderConnections(USER_ID, selectDb(rows));
      assert.equal(connected[p], true, 'row alone keeps it connected');
      assert.equal(isProviderConfiguredBysEnv(p), false, 'serverConfigured false after env removal');
      const afterRowGone = await getProviderConnections(USER_ID, selectDb([]));
      assert.equal(afterRowGone[p], false, 'row deleted ⇒ stable disconnected');
    });

    await check('State D: env removed + no row ⇒ disconnected for every provider', async () => {
      for (const e of envMapped) delete process.env[envVarForProvider(e)];
      const connections = await getProviderConnections(USER_ID, selectDb([]));
      for (const e of PROVIDER_NAMES) {
        assert.equal(connections[e], false, `${e}: no env, no row ⇒ disconnected`);
      }
    });

    await check("State E: 'error' rows never veto the env credential", async () => {
      delete process.env[envVarForProvider(p)];
      const withoutEnv = await getProviderConnections(USER_ID, selectDb([{ provider: p, ...errorRow }]));
      assert.equal(withoutEnv[p], false, 'error row + no env ⇒ disconnected');
      const envVar = envVarForProvider(p);
      process.env[envVar] = 'test-secret-error-row';
      const withEnv = await getProviderConnections(USER_ID, selectDb([{ provider: p, ...errorRow }]));
      assert.equal(withEnv[p], true, 'env decides for a non-connected row (env precedence kept)');
      delete process.env[envVar];
    });

    await check('State F: local is immune to every env key and always row-driven', async () => {
      for (const e of envMapped) process.env[envVarForProvider(e)] = 'test-secret';
      const off = await getProviderConnections(USER_ID, selectDb([]));
      assert.equal(off.local, false, 'all env keys set must never flip local');
      assert.equal(isProviderConfiguredBysEnv('local'), false, 'local is never serverConfigured');
      const states = await getProviderConnectionStates(USER_ID, selectDb([]));
      assert.equal(states.local.state, 'none');
      const on = await getProviderConnectionStates(
        USER_ID,
        selectDb([{ provider: 'local', status: 'connected', encrypted_api_key: null }])
      );
      assert.equal(on.local.state, 'user', 'a keyless local row is still a user connection');
      assert.equal(on.local.connected, true);
      assert.equal(on.local.connectionSource, 'user');
      for (const e of envMapped) delete process.env[envVarForProvider(e)];
    });

    await check('display payload carries booleans/safe metadata only — never key material', async () => {
      for (const e of envMapped) process.env[envVarForProvider(e)] = `test-secret-${envVarForProvider(e)}`;
      const states = await getProviderConnectionStates(
        USER_ID,
        selectDb([{ provider: p, ...connectedRow }, { provider: envMapped[1] ?? p, ...disabledRow }])
      );
      const json = JSON.stringify(states);
      for (const e of envMapped) {
        const secret = process.env[envVarForProvider(e)];
        assert.ok(secret && !json.includes(secret), `${e}: key value must never appear`);
        assert.ok(!json.includes(envVarForProvider(e)), `${e}: env var name must never appear`);
      }
      assert.ok(!json.includes('enc-fake'), 'stored ciphertext must never appear');
      assert.deepEqual(
        Object.keys(states).sort(),
        [...PROVIDER_NAMES].sort(),
        'payload shape is the provider map only'
      );
      for (const info of Object.values(states)) {
        assert.equal(typeof info.connected, 'boolean');
        assert.equal(typeof info.disabled, 'boolean');
        assert.ok(
          info.connectionSource === 'user' || info.connectionSource === 'server' || info.connectionSource === null,
          'connectionSource is user|server|null only'
        );
      }
      for (const e of envMapped) delete process.env[envVarForProvider(e)];
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
