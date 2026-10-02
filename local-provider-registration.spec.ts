// Task K — local provider registration through the existing connection
// architecture, gated on a successful connection test. Pure/unit tests with an
// injected DB boundary and mocked HTTP — NO real network, NO real database,
// NO secrets persisted in plaintext.

import { strict as assert } from 'node:assert';
import type { createBackgroundClient } from './lib/supabase/background';
import {
  envKeyForProvider,
  envVarForProvider,
  getProviderConnections,
  isProviderConfiguredBysEnv,
  PROVIDER_NAMES,
  removeUserConnection,
  resolveLocalEndpoint,
  saveLocalUserConnection,
} from './lib/ai/connection/service';
import {
  disconnectLocalConnection,
  registerLocalConnection,
} from './lib/ai/connection/registerLocal';
import { decryptSecret, encryptSecret } from './lib/ai/connection/encryption';
import { LOCAL_PROVIDER_ID } from './lib/ai/connection/local';
import type { LocalConnectionTestResult, FetchLike } from './lib/ai/connection/testConnection';
import {
  createProviderInstance,
  createProviderInstanceWithApiKey,
} from './lib/ai/providers/registry';
import { PROVIDER_DEFINITIONS } from './lib/ai/catalog/registry';

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

// ── Fake Supabase client (structural chains used by service.ts) ──

interface FakeDb {
  client: BackgroundClient;
  upserts: { table: string; payload: Record<string, unknown>; options: unknown }[];
  deletes: { table: string; filters: Record<string, unknown> }[];
  selects: { table: string; columns: string; filters: Record<string, unknown> }[];
}

function createFakeDb(opts: { rows?: Record<string, unknown>[]; upsertError?: string } = {}): FakeDb {
  const upserts: FakeDb['upserts'] = [];
  const deletes: FakeDb['deletes'] = [];
  const selects: FakeDb['selects'] = [];

  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          const filters: Record<string, unknown> = {};
          const run = () => {
            selects.push({ table, columns, filters: { ...filters } });
            const wanted = columns.split(',').map((c) => c.trim()).filter(Boolean);
            const rows = (opts.rows ?? [])
              .filter((row) => Object.entries(filters).every(([k, v]) => row[k] === v))
              .map((row) => Object.fromEntries(wanted.map((w) => [w, row[w]])));
            return { data: rows, error: null };
          };
          const builder = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return builder;
            },
            async maybeSingle() {
              const { data } = run();
              return { data: data[0] ?? null, error: null };
            },
            then(onFulfilled?: unknown, onRejected?: unknown) {
              return Promise.resolve(run()).then(
                onFulfilled as never,
                onRejected as never
              );
            },
          };
          return builder;
        },
        async upsert(payload: Record<string, unknown>, options: unknown) {
          upserts.push({ table, payload, options });
          return { error: opts.upsertError ? { message: opts.upsertError } : null };
        },
        delete() {
          const filters: Record<string, unknown> = {};
          const builder = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return builder;
            },
            then(onFulfilled?: unknown, onRejected?: unknown) {
              return Promise.resolve()
                .then(() => {
                  deletes.push({ table, filters: { ...filters } });
                  return { error: null };
                })
                .then(onFulfilled as never, onRejected as never);
            },
          };
          return builder;
        },
      };
    },
  };

  return {
    client: client as unknown as BackgroundClient,
    upserts,
    deletes,
    selects,
  };
}

function passResult(modelIds: string[] = ['m1', 'm2']): LocalConnectionTestResult {
  return {
    success: true,
    providerType: LOCAL_PROVIDER_ID,
    baseUrl: 'http://127.0.0.1:8000/v1',
    modelsEndpoint: 'http://127.0.0.1:8000/v1/models',
    modelIds,
    compatibility: 'openai-compatible',
    error: null,
  };
}

function failResult(error: string): LocalConnectionTestResult {
  return {
    success: false,
    providerType: LOCAL_PROVIDER_ID,
    baseUrl: 'http://127.0.0.1:8000/v1',
    modelsEndpoint: null,
    modelIds: [],
    compatibility: 'unverified',
    error,
  };
}

// ── Mock HTTP helpers (same shape as local-provider-connection.spec.ts) ──

function jsonRes(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  };
}

async function main(): Promise<void> {
  // ── Gate: registration only after a successful test ──

  await check('successful test → save invoked once with normalized config', async () => {
    const saved: { userId: string; config: { baseUrl: string; apiKey?: string } }[] = [];
    let testCalls = 0;
    const r = await registerLocalConnection(
      'user-1',
      { baseUrl: '  http://127.0.0.1:8000/v1///  ', apiKey: '  sk-round-trip  ' },
      {
        testFn: async () => {
          testCalls++;
          return passResult(['a', 'b', 'c']);
        },
        saveFn: async (userId, config) => {
          saved.push({ userId, config });
          return { ok: true };
        },
      }
    );
    assert.equal(testCalls, 1);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].userId, 'user-1');
    assert.equal(saved[0].config.baseUrl, 'http://127.0.0.1:8000/v1');
    assert.equal(saved[0].config.apiKey, 'sk-round-trip');
    assert.equal(r.ok, true);
    assert.equal(r.baseUrl, 'http://127.0.0.1:8000/v1');
    assert.equal(r.modelCount, 3);
    assert.equal(r.compatibility, 'openai-compatible');
    assert.equal(r.error, null);
  });

  await check('failed test → nothing saved, error surfaces', async () => {
    let savedCount = 0;
    const r = await registerLocalConnection(
      'user-1',
      { baseUrl: 'http://127.0.0.1:8000/v1', apiKey: 'sk-x' },
      {
        testFn: async () => failResult('Authentication failed (HTTP 401)'),
        saveFn: async () => {
          savedCount++;
          return { ok: true };
        },
      }
    );
    assert.equal(savedCount, 0, 'a failed test must never persist');
    assert.equal(r.ok, false);
    assert.equal(r.modelCount, 0);
    assert.ok(r.error && r.error.includes('401'));
    assert.equal(r.compatibility, 'unverified');
  });

  await check('invalid base URL → no test, no save', async () => {
    let testCalls = 0;
    let saveCalls = 0;
    const r = await registerLocalConnection(
      'user-1',
      { baseUrl: 'javascript:alert(1)' },
      {
        testFn: async () => {
          testCalls++;
          return passResult();
        },
        saveFn: async () => {
          saveCalls++;
          return { ok: true };
        },
      }
    );
    assert.equal(testCalls, 0);
    assert.equal(saveCalls, 0);
    assert.equal(r.ok, false);
    assert.equal(r.baseUrl, '');
    assert.ok(r.error && r.error.length > 0);
  });

  await check('empty model list from a real probe → registration refused', async () => {
    let saveCalls = 0;
    const fetchFn: FetchLike = async () => jsonRes(200, { object: 'list', data: [] });
    const r = await registerLocalConnection(
      'user-1',
      { baseUrl: 'http://127.0.0.1:8000/v1' },
      {
        testDeps: { fetchFn },
        saveFn: async () => {
          saveCalls++;
          return { ok: true };
        },
      }
    );
    assert.equal(saveCalls, 0, 'a compatible-but-empty endpoint must not register');
    assert.equal(r.ok, false);
    assert.equal(r.compatibility, 'openai-compatible');
    assert.ok(r.error && r.error.includes('empty model list'));
  });

  await check('full-stack success: mocked models endpoint reaches save exactly once', async () => {
    const fetchFn: FetchLike = async () =>
      jsonRes(200, { object: 'list', data: [{ id: 'llama-3-8b' }, { id: 'qwen2.5-7b' }] });
    const saved: { baseUrl: string }[] = [];
    const r = await registerLocalConnection(
      'user-1',
      { baseUrl: 'http://10.0.0.5:8080' },
      {
        testDeps: { fetchFn },
        saveFn: async (_userId, config) => {
          saved.push({ baseUrl: config.baseUrl });
          return { ok: true };
        },
      }
    );
    assert.equal(r.ok, true);
    assert.equal(r.modelCount, 2);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].baseUrl, 'http://10.0.0.5:8080');
  });

  await check('save failure after a successful test reports the error', async () => {
    const r = await registerLocalConnection(
      'user-1',
      { baseUrl: 'http://127.0.0.1:8000/v1' },
      {
        testFn: async () => passResult(['only-one']),
        saveFn: async () => ({ ok: false, error: 'Failed to save connection: boom' }),
      }
    );
    assert.equal(r.ok, false);
    assert.equal(r.modelCount, 1, 'test outcome is preserved for the message');
    assert.ok(r.error && r.error.includes('boom'));
  });

  // ── Persistence through the existing provider_connections infrastructure ──

  await check('saveLocalUserConnection upserts one (user_id,provider) row, encrypted', async () => {
    const db = createFakeDb();
    const key = 'sk-PLAINTEXT-MUST-NOT-APPEAR';
    const r = await saveLocalUserConnection(
      'user-1',
      { baseUrl: 'http://127.0.0.1:8000/v1', apiKey: key },
      db.client
    );
    assert.equal(r.ok, true);
    assert.equal(db.upserts.length, 1);
    const { table, payload, options } = db.upserts[0];
    assert.equal(table, 'provider_connections');
    assert.deepEqual(options, { onConflict: 'user_id,provider' });
    assert.equal(payload.user_id, 'user-1');
    assert.equal(payload.provider, LOCAL_PROVIDER_ID);
    assert.equal(payload.status, 'connected');
    assert.equal(payload.base_url, 'http://127.0.0.1:8000/v1');
    assert.equal(typeof payload.encrypted_api_key, 'string');
    assert.notEqual(payload.encrypted_api_key, key);
    assert.ok(!JSON.stringify(payload).includes(key), 'plaintext key must never be persisted');
    assert.equal(decryptSecret(payload.encrypted_api_key as string), key, 'encrypted at rest, decryptable');
    assert.equal(typeof payload.connected_at, 'string');
  });

  await check('saveLocalUserConnection stores NULL for a keyless endpoint', async () => {
    const db = createFakeDb();
    const r = await saveLocalUserConnection(
      'user-2',
      { baseUrl: 'http://localhost:11434/v1' },
      db.client
    );
    assert.equal(r.ok, true);
    assert.equal(db.upserts[0].payload.encrypted_api_key, null);
    assert.equal(db.upserts[0].payload.base_url, 'http://localhost:11434/v1');
  });

  await check('saveLocalUserConnection: invalid base URL never touches the database', async () => {
    const db = createFakeDb();
    const r = await saveLocalUserConnection('user-1', { baseUrl: 'nope' }, db.client);
    assert.equal(r.ok, false);
    assert.equal(db.upserts.length, 0);
    assert.equal(db.deletes.length, 0);
    assert.equal(db.selects.length, 0);
  });

  await check('saveLocalUserConnection: database error surfaces as failure', async () => {
    const db = createFakeDb({ upsertError: 'relation "provider_connections" does not exist' });
    const r = await saveLocalUserConnection(
      'user-1',
      { baseUrl: 'http://127.0.0.1:8000/v1' },
      db.client
    );
    assert.equal(r.ok, false);
    assert.ok(r.error && r.error.includes('relation "provider_connections" does not exist'));
  });

  await check('re-registration upserts (single-row replace, never duplicates)', async () => {
    const db = createFakeDb();
    await saveLocalUserConnection('user-1', { baseUrl: 'http://127.0.0.1:1111/v1', apiKey: 'k1' }, db.client);
    await saveLocalUserConnection('user-1', { baseUrl: 'http://127.0.0.1:2222/v1' }, db.client);
    assert.equal(db.upserts.length, 2, 'both writes go through the same upsert');
    for (const u of db.upserts) {
      assert.deepEqual(u.options, { onConflict: 'user_id,provider' });
      assert.equal(u.payload.user_id, 'user-1');
      assert.equal(u.payload.provider, LOCAL_PROVIDER_ID);
    }
    assert.equal(db.upserts[1].payload.base_url, 'http://127.0.0.1:2222/v1');
    assert.equal(db.upserts[1].payload.encrypted_api_key, null, 'a re-register without a key clears it');
  });

  // ── Resolution ──

  await check('resolveLocalEndpoint: connected row resolves URL + decrypted key', async () => {
    const key = 'sk-resolve-me';
    const db = createFakeDb({
      rows: [
        {
          user_id: 'user-1',
          provider: 'local',
          base_url: 'http://127.0.0.1:8000/v1',
          encrypted_api_key: encryptSecret(key),
          status: 'connected',
        },
      ],
    });
    const endpoint = await resolveLocalEndpoint('user-1', db.client);
    assert.ok(endpoint);
    assert.equal(endpoint?.baseUrl, 'http://127.0.0.1:8000/v1');
    assert.equal(endpoint?.apiKey, key);
    assert.equal(db.selects.length, 1);
    assert.deepEqual(db.selects[0].filters, {
      user_id: 'user-1',
      provider: 'local',
      status: 'connected',
    });
  });

  await check('resolveLocalEndpoint: keyless row resolves without a key property', async () => {
    const db = createFakeDb({
      rows: [
        {
          user_id: 'user-1',
          provider: 'local',
          base_url: 'http://localhost:11434/v1',
          encrypted_api_key: null,
          status: 'connected',
        },
      ],
    });
    const endpoint = await resolveLocalEndpoint('user-1', db.client);
    assert.ok(endpoint);
    assert.equal(endpoint?.baseUrl, 'http://localhost:11434/v1');
    assert.equal('apiKey' in (endpoint ?? {}), false, 'no key must appear for keyless rows');
  });

  await check('resolveLocalEndpoint: no row or missing base URL → null', async () => {
    const empty = createFakeDb({ rows: [] });
    assert.equal(await resolveLocalEndpoint('nobody', empty.client), null);

    const noUrl = createFakeDb({
      rows: [{ user_id: 'user-1', provider: 'local', encrypted_api_key: null, status: 'connected' }],
    });
    assert.equal(await resolveLocalEndpoint('user-1', noUrl.client), null);
  });

  await check('resolveLocalEndpoint: undecryptable key tolerated (URL still resolves)', async () => {
    const db = createFakeDb({
      rows: [
        {
          user_id: 'user-1',
          provider: 'local',
          base_url: 'http://127.0.0.1:8000/v1',
          encrypted_api_key: 'not-a-valid-ciphertext',
          status: 'connected',
        },
      ],
    });
    const endpoint = await resolveLocalEndpoint('user-1', db.client);
    assert.ok(endpoint, 'a bad key must not lose the endpoint');
    assert.equal(endpoint?.baseUrl, 'http://127.0.0.1:8000/v1');
    assert.equal('apiKey' in (endpoint ?? {}), false);
  });

  // ── Connection status + disconnect (existing architecture) ──

  await check('getProviderConnections: local defaults disconnected, connected row flips it', async () => {
    const off = createFakeDb({ rows: [] });
    const status0 = await getProviderConnections('user-1', off.client);
    assert.equal(status0[LOCAL_PROVIDER_ID], false);

    const on = createFakeDb({
      rows: [{ user_id: 'user-1', provider: 'local', status: 'connected' }],
    });
    const status1 = await getProviderConnections('user-1', on.client);
    assert.equal(status1[LOCAL_PROVIDER_ID], true);

    const err = createFakeDb({
      rows: [{ user_id: 'user-1', provider: 'local', status: 'error' }],
    });
    const status2 = await getProviderConnections('user-1', err.client);
    assert.equal(status2[LOCAL_PROVIDER_ID], false, 'only status=connected counts');
    assert.ok('chutes' in status1 && 'openrouter' in status1, 'all providers remain present');
  });

  await check('removeUserConnection deletes by user_id + provider', async () => {
    const db = createFakeDb();
    await removeUserConnection('user-1', LOCAL_PROVIDER_ID, db.client);
    assert.equal(db.deletes.length, 1);
    assert.equal(db.deletes[0].table, 'provider_connections');
    assert.deepEqual(db.deletes[0].filters, { user_id: 'user-1', provider: 'local' });
  });

  await check('disconnectLocalConnection uses the existing remove path', async () => {
    const calls: { userId: string; provider: string }[] = [];
    await disconnectLocalConnection('user-9', {
      removeFn: async (userId, provider) => {
        calls.push({ userId, provider });
      },
    });
    assert.deepEqual(calls, [{ userId: 'user-9', provider: 'local' }]);
  });

  // ── Registry / catalog membership ──

  await check('local is a first-class provider name with NO server env key', () => {
    assert.ok(PROVIDER_NAMES.includes(LOCAL_PROVIDER_ID as (typeof PROVIDER_NAMES)[number]));
    assert.equal(envVarForProvider('local'), '');
    assert.equal(envKeyForProvider('local'), '');
    assert.equal(isProviderConfiguredBysEnv('local'), false, 'local is never env-configured');
  });

  await check('PROVIDER_DEFINITIONS includes the local entry alongside all others', () => {
    const ids = PROVIDER_DEFINITIONS.map((d) => d.providerId);
    assert.deepEqual(
      [...ids].sort(),
      ['chutes', 'deepseek', 'gemini', 'local', 'openai', 'opencode', 'openrouter', 'zai'].sort()
    );
    const local = PROVIDER_DEFINITIONS.find((d) => d.providerId === 'local');
    assert.ok(local);
    assert.equal(local?.displayName, 'Local LLM');
    assert.equal(local?.authType, 'api_key');
    assert.equal(local?.serverConfigured, false);
    assert.equal(local?.status, 'disconnected');
    assert.ok((local?.description ?? '').length > 0);
  });

  await check('provider instance construction refuses local (routing not yet wired)', () => {
    assert.throws(() => createProviderInstance('local'));
    assert.throws(() => createProviderInstanceWithApiKey('local', 'sk-any'));
  });
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
