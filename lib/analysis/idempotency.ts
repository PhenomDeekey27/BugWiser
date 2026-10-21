// Idempotency for analysis creation.
//
// A retry or a double-submitted "Start Analysis" must not create a second
// analysis row for the SAME operation. The key is generated once per user
// intent on the client and stored on the analyses row; the server returns the
// already-created analysis for a repeated key (user + key, never repository +
// issue). Intentional repeat analyses use a fresh key and therefore stay
// separate rows.

export const ANALYSIS_IDEMPOTENCY_HEADER = 'idempotency-key';

const MIN_KEY_LENGTH = 8;
const MAX_KEY_LENGTH = 200;
// UUIDs and opaque client tokens. Deliberately conservative: no whitespace,
// control characters, or SQL-ish punctuation.
const KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;

/**
 * Validates a client-supplied idempotency key. Returns the trimmed key, or
 * null when absent/invalid. Callers MUST reject an invalid supplied key
 * instead of silently creating a non-idempotent row.
 */
export function normalizeAnalysisIdempotencyKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim();
  if (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH) return null;
  if (!KEY_PATTERN.test(key)) return null;
  return key;
}

export interface DatabaseErrorLike {
  code?: string | null;
  message?: string | null;
}

/**
 * Postgres unique violation, as reported by Supabase/PostgREST. Used to turn
 * the loser of a concurrent insert race into the same idempotent response as a
 * sequential retry.
 */
export function isUniqueViolation(error: DatabaseErrorLike | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '23505') return true;
  const message = (error.message ?? '').toLowerCase();
  return (
    message.includes('duplicate key value') ||
    message.includes('unique constraint') ||
    message.includes('unique violation')
  );
}

/** Missing column/table (migration not applied yet) — reported distinctly. */
export function isMissingSchema(error: DatabaseErrorLike | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '42703' || error.code === '42P01') return true;
  const message = (error.message ?? '').toLowerCase();
  if (!message.includes('does not exist')) return false;
  return (
    message.includes('column') ||
    message.includes('relation') ||
    message.includes('table')
  );
}
