// Structured, secret-free logging for the authentication flow.
//
// Every field is an allowlisted primitive supplied by the caller. Callers must
// never pass a state value, authorization code, access token, session cookie
// value, client secret, or database URL. The helpers below additionally strip
// control characters and truncate, so a value that slips through cannot break
// the log line or fill it with payload.
//
// A correlation id ties all events of one authorization attempt together and is
// included in the error redirect (`ref`) so a user can quote it in a report
// without ever seeing a secret.

import crypto from 'node:crypto';

type LogField = string | number | boolean | null | undefined;

const MAX_VALUE_LENGTH = 160;

/** Short, non-secret id for one request. Never derived from user input. */
export function newCorrelationId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}

function clean(value: LogField): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const flattened = value.replace(/[\r\n\t]+/g, ' ').trim();
  return flattened.length > MAX_VALUE_LENGTH
    ? `${flattened.slice(0, MAX_VALUE_LENGTH)}...`
    : flattened;
}

function format(fields: Record<string, LogField>): string {
  return Object.entries(fields)
    .map(([key, value]) => {
      const cleaned = clean(value);
      return cleaned === null ? null : `${key}=${cleaned}`;
    })
    .filter(Boolean)
    .join(' ');
}

/** Authorization stages, used as the `stage` field on every event. */
export type AuthStage =
  | 'authorize_start'
  | 'authorize_callback'
  | 'session_read'
  | 'persistence'
  | 'reauth'
  | 'logout'
  | 'guest';

export function logAuthEvent(
  stage: AuthStage,
  event: string,
  fields: Record<string, LogField> = {}
): void {
  console.info(`[auth] ${format({ stage, event, ...fields })}`);
}

export function logAuthFailure(
  stage: AuthStage,
  event: string,
  fields: Record<string, LogField> = {}
): void {
  console.error(`[auth] ${format({ stage, event, ...fields })}`);
}

/**
 * Machine-readable failure categories. Messages shown to users are chosen from
 * this list, so a GitHub or database message is never echoed verbatim.
 */
export type AuthFailureCategory =
  | 'not_configured'
  | 'provider_cancelled'
  | 'provider_error'
  | 'missing_code'
  | 'missing_state'
  | 'state_unknown'
  | 'state_expired'
  | 'state_mismatch'
  | 'token_exchange_failed'
  | 'identity_failed'
  | 'session_failed'
  | 'unexpected';

/** User-facing text per category. Deliberately generic and secret-free. */
export function userMessageFor(category: AuthFailureCategory): string {
  switch (category) {
    case 'not_configured':
      return 'GitHub sign-in is not configured on this deployment.';
    case 'provider_cancelled':
      return 'GitHub authorization was cancelled.';
    case 'provider_error':
      return 'GitHub authorization failed. Please try again.';
    case 'missing_code':
      return 'No authorization code was received from GitHub.';
    case 'missing_state':
      return 'The authorization response was missing its security state.';
    case 'state_unknown':
      return 'This sign-in attempt was not started by BugWiser, or your browser blocked its cookie. Please sign in again.';
    case 'state_expired':
      return 'Your sign-in link expired. Please start again.';
    case 'state_mismatch':
      return 'This sign-in was started in a different browser or profile. Please sign in again here.';
    case 'token_exchange_failed':
      return 'GitHub authorization could not be completed. Please sign in again.';
    case 'identity_failed':
      return 'We could not finish signing you in. Please try again.';
    case 'session_failed':
      return 'We could not create your BugWiser session. Please try again.';
    case 'unexpected':
    default:
      return 'We could not complete GitHub sign-in. Please try again.';
  }
}
