// Server-side storage boundary for browser-relay jobs (local_relay_jobs).
//
// WHY THIS EXISTS SEPARATELY FROM relay.ts:
// relay.ts owns the enqueue → poll → replay loop and runs with the service
// role. The OTHER half runs in the user's browser tab. That tab used to claim
// jobs straight from Supabase with a Supabase Auth session, but BugWiser now
// signs users in with a GitHub App and an HttpOnly signed cookie — there is no
// Supabase session in the browser any more, so those queries returned nothing
// and every relayed probe timed out.
//
// The browser therefore talks to same-origin API routes (app/api/relay/jobs/*)
// authenticated by the SAME session cookie every other API route uses. Those
// routes call this module, which reads/writes the table with the service role
// exactly like relay.ts does. RLS stays as the second line of defence; the
// service role never reaches the browser.
//
// Security:
//   - every query is scoped by user_id (a tab can only ever see its own jobs);
//   - the claim is an atomic pending → claimed update, so two tabs cannot both
//     execute the same job;
//   - completing a job SCRUBS the request headers/body, so a local endpoint's
//     optional Authorization header never rests in the table;
//   - response payloads are size-capped before they are stored.

import { createBackgroundClient } from '@/lib/supabase/background';

/** Columns the worker needs to execute a job (never secrets metadata). */
export const RELAY_JOB_COLUMNS =
  'id, method, url, headers, body, expires_at, attempts, created_at';

/** Hard cap on a relayed response body stored for replay. */
export const MAX_RELAY_RESPONSE_BYTES = 4 * 1024 * 1024;
/** Hard cap on a relayed response header map / error message. */
const MAX_RELAY_HEADERS = 100;
const MAX_RELAY_ERROR_CHARS = 2_000;

export interface ClaimedRelayJob {
  id: string;
  method: string;
  url: string;
  headers: Record<string, string> | null;
  body: string | null;
  expires_at: string;
  attempts: number;
  created_at: string;
}

export type RelayJobOutcome =
  | { ok: true; status: number; headers: Record<string, string>; body: string }
  | { ok: false; error: string };

export type RelayQueueErrorKind = 'unavailable' | 'storage';

export class RelayQueueError extends Error {
  readonly kind: RelayQueueErrorKind;
  constructor(kind: RelayQueueErrorKind, message: string) {
    super(message);
    this.name = 'RelayQueueError';
    this.kind = kind;
  }
}

type Db = ReturnType<typeof createBackgroundClient>;

/** Missing table/index (migration 017 not applied) reads as "unavailable". */
function isMissingRelayStorage(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42P01') return true;
  const message = error.message ?? '';
  return /relation .*local_relay_jobs.* does not exist/i.test(message);
}

function queueError(action: string, error: { code?: string; message?: string } | null): RelayQueueError {
  if (isMissingRelayStorage(error)) {
    return new RelayQueueError(
      'unavailable',
      'Local-model relay storage is not available on this deployment. Apply migration 017_local_relay_jobs.sql and try again.'
    );
  }
  console.warn(`[relay-queue] ${action} failed:`, error?.message ?? 'unknown error');
  return new RelayQueueError('storage', 'Could not reach the local-model relay — please try again.');
}

/**
 * Claim the oldest pending, unexpired job for this user. Returns null when
 * there is nothing to run. The second update is guarded by `status = 'pending'`,
 * so a concurrent tab that claimed the same row first leaves us retrying with
 * the next oldest job instead of executing it twice.
 */
export async function claimNextRelayJob(
  userId: string,
  dbOverride?: Db
): Promise<ClaimedRelayJob | null> {
  const db = dbOverride ?? createBackgroundClient();

  for (let attempt = 0; attempt < 3; attempt++) {
    const now = new Date().toISOString();
    const { data, error } = await db
      .from('local_relay_jobs')
      .select(RELAY_JOB_COLUMNS)
      .eq('user_id', userId)
      .eq('status', 'pending')
      .gt('expires_at', now)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) throw queueError('claim read', error);
    if (!data) return null;

    const row = data as ClaimedRelayJob;
    const { data: claimed, error: claimError } = await db
      .from('local_relay_jobs')
      .update({
        status: 'claimed',
        claimed_at: new Date().toISOString(),
        attempts: (row.attempts ?? 0) + 1,
      })
      .eq('id', row.id)
      .eq('user_id', userId)
      .eq('status', 'pending')
      .select(RELAY_JOB_COLUMNS)
      .maybeSingle();

    if (claimError) throw queueError('claim update', claimError);
    if (claimed) return claimed as ClaimedRelayJob;
    // Lost the race with another tab — look for the next pending job.
  }

  return null;
}

export type NormalizedRelayOutcome =
  | { ok: true; patch: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Validate and shape a worker-reported outcome before persisting it. Keeps the
 * replay side's guarantees (legal status, string headers, cap on payload) on
 * the write path too, so a broken tab cannot store a Response the server would
 * refuse to rebuild.
 */
export function normalizeRelayOutcome(outcome: RelayJobOutcome): NormalizedRelayOutcome {
  if (!outcome || typeof outcome !== 'object') {
    return { ok: false, error: 'A relay outcome object is required.' };
  }

  if (!outcome.ok) {
    const message = typeof outcome.error === 'string' ? outcome.error.trim() : '';
    return {
      ok: true,
      patch: {
        status: 'error',
        response_status: null,
        response_headers: null,
        response_body: null,
        error: (message || 'The browser relay failed to reach the endpoint.').slice(
          0,
          MAX_RELAY_ERROR_CHARS
        ),
      },
    };
  }

  const status = outcome.status;
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 100 || status > 599) {
    return { ok: false, error: 'The relayed response status is invalid.' };
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(outcome.headers ?? {}).slice(0, MAX_RELAY_HEADERS)) {
    if (typeof value === 'string') headers[name] = value;
  }

  const body = typeof outcome.body === 'string' ? outcome.body : '';
  if (body.length > MAX_RELAY_RESPONSE_BYTES) {
    return { ok: false, error: 'The relayed response was too large.' };
  }

  return {
    ok: true,
    patch: {
      status: 'done',
      response_status: status,
      response_headers: headers,
      response_body: body,
      error: null,
    },
  };
}

/**
 * Write the worker's outcome back and scrub the request payload. Scoped by
 * user_id so a tab can only ever complete its own job. Returns false when no
 * row matched (expired/removed/already completed) — the server's poller treats
 * that as a lost job and reports the expiry guidance.
 */
export async function completeRelayJob(
  userId: string,
  jobId: string,
  outcome: RelayJobOutcome,
  dbOverride?: Db
): Promise<{ ok: boolean; error?: string }> {
  const normalized = normalizeRelayOutcome(outcome);
  if (!normalized.ok) return { ok: false, error: normalized.error };

  const db = dbOverride ?? createBackgroundClient();
  const { data, error } = await db
    .from('local_relay_jobs')
    .update({
      ...normalized.patch,
      headers: {},
      body: null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();

  if (error) throw queueError('complete', error);
  return data ? { ok: true } : { ok: false, error: 'That relay job is no longer available.' };
}

/**
 * Delete this user's expired rows. Rows past expires_at are never read again
 * (the server's poll deadline sits ~30s before expiry), so deleting them is
 * safe and keeps the table from growing without a janitor process.
 */
export async function discardExpiredRelayJobs(
  userId: string,
  dbOverride?: Db
): Promise<number> {
  const db = dbOverride ?? createBackgroundClient();
  const { data, error } = await db
    .from('local_relay_jobs')
    .delete()
    .eq('user_id', userId)
    .lt('expires_at', new Date().toISOString())
    .select('id');

  if (error) throw queueError('cleanup', error);
  return Array.isArray(data) ? data.length : 0;
}
