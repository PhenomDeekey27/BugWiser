// Relay queue storage boundary (lib/ai/connection/relayQueue.ts) — the piece
// that replaced the browser's Supabase-Auth reads after the GitHub App sign-in
// migration. Pure tests with an in-memory table: NO real DB, NO network, NO
// secrets.
//
// Covers: claim ordering/expiry/ownership/atomicity, outcome validation and
// payload scrubbing, cleanup scoping, and relay-target normalization for
// scheme-less pastes (localhost:1234).

import { strict as assert } from 'node:assert';
import type { createBackgroundClient } from './lib/supabase/background';
import {
  claimNextRelayJob,
  completeRelayJob,
  discardExpiredRelayJobs,
  normalizeRelayOutcome,
  MAX_RELAY_RESPONSE_BYTES,
  RelayQueueError,
  type ClaimedRelayJob,
} from './lib/ai/connection/relayQueue';
import { relayProbeDeps } from './lib/ai/connection/relay';
import { testLocalConnection, type FetchLike } from './lib/ai/connection/testConnection';

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

// ── In-memory Supabase-shaped table ──

type Row = Record<string, unknown>;
type Filter = { column: string; op: 'eq' | 'gt' | 'lt'; value: unknown };

function compare(row: Row, filter: Filter): boolean {
  const actual = row[filter.column];
  if (filter.op === 'eq') return actual === filter.value;
  const left = typeof actual === 'string' ? Date.parse(actual) : Number(actual);
  const right =
    typeof filter.value === 'string' ? Date.parse(filter.value) : Number(filter.value);
  if (filter.op === 'gt') return left > right;
  return left < right;
}

function project(row: Row, columns: string): Row {
  const wanted = columns.split(',').map((c) => c.trim()).filter(Boolean);
  if (wanted.length === 0 || wanted.includes('*')) return { ...row };
  return Object.fromEntries(wanted.map((c) => [c, row[c]]));
}

interface FakeStore {
  client: BackgroundClient;
  rows: Row[];
  updates: { patch: Row; filters: Filter[] }[];
  deletes: Filter[][];
}

function createFakeStore(initial: Row[] = []): FakeStore {
  const rows = initial.map((r) => ({ ...r }));
  const updates: FakeStore['updates'] = [];
  const deletes: FakeStore['deletes'] = [];

  const matches = (filters: Filter[]) => (row: Row) =>
    filters.every((f) => compare(row, f));

  const client = {
    from(_table: string) {
      return {
        select(columns: string) {
          const filters: Filter[] = [];
          let orderColumn: string | null = null;
          let ascending = true;
          let limit = Number.POSITIVE_INFINITY;

          const run = () => {
            let found = rows.filter(matches(filters));
            if (orderColumn) {
              const col = orderColumn;
              found = [...found].sort((a, b) => {
                const av = a[col] as string | number;
                const bv = b[col] as string | number;
                return av < bv ? -1 : av > bv ? 1 : 0;
              });
              if (!ascending) found.reverse();
            }
            return found.slice(0, limit).map((row) => project(row, columns));
          };

          const builder = {
            eq(column: string, value: unknown) {
              filters.push({ column, op: 'eq', value });
              return builder;
            },
            gt(column: string, value: unknown) {
              filters.push({ column, op: 'gt', value });
              return builder;
            },
            lt(column: string, value: unknown) {
              filters.push({ column, op: 'lt', value });
              return builder;
            },
            order(column: string, options?: { ascending?: boolean }) {
              orderColumn = column;
              ascending = options?.ascending !== false;
              return builder;
            },
            limit(count: number) {
              limit = count;
              return builder;
            },
            async maybeSingle() {
              const data = run();
              return { data: data[0] ?? null, error: null };
            },
          };
          return builder;
        },

        update(patch: Row) {
          const filters: Filter[] = [];
          const builder = {
            eq(column: string, value: unknown) {
              filters.push({ column, op: 'eq', value });
              return builder;
            },
            select(columns: string) {
              const applyUpdate = () => {
                updates.push({ patch: { ...patch }, filters: [...filters] });
                const updated: Row[] = [];
                for (const row of rows) {
                  if (!matches(filters)(row)) continue;
                  Object.assign(row, patch);
                  updated.push(project(row, columns));
                }
                return updated;
              };
              return {
                async maybeSingle() {
                  const data = applyUpdate();
                  return { data: data[0] ?? null, error: null };
                },
              };
            },
          };
          return builder;
        },

        delete() {
          const filters: Filter[] = [];
          const builder = {
            eq(column: string, value: unknown) {
              filters.push({ column, op: 'eq', value });
              return builder;
            },
            lt(column: string, value: unknown) {
              filters.push({ column, op: 'lt', value });
              return builder;
            },
            select(columns: string) {
              const run = () => {
                deletes.push([...filters]);
                const kept: Row[] = [];
                const removed: Row[] = [];
                for (const row of rows) {
                  (matches(filters)(row) ? removed : kept).push(row);
                }
                rows.splice(0, rows.length, ...kept);
                return removed.map((row) => project(row, columns));
              };
              return {
                then(onFulfilled?: unknown, onRejected?: unknown) {
                  return Promise.resolve({ data: run(), error: null }).then(
                    onFulfilled as never,
                    onRejected as never
                  );
                },
              };
            },
          };
          return builder;
        },
      };
    },
  };

  return { client: client as unknown as BackgroundClient, rows, updates, deletes };
}

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function future(ms = 60_000): string {
  return new Date(Date.now() + ms).toISOString();
}
function past(ms = 60_000): string {
  return new Date(Date.now() - ms).toISOString();
}

function jobRow(over: Row = {}): Row {
  return {
    id: `job-${Math.random().toString(16).slice(2)}`,
    user_id: USER,
    status: 'pending',
    method: 'GET',
    url: 'http://127.0.0.1:1234/v1/models',
    headers: { Authorization: 'Bearer sk-local-secret' },
    body: null,
    attempts: 0,
    created_at: new Date().toISOString(),
    expires_at: future(),
    ...over,
  };
}

function asJob(row: Row): ClaimedRelayJob {
  return {
    id: row.id as string,
    method: row.method as string,
    url: row.url as string,
    headers: (row.headers as Record<string, string>) ?? null,
    body: (row.body as string | null) ?? null,
    expires_at: row.expires_at as string,
    attempts: row.attempts as number,
    created_at: row.created_at as string,
  };
}

async function main(): Promise<void> {
  // ── Claim ──

  await check('claim: oldest pending unexpired own job is claimed and attempts increments', async () => {
    const older = jobRow({ id: 'older', created_at: new Date(Date.now() - 5_000).toISOString() });
    const newer = jobRow({ id: 'newer', created_at: new Date().toISOString() });
    const store = createFakeStore([newer, older]);

    const claimed = await claimNextRelayJob(USER, store.client);
    assert.ok(claimed);
    assert.equal(claimed?.id, 'older', 'oldest job must be claimed first');
    assert.equal(claimed?.attempts, 1);
    const row = store.rows.find((r) => r.id === 'older');
    assert.equal(row?.status, 'claimed');
    assert.ok(row?.claimed_at);
  });

  await check('claim: expired, already-claimed, and other users’ jobs are skipped', async () => {
    const store = createFakeStore([
      jobRow({ id: 'expired', expires_at: past() }),
      jobRow({ id: 'done', status: 'done' }),
      jobRow({ id: 'foreign', user_id: OTHER }),
    ]);
    assert.equal(await claimNextRelayJob(USER, store.client), null);
    assert.equal(store.rows.find((r) => r.id === 'expired')?.status, 'pending');
    assert.equal(store.rows.find((r) => r.id === 'foreign')?.status, 'pending');
  });

  await check('claim: a second tab gets no job (single execution)', async () => {
    const store = createFakeStore([jobRow({ id: 'one' })]);
    const first = await claimNextRelayJob(USER, store.client);
    const second = await claimNextRelayJob(USER, store.client);
    assert.equal(first?.id, 'one');
    assert.equal(second, null, 'the claimed job must not be handed to another tab');
  });

  await check('claim: missing relay storage surfaces an "unavailable" RelayQueueError', async () => {
    const broken = {
      from() {
        return {
          select() {
            const builder = {
              eq: () => builder,
              gt: () => builder,
              order: () => builder,
              limit: () => builder,
              async maybeSingle() {
                return {
                  data: null,
                  error: {
                    code: '42P01',
                    message: 'relation "local_relay_jobs" does not exist',
                  },
                };
              },
            };
            return builder;
          },
        };
      },
    } as unknown as BackgroundClient;

    let caught: unknown = null;
    try {
      await claimNextRelayJob(USER, broken);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught instanceof RelayQueueError);
    assert.equal((caught as RelayQueueError).kind, 'unavailable');
    assert.ok(/migration 017/i.test((caught as Error).message));
  });

  // ── Completion ──

  await check('complete: successful outcome is stored and the request payload is scrubbed', async () => {
    const store = createFakeStore([jobRow({ id: 'j1', status: 'claimed' })]);
    const result = await completeRelayJob(
      USER,
      'j1',
      {
        ok: true,
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: '{"data":[{"id":"m1"}]}',
      },
      store.client
    );
    assert.equal(result.ok, true);
    const row = store.rows.find((r) => r.id === 'j1');
    assert.equal(row?.status, 'done');
    assert.equal(row?.response_status, 200);
    assert.equal(row?.response_body, '{"data":[{"id":"m1"}]}');
    assert.deepEqual(row?.headers, {}, 'Authorization must not rest in the row');
    assert.equal(row?.body, null);
  });

  await check('complete: a worker failure is stored as a sanitized error row', async () => {
    const store = createFakeStore([jobRow({ id: 'j2', status: 'claimed' })]);
    const result = await completeRelayJob(
      USER,
      'j2',
      { ok: false, error: 'Your local server at 127.0.0.1:1234 refused this origin (CORS).' },
      store.client
    );
    assert.equal(result.ok, true);
    const row = store.rows.find((r) => r.id === 'j2');
    assert.equal(row?.status, 'error');
    assert.equal(row?.response_status, null);
    assert.ok(String(row?.error).includes('CORS'));
    assert.deepEqual(row?.headers, {});
  });

  await check('complete: another user cannot complete the job', async () => {
    const store = createFakeStore([jobRow({ id: 'j3', status: 'claimed' })]);
    const result = await completeRelayJob(
      OTHER,
      'j3',
      { ok: true, status: 200, headers: {}, body: '{}' },
      store.client
    );
    assert.equal(result.ok, false);
    assert.equal(store.rows.find((r) => r.id === 'j3')?.status, 'claimed');
  });

  await check('complete: invalid status and oversized bodies are refused before writing', async () => {
    const store = createFakeStore([jobRow({ id: 'j4', status: 'claimed' })]);
    const badStatus = await completeRelayJob(
      USER,
      'j4',
      { ok: true, status: 999, headers: {}, body: '{}' } as never,
      store.client
    );
    assert.equal(badStatus.ok, false);

    const huge = await completeRelayJob(
      USER,
      'j4',
      {
        ok: true,
        status: 200,
        headers: {},
        body: 'x'.repeat(MAX_RELAY_RESPONSE_BYTES + 1),
      },
      store.client
    );
    assert.equal(huge.ok, false);
    assert.equal(store.rows.find((r) => r.id === 'j4')?.status, 'claimed');
    assert.equal(store.updates.length, 0, 'nothing may be written for an invalid outcome');
  });

  await check('normalizeRelayOutcome: error messages are capped and never invent data', () => {
    const normalized = normalizeRelayOutcome({ ok: false, error: 'x'.repeat(10_000) });
    assert.equal(normalized.ok, true);
    if (normalized.ok) {
      assert.equal((normalized.patch.error as string).length, 2_000);
      assert.equal(normalized.patch.response_body, null);
    }
  });

  // ── Cleanup ──

  await check('cleanup: only this user’s expired rows are removed', async () => {
    const store = createFakeStore([
      jobRow({ id: 'expired-own', expires_at: past() }),
      jobRow({ id: 'live-own', expires_at: future() }),
      jobRow({ id: 'expired-foreign', user_id: OTHER, expires_at: past() }),
    ]);
    const removed = await discardExpiredRelayJobs(USER, store.client);
    assert.equal(removed, 1);
    assert.deepEqual(
      store.rows.map((r) => r.id).sort(),
      ['expired-foreign', 'live-own']
    );
  });

  // ── Production relay target classification ──

  await check('relayProbeDeps: scheme-less localhost paste is relayed (normalized before classification)', () => {
    const deps = relayProbeDeps(USER, 'localhost:1234/v1', { deployed: true, mode: 'auto' });
    assert.ok(deps.fetchFn, 'a scheme-less loopback paste must relay when deployed');
    assert.equal(deps.timeoutMs, 15_000);

    const v4 = relayProbeDeps(USER, '127.0.0.1:1234/v1', { deployed: true, mode: 'auto' });
    assert.ok(v4.fetchFn);

    const lan = relayProbeDeps(USER, '192.168.1.20:8000/v1', { deployed: true, mode: 'auto' });
    assert.ok(lan.fetchFn);

    const publicUrl = relayProbeDeps(USER, 'https://api.example.com/v1', {
      deployed: true,
      mode: 'auto',
    });
    assert.equal(publicUrl.fetchFn, undefined, 'public endpoints are fetched directly');

    const localDev = relayProbeDeps(USER, 'localhost:1234/v1', { deployed: false, mode: 'auto' });
    assert.equal(localDev.fetchFn, undefined, 'local dev fetches the endpoint directly');
  });

  await check('relayProbeDeps + testLocalConnection: scheme-less paste reaches the relayed endpoint shape', async () => {
    const urls: string[] = [];
    const fetchFn: FetchLike = async (url) => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ data: [{ id: 'qwen2.5-7b' }] }),
      };
    };
    const deps = relayProbeDeps(USER, 'localhost:1234/v1', { deployed: true, mode: 'auto' });
    const result = await testLocalConnection(
      { baseUrl: 'localhost:1234/v1' },
      { ...deps, fetchFn }
    );
    assert.equal(result.success, true);
    assert.deepEqual(result.modelIds, ['qwen2.5-7b']);
    assert.equal(urls[0], 'http://localhost:1234/v1/models');
  });

  await check('manual Base URL on a non-default port: connects, no duplicated /v1 segment', async () => {
    const urls: string[] = [];
    const fetchFn: FetchLike = async (url) => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ object: 'list', data: [{ id: 'custom-port-model' }] }),
      };
    };
    const result = await testLocalConnection(
      { baseUrl: 'http://127.0.0.1:43219/v1/' },
      { fetchFn }
    );
    assert.equal(result.success, true);
    assert.equal(result.baseUrl, 'http://127.0.0.1:43219/v1');
    assert.deepEqual(result.modelIds, ['custom-port-model']);
    assert.equal(urls.length, 1, 'a /v1 base must not probe a second endpoint');
    assert.equal(urls[0], 'http://127.0.0.1:43219/v1/models');
    assert.ok(!urls[0].includes('/v1/v1'));
  });

  console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILED');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('SPEC CRASH :: ' + ((err as Error).stack || String(err)));
  process.exit(1);
});
