// Task J — Server-side "Test Connection" for a local OpenAI-compatible endpoint.
//
// Contract: the client submits a Base URL + optional API key; the server
// verifies the endpoint behaves like an OpenAI-compatible LLM API and returns
// a STRUCTURED result. This module NEVER persists or registers anything —
// "test connection" and "register provider" are separate concepts (failed
// tests cannot create an active provider; registration in
// connection/registerLocal.ts consumes a successful result and is gated on it).
//
// Verification strategy (mirrors the existing provider healthCheck pattern —
// GET `${baseUrl}/models`, e.g. providers/openai/client.ts healthCheck):
//   1. GET `<base>/models`; when that 404s and the base URL has no version
//      segment, also try `<base>/v1/models` (OpenAI-compatible convention).
//   2. A 200 alone is NOT enough: the body must parse as an OpenAI models
//      list (bare array or `{ data: [...] }` with extractable `id`s).
//   3. No generation request is sent — the existing architecture only ever
//      requires the lightweight models listing for compatibility checks.
//
// Security:
//   - The API key is optional, sent ONLY as an Authorization header to the
//     validated target, and is never included in any result or message.
//   - Response bodies are never echoed — only extracted model IDs or generic
//     human-readable errors (status codes, timeout, reachability).
//   - Target URLs are screened for obvious SSRF (blockedLocalTargetReason);
//     redirects are re-validated per hop.
//   - A short timeout keeps a dead local server from hanging the request.

import {
  LOCAL_PROVIDER_ID,
  normalizeLocalBaseUrl,
  blockedLocalTargetReason,
  hasVersionSegment,
} from './local';

export type LocalCompatibility = 'openai-compatible' | 'not-compatible' | 'unverified';

export interface LocalConnectionTestResult {
  success: boolean;
  providerType: typeof LOCAL_PROVIDER_ID;
  /** Normalized base URL; '' when the input could not be normalized. */
  baseUrl: string;
  /** The models endpoint that was verified, when one was reached. */
  modelsEndpoint: string | null;
  /** Discovered model IDs (present only for a verified compatible endpoint). */
  modelIds: string[];
  compatibility: LocalCompatibility;
  /** Human-readable failure reason; null on success. Never contains secrets. */
  error: string | null;
}

interface ResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<ResponseLike>;

export interface TestConnectionDeps {
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: FetchLike;
  /** Short by default so a dead local server cannot hang the request. */
  timeoutMs?: number;
}

/**
 * Result of the shared models-endpoint probe (the SINGLE HTTP security layer
 * for local endpoints — used by both the connection test and catalog
 * discovery). Never contains API keys, Authorization headers, or raw response
 * bodies; `entries` holds only the parsed list entries of a verified response.
 */
export interface LocalModelsProbe {
  ok: boolean;
  /** Normalized base URL; '' when the input could not be normalized. */
  baseUrl: string;
  /** The models endpoint that was verified, when one was reached. */
  modelsEndpoint: string | null;
  /** Parsed list entries (present only for a verified compatible endpoint). */
  entries: unknown[];
  /** Extracted model IDs (present only for a verified compatible endpoint). */
  modelIds: string[];
  compatibility: LocalCompatibility;
  /** Human-readable failure reason; null on success. Never contains secrets. */
  error: string | null;
}

export const DEFAULT_TEST_TIMEOUT_MS = 5_000;
const MAX_REDIRECT_HOPS = 3;

const TIMEOUT = Symbol('local-connection-test-timeout');

type TransportOutcome =
  | { kind: 'response'; response: ResponseLike }
  | { kind: 'timeout'; url: string }
  | { kind: 'network'; url: string }
  | { kind: 'blocked-redirect'; reason: string }
  | { kind: 'too-many-redirects' };

function fail(
  baseUrl: string,
  compatibility: LocalCompatibility,
  error: string,
  modelsEndpoint: string | null = null
): LocalModelsProbe {
  return {
    ok: false,
    baseUrl,
    modelsEndpoint,
    entries: [],
    modelIds: [],
    compatibility,
    error,
  };
}

async function requestWithTimeout(
  fetchFn: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<TransportOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    // Ref'd on purpose: this timer is the safety net that guarantees the test
    // settles even when the request hangs (it is cleared in `finally`).
    timer = setTimeout(() => reject(TIMEOUT), timeoutMs);
  });
  try {
    const initWithSignal: RequestInit = { ...init };
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      initWithSignal.signal = AbortSignal.timeout(timeoutMs);
    }
    const response = await Promise.race([fetchFn(url, initWithSignal), timeoutPromise]);
    return { kind: 'response', response };
  } catch (err) {
    if (err === TIMEOUT) return { kind: 'timeout', url };
    const name = (err as { name?: string } | null)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') return { kind: 'timeout', url };
    return { kind: 'network', url };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Fetch with redirect following done MANUALLY so every hop is re-screened
 * against the SSRF target rules (a redirect must not smuggle the request to a
 * blocked address).
 */
async function safeFetch(
  fetchFn: FetchLike,
  startUrl: string,
  init: RequestInit,
  timeoutMs: number
): Promise<TransportOutcome> {
  let currentUrl = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    const outcome = await requestWithTimeout(fetchFn, currentUrl, { ...init, redirect: 'manual' }, timeoutMs);
    if (outcome.kind !== 'response') return outcome;

    const { response } = outcome;
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) return { kind: 'response', response };
      let nextUrl: string;
      try {
        nextUrl = new URL(location, currentUrl).toString();
      } catch {
        return { kind: 'network', url: currentUrl };
      }
      const blocked = blockedLocalTargetReason(nextUrl);
      if (blocked) return { kind: 'blocked-redirect', reason: blocked };
      currentUrl = nextUrl;
      continue;
    }
    return { kind: 'response', response };
  }
  return { kind: 'too-many-redirects' };
}

function extractModelIds(list: unknown[]): string[] {
  const ids: string[] = [];
  for (const entry of list) {
    if (typeof entry === 'string') {
      if (entry.trim()) ids.push(entry);
    } else if (entry && typeof entry === 'object') {
      const id = (entry as { id?: unknown }).id;
      if (typeof id === 'string' && id.trim()) ids.push(id);
    }
  }
  return ids;
}

function extractModelList(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed; // bare-array form (existing fetchChutes accepts it)
  if (parsed && typeof parsed === 'object') {
    const data = (parsed as { data?: unknown }).data;
    if (Array.isArray(data)) return data; // OpenAI `{ object: 'list', data: [...] }`
  }
  return null;
}

/**
 * Probe a local OpenAI-compatible endpoint's models list. This is the ONE
 * place local-endpoint HTTP happens (connection test AND catalog discovery
 * reuse it), so URL normalization, SSRF screening, manual per-hop redirect
 * validation, timeout handling, and response-shape verification exist once.
 * Performs NO persistence and sends NO generation request.
 */
export async function probeLocalModelsList(
  input: { baseUrl: string; apiKey?: string },
  deps: TestConnectionDeps = {}
): Promise<LocalModelsProbe> {
  const fetchFn = deps.fetchFn ?? (globalThis.fetch as FetchLike | undefined);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TEST_TIMEOUT_MS;

  if (!fetchFn) {
    return fail('', 'unverified', 'No HTTP client is available to run the connection test.');
  }

  const normalized = normalizeLocalBaseUrl(input.baseUrl);
  if (!normalized.ok) {
    return fail('', 'unverified', normalized.error);
  }
  const baseUrl = normalized.baseUrl;

  const blocked = blockedLocalTargetReason(baseUrl);
  if (blocked) {
    return fail(baseUrl, 'unverified', blocked);
  }

  const apiKey = (input.apiKey ?? '').trim();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const candidates = [`${baseUrl}/models`];
  if (!hasVersionSegment(baseUrl)) candidates.push(`${baseUrl}/v1/models`);

  for (const candidate of candidates) {
    const outcome = await safeFetch(fetchFn, candidate, { method: 'GET', headers }, timeoutMs);

    switch (outcome.kind) {
      case 'timeout':
        return fail(baseUrl, 'unverified', `Connection test timed out after ${timeoutMs}ms reaching ${outcome.url}.`);
      case 'network':
        return fail(
          baseUrl,
          'unverified',
          `Could not reach ${outcome.url} — the server refused the connection or is unreachable.`
        );
      case 'blocked-redirect':
        return fail(baseUrl, 'unverified', outcome.reason);
      case 'too-many-redirects':
        return fail(baseUrl, 'unverified', `Too many redirects while testing ${candidate}.`);
      case 'response':
        break;
    }

    const response = (outcome as { kind: 'response'; response: ResponseLike }).response;
    const { status } = response;

    if (status === 401 || status === 403) {
      return fail(
        baseUrl,
        'unverified',
        `Authentication failed (HTTP ${status}) — check the API key for ${candidate}.`,
        candidate
      );
    }
    if (status === 404) continue; // try the next candidate endpoint
    if (status >= 300 && status < 400) {
      return fail(baseUrl, 'unverified', `Unexpected redirect (HTTP ${status}) from ${candidate}.`, candidate);
    }
    if (!response.ok) {
      return fail(baseUrl, 'unverified', `Endpoint responded with HTTP ${status} from ${candidate}.`, candidate);
    }

    // 2xx — a status alone proves nothing; the body must be an OpenAI models list.
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return fail(
        baseUrl,
        'not-compatible',
        `${candidate} responded but the response is not valid JSON — not an OpenAI-compatible endpoint.`,
        candidate
      );
    }

    const list = extractModelList(parsed);
    if (!list) {
      return fail(
        baseUrl,
        'not-compatible',
        `${candidate} responded but did not return an OpenAI-compatible models list.`,
        candidate
      );
    }

    const modelIds = extractModelIds(list);
    if (list.length === 0) {
      return fail(
        baseUrl,
        'openai-compatible',
        `${candidate} is OpenAI-compatible but returned an empty model list — no models are available.`,
        candidate
      );
    }
    if (modelIds.length === 0) {
      return fail(
        baseUrl,
        'not-compatible',
        `${candidate} returned a models list without any model IDs — malformed response.`,
        candidate
      );
    }

    return {
      ok: true,
      baseUrl,
      modelsEndpoint: candidate,
      entries: list,
      modelIds,
      compatibility: 'openai-compatible',
      error: null,
    };
  }

  return fail(
    baseUrl,
    'not-compatible',
    `No OpenAI-compatible models endpoint found at ${baseUrl} (tried ${candidates.join(', ')}).`,
    null
  );
}

/**
 * Test a local OpenAI-compatible endpoint: the shared probe plus the
 * user-facing result contract (providerType + success flag). Registration is
 * gated on `success === true` — a reachable-but-empty or unverified endpoint
 * can never mark the provider connected.
 */
export async function testLocalConnection(
  input: { baseUrl: string; apiKey?: string },
  deps: TestConnectionDeps = {}
): Promise<LocalConnectionTestResult> {
  const probe = await probeLocalModelsList(input, deps);
  return {
    success: probe.ok,
    providerType: LOCAL_PROVIDER_ID,
    baseUrl: probe.baseUrl,
    modelsEndpoint: probe.modelsEndpoint,
    modelIds: probe.modelIds,
    compatibility: probe.compatibility,
    error: probe.error,
  };
}
