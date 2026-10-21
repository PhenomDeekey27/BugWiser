// Pure state machine for the Local LLM connect flow (Connect → test →
// verified → register). No React, no fetch: the component drives it and tests
// exercise it directly.
//
// The core gate: registration is only possible after a SUCCESSFUL test
// ('verified' with ≥1 discovered model). Editing any field after a test
// invalidates the verification ('idle'), so what gets registered is exactly
// what was tested — the server re-runs the test anyway before saving.
//
// Connect is ONE user action: nextConnectStep says whether it still needs the
// test (nothing verified yet) or can register the verified URL straight away.
// A retry after a failed test never needs the URL re-typed.

export type LocalFlowPhase =
  | 'idle' // no successful test yet (or fields changed since one)
  | 'testing' // test request in flight
  | 'verified' // test succeeded with ≥1 model — registration allowed
  | 'no-models' // test succeeded but the endpoint listed 0 models — registration blocked
  | 'failed' // last test failed
  | 'registering' // registration request in flight
  | 'registered'; // registration succeeded (parent refresh flips the card)

export interface LocalFlowState {
  phase: LocalFlowPhase;
  baseUrl: string;
  apiKey: string;
  /** Model IDs discovered by the last successful test. */
  modelIds: string[];
  /** Convenience count; always modelIds.length after a test. */
  modelCount: number;
  /** Error for display; constructed server-side, never contains secrets. */
  error: string | null;
  /** Base URL of the successful test — what registration submits. */
  verifiedBaseUrl: string | null;
}

export type LocalFlowAction =
  | { type: 'field'; field: 'baseUrl' | 'apiKey'; value: string }
  | { type: 'test-start' }
  | {
      type: 'test-success';
      /** Discovered model IDs (preferred — the UI lists them). */
      modelIds?: string[];
      /** Legacy count-only form (kept for callers that only know the count). */
      modelCount?: number;
      baseUrl: string;
    }
  | { type: 'test-failure'; error: string }
  | { type: 'register-start' }
  | { type: 'register-success' }
  | { type: 'register-failure'; error: string }
  | { type: 'clear-api-key' }
  | { type: 'reset' };

export function createInitialLocalFlowState(baseUrl = ''): LocalFlowState {
  return {
    phase: 'idle',
    baseUrl,
    apiKey: '',
    modelIds: [],
    modelCount: 0,
    error: null,
    verifiedBaseUrl: null,
  };
}

function isBusy(state: LocalFlowState): boolean {
  return state.phase === 'testing' || state.phase === 'registering';
}

/** A test may start only when no request is in flight and a base URL is
 * present. 'registered' is terminal (the parent refresh flips the card). */
export function canTest(state: LocalFlowState): boolean {
  if (isBusy(state) || state.phase === 'registered') return false;
  return state.baseUrl.trim().length > 0;
}

/** Registration gate: ONLY from a successful test with at least one model.
 * 'no-models' (empty endpoint) can never register. */
export function canRegister(state: LocalFlowState): boolean {
  return state.phase === 'verified' && state.modelCount > 0 && state.verifiedBaseUrl !== null;
}

/** The Connect button: one action that tests when needed, then registers. */
export function canConnect(state: LocalFlowState): boolean {
  if (isBusy(state) || state.phase === 'registered') return false;
  return state.baseUrl.trim().length > 0;
}

export type LocalConnectStep =
  | { step: 'test' }
  | { step: 'register'; baseUrl: string }
  | { step: 'blocked'; reason: string };

/**
 * What must happen next when the user clicks Connect. When a test already
 * verified this exact URL, registration runs immediately (no re-entering the
 * URL); otherwise the test runs first. `resume` after a failure lands back on
 * 'test' because the URL is still in the field.
 */
export function nextConnectStep(state: LocalFlowState): LocalConnectStep {
  if (isBusy(state)) return { step: 'blocked', reason: 'A connection request is already running.' };
  if (state.phase === 'registered') {
    return { step: 'blocked', reason: 'This endpoint is already connected.' };
  }
  if (state.baseUrl.trim().length === 0) {
    return { step: 'blocked', reason: 'Enter the Base URL of your local LLM server first.' };
  }
  if (state.phase === 'verified' && state.verifiedBaseUrl) {
    return { step: 'register', baseUrl: state.verifiedBaseUrl };
  }
  return { step: 'test' };
}

export function localFlowReducer(state: LocalFlowState, action: LocalFlowAction): LocalFlowState {
  switch (action.type) {
    case 'field': {
      if (isBusy(state) || state.phase === 'registered') {
        return state;
      }
      // Any edit invalidates a previous verification: register exactly what
      // was tested. Errors from a prior attempt are cleared with the edit.
      return {
        ...state,
        [action.field]: action.value,
        phase: 'idle',
        modelIds: [],
        modelCount: 0,
        error: null,
        verifiedBaseUrl: null,
      };
    }
    case 'test-start': {
      if (!canTest(state)) return state;
      return {
        ...state,
        phase: 'testing',
        error: null,
        modelIds: [],
        modelCount: 0,
        verifiedBaseUrl: null,
      };
    }
    case 'test-success': {
      const modelIds = action.modelIds ?? [];
      const modelCount = modelIds.length > 0 ? modelIds.length : (action.modelCount ?? 0);
      // Distinguish a verified-but-empty endpoint from a working one — the
      // empty case stays registrable=false below via its own phase.
      const verified = modelCount > 0;
      return {
        ...state,
        phase: verified ? 'verified' : 'no-models',
        modelIds,
        modelCount,
        verifiedBaseUrl: action.baseUrl,
        error: null,
      };
    }
    case 'test-failure': {
      return {
        ...state,
        phase: 'failed',
        modelIds: [],
        modelCount: 0,
        verifiedBaseUrl: null,
        error: action.error,
      };
    }
    case 'register-start': {
      if (!canRegister(state)) return state;
      return { ...state, phase: 'registering', error: null };
    }
    case 'register-success': {
      if (state.phase !== 'registering') return state;
      return { ...state, phase: 'registered', error: null };
    }
    case 'register-failure': {
      if (state.phase !== 'registering') return state;
      // Back to the verified state so registration can be retried (the test
      // result is still valid; the failure is shown alongside it).
      return { ...state, phase: 'verified', error: action.error };
    }
    case 'clear-api-key': {
      // Secret hygiene after submission — clears ONLY the key field and never
      // touches the phase (so it is safe mid/post-registration).
      return { ...state, apiKey: '' };
    }
    case 'reset': {
      return createInitialLocalFlowState(state.baseUrl);
    }
    default:
      return state;
  }
}
