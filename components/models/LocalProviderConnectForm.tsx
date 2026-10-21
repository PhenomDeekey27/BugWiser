'use client';

import { useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CatalogProvider } from '@/app/models/page';
import { mixedContentHint, normalizeLocalBaseUrl } from '@/lib/ai/connection/local';
import { appOrigin, serverCorsHint } from '@/lib/ai/connection/reachability';
import { createConnectGate } from './connectState';
import { detectLocalEndpoint } from './localEndpointDetect';
import {
  canConnect,
  canRegister,
  canTest,
  createInitialLocalFlowState,
  localFlowReducer,
  nextConnectStep,
} from './localProviderFlow';

interface LocalProviderConnectFormProps {
  provider: CatalogProvider;
  onConnect: (
    providerId: string,
    apiKey: string,
    options?: { baseUrl?: string }
  ) => Promise<void>;
}

// Page protocol as an external store: window is unavailable during SSR, and
// useSyncExternalStore re-renders after hydration when the client snapshot
// differs — no setState-in-effect, no hydration mismatch.
const subscribeProtocol = () => () => {};
const readProtocol = () => (typeof window !== 'undefined' ? window.location.protocol : 'http:');
const readServerProtocol = () => 'http:';

const MAX_LISTED_MODELS = 50;

interface TestOutcome {
  ok: boolean;
  modelIds: string[];
  baseUrl: string;
  error: string | null;
}

/**
 * Local LLM connection flow inside ProviderCard.
 *
 * The Base URL input is always the primary path: paste the endpoint your
 * server prints (e.g. http://127.0.0.1:1234/v1) and press Connect. Connect is
 * ONE action — it tests the endpoint and only then registers it (the existing
 * architecture's validate-before-save gate). "Test" is an optional separate
 * check; "Detect" only fills the field when the user asks for it and never
 * overwrites a URL the user typed.
 *
 * What the test actually does (server-side, relayed to this browser tab when
 * the app is deployed): GET <base>/models (falling back to /v1/models), require
 * an OpenAI-compatible model list, and return the discovered model IDs. A
 * reachable-but-empty endpoint is shown as such and can never be registered.
 */
export function LocalProviderConnectForm({ provider, onConnect }: LocalProviderConnectFormProps) {
  const [state, dispatch] = useReducer(
    localFlowReducer,
    provider.baseUrl ?? '',
    createInitialLocalFlowState
  );
  const [detecting, setDetecting] = useState(false);
  const [detectNote, setDetectNote] = useState<string | null>(null);
  const [relayed, setRelayed] = useState(false);

  // Single-flight latch: the buttons are disabled while a request is in
  // flight, but two clicks dispatched before the re-render would both read the
  // pre-request state. This makes duplicate tests/registrations impossible.
  const requestGate = useRef(createConnectGate());
  // Detect must never overwrite a value the user typed while the probe was in
  // flight: any edit sets this, and the fill is then skipped.
  const baseUrlEdited = useRef(false);

  const busy = state.phase === 'testing' || state.phase === 'registering';
  const pageProtocol = useSyncExternalStore(subscribeProtocol, readProtocol, readServerProtocol);
  const mixedHint = busy ? null : mixedContentHint(state.baseUrl, pageProtocol);

  const runDetect = async () => {
    if (detecting || busy || state.phase === 'registered') return;
    setDetecting(true);
    setDetectNote(null);
    baseUrlEdited.current = false;
    let result: Awaited<ReturnType<typeof detectLocalEndpoint>> = { endpoint: null, blocked: [] };
    try {
      result = await detectLocalEndpoint();
    } catch {
      result = { endpoint: null, blocked: [] };
    }
    setDetecting(false);
    const found = result.endpoint;
    if (!found) {
      const blockedUrl = result.blocked[0];
      setDetectNote(
        blockedUrl
          ? `${blockedUrl} answered, but it blocks this site's origin — add ${appOrigin()} to the server's allowed origins (${serverCorsHint(blockedUrl)}) and run Detect again.`
          : 'No local endpoint answered on the common ports — paste your server’s Base URL instead.'
      );
      return;
    }
    const count = found.modelIds.length;
    const detail =
      count > 0
        ? `${count} model${count === 1 ? '' : 's'} available`
        : 'reachable, but it lists no models yet';
    if (!baseUrlEdited.current) {
      dispatch({ type: 'field', field: 'baseUrl', value: found.baseUrl });
    }
    setDetectNote(
      `${baseUrlEdited.current ? 'Found' : 'Detected'} ${found.baseUrl} — ${detail}.`
    );
  };

  /** One test request; dispatches its own state transition and returns the
   *  raw outcome so Connect can chain registration without stale state. */
  const runTestRequest = async (baseUrl: string, apiKey: string): Promise<TestOutcome> => {
    try {
      const res = await fetch('/api/models/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, apiKey: apiKey || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (typeof data.relayed === 'boolean') setRelayed(data.relayed);
      const modelIds: string[] = Array.isArray(data.modelIds)
        ? data.modelIds.filter((id: unknown): id is string => typeof id === 'string')
        : [];
      const normalizedBase =
        typeof data.baseUrl === 'string' && data.baseUrl ? data.baseUrl : baseUrl;
      if (!res.ok) {
        return {
          ok: false,
          modelIds: [],
          baseUrl: normalizedBase,
          error: data.error || 'Connection test failed.',
        };
      }
      if (data.success === true) {
        dispatch({ type: 'test-success', modelIds, baseUrl: normalizedBase });
        return { ok: true, modelIds, baseUrl: normalizedBase, error: null };
      }
      // A server that ANSWERED as OpenAI-compatible but lists no models is not
      // a failed connection — it is an empty endpoint. Show that state (Connect
      // stays blocked) instead of a generic failure. `success` remains false
      // server-side, so registration is still impossible.
      if (data.compatibility === 'openai-compatible' && modelIds.length === 0) {
        dispatch({ type: 'test-success', modelIds: [], baseUrl: normalizedBase });
        return { ok: true, modelIds: [], baseUrl: normalizedBase, error: null };
      }
      return {
        ok: false,
        modelIds: [],
        baseUrl: normalizedBase,
        error: data.error || 'Connection test failed.',
      };
    } catch (e) {
      const error = `Could not reach BugWiser's connection test endpoint: ${
        (e as Error).message || 'network error'
      }.`;
      return { ok: false, modelIds: [], baseUrl, error };
    }
  };

  const runTest = async (): Promise<TestOutcome | null> => {
    if (!canTest(state)) return null;
    dispatch({ type: 'test-start' });
    // Fast local validation first: an unsupported scheme or a non-URL should
    // never reach the server. Same rules as the server-side normalizer.
    const validation = normalizeLocalBaseUrl(state.baseUrl);
    if (!validation.ok) {
      dispatch({ type: 'test-failure', error: validation.error });
      return { ok: false, modelIds: [], baseUrl: '', error: validation.error };
    }
    const outcome = await runTestRequest(validation.baseUrl, state.apiKey);
    if (!outcome.ok) {
      dispatch({ type: 'test-failure', error: outcome.error ?? 'Connection test failed.' });
    }
    return outcome;
  };

  const runRegister = async (verifiedBaseUrl: string): Promise<boolean> => {
    dispatch({ type: 'register-start' });
    try {
      await onConnect(provider.providerId, state.apiKey, { baseUrl: verifiedBaseUrl });
      dispatch({ type: 'register-success' });
      // Submitted — drop the secret from the form immediately.
      dispatch({ type: 'clear-api-key' });
      return true;
    } catch (e) {
      dispatch({
        type: 'register-failure',
        error: (e as Error).message || 'Registration failed.',
      });
      return false;
    }
  };

  /** Connect: test when this URL has not been verified yet, then register. */
  const runConnect = async () => {
    const next = nextConnectStep(state);
    if (next.step === 'blocked') {
      if (state.baseUrl.trim().length === 0) {
        dispatch({ type: 'test-failure', error: next.reason });
      }
      return;
    }
    if (!requestGate.current.tryBegin()) return;
    try {
      let target: string;
      if (next.step === 'register') {
        target = next.baseUrl;
      } else {
        const outcome = await runTest();
        if (!outcome || !outcome.ok) return;
        if (outcome.modelIds.length === 0) return; // 'no-models' is shown
        target = outcome.baseUrl;
      }
      await runRegister(target);
    } finally {
      requestGate.current.end();
    }
  };

  const runTestOnly = async () => {
    if (!requestGate.current.tryBegin()) return;
    try {
      await runTest();
    } finally {
      requestGate.current.end();
    }
  };

  const listedModels = state.modelIds.slice(0, MAX_LISTED_MODELS);
  const remainingModels = state.modelIds.length - listedModels.length;

  return (
    <div className="space-y-2">
      <Input
        type="text"
        placeholder="Base URL — e.g. http://127.0.0.1:1234/v1"
        value={state.baseUrl}
        onChange={(e) => {
          baseUrlEdited.current = true;
          dispatch({ type: 'field', field: 'baseUrl', value: e.target.value });
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void runConnect();
          }
        }}
        disabled={busy || state.phase === 'registered'}
        aria-label="Local endpoint base URL"
        autoComplete="off"
        spellCheck={false}
      />
      {mixedHint && <p className="text-[11px] text-bw-peach">{mixedHint}</p>}
      <Input
        type="password"
        placeholder="API key (optional — many local servers need none)"
        value={state.apiKey}
        onChange={(e) => dispatch({ type: 'field', field: 'apiKey', value: e.target.value })}
        disabled={busy || state.phase === 'registered'}
        aria-label="Local endpoint API key"
      />

      {state.phase === 'testing' && (
        <p className="text-xs font-mono text-bw-peach">
          Testing {state.baseUrl} — fetching its model list…
        </p>
      )}
      {state.phase === 'verified' && (
        <div className="rounded-md border border-border/60 bg-surface-container-lowest/60 p-2">
          <p className="text-xs font-mono text-bw-peach">
            {state.verifiedBaseUrl} — {state.modelCount} model
            {state.modelCount === 1 ? '' : 's'} found
          </p>
          <ul className="mt-1 max-h-24 space-y-0.5 overflow-auto">
            {listedModels.map((id, index) => (
              <li
                key={`${index}-${id}`}
                className="truncate text-[11px] font-mono text-bw-peach/80"
                title={id}
              >
                {id}
              </li>
            ))}
          </ul>
          {remainingModels > 0 && (
            <p className="mt-1 text-[11px] font-mono text-bw-peach/70">
              +{remainingModels} more
            </p>
          )}
        </div>
      )}
      {state.phase === 'no-models' && (
        <p className="text-xs text-bw-peach" role="status">
          The server answered and is OpenAI-compatible, but its model list is empty. Load or
          download a model in your local server, then press Connect again.
        </p>
      )}
      {state.phase === 'registered' && (
        <p className="text-xs font-mono text-bw-peach" role="status">
          Connected — the discovered models are being added to your catalog.
        </p>
      )}
      {detectNote && !busy && <p className="text-xs text-bw-peach">{detectNote}</p>}
      {relayed && (
        <p className="text-[11px] text-bw-peach">
          Talking to your local server through this browser tab — keep BugWiser open in this
          browser while it (and future analyses) run.
        </p>
      )}
      {state.error && (
        <p className="text-xs text-error-default" role="alert">
          {state.error}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="border-border text-bw-peach"
          onClick={runDetect}
          disabled={detecting || busy || state.phase === 'registered'}
          title="Probe the common local ports (optional — pasting the Base URL is enough)"
        >
          {detecting ? 'Detecting...' : 'Detect'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="border-border text-bw-peach"
          onClick={runTestOnly}
          disabled={!canTest(state)}
        >
          {state.phase === 'testing' ? 'Testing...' : 'Test'}
        </Button>
        <Button
          size="sm"
          className="flex-1 btn-bw-primary font-medium"
          onClick={runConnect}
          disabled={!canConnect(state)}
        >
          {state.phase === 'testing'
            ? 'Testing...'
            : state.phase === 'registering'
              ? 'Connecting...'
              : state.phase === 'verified'
                ? 'Save connection'
                : 'Connect'}
        </Button>
      </div>

      <p className="text-[11px] text-bw-peach">
        Connect tests the endpoint and saves it only if it returns an OpenAI-compatible model
        list. Your server must allow requests from this site (CORS).
      </p>
      {canRegister(state) && (
        <p className="text-[11px] font-mono text-bw-peach/70">
          Verified endpoint ready to save.
        </p>
      )}
    </div>
  );
}
