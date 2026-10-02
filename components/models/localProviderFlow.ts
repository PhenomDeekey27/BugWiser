// Task M — pure state machine for the Local LLM connect flow (Test Connection
// → Register). No React, no fetch: the component drives it and tests exercise
// it directly.
//
// The core gate: registration is only possible after a SUCCESSFUL test
// ('verified' with ≥1 discovered model). Editing any field after a test
// invalidates the verification ('idle'), so what gets registered is exactly
// what was tested — the server re-runs the test anyway before saving.

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
  /** Models discovered by the last successful test (0 unless verified). */
  modelCount: number;
  /** Error for display; constructed server-side, never contains secrets. */
  error: string | null;
  /** Base URL of the successful test — what registration submits. */
  verifiedBaseUrl: string | null;
}

export type LocalFlowAction =
  | { type: 'field'; field: 'baseUrl' | 'apiKey'; value: string }
  | { type: 'test-start' }
  | { type: 'test-success'; modelCount: number; baseUrl: string }
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
    modelCount: 0,
    error: null,
    verifiedBaseUrl: null,
  };
}

/** A test may start only when no request is in flight and a base URL is
 * present. 'registered' is terminal (the parent refresh flips the card). */
export function canTest(state: LocalFlowState): boolean {
  if (state.phase === 'testing' || state.phase === 'registering') return false;
  if (state.phase === 'registered') return false;
  return state.baseUrl.trim().length > 0;
}

/** Registration gate: ONLY from a successful test with at least one model.
 * 'no-models' (empty endpoint) can never register. */
export function canRegister(state: LocalFlowState): boolean {
  return state.phase === 'verified' && state.modelCount > 0 && state.verifiedBaseUrl !== null;
}

export function localFlowReducer(state: LocalFlowState, action: LocalFlowAction): LocalFlowState {
  switch (action.type) {
    case 'field': {
      if (state.phase === 'testing' || state.phase === 'registering' || state.phase === 'registered') {
        return state;
      }
      // Any edit invalidates a previous verification: register exactly what
      // was tested. Errors from a prior attempt are cleared with the edit.
      return {
        ...state,
        [action.field]: action.value,
        phase: 'idle',
        modelCount: 0,
        error: null,
        verifiedBaseUrl: null,
      };
    }
    case 'test-start': {
      if (!canTest(state)) return state;
      return { ...state, phase: 'testing', error: null, modelCount: 0, verifiedBaseUrl: null };
    }
    case 'test-success': {
      // Distinguish a verified-but-empty endpoint from a working one — the
      // empty case stays registrable=false below via its own phase.
      const verified = action.modelCount > 0;
      return {
        ...state,
        phase: verified ? 'verified' : 'no-models',
        modelCount: action.modelCount,
        verifiedBaseUrl: action.baseUrl,
        error: null,
      };
    }
    case 'test-failure': {
      return {
        ...state,
        phase: 'failed',
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
