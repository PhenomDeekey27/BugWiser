// Task I + J — local OpenAI-compatible provider foundation + connection test.
// Pure/unit tests with a mocked HTTP boundary — NO real network calls, NO DB
// writes, NO secrets in results.

import { strict as assert } from 'node:assert';
import {
  LOCAL_PROVIDER_ID,
  normalizeLocalBaseUrl,
  buildLocalProviderConfig,
  blockedLocalTargetReason,
  hasVersionSegment,
} from './lib/ai/connection/local';
import {
  testLocalConnection,
  type FetchLike,
} from './lib/ai/connection/testConnection';

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

// ── Mock HTTP helpers ──

interface Call {
  url: string;
  init?: RequestInit;
}

type Responder = (url: string, init?: RequestInit) => unknown;

function mockFetch(responder: Responder, calls: Call[]): FetchLike {
  return async (url, init) => {
    calls.push({ url, init });
    const value = await responder(url, init);
    return value as Awaited<ReturnType<FetchLike>>;
  };
}

function jsonRes(status: number, body: unknown, location?: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'location' && location ? location : null),
    },
    json: async () => body,
  };
}

function htmlRes() {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => {
      throw new Error('Unexpected token < in JSON at position 0');
    },
  };
}

function headersOf(init?: RequestInit): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

async function main(): Promise<void> {
  // ── Task I: URL normalization / validation ──

  await check('valid local URL: http://127.0.0.1:8000/v1 accepted unchanged', () => {
    const r = normalizeLocalBaseUrl('http://127.0.0.1:8000/v1');
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.baseUrl, 'http://127.0.0.1:8000/v1');
  });

  await check('valid local URL: trailing slashes stripped (no //models paths)', () => {
    const r = normalizeLocalBaseUrl('  http://127.0.0.1:8000/v1///  ');
    assert.equal(r.ok && r.baseUrl, 'http://127.0.0.1:8000/v1');
    const root = normalizeLocalBaseUrl('http://localhost:8000/');
    assert.equal(root.ok && root.baseUrl, 'http://localhost:8000');
  });

  await check('valid local URL: pasted /models endpoint, query and fragment stripped', () => {
    const r = normalizeLocalBaseUrl('http://127.0.0.1:8000/v1/models?api-key=leak#frag');
    assert.equal(r.ok && r.baseUrl, 'http://127.0.0.1:8000/v1');
    const bare = normalizeLocalBaseUrl('http://127.0.0.1:8000/models');
    assert.equal(bare.ok && bare.baseUrl, 'http://127.0.0.1:8000');
  });

  await check('invalid URL rejected: garbage, empty, non-http schemes', () => {
    for (const bad of ['', '   ', 'not a url', '/v1', 'ftp://host:21/v1', 'javascript:alert(1)', 'file:///etc/passwd']) {
      const r = normalizeLocalBaseUrl(bad);
      assert.equal(r.ok, false, `expected rejection for ${JSON.stringify(bad)}`);
      assert.ok(r.ok === false && r.error.length > 0, 'rejection must carry a message');
    }
  });

  await check('invalid URL: scheme-specific message, no secrets echoed', () => {
    const r = normalizeLocalBaseUrl('ftp://user:secret@host/v1');
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.error.includes('scheme') || r.error.includes('credentials'));
      assert.ok(!r.error.includes('secret'), 'error must not echo URL contents');
    }
  });

  await check('embedded credentials in URL rejected (keys belong in the API key field)', () => {
    const r = normalizeLocalBaseUrl('http://user:pass@127.0.0.1:8000/v1');
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.error.includes('credentials'));
      assert.ok(!r.error.includes('user:pass'));
    }
  });

  await check('provider config: identity + optional API key', () => {
    const withKey = buildLocalProviderConfig({ baseUrl: 'http://127.0.0.1:8000/v1', apiKey: 'sk-local-1' });
    assert.equal(withKey.ok, true);
    assert.equal(withKey.ok && withKey.config?.provider, LOCAL_PROVIDER_ID);
    assert.equal(withKey.ok && withKey.config?.baseUrl, 'http://127.0.0.1:8000/v1');
    assert.equal(withKey.ok && withKey.config?.apiKey, 'sk-local-1');

    for (const apiKey of [undefined, '', '   ']) {
      const noKey = buildLocalProviderConfig({ baseUrl: 'http://127.0.0.1:8000/v1', apiKey });
      assert.equal(noKey.ok && 'apiKey' in (noKey.config ?? {}), false, 'empty key must be omitted');
    }

    const bad = buildLocalProviderConfig({ baseUrl: 'nope' });
    assert.equal(bad.ok, false);
    assert.equal('config' in bad, false, 'invalid input must not produce a config');
  });

  await check('version segment detection for endpoint probing', () => {
    assert.equal(hasVersionSegment('http://127.0.0.1:8000/v1'), true);
    assert.equal(hasVersionSegment('http://127.0.0.1:8000/v2'), true);
    assert.equal(hasVersionSegment('http://127.0.0.1:8000'), false);
    assert.equal(hasVersionSegment('http://127.0.0.1:8000/openai'), false);
    assert.equal(hasVersionSegment('http://127.0.0.1:8000/openai/v1'), true);
  });

  // ── Task J: SSRF screening ──

  await check('SSRF: link-local / metadata targets blocked, local + LAN + public allowed', () => {
    assert.ok(blockedLocalTargetReason('http://169.254.169.254/v1'));
    assert.ok(blockedLocalTargetReason('http://169.254.1.1/v1'));
    assert.ok(blockedLocalTargetReason('http://metadata.google.internal/v1'));
    assert.ok(blockedLocalTargetReason('http://[fe80::1]/v1'));
    assert.equal(blockedLocalTargetReason('http://127.0.0.1:8000/v1'), null);
    assert.equal(blockedLocalTargetReason('http://10.0.0.5:8080/v1'), null);
    assert.equal(blockedLocalTargetReason('http://192.168.1.20:8080/v1'), null);
    assert.equal(blockedLocalTargetReason('https://api.example.com/v1'), null);
  });

  await check('SSRF: blocked target fails the test before any HTTP request', async () => {
    const calls: Call[] = [];
    const fetchFn = mockFetch(() => { throw new Error('must not be called'); }, calls);
    const r = await testLocalConnection({ baseUrl: 'http://169.254.169.254/v1' }, { fetchFn });
    assert.equal(r.success, false);
    assert.equal(r.compatibility, 'unverified');
    assert.ok(r.error && r.error.includes('not allowed'));
    assert.equal(calls.length, 0, 'no request may be made to a blocked target');
  });

  // ── Task J: connection test behaviors ──

  await check('successful OpenAI-compatible endpoint returns verified model IDs', async () => {
    const calls: Call[] = [];
    const fetchFn = mockFetch(() => jsonRes(200, { object: 'list', data: [{ id: 'llama-3-8b' }, { id: 'qwen2.5-7b' }] }), calls);
    const r = await testLocalConnection({ baseUrl: 'http://127.0.0.1:8000/v1' }, { fetchFn });
    assert.equal(r.success, true);
    assert.equal(r.providerType, 'local');
    assert.equal(r.baseUrl, 'http://127.0.0.1:8000/v1');
    assert.equal(r.modelsEndpoint, 'http://127.0.0.1:8000/v1/models');
    assert.deepEqual(r.modelIds, ['llama-3-8b', 'qwen2.5-7b']);
    assert.equal(r.compatibility, 'openai-compatible');
    assert.equal(r.error, null);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init?.method, 'GET');
  });

  await check('no generation request is ever sent (models endpoint only)', async () => {
    const calls: Call[] = [];
    const fetchFn = mockFetch(() => jsonRes(200, { data: [{ id: 'm1' }] }), calls);
    await testLocalConnection({ baseUrl: 'http://127.0.0.1:8000/v1' }, { fetchFn });
    for (const c of calls) {
      assert.ok(/\/(v1\/)?models$/.test(c.url), `unexpected endpoint requested: ${c.url}`);
      assert.equal(c.init?.method, 'GET');
    }
  });

  await check('optional API key: no Authorization header when omitted, Bearer when provided', async () => {
    const calls: Call[] = [];
    const fetchFn = mockFetch(() => jsonRes(200, { data: [{ id: 'm1' }] }), calls);
    await testLocalConnection({ baseUrl: 'http://127.0.0.1:8000/v1' }, { fetchFn });
    assert.equal('Authorization' in headersOf(calls[0].init), false);

    const calls2: Call[] = [];
    const fetchFn2 = mockFetch(() => jsonRes(200, { data: [{ id: 'm1' }] }), calls2);
    await testLocalConnection({ baseUrl: 'http://127.0.0.1:8000/v1', apiKey: 'sk-local-abc' }, { fetchFn: fetchFn2 });
    assert.equal(headersOf(calls2[0].init).Authorization, 'Bearer sk-local-abc');
  });

  await check('authentication failure (401) → not verified, no body echoed', async () => {
    const calls: Call[] = [];
    const fetchFn = mockFetch(() => jsonRes(401, { error: { message: 'internal-secret-detail' } }), calls);
    const r = await testLocalConnection({ baseUrl: 'http://127.0.0.1:8000/v1', apiKey: 'sk-SECRET-XYZ' }, { fetchFn });
    assert.equal(r.success, false);
    assert.equal(r.compatibility, 'unverified');
    assert.ok(r.error && r.error.includes('401') && r.error.includes('API key'));
    assert.ok(!JSON.stringify(r).includes('internal-secret-detail'), 'raw body must not leak');
    assert.ok(!JSON.stringify(r).includes('sk-SECRET-XYZ'), 'API key must not leak');
    assert.equal(calls.length, 1, 'auth failure ends the test');
  });

  await check('authentication failure (403) → not verified', async () => {
    const fetchFn = mockFetch(() => jsonRes(403, { error: 'forbidden' }), []);
    const r = await testLocalConnection({ baseUrl: 'http://127.0.0.1:8000/v1', apiKey: 'sk-x' }, { fetchFn });
    assert.equal(r.success, false);
    assert.equal(r.compatibility, 'unverified');
    assert.ok(r.error && r.error.includes('403'));
    assert.ok(!JSON.stringify(r).includes('sk-x'));
  });

  await check('connection failure (refused/unreachable) → not verified with readable error', async () => {
    const fetchFn: FetchLike = async () => {
      throw new TypeError('fetch failed');
    };
    const r = await testLocalConnection({ baseUrl: 'http://127.0.0.1:65534/v1' }, { fetchFn });
    assert.equal(r.success, false);
    assert.equal(r.compatibility, 'unverified');
    assert.ok(r.error && r.error.includes('refused the connection or is unreachable'));
    assert.equal(r.modelIds.length, 0);
  });

  await check('timeout: dead server does not hang the request', async () => {
    const hangingFetch: FetchLike = () => new Promise(() => undefined);
    const started = Date.now();
    const r = await testLocalConnection({ baseUrl: 'http://127.0.0.1:8000/v1' }, { fetchFn: hangingFetch, timeoutMs: 40 });
    const elapsed = Date.now() - started;
    assert.equal(r.success, false);
    assert.equal(r.compatibility, 'unverified');
    assert.ok(r.error && r.error.includes('timed out after 40ms'));
    assert.ok(elapsed < 5_000, `test must settle quickly, took ${elapsed}ms`);
  });

  await check('malformed /models response: invalid JSON → not compatible', async () => {
    const fetchFn = mockFetch(() => htmlRes(), []);
    const r = await testLocalConnection({ baseUrl: 'http://127.0.0.1:8000/v1' }, { fetchFn });
    assert.equal(r.success, false);
    assert.equal(r.compatibility, 'not-compatible');
    assert.ok(r.error && r.error.includes('not valid JSON'));
  });

  await check('non-compatible endpoint: 200 JSON that is not a models list', async () => {
    const fetchFn = mockFetch(() => jsonRes(200, { message: 'hello from some server' }), []);
    const r = await testLocalConnection({ baseUrl: 'http://127.0.0.1:8000/v1' }, { fetchFn });
    assert.equal(r.success, false);
    assert.equal(r.compatibility, 'not-compatible');
    assert.ok(r.error && r.error.includes('OpenAI-compatible models list'));
  });

  await check('non-compatible endpoint: models entries without any model IDs', async () => {
    const fetchFn = mockFetch(() => jsonRes(200, { data: [{}, { foo: 1 }] }), []);
    const r = await testLocalConnection({ baseUrl: 'http://127.0.0.1:8000/v1' }, { fetchFn });
    assert.equal(r.success, false);
    assert.equal(r.compatibility, 'not-compatible');
    assert.ok(r.error && r.error.includes('model IDs'));
  });

  await check('non-compatible endpoint: 404 on /models and /v1/models', async () => {
    const calls: Call[] = [];
    const fetchFn = mockFetch(() => jsonRes(404, {}), calls);
    const r = await testLocalConnection({ baseUrl: 'http://127.0.0.1:8000' }, { fetchFn });
    assert.equal(r.success, false);
    assert.equal(r.compatibility, 'not-compatible');
    assert.ok(r.error && r.error.includes('No OpenAI-compatible models endpoint'));
    assert.equal(calls.length, 2, 'root base must probe both /models and /v1/models');
    assert.ok(calls[0].url.endsWith('/models'));
    assert.ok(calls[1].url.endsWith('/v1/models'));
  });

  await check('versioned base URL probes only <base>/models (no /v1/v1/models)', async () => {
    const calls: Call[] = [];
    const fetchFn = mockFetch(() => jsonRes(404, {}), calls);
    const r = await testLocalConnection({ baseUrl: 'http://127.0.0.1:8000/v1' }, { fetchFn });
    assert.equal(r.success, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'http://127.0.0.1:8000/v1/models');
  });

  await check('empty model response: compatible endpoint with zero models fails the test', async () => {
    const fetchFn = mockFetch(() => jsonRes(200, { object: 'list', data: [] }), []);
    const r = await testLocalConnection({ baseUrl: 'http://127.0.0.1:8000/v1' }, { fetchFn });
    assert.equal(r.success, false, 'an empty catalog must not register');
    assert.equal(r.compatibility, 'openai-compatible', 'compatibility is still verified');
    assert.equal(r.modelsEndpoint, 'http://127.0.0.1:8000/v1/models');
    assert.deepEqual(r.modelIds, []);
    assert.ok(r.error && r.error.includes('empty model list'));
  });

  await check('bare-array models response accepted (existing architecture accepts it)', async () => {
    const fetchFn = mockFetch(() => jsonRes(200, [{ id: 'a' }, { id: 'b' }]), []);
    const r = await testLocalConnection({ baseUrl: 'http://127.0.0.1:8000/v1' }, { fetchFn });
    assert.equal(r.success, true);
    assert.deepEqual(r.modelIds, ['a', 'b']);
  });

  await check('root base URL falls back to /v1/models and records the verified endpoint', async () => {
    const calls: Call[] = [];
    const fetchFn = mockFetch((url) => (url.endsWith('/v1/models') ? jsonRes(200, { data: [{ id: 'local-7b' }] }) : jsonRes(404, {})), calls);
    const r = await testLocalConnection({ baseUrl: 'http://127.0.0.1:9000' }, { fetchFn });
    assert.equal(r.success, true);
    assert.equal(r.baseUrl, 'http://127.0.0.1:9000');
    assert.equal(r.modelsEndpoint, 'http://127.0.0.1:9000/v1/models');
    assert.deepEqual(r.modelIds, ['local-7b']);
  });

  await check('HTTP 500 → unverified with status in the message', async () => {
    const fetchFn = mockFetch(() => jsonRes(500, { error: 'boom' }), []);
    const r = await testLocalConnection({ baseUrl: 'http://127.0.0.1:8000/v1' }, { fetchFn });
    assert.equal(r.success, false);
    assert.equal(r.compatibility, 'unverified');
    assert.ok(r.error && r.error.includes('HTTP 500'));
    assert.ok(!JSON.stringify(r).includes('boom'));
  });

  await check('invalid URL input → structured failure before any HTTP call', async () => {
    const calls: Call[] = [];
    const fetchFn = mockFetch(() => jsonRes(200, { data: [{ id: 'x' }] }), calls);
    const r = await testLocalConnection({ baseUrl: 'not-a-url' }, { fetchFn });
    assert.equal(r.success, false);
    assert.equal(r.compatibility, 'unverified');
    assert.equal(r.baseUrl, '');
    assert.equal(calls.length, 0);
  });

  await check('safe redirect is followed within the same allowed host', async () => {
    const calls: Call[] = [];
    const fetchFn = mockFetch((url) => (url.endsWith('/models') && !url.endsWith('/v1/models')
      ? jsonRes(302, null, '/v1/models')
      : jsonRes(200, { data: [{ id: 'after-redirect' }] })), calls);
    const r = await testLocalConnection({ baseUrl: 'http://127.0.0.1:8000' }, { fetchFn });
    assert.equal(r.success, true);
    assert.deepEqual(r.modelIds, ['after-redirect']);
    assert.equal(calls.length, 2);
  });

  await check('redirect to a blocked address is refused without following it', async () => {
    const calls: Call[] = [];
    const fetchFn = mockFetch(() => jsonRes(302, null, 'http://169.254.169.254/latest/meta-data/'), calls);
    const r = await testLocalConnection({ baseUrl: 'http://127.0.0.1:8000/v1' }, { fetchFn });
    assert.equal(r.success, false);
    assert.equal(r.compatibility, 'unverified');
    assert.ok(r.error && r.error.includes('not allowed'));
    assert.equal(calls.length, 1, 'blocked redirect target must never be fetched');
  });

  await check('secrets never appear in any result structure (success or failure)', async () => {
    const secret = 'sk-VERY-SECRET-KEY-123';
    const okFetch = mockFetch(() => jsonRes(200, { data: [{ id: 'm' }] }), []);
    const okResult = await testLocalConnection({ baseUrl: 'http://127.0.0.1:8000/v1', apiKey: secret }, { fetchFn: okFetch });
    assert.ok(!JSON.stringify(okResult).includes(secret));

    const failFetch = mockFetch(() => jsonRes(404, {}), []);
    const failResult = await testLocalConnection({ baseUrl: 'http://127.0.0.1:8000/v1', apiKey: secret }, { fetchFn: failFetch });
    assert.ok(!JSON.stringify(failResult).includes(secret));

    const netFetch: FetchLike = async () => { throw new Error(`boom ${secret}`); };
    const netResult = await testLocalConnection({ baseUrl: 'http://127.0.0.1:8000/v1', apiKey: secret }, { fetchFn: netFetch });
    assert.ok(!JSON.stringify(netResult).includes(secret), 'network errors must be generic, never raw');
  });

  await check('result always carries the full structured contract', async () => {
    const fetchFn = mockFetch(() => jsonRes(404, {}), []);
    const r = await testLocalConnection({ baseUrl: 'http://127.0.0.1:8000/v1' }, { fetchFn });
    assert.deepEqual(Object.keys(r).sort(), [
      'baseUrl',
      'compatibility',
      'error',
      'modelIds',
      'modelsEndpoint',
      'providerType',
      'success',
    ]);
    assert.equal(r.providerType, LOCAL_PROVIDER_ID);
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
