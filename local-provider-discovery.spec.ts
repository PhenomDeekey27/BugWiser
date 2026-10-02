// Task L — local provider catalog discovery: the fetcher reuses the Task J
// probe (single HTTP security layer), the normalizer's honest local
// semantics, and the classifier's provider block. Mocked HTTP only — NO real
// network, NO database.

import { strict as assert } from 'node:assert';
import { fetchLocalModels } from './lib/ai/catalog/live';
import { normalizeProviderModel } from './lib/ai/catalog/normalizers';
import {
  selectFreeModelForClassification,
  type NormalizedModel,
} from './lib/ai/model-intelligence';
import type { FetchLike } from './lib/ai/connection/testConnection';

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

// ── Mock HTTP helpers (same shape as local-provider-connection.spec.ts) ──

interface Call {
  url: string;
  init?: RequestInit;
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

function mockFetch(responder: (url: string, init?: RequestInit) => unknown, calls: Call[]): FetchLike {
  return async (url, init) => {
    calls.push({ url, init });
    const value = await responder(url, init);
    return value as Awaited<ReturnType<FetchLike>>;
  };
}

function headersOf(init?: RequestInit): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

function localModel(raw: Record<string, unknown>) {
  const m = normalizeProviderModel('local', raw);
  assert.ok(m, `expected ${JSON.stringify(raw.id)} to normalize`);
  return m!;
}

function nm(
  provider: 'local' | 'openrouter',
  modelId: string,
  extra: Partial<NormalizedModel> = {}
): NormalizedModel {
  return {
    provider,
    modelId,
    isFree: true,
    contextWindow: 32_000,
    supportsCoding: false,
    supportsReasoning: false,
    supportsToolCalling: false,
    ...extra,
  } as NormalizedModel;
}

async function main(): Promise<void> {
  // ── fetchLocalModels: transport + dedupe + security-layer reuse ──

  await check('verified endpoint → normalized local ModelDefinition[]', async () => {
    const calls: Call[] = [];
    const fetchFn = mockFetch(
      () =>
        jsonRes(200, {
          object: 'list',
          data: [
            { id: 'llama-3-8b', display_name: 'Llama 3 8B' },
            { id: 'qwen2.5-coder-7b-instruct' },
          ],
        }),
      calls
    );
    const models = await fetchLocalModels({ apiKey: '', baseUrl: 'http://127.0.0.1:8000/v1', probeDeps: { fetchFn } });
    assert.equal(models.length, 2);
    assert.equal(models[0].providerId, 'local');
    assert.equal(models[0].modelId, 'llama-3-8b');
    assert.equal(models[0].displayName, 'Llama 3 8B');
    assert.equal(models[1].modelId, 'qwen2.5-coder-7b-instruct');
    assert.equal(models[1].displayName, 'qwen2.5-coder-7b-instruct', 'id is the display fallback');
    assert.equal(models[0].source, 'live');
    assert.ok(models[0].tags.includes('live'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init?.method, 'GET');
    assert.ok(/\/(v1\/)?models$/.test(calls[0].url));
  });

  await check('duplicate model IDs are deduped (first entry wins)', async () => {
    const calls: Call[] = [];
    const fetchFn = mockFetch(
      () =>
        jsonRes(200, {
          data: [
            { id: 'dup-model', display_name: 'First' },
            { id: 'dup-model', display_name: 'Second' },
            { id: 'other-model' },
          ],
        }),
      calls
    );
    const models = await fetchLocalModels({ apiKey: '', baseUrl: 'http://127.0.0.1:8000/v1', probeDeps: { fetchFn } });
    assert.equal(models.length, 2);
    const dup = models.filter((m) => m.modelId === 'dup-model');
    assert.equal(dup.length, 1);
    assert.equal(dup[0].displayName, 'First');
  });

  await check('probe failure → throws with the reason, no partial results', async () => {
    const calls: Call[] = [];
    const fetchFn = mockFetch(() => jsonRes(404, {}), calls);
    await assert.rejects(
      () => fetchLocalModels({ apiKey: '', baseUrl: 'http://127.0.0.1:9001', probeDeps: { fetchFn } }),
      (err: Error) => err.message.includes('No OpenAI-compatible models endpoint')
    );
    assert.equal(calls.length, 2, 'root base probes both candidate endpoints before failing');
  });

  await check('SSRF: blocked target fails discovery before any HTTP request', async () => {
    const calls: Call[] = [];
    const fetchFn = mockFetch(() => { throw new Error('must not be called'); }, calls);
    await assert.rejects(
      () => fetchLocalModels({ apiKey: '', baseUrl: 'http://169.254.169.254/v1', probeDeps: { fetchFn } }),
      (err: Error) => err.message.includes('not allowed')
    );
    assert.equal(calls.length, 0);
  });

  await check('SSRF: redirect to a blocked address is refused (Task J layer reused)', async () => {
    const calls: Call[] = [];
    const fetchFn = mockFetch(
      (url) =>
        url.endsWith('/models') && !url.endsWith('/v1/models')
          ? jsonRes(302, null, 'http://169.254.169.254/latest/meta-data/')
          : jsonRes(404, {}),
      calls
    );
    await assert.rejects(
      () => fetchLocalModels({ apiKey: '', baseUrl: 'http://127.0.0.1:8000', probeDeps: { fetchFn } }),
      (err: Error) => err.message.includes('not allowed')
    );
    assert.equal(calls.length, 1, 'blocked redirect target must never be fetched');
  });

  await check('optional key: no Authorization header when keyless, Bearer when provided', async () => {
    const callsA: Call[] = [];
    const fetchFnA = mockFetch(() => jsonRes(200, { data: [{ id: 'm1' }] }), callsA);
    await fetchLocalModels({ apiKey: '', baseUrl: 'http://127.0.0.1:8000/v1', probeDeps: { fetchFn: fetchFnA } });
    assert.equal('Authorization' in headersOf(callsA[0].init), false);

    const callsB: Call[] = [];
    const fetchFnB = mockFetch(() => jsonRes(200, { data: [{ id: 'm1' }] }), callsB);
    await fetchLocalModels({ apiKey: 'sk-local-key', baseUrl: 'http://127.0.0.1:8000/v1', probeDeps: { fetchFn: fetchFnB } });
    assert.equal(headersOf(callsB[0].init).Authorization, 'Bearer sk-local-key');
  });

  await check('missing base URL → throws before any HTTP request', async () => {
    const calls: Call[] = [];
    const fetchFn = mockFetch(() => { throw new Error('must not be called'); }, calls);
    await assert.rejects(
      () => fetchLocalModels({ apiKey: '', probeDeps: { fetchFn } }),
      (err: Error) => err.message.includes('no base URL configured')
    );
    assert.equal(calls.length, 0);
  });

  // ── normalizeLocalModel: honest metadata semantics ──

  await check('no pricing → unknown source, nulls, NEVER free', () => {
    const m = localModel({ id: 'llama-3-8b' });
    assert.equal(m.priceSource, 'unknown');
    assert.equal(m.price.input, null);
    assert.equal(m.price.output, null);
    assert.equal(m.price.isFree, false, 'absent pricing must not read as free');
    assert.equal(m.freeAuthority, 'none');
    assert.equal(m.contextWindow, 128_000, 'honest default context');
    assert.equal(m.contextSource, 'default');
    assert.equal(m.maxOutputTokens, 8192);
    assert.equal(m.availability, 'available');
    assert.equal(m.source, 'live');
  });

  await check('pricing block (USD per token, OpenRouter-style) → live per-million', () => {
    const m = localModel({
      id: 'priced-model',
      pricing: { prompt: '0.0000005', completion: '0.00000075' },
    });
    assert.equal(m.priceSource, 'live');
    assert.equal(m.price.input, 0.5);
    assert.equal(m.price.output, 0.75);
    assert.equal(m.price.isFree, false);
  });

  await check('explicit 0/0 pricing → free by explicit-zero authority', () => {
    const m = localModel({ id: 'free-model', pricing: { prompt: 0, completion: 0 } });
    assert.equal(m.price.isFree, true);
    assert.equal(m.freeAuthority, 'explicit-zero');
    assert.equal(m.priceSource, 'live');
    assert.equal(m.price.input, 0);
    assert.equal(m.price.output, 0);
  });

  await check('one-sided pricing → not free, honest partial numbers', () => {
    const m = localModel({ id: 'half-priced', pricing: { prompt: '0.000001' } });
    assert.equal(m.priceSource, 'live');
    assert.equal(m.price.input, 1);
    assert.equal(m.price.output, null);
    assert.equal(m.price.isFree, false, 'one-sided zero can never be free');
  });

  await check('context: max_model_len / context_length → live context window', () => {
    const vllm = localModel({ id: 'vllm-model', max_model_len: 32_768 });
    assert.equal(vllm.contextWindow, 32_768);
    assert.equal(vllm.contextSource, 'live');

    const orStyle = localModel({ id: 'or-style-model', context_length: 131_072 });
    assert.equal(orStyle.contextWindow, 131_072);
    assert.equal(orStyle.contextSource, 'live');
  });

  await check('capability signals: ID-derived only, with honest provenance', () => {
    const coder = localModel({ id: 'qwen2.5-coder-7b-instruct' });
    assert.equal(coder.capabilities.includes('coding'), true);
    assert.equal(coder.capabilityProvenance!.coding, 'derived');
    assert.equal(coder.capabilityProvenance!.vision, 'unknown', 'no payload evidence → never assumed');

    const thinker = localModel({ id: 'gemma3-4b-it-thinking' });
    assert.equal(thinker.supportsReasoning, true);
    assert.equal(thinker.capabilityProvenance!.reasoning, 'derived');

    const plain = localModel({ id: 'llama-3-8b' });
    assert.equal(plain.capabilities.includes('coding'), false);
    assert.equal(plain.supportsReasoning, false);
    assert.equal(plain.capabilityProvenance!.coding, 'unknown');
    assert.equal(plain.metadataConfidence, 'low', 'nothing known → low confidence');
  });

  await check('malformed entries dropped (missing/blank id)', () => {
    assert.equal(normalizeProviderModel('local', {}), null);
    assert.equal(normalizeProviderModel('local', { id: '   ' }), null);
    assert.equal(normalizeProviderModel('local', { id: 42 }), null);
  });

  // ── Classifier: local is blocked from server-side selection ──

  await check('classifier never selects a local model, even a confirmed-free one', () => {
    const localFree = nm('local', 'llama-3-8b', { supportsCoding: true, supportsReasoning: true });
    const openrouterFree = nm('openrouter', 'some-free-model', { supportsCoding: true });

    const picked = selectFreeModelForClassification([localFree, openrouterFree]);
    assert.equal(picked?.provider, 'openrouter', 'local must be skipped, not preferred');
    assert.equal(picked?.modelId, 'some-free-model');

    const onlyLocal = selectFreeModelForClassification([localFree]);
    assert.equal(onlyLocal, null, 'blocked provider → null, never a local model');
  });

  await check('classifier block does NOT change free status (user-facing Free unaffected)', () => {
    const localFree = nm('local', 'llama-3-8b');
    assert.equal(localFree.isFree, true, 'the block is provider-scoped to classification only');
    const picked = selectFreeModelForClassification([localFree]);
    assert.equal(picked, null);
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
