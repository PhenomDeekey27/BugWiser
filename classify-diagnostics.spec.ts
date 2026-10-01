// classify-diagnostics.spec.ts — mocked-response tests for the OpenRouter
// classification fallback diagnostics. NO network, NO credentials, NO catalog
// rebuilds: global fetch is stubbed with canned Response objects and
// classifyBatch receives a dummy key/base URL directly.
// Run: npx --no-install tsx classify-diagnostics.spec.ts
import { strict as assert } from 'node:assert';
import { classifyBatch, applyBatchScores } from './lib/ai/model-intelligence';
import type { NormalizedModel } from './lib/ai/model-intelligence';

const TEST_KEY = 'test-key-never-printed';
const MOCK_BASE = 'https://mock.invalid/v1';

function model(id: number): NormalizedModel {
  return {
    provider: 'openrouter',
    modelId: 'mock/model-' + id,
    displayName: 'Mock ' + id,
    isFree: true,
    inputPrice: 0,
    outputPrice: 0,
    priceSource: 'live',
    priceFetchedAt: '2026-09-30T00:00:00.000Z',
    contextWindow: 32000,
    maxOutputTokens: 4096,
    supportsReasoning: false,
    supportsToolCalling: false,
    supportsStructuredOutput: false,
    supportsCoding: true,
    supportsVision: false,
    availability: 'available',
    source: 'live',
  };
}

const batch = [model(1), model(2)];
const classifierTarget: NormalizedModel = { ...model(0), modelId: 'test/classifier-free' };

const entry = (v: number): string =>
  JSON.stringify({
    codingScore: v,
    reasoningScore: v,
    speedScore: v,
    longContextScore: v,
    valueScore: v,
    overallScore: v,
  });

// --- fetch stub (restored in finally) ---------------------------------------
let canned: { status: number; body: unknown } = { status: 200, body: {} };
const realFetch = globalThis.fetch;
let lastRequestBody: string | undefined;
globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
  lastRequestBody = typeof init?.body === 'string' ? init.body : undefined;
  return new Response(JSON.stringify(canned.body), {
    status: canned.status,
    headers: { 'Content-Type': 'application/json' },
  });
}) as typeof fetch;

interface CallResult {
  msg: string;
  notes: string[];
  out: Awaited<ReturnType<typeof classifyBatch>> | undefined;
}

const allLogged: string[] = [];
async function call(next: { status: number; body: unknown }): Promise<CallResult> {
  canned = next;
  const notes: string[] = [];
  try {
    const out = await classifyBatch(batch, classifierTarget, TEST_KEY, MOCK_BASE, (n) => {
      notes.push(n);
      allLogged.push(n);
    });
    return { msg: '', notes, out };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    allLogged.push(msg);
    return { msg, notes, out: undefined };
  }
}

let failures = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log('PASS ' + name);
  } catch (err) {
    failures++;
    console.error('FAIL ' + name + ' :: ' + (err as Error).message);
  }
}

async function main(): Promise<void> {
  let r = await call({ status: 429, body: { error: { message: 'RAW_RATE_SENTINEL' } } });
  check('HTTP 429 -> status-only message', () => {
    assert.equal(r.msg, 'AI classification call failed: 429');
  });

  r = await call({ status: 401, body: { error: { message: 'RAW_AUTH_SENTINEL' } } });
  check('HTTP 401 -> status-only message', () => {
    assert.equal(r.msg, 'AI classification call failed: 401');
  });

  r = await call({ status: 200, body: { error: { code: 529, message: 'RAW_OVERLOAD_SENTINEL' } } });
  check('HTTP 200 + error body (code) -> sanitized code=529', () => {
    assert.equal(r.msg, 'classifier http200 api error: code=529');
  });

  r = await call({ status: 200, body: { error: { type: 'rate_limit_exceeded', message: 'RAW_TYPE_SENTINEL' } } });
  check('HTTP 200 + error body (type) -> sanitized type=...', () => {
    assert.equal(r.msg, 'classifier http200 api error: type=rate_limit_exceeded');
  });

  r = await call({ status: 200, body: { error: { type: 'evil value with spaces RAW_SPACES_SENTINEL' } } });
  check('HTTP 200 + hostile error type -> category=unknown', () => {
    assert.equal(r.msg, 'classifier http200 api error: category=unknown');
  });

  r = await call({ status: 200, body: { id: 'gen_x', object: 'no.choices.here' } });
  check('HTTP 200 + missing choices -> missing-choices error', () => {
    assert.equal(r.msg, 'classifier http200 missing choices');
  });

  r = await call({ status: 200, body: { choices: [{ message: { content: '' } }] } });
  check('empty content -> null + note empty-content', () => {
    assert.equal(r.out, null);
    assert.deepEqual(r.notes, ['empty-content']);
  });

  r = await call({ status: 200, body: { choices: [{ message: { content: 'Prose output without any JSON.' } }] } });
  check('malformed output (no array) -> note no-json-array', () => {
    assert.equal(r.out, null);
    assert.deepEqual(r.notes, ['no-json-array']);
  });

  r = await call({ status: 200, body: { choices: [{ message: { content: '[{"codingScore":]' } }] } });
  check('JSON/schema validation failure -> note json-parse-error', () => {
    assert.equal(r.out, null);
    assert.deepEqual(r.notes, ['json-parse-error']);
  });

  r = await call({
    status: 200,
    body: { choices: [{ finish_reason: 'length', message: { content: '[{"codingScore":]', reasoning: 'RAW_REASONING_SENTINEL must not leak' } }] },
  });
  check('json-parse-error inherits sanitized flags (finish + reasoning booleans)', () => {
    assert.equal(r.out, null);
    assert.deepEqual(r.notes, ['json-parse-error|finish_reason=length|reasoning-present']);
    assert.ok(!allLogged.join('\n').includes('RAW_REASONING_SENTINEL'), 'reasoning text leaked');
  });

  r = await call({
    status: 200,
    body: { choices: [{ finish_reason: 'stop', message: { content: 'Prose with no bracket span at all.' } }] },
  });
  check('no-json-array inherits sanitized flags (finish_reason only)', () => {
    assert.equal(r.out, null);
    assert.deepEqual(r.notes, ['no-json-array|finish_reason=stop']);
  });

  r = await call({
    status: 200,
    body: { choices: [{ finish_reason: 'length', message: { content: '[' + entry(70) + ']' } }] },
  });
  check('other parse-family notes (incomplete) stay flag-free', () => {
    assert.equal(r.out, null);
    assert.deepEqual(r.notes, ['incomplete:1/2']);
  });

  r = await call({ status: 200, body: { choices: [{ message: { content: '[]' } }] } });
  check('incomplete results -> note with received/expected counts', () => {
    assert.equal(r.out, null);
    assert.deepEqual(r.notes, ['incomplete:0/2']);
  });

  r = await call({ status: 200, body: { choices: [{ message: { content: [{ type: 'text', text: 'parts' }] } }] } });
  check('non-string content -> note nonstring-content', () => {
    assert.equal(r.out, null);
    assert.deepEqual(r.notes, ['nonstring-content']);
  });

  r = await call({ status: 200, body: { choices: [{ message: { content: '[' + entry(80) + ',' + entry(60) + ']' } }] } });
  check('valid output -> applied with scores intact, no notes', () => {
    assert.ok(Array.isArray(r.out) && r.out.length === 2);
    assert.equal(r.out[0].codingScore, 80);
    assert.equal(r.out[1].codingScore, 60);
    assert.equal(r.out[0].scoreOrigin, 'ai');
    assert.deepEqual(r.notes, []);
  });

  check('classifier request body sets max_tokens 8192 (no network)', () => {
    assert.ok(lastRequestBody, 'no request body captured');
    const sent = JSON.parse(lastRequestBody) as { max_tokens?: unknown };
    assert.equal(sent.max_tokens, 8192);
  });

  r = await call({
    status: 200,
    body: { choices: [{ message: { content: '[' + entry(70) + ', null]' } }] },
  });
  check('schema gap -> applied with per-entry fallback + schema note', () => {
    assert.ok(Array.isArray(r.out) && r.out.length === 2);
    assert.equal(r.out[0].scoreOrigin, 'ai');
    assert.equal(r.out[1].scoreOrigin, 'deterministic');
    assert.deepEqual(r.notes, ['schema:1-of-2-entries']);
  });

  r = await call({
    status: 200,
    body: { error: { code: 1 }, choices: [{ message: { content: '[' + entry(50) + ',' + entry(50) + ']' } }] },
  });
  check('choices present alongside error -> normal path wins', () => {
    assert.ok(Array.isArray(r.out) && r.out.length === 2);
    assert.deepEqual(r.notes, []);
  });

  // --- shape diagnostics (post-implementation): classifyBatch distinguishes
  // the shapes BEFORE coercing content. Tokens are sanitized categories,
  // booleans, and whitelist-matched enums only; text never reaches a note.
  r = await call({ status: 200, body: { choices: [{ message: { content: null } }] } });
  check('content:null -> null-content (distinct from empty-content)', () => {
    assert.equal(r.out, null);
    assert.deepEqual(r.notes, ['null-content']);
  });

  r = await call({
    status: 200,
    body: { choices: [{ message: { content: null, refusal: 'RAW_REFUSAL_SENTINEL must not leak' } }] },
  });
  check('null-content + refusal -> refusal-present boolean, text never logged', () => {
    assert.equal(r.out, null);
    assert.deepEqual(r.notes, ['null-content|refusal-present']);
    assert.ok(!allLogged.join('\n').includes('RAW_REFUSAL_SENTINEL'), 'refusal text leaked');
  });

  r = await call({ status: 200, body: { choices: [{ index: 0 }] } });
  check('truthy choice without message -> missing-message', () => {
    assert.equal(r.out, null);
    assert.deepEqual(r.notes, ['missing-message']);
  });

  r = await call({ status: 200, body: { choices: [{ message: null }] } });
  check('message:null -> missing-message', () => {
    assert.equal(r.out, null);
    assert.deepEqual(r.notes, ['missing-message']);
  });

  r = await call({
    status: 200,
    body: { choices: [{ finish_reason: 'length', message: { content: null } }] },
  });
  check('null-content + whitelisted finish_reason -> finish_reason=length', () => {
    assert.equal(r.out, null);
    assert.deepEqual(r.notes, ['null-content|finish_reason=length']);
  });

  r = await call({
    status: 200,
    body: { choices: [{ finish_reason: 'bad enum RAW_FINISH_SENTINEL', message: { content: null } }] },
  });
  check('null-content + hostile finish_reason -> flag omitted, sentinel never logged', () => {
    assert.equal(r.out, null);
    assert.deepEqual(r.notes, ['null-content']);
    assert.ok(!allLogged.join('\n').includes('RAW_FINISH_SENTINEL'), 'finish_reason text leaked');
  });

  r = await call({
    status: 200,
    body: { choices: [{ message: { content: null, tool_calls: [{ id: 'RAW_TOOLCALL_SENTINEL' }] } }] },
  });
  check('null-content + tool_calls -> tool-calls-present boolean', () => {
    assert.equal(r.out, null);
    assert.deepEqual(r.notes, ['null-content|tool-calls-present']);
    assert.ok(!allLogged.join('\n').includes('RAW_TOOLCALL_SENTINEL'), 'tool-call payload leaked');
  });

  r = await call({
    status: 200,
    body: { choices: [{ message: { content: null, reasoning: 'RAW_REASONING_SENTINEL private chain' } }] },
  });
  check('null-content + reasoning text -> reasoning-present boolean, text never logged', () => {
    assert.equal(r.out, null);
    assert.deepEqual(r.notes, ['null-content|reasoning-present']);
    assert.ok(!allLogged.join('\n').includes('RAW_REASONING_SENTINEL'), 'reasoning text leaked');
  });

  r = await call({
    status: 200,
    body: { choices: [{ message: { content: null, reasoning_content: 'RAW_REASONING_SENTINEL via content field' } }] },
  });
  check('null-content + reasoning_content -> reasoning-present boolean', () => {
    assert.equal(r.out, null);
    assert.deepEqual(r.notes, ['null-content|reasoning-present']);
  });

  r = await call({
    status: 200,
    body: { choices: [{ message: { content: null, reasoning: [{ type: 'text', text: 'RAW_REASONING_SENTINEL array' }] } }] },
  });
  check('null-content + reasoning array -> reasoning-present boolean, array text never logged', () => {
    assert.equal(r.out, null);
    assert.deepEqual(r.notes, ['null-content|reasoning-present']);
    assert.ok(!allLogged.join('\n').includes('RAW_REASONING_SENTINEL'), 'reasoning array text leaked');
  });

  r = await call({ status: 200, body: { choices: [{ message: { content: ' \n\t ' } }] } });
  check('whitespace-only content -> empty-content', () => {
    assert.equal(r.out, null);
    assert.deepEqual(r.notes, ['empty-content']);
  });

  r = await call({
    status: 200,
    body: { choices: [{ finish_reason: 'stop', message: { content: '' } }] },
  });
  check('empty-content + finish_reason -> empty-content|finish_reason=stop', () => {
    assert.equal(r.out, null);
    assert.deepEqual(r.notes, ['empty-content|finish_reason=stop']);
  });

  r = await call({
    status: 200,
    body: {
      choices: [{
        finish_reason: 'stop',
        message: {
          content: '[' + entry(80) + ',' + entry(60) + ']',
          refusal: 'RAW_REFUSAL_SENTINEL present alongside success',
          tool_calls: [{ id: 'RAW_TOOLCALL_SENTINEL' }],
          reasoning: 'RAW_REASONING_SENTINEL alongside success',
        },
      }],
    },
  });
  check('valid output WITH metadata present -> applied, no notes, no text leaked', () => {
    assert.ok(Array.isArray(r.out) && r.out.length === 2);
    assert.equal(r.out[0].codingScore, 80);
    assert.equal(r.out[0].scoreOrigin, 'ai');
    assert.deepEqual(r.notes, []);
    const joined = allLogged.join('\n');
    assert.ok(!/RAW_[A-Z_]+_SENTINEL/.test(joined), 'metadata text leaked on success path');
  });

  check('applyBatchScores without callback still returns null (compat)', () => {
    assert.equal(applyBatchScores(batch, 'no json here'), null);
    assert.equal(applyBatchScores(batch, ''), null);
  });

  check('no key or response-body sentinel ever reaches a log/throw message', () => {
    const joined = allLogged.join('\n');
    assert.ok(!joined.includes(TEST_KEY), 'key leaked');
    assert.ok(!/RAW_[A-Z_]+_SENTINEL/.test(joined), 'raw body text leaked');
    assert.ok(!joined.includes('RAW_SPACES_SENTINEL'), 'raw body text leaked');
  });
}

main()
  .then(() => {
    globalThis.fetch = realFetch;
    console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILED');
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    globalThis.fetch = realFetch;
    console.error('FAIL harness :: ' + (err as Error).stack);
    process.exit(1);
  });
