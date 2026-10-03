'use client';

import { useCallback, useReducer, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CatalogProvider } from '@/app/models/page';
import { createConnectGate } from './connectState';
import {
  canRegister,
  canTest,
  createInitialLocalFlowState,
  localFlowReducer,
} from './localProviderFlow';

interface LocalProviderConnectFormProps {
  provider: CatalogProvider;
  onConnect: (
    providerId: string,
    apiKey: string,
    options?: { baseUrl?: string }
  ) => Promise<void>;
}

/**
 * Local LLM connection flow inside ProviderCard (disconnected state):
 * Base URL + optional API key → Test Connection → Register (Connect).
 * The Connect button only becomes enabled after a successful test that
 * discovered at least one model (see localProviderFlow.ts) — a reachable but
 * empty or unverified endpoint can never register.
 */
export function LocalProviderConnectForm({ provider, onConnect }: LocalProviderConnectFormProps) {
  const [state, dispatch] = useReducer(
    localFlowReducer,
    provider.baseUrl ?? '',
    createInitialLocalFlowState
  );

  // Single-flight latch: the Connect button is disabled while a request is in
  // flight, but two clicks dispatched before the re-render would both read the
  // pre-request state. This makes a duplicate registration impossible.
  const registerGate = useRef(createConnectGate());

  const busy = state.phase === 'testing' || state.phase === 'registering';

  const runTest = async () => {
    if (!canTest(state)) return;
    const baseUrl = state.baseUrl;
    const apiKey = state.apiKey;
    dispatch({ type: 'test-start' });
    try {
      const res = await fetch('/api/models/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, apiKey: apiKey || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        dispatch({ type: 'test-failure', error: data.error || 'Connection test failed.' });
        return;
      }
      if (data.success) {
        dispatch({
          type: 'test-success',
          modelCount: Array.isArray(data.modelIds) ? data.modelIds.length : 0,
          baseUrl: typeof data.baseUrl === 'string' && data.baseUrl ? data.baseUrl : baseUrl,
        });
      } else {
        dispatch({ type: 'test-failure', error: data.error || 'Connection test failed.' });
      }
    } catch (e) {
      dispatch({ type: 'test-failure', error: (e as Error).message || 'Connection test failed.' });
    }
  };

  const runRegister = useCallback(async () => {
    if (!canRegister(state)) return;
    if (!registerGate.current.tryBegin()) return;
    const baseUrl = state.verifiedBaseUrl ?? state.baseUrl;
    const apiKey = state.apiKey;
    dispatch({ type: 'register-start' });
    try {
      // Resolves as soon as the registration request finishes (success or
      // failure) — the catalog refresh it triggers runs in the background, so
      // this can never leave the button on "Connecting...".
      await onConnect(provider.providerId, apiKey, { baseUrl });
      dispatch({ type: 'register-success' });
      // Submitted — drop the secret from the form immediately.
      dispatch({ type: 'clear-api-key' });
    } catch (e) {
      dispatch({
        type: 'register-failure',
        error: (e as Error).message || 'Registration failed.',
      });
    } finally {
      registerGate.current.end();
    }
  }, [state, onConnect, provider.providerId]);

  return (
    <div className="space-y-2">
      <Input
        type="text"
        placeholder="Base URL — e.g. http://127.0.0.1:8000/v1"
        value={state.baseUrl}
        onChange={(e) => dispatch({ type: 'field', field: 'baseUrl', value: e.target.value })}
        disabled={busy || state.phase === 'registered'}
        aria-label="Local endpoint base URL"
      />
      <Input
        type="password"
        placeholder="API key (optional — many local servers need none)"
        value={state.apiKey}
        onChange={(e) => dispatch({ type: 'field', field: 'apiKey', value: e.target.value })}
        disabled={busy || state.phase === 'registered'}
        aria-label="Local endpoint API key"
      />

      {state.phase === 'verified' && (
        <p className="text-xs font-mono text-bw-peach">
          Endpoint verified — {state.modelCount} model{state.modelCount === 1 ? '' : 's'} found
        </p>
      )}
      {state.phase === 'no-models' && (
        <p className="text-xs text-bw-peach">
          Endpoint verified, but it lists no models. Connect stays disabled until the server
          exposes models.
        </p>
      )}
      {state.phase === 'registered' && (
        <p className="text-xs font-mono text-bw-peach">Connected.</p>
      )}
      {state.error && <p className="text-xs text-error-default">{state.error}</p>}

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="border-border text-bw-peach"
          onClick={runTest}
          disabled={!canTest(state)}
        >
          {state.phase === 'testing' ? 'Testing...' : 'Test Connection'}
        </Button>
        <Button
          size="sm"
          className="flex-1 btn-bw-primary font-medium"
          onClick={runRegister}
          disabled={!canRegister(state)}
        >
          {state.phase === 'registering' ? 'Connecting...' : 'Connect'}
        </Button>
      </div>

      <p className="text-[11px] text-bw-peach">
        A successful connection test is required before this provider can connect.
      </p>
    </div>
  );
}
