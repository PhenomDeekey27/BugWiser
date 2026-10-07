// Local endpoint browser relay — pure/unit tests with INJECTED transport,
// clock, and fetch. NO real network calls, NO DB writes, NO secrets.
//
// Covers: target classification (relayTarget.ts), the enqueue/poll/replay
// fetch (relay.ts), relay-aware dispatch (createRelayAwareFetch), the probe's
// relay-error passthrough (testConnection.ts), browser job execution
// (relayJobs.ts), and port auto-detect (components/models/localEndpointDetect).

import { strict as assert } from 'node:assert';
import {
  isLocalNetworkHost,
  isRelayableTarget,
  relayModeFromEnv,
  shouldRelay,
} from './lib/ai/connection/relayTarget';
import {
  RelayError,
  createRelayAwareFetch,
  isRelayError,
  relayEnabledFor,
  relayFetch,
  relayProbeDeps,
  RELAY_PROBE_TIMEOUT_MS,
  type RelayEnqueueInput,
  type RelayJobRow,
  type RelayTransport,
} from './lib/ai/connection/relay';
import {
  executeRelayJob,
  relayReachFailureMessage,
  type RelayJobRecord,
} from './lib/ai/connection/relayJobs';
import { testLocalConnection, type FetchLike } from './lib/ai/connection/testConnection';
import { detectLocalEndpoint } from './components/models/localEndpointDetect';

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

// ── Shared helpers ──

function jsonRes(status: number, body: unknown): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface Harness {
  transport: RelayTransport;
  log: string[];
  enqueued: RelayEnqueueInput[];
}

/** Fake transport: enqueue succeeds (or throws), reads replay `reads` (last value repeats). */
function harness(reads: RelayJobRow[], enqueueThrows?: Error): Harness {
  const log: string[] = [];
  const enqueued: RelayEnqueueInput[] = [];
  let index = 0;
  const transport: RelayTransport = {
    enqueue: async (input) => {
      if (enqueueThrows) throw enqueueThrows;
      enqueued.push(input);
      log.push('enqueue');
      return { id: 'job-1' };
    },
    read: async () => {
      log.push('read');
      if (reads.length === 0) return null;
      return reads[Math.min(index++, reads.length - 1)];
    },
    discard: async () => {
      log.push('discard');
    },
  };
  return { transport, log, enqueued };
}

function jobRow(over: Partial<RelayJobRow> = {}): RelayJobRow {
  return {
    id: 'job-1',
    status: 'pending',
    response_status: null,
    response_headers: null,
    response_body: null,
    error: null,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    ...over,
  };
}

function jobRecord(over: Partial<RelayJobRecord> = {}): RelayJobRecord {
  return {
    id: 'j1',
    method: 'GET',
    url: 'http://127.0.0.1:11434/models',
    headers: { Authorization: 'Bearer sk-local-test' },
    body: null,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    ...over,
  };
}

async function expectRelayError(fn: () => Promise<unknown>, kind: string): Promise<RelayError> {
  try {
    await fn();
  } catch (err) {
    assert.ok(isRelayError(err), `expected RelayError, got: ${(err as Error)?.name}`);
    assert.equal((err as RelayError).kind, kind);
    return err as RelayError;
  }
  throw new Error(`expected RelayError(${kind}) but nothing was thrown`);
}

async function main(): Promise<void> {
  // ── A. Target classification (relayTarget.ts) ──

  await check('relayModeFromEnv: valid values, case-insensitive, invalid ⇒ auto', () => {
    assert.equal(relayModeFromEnv(undefined), 'auto');
    assert.equal(relayModeFromEnv(''), 'auto');
    assert.equal(relayModeFromEnv('always'), 'always');
    assert.equal(relayModeFromEnv('NEVER'), 'never');
    assert.equal(relayModeFromEnv('Auto'), 'auto');
    assert.equal(relayModeFromEnv('yes'), 'auto');
  });

  await check('isLocalNetworkHost: private IPv4 ranges + loopback accepted', () => {
    for (const host of [
      '127.0.0.1',
      '127.1.2.3',
      '10.0.0.5',
      '192.168.1.10',
      '172.16.0.1',
      '172.31.255.255',
      '0.0.0.0',
    ]) {
      assert.equal(isLocalNetworkHost(host), true, host);
    }
    for (const host of ['172.32.0.1', '8.8.8.8', '169.254.169.254', '213.180.204.3', '']) {
      assert.equal(isLocalNetworkHost(host), false, host);
    }
  });

  await check('isLocalNetworkHost: names + IPv6 loopback/ULA accepted, link-local not', () => {
    for (const host of ['localhost', 'api.localhost', 'printer.local', '::1', '[::1]', 'fd00::1', 'fc00::1']) {
      assert.equal(isLocalNetworkHost(host), true, host);
    }
    assert.equal(isLocalNetworkHost('fe80::1'), false);
    assert.equal(isLocalNetworkHost('example.com'), false);
  });

  await check('isRelayableTarget: http(s) + local host only', () => {
    assert.equal(isRelayableTarget('http://127.0.0.1:11434/v1'), true);
    assert.equal(isRelayableTarget('https://localhost:8080'), true);
    assert.equal(isRelayableTarget('http://192.168.1.5:8000'), true);
    assert.equal(isRelayableTarget('https://api.openai.com/v1'), false);
    assert.equal(isRelayableTarget('ftp://127.0.0.1'), false);
    assert.equal(isRelayableTarget('not-a-url'), false);
  });

  await check('shouldRelay: mode never/always/auto × deployed matrix', () => {
    assert.equal(shouldRelay('http://127.0.0.1:8000', { deployed: false, mode: 'auto' }), false);
    assert.equal(shouldRelay('http://127.0.0.1:8000', { deployed: true, mode: 'auto' }), true);
    assert.equal(shouldRelay('http://127.0.0.1:8000', { deployed: false, mode: 'always' }), true);
    assert.equal(shouldRelay('http://127.0.0.1:8000', { deployed: true, mode: 'never' }), false);
    assert.equal(shouldRelay('https://openrouter.ai/api/v1', { deployed: true, mode: 'always' }), false);
    assert.equal(shouldRelay('https://openrouter.ai/api/v1', { deployed: true, mode: 'auto' }), false);
  });

  // ── B. relayFetch: enqueue → poll → replay ──

  await check('relayFetch: pending → done replays Response, strips decoding headers, discards row', async () => {
    const h = harness([
      jobRow({ status: 'pending' }),
      jobRow({
        status: 'done',
        response_status: 200,
        response_headers: {
          'content-type': 'application/json',
          'content-encoding': 'gzip',
          'content-length': '42',
          'set-cookie': 'session=x',
        },
        response_body: '{"object":"list","data":[{"id":"m1"}]}',
      }),
    ]);
    const res = await relayFetch(
      {
        userId: 'user-1',
        url: 'http://127.0.0.1:11434/v1/models',
        headers: { Accept: 'application/json', Host: 'evil.example', Cookie: 'a=b' },
        timeoutMs: 5_000,
      },
      { transport: h.transport, sleep: async () => undefined }
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json');
    assert.equal(res.headers.get('content-encoding'), null);
    assert.equal(res.headers.get('content-length'), null);
    assert.equal(res.headers.get('set-cookie'), null);
    const parsed = (await res.json()) as { data: { id: string }[] };
    assert.equal(parsed.data[0].id, 'm1');
    assert.equal(h.log[h.log.length - 1], 'discard');
    // enqueue: method normalized, browser-controlled headers never travel
    assert.equal(h.enqueued[0].method, 'GET');
    assert.equal(h.enqueued[0].headers['Accept'], 'application/json');
    assert.equal(h.enqueued[0].headers['Host'], undefined);
    assert.equal(h.enqueued[0].headers['Cookie'], undefined);
    assert.equal(h.enqueued[0].userId, 'user-1');
    // job expiry sits ~30s past the wait budget
    assert.ok(Date.parse(h.enqueued[0].expiresAt) >= Date.now() + 5_000 + 20_000);
  });

  await check('relayFetch: worker error row surfaces its sanitized message (kind failed)', async () => {
    const h = harness([
      jobRow({ status: 'error', error: 'Could not reach 127.0.0.1:11434 from this browser tab — CORS.' }),
    ]);
    const err = await expectRelayError(
      () => relayFetch({ userId: 'u', url: 'http://127.0.0.1:11434', timeoutMs: 1_000 }, { transport: h.transport }),
      'failed'
    );
    assert.match(err.message, /CORS/);
    assert.ok(h.log.includes('discard'));
  });

  await check('relayFetch: timeout with a never-answering job (fake clock) → kind timeout, row discarded', async () => {
    const h = harness([jobRow({ status: 'pending' })]);
    let t = 0;
    const err = await expectRelayError(
      () =>
        relayFetch(
          { userId: 'u', url: 'http://127.0.0.1:8000', timeoutMs: 1_000 },
          { transport: h.transport, now: () => t, sleep: async (ms) => { t += ms; } }
        ),
      'timeout'
    );
    assert.match(err.message, /did not answer within 1s/);
    assert.match(err.message, /BugWiser tab/);
    assert.ok(h.log.includes('discard'));
    assert.ok(h.log.filter((l) => l === 'read').length >= 2);
  });

  await check('relayFetch: pending row past expires_at → kind expired, discarded', async () => {
    const h = harness([jobRow({ status: 'pending', expires_at: new Date(0).toISOString() })]);
    const err = await expectRelayError(
      () => relayFetch({ userId: 'u', url: 'http://127.0.0.1:8000', timeoutMs: 5_000 }, { transport: h.transport }),
      'expired'
    );
    assert.match(err.message, /expired/);
    assert.ok(h.log.includes('discard'));
  });

  await check('relayFetch: vanished row → kind expired; enqueue failure propagates without discard', async () => {
    const vanished = harness([]);
    await expectRelayError(
      () => relayFetch({ userId: 'u', url: 'http://127.0.0.1:8000', timeoutMs: 5_000 }, { transport: vanished.transport }),
      'expired'
    );
    assert.ok(vanished.log.includes('discard'));

    const boom = new RelayError('enqueue', 'Could not queue a browser-relay job — please try again in a moment.');
    const failing = harness([], boom);
    await expectRelayError(
      () => relayFetch({ userId: 'u', url: 'http://127.0.0.1:8000', timeoutMs: 5_000 }, { transport: failing.transport }),
      'enqueue'
    );
    assert.equal(failing.log.includes('discard'), false); // no row exists to discard
    assert.equal(failing.log.includes('read'), false);
  });

  await check('relayFetch: non-allowlisted method / non-relayable target rejected before enqueue', async () => {
    const h = harness([]);
    await expectRelayError(
      () => relayFetch({ userId: 'u', url: 'http://127.0.0.1:8000', method: 'DELETE', timeoutMs: 1_000 }, { transport: h.transport }),
      'unsupported'
    );
    await expectRelayError(
      () => relayFetch({ userId: 'u', url: 'https://api.openai.com/v1/models', timeoutMs: 1_000 }, { transport: h.transport }),
      'unsupported'
    );
    assert.equal(h.enqueued.length, 0);
    assert.equal(h.log.length, 0);
  });

  await check('isRelayError: duck-typed on name only (works across module instances)', () => {
    assert.equal(isRelayError(new RelayError('timeout', 'x')), true);
    assert.equal(isRelayError(Object.assign(new Error('x'), { name: 'RelayError' })), true);
    assert.equal(isRelayError(new Error('x')), false);
    assert.equal(isRelayError('RelayError'), false);
    assert.equal(isRelayError(null), false);
  });

  // ── C. createRelayAwareFetch: per-URL dispatch ──

  await check('createRelayAwareFetch: local URL relays when deployed, public URL stays direct', async () => {
    const h = harness([
      jobRow({ status: 'done', response_status: 200, response_headers: { 'content-type': 'text/plain' }, response_body: 'pong' }),
    ]);
    const directCalls: string[] = [];
    const fetchFn = createRelayAwareFetch('user-9', {
      deployed: true,
      mode: 'auto',
      transport: h.transport,
      fetchFn: async (url) => {
        directCalls.push(url);
        return jsonRes(200, []);
      },
    });

    const relayed = await fetchFn('http://127.0.0.1:11434/v1/models', { headers: { Accept: 'text/plain' } });
    assert.equal(relayed.status, 200);
    assert.equal(await relayed.text(), 'pong');
    assert.equal(h.enqueued.length, 1);
    assert.equal(directCalls.length, 0);

    const direct = await fetchFn('https://openrouter.ai/api/v1/models');
    assert.equal(direct.status, 200);
    assert.equal(directCalls[0], 'https://openrouter.ai/api/v1/models');
    assert.equal(h.enqueued.length, 1); // unchanged
  });

  await check('createRelayAwareFetch: no userId or mode never ⇒ always direct', async () => {
    const h = harness([jobRow({ status: 'done', response_status: 200, response_body: 'x' })]);
    const directCalls: string[] = [];
    const directFetch = async (url: string): Promise<Response> => {
      directCalls.push(url);
      return jsonRes(200, { ok: true });
    };
    const anon = createRelayAwareFetch(undefined, { deployed: true, transport: h.transport, fetchFn: directFetch });
    await anon('http://127.0.0.1:8000/models');
    const never = createRelayAwareFetch('user-9', { deployed: true, mode: 'never', transport: h.transport, fetchFn: directFetch });
    await never('http://127.0.0.1:8000/models');
    assert.equal(directCalls.length, 2);
    assert.equal(h.enqueued.length, 0);
  });

  await check('createRelayAwareFetch: non-string body on the relay path is rejected (unsupported)', async () => {
    const h = harness([]);
    const fetchFn = createRelayAwareFetch('user-9', { deployed: true, transport: h.transport });
    await expectRelayError(
      () => fetchFn('http://127.0.0.1:8000/v1/chat/completions', { method: 'POST', body: new URLSearchParams({ a: 'b' }) }),
      'unsupported'
    );
    assert.equal(h.enqueued.length, 0);
  });

  // ── D. Probe passthrough (testConnection.ts) ──

  await check('probe: RelayError message surfaces verbatim as the connection-test failure', async () => {
    const relayMessage =
      'The local endpoint did not answer within 14s. Keep a BugWiser tab open in this browser — retry.';
    const fetchFn: FetchLike = async () => {
      throw new RelayError('timeout', relayMessage);
    };
    const r = await testLocalConnection({ baseUrl: 'http://127.0.0.1:8000/v1' }, { fetchFn });
    assert.equal(r.success, false);
    assert.equal(r.compatibility, 'unverified');
    assert.equal(r.error, relayMessage);
  });

  await check('probe: plain network failure keeps the pre-existing generic message', async () => {
    const fetchFn: FetchLike = async () => {
      throw new TypeError('Failed to fetch');
    };
    const r = await testLocalConnection({ baseUrl: 'http://127.0.0.1:8000/v1' }, { fetchFn });
    assert.equal(r.success, false);
    assert.match(r.error ?? '', /Could not reach http:\/\/127\.0\.0\.1:8000\/v1\/models/);
  });

  // ── E. relayProbeDeps / relayEnabledFor ──

  await check('relayProbeDeps: relay-enabled target returns relay fetch + 15s budget; disabled ⇒ {}', () => {
    process.env.LOCAL_ENDPOINT_RELAY = 'always';
    try {
      const relayed = relayProbeDeps('user-1', 'http://127.0.0.1:8000');
      assert.equal(relayed.timeoutMs, RELAY_PROBE_TIMEOUT_MS);
      assert.equal(typeof relayed.fetchFn, 'function');
      const publicTarget = relayProbeDeps('user-1', 'https://openrouter.ai/api/v1');
      assert.deepEqual(publicTarget, {});
    } finally {
      delete process.env.LOCAL_ENDPOINT_RELAY;
    }
    process.env.LOCAL_ENDPOINT_RELAY = 'never';
    try {
      assert.deepEqual(relayProbeDeps('user-1', 'http://127.0.0.1:8000'), {});
    } finally {
      delete process.env.LOCAL_ENDPOINT_RELAY;
    }
  });

  await check('relayEnabledFor: explicit env overrides, private LAN relays only when deployed', () => {
    assert.equal(relayEnabledFor('http://10.0.0.5:8000/v1', { deployed: true, mode: 'auto' }), true);
    assert.equal(relayEnabledFor('http://10.0.0.5:8000/v1', { deployed: false, mode: 'auto' }), false);
    assert.equal(relayEnabledFor('http://10.0.0.5:8000/v1', { deployed: false, mode: 'always' }), true);
    assert.equal(relayEnabledFor('https://example.com/v1', { deployed: true, mode: 'always' }), false);
  });

  // ── F. Browser-side job execution (relayJobs.ts) ──

  await check('executeRelayJob: success records status/headers/body; GET sends no body, follows redirects', async () => {
    let captured: RequestInit | undefined;
    const outcome = await executeRelayJob(
      jobRecord({
        headers: { Accept: 'application/json', Host: 'evil.example', Authorization: 'Bearer sk-local-test' },
      }),
      {
        fetchFn: async (_url, init) => {
          captured = init;
          return jsonRes(200, { data: [{ id: 'llama3' }] });
        },
      }
    );
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.status, 200);
      assert.equal(outcome.headers['content-type'], 'application/json');
      assert.match(outcome.body, /llama3/);
    }
    assert.equal(captured?.method, 'GET');
    assert.equal(captured?.body, undefined);
    assert.equal(captured?.redirect, 'follow');
    const headers = (captured?.headers ?? {}) as Record<string, string>;
    assert.equal(headers['Host'], undefined);
    assert.equal(headers['Accept'], 'application/json');
    assert.equal(headers['Authorization'], 'Bearer sk-local-test'); // key must travel
  });

  await check('executeRelayJob: POST forwards the string body', async () => {
    let captured: RequestInit | undefined;
    const outcome = await executeRelayJob(
      jobRecord({ method: 'POST', body: '{"model":"m"}', headers: { 'Content-Type': 'application/json' } }),
      {
        fetchFn: async (_url, init) => {
          captured = init;
          return jsonRes(200, { choices: [] });
        },
      }
    );
    assert.equal(outcome.ok, true);
    assert.equal(captured?.body, '{"model":"m"}');
  });

  await check('executeRelayJob: opaque fetch rejection yields actionable CORS/reachability guidance', async () => {
    const outcome = await executeRelayJob(jobRecord({ url: 'http://127.0.0.1:11434/v1/chat/completions' }), {
      fetchFn: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      // Opaque rejection + unreachable no-cors verdict ⇒ "nothing answered".
      assert.match(outcome.error, /Could not reach 127\.0\.0\.1:11434/);
      assert.match(outcome.error, /CORS/);
      assert.match(outcome.error, /OLLAMA_ORIGINS/);
      assert.match(outcome.error, /no server answered/);
      assert.equal(outcome.error.includes('sk-local-test'), false); // never leaks the key
    }
    assert.match(relayReachFailureMessage('http://192.168.1.20:8080'), /non-loopback/); // mixed-content note
    assert.equal(relayReachFailureMessage('http://127.0.0.1:1').includes('non-loopback'), false);
  });

  await check('relayReachFailureMessage: verdict-specific text leads with the diagnosis', () => {
    const blockedMsg = relayReachFailureMessage('http://192.168.1.20:8080', 'reachable-blocked');
    assert.match(blockedMsg, /blocking this site/);
    assert.match(blockedMsg, /CORS/);
    assert.match(blockedMsg, /--cors-origin/); // port 8080 hint
    assert.match(blockedMsg, /non-loopback/); // mixed-content note retained

    const unreachableMsg = relayReachFailureMessage('http://192.168.1.20:8080', 'unreachable');
    assert.match(unreachableMsg, /Could not reach 192\.168\.1\.20:8080/);
    assert.match(unreachableMsg, /no server answered/);
    assert.match(unreachableMsg, /CORS/);

    const unknownMsg = relayReachFailureMessage('http://127.0.0.1:11434');
    assert.match(unknownMsg, /OLLAMA_ORIGINS/); // combined fallback names every family
    assert.match(unknownMsg, /--cors-origin/);
    assert.match(unknownMsg, /LM Studio/);
    assert.equal(unknownMsg.includes('non-loopback'), false);
  });

  await check('executeRelayJob: up-but-CORS-blocking server diagnosed via the no-cors probe', async () => {
    const outcome = await executeRelayJob(jobRecord({ url: 'http://127.0.0.1:8000/v1/models' }), {
      fetchFn: async (_url, init) => {
        // The no-cors follow-up resolves ⇒ the server is up and refused us.
        if ((init as RequestInit | undefined)?.mode === 'no-cors') return new Response(null, { status: 200 });
        throw new TypeError('Failed to fetch');
      },
    });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.match(outcome.error, /blocking this site/);
      assert.match(outcome.error, /--cors-origin/); // port 8000 hint
      assert.ok(!outcome.error.includes('no server answered'), 'CORS verdict must not claim the server is down');
      assert.equal(outcome.error.includes('sk-local-test'), false);
    }
  });

  await check('executeRelayJob: non-loopback plain-http target claims targetAddressSpace local; loopback does not', async () => {
    type CapturedInit = RequestInit & { targetAddressSpace?: string };
    let lanInit: CapturedInit | undefined;
    const lan = await executeRelayJob(jobRecord({ url: 'http://192.168.1.20:8080/v1/models' }), {
      fetchFn: async (_url, init) => {
        lanInit = init as CapturedInit;
        return jsonRes(200, { data: [] });
      },
    });
    assert.equal(lan.ok, true);
    assert.equal(lanInit?.targetAddressSpace, 'local');

    let loopInit: CapturedInit | undefined;
    const loop = await executeRelayJob(jobRecord({ url: 'http://127.0.0.1:8000/v1/models' }), {
      fetchFn: async (_url, init) => {
        loopInit = init as CapturedInit;
        return jsonRes(200, { data: [] });
      },
    });
    assert.equal(loop.ok, true);
    assert.equal(loopInit?.targetAddressSpace, undefined, 'loopback is exempt from mixed content');
  });

  await check('executeRelayJob: defense in depth — non-local target, expired job, bad method all refused', async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls++;
      return jsonRes(200, {});
    };
    const notLocal = await executeRelayJob(jobRecord({ url: 'https://api.openai.com/v1/models' }), { fetchFn });
    assert.equal(notLocal.ok, false);
    if (!notLocal.ok) assert.match(notLocal.error, /local-network/);

    const expired = await executeRelayJob(jobRecord({ expires_at: new Date(0).toISOString() }), { fetchFn });
    assert.equal(expired.ok, false);
    if (!expired.ok) assert.match(expired.error, /expired/i);

    const badMethod = await executeRelayJob(jobRecord({ method: 'PUT' }), { fetchFn });
    assert.equal(badMethod.ok, false);
    if (!badMethod.ok) assert.match(badMethod.error, /PUT/);

    assert.equal(calls, 0); // none of them may reach the network
  });

  // ── G. Port auto-detect (components/models/localEndpointDetect.ts) ──

  await check('detect: finds a CORS-readable endpoint and extracts its model IDs', async () => {
    const fetchFn: FetchLike = async (url) => {
      if (url.startsWith('http://127.0.0.1:11434')) return jsonRes(200, { object: 'list', data: [{ id: 'llama3' }, { id: 'qwen2.5' }] });
      throw new TypeError('Failed to fetch'); // dead ports reject instantly
    };
    const found = await detectLocalEndpoint({
      fetchFn,
      hosts: ['127.0.0.1', 'localhost'],
      ports: [11434, 9999],
      timeoutMs: 200,
    });
    assert.ok(found.endpoint);
    assert.equal(found.endpoint?.baseUrl, 'http://127.0.0.1:11434');
    assert.deepEqual(found.endpoint?.modelIds, ['llama3', 'qwen2.5']);
    assert.deepEqual(found.blocked, [], 'dead ports must not be reported as CORS-blocked');
  });

  await check('detect: loopback host wins the deterministic priority when both hosts answer', async () => {
    const fetchFn: FetchLike = async (url) => {
      if (url.includes(':11434')) return jsonRes(200, { data: [{ id: 'm1' }] });
      throw new TypeError('Failed to fetch');
    };
    const found = await detectLocalEndpoint({ fetchFn, hosts: ['127.0.0.1', 'localhost'], ports: [11434, 1234] });
    assert.equal(found.endpoint?.baseUrl, 'http://127.0.0.1:11434');
  });

  await check('detect: empty-but-valid endpoint is detected; nothing answering ⇒ null', async () => {
    const empty: FetchLike = async () => jsonRes(200, { data: [] });
    const found = await detectLocalEndpoint({ fetchFn: empty, hosts: ['127.0.0.1'], ports: [11434] });
    assert.ok(found.endpoint);
    assert.equal(found.endpoint?.baseUrl, 'http://127.0.0.1:11434');
    assert.deepEqual(found.endpoint?.modelIds, []);

    const dead: FetchLike = async () => {
      throw new TypeError('Failed to fetch');
    };
    const none = await detectLocalEndpoint({ fetchFn: dead, hosts: ['127.0.0.1'], ports: [11434, 1234] });
    assert.equal(none.endpoint, null);
    assert.deepEqual(none.blocked, [], 'a dead server (no-cors probe also fails) is not blocked');
  });

  await check('detect: up-but-CORS-blocking endpoint reported as blocked, not not-found', async () => {
    const fetchFn: FetchLike = async (_url, init) => {
      // Opaque no-cors success ⇒ the server is up and refusing this origin.
      if ((init as RequestInit | undefined)?.mode === 'no-cors') return new Response(null, { status: 200 });
      throw new TypeError('Failed to fetch');
    };
    const result = await detectLocalEndpoint({ fetchFn, hosts: ['127.0.0.1'], ports: [11434, 9999] });
    assert.equal(result.endpoint, null);
    assert.deepEqual(result.blocked, ['http://127.0.0.1:11434', 'http://127.0.0.1:9999']);
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
