// GitHub → BugWiser identity mapping rules.
//
// Two requirements shape this module:
//
//   1. GitHub user id is the only stable account key. A login name can change
//      hands, so it is display data, never a matching key.
//   2. Nothing here may make sign-in fail when PostgreSQL is slow, asleep, or
//      unreachable. Every storage call can degrade to a `pending` result: the
//      caller still gets a usable BugWiser user id and persists later.
//
// The pending id is deterministic — `uuidv5(github:<numeric id>)` — so two
// sign-ins during an outage, and the eventual write when the database is back,
// all address the same `users.id`. That is what makes persistence idempotent and
// prevents duplicate user rows.
//
// No Next.js, `pg`, or environment imports: the rules are unit-testable against
// an in-memory store.

import crypto from 'node:crypto';

export interface GitHubIdentityProfile {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string;
}

export interface StoreError {
  message: string;
  code?: string;
}

/** Storage surface the identity rules need. Implemented once, over Neon. */
export interface IdentityStore {
  /** Current mapping for a GitHub account, or null when this account is new. */
  lookup(
    githubUserId: number
  ): Promise<{ userId: string | null; error: StoreError | null }>;
  /**
   * Idempotently writes `users` + `github_identities` for this account and
   * returns the canonical `users.id`. An existing mapping always wins, so a
   * legacy account keeps its history instead of being re-provisioned.
   */
  provision(
    profile: GitHubIdentityProfile,
    userId: string
  ): Promise<{
    userId: string | null;
    error: StoreError | null;
    /** True when `users` row `userId` was created by this call. */
    createdUser: boolean;
  }>;
}

export type IdentityResolution =
  /** The user row exists in the database under `userId`. */
  | { status: 'ok'; userId: string; persisted: true }
  /** GitHub identity is verified, but persistence must be retried later. */
  | { status: 'pending'; userId: string; error: string }
  /** GitHub returned an unusable account id: fail closed, never sign in. */
  | { status: 'invalid' };

export interface IdentityPersistResult {
  status: 'ok' | 'pending';
  userId: string;
  error?: string;
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  /** Injected for tests so the backoff does not slow the suite down. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Fixed namespace for BugWiser user ids: `uuidv5(DNS, 'bugwiser.local/user')`,
 * reproducible with `uuidv5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'bugwiser.local/user')`.
 * It must never change — sessions minted during an outage already carry ids from
 * it, and the database later stores the same value.
 */
export const BUGWISER_USER_NAMESPACE = 'ea51d9e6-6b67-5b63-be8d-bb92f80d5a01';

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The only accepted form of a GitHub account id. */
export function isUsableGitHubId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** RFC 2606 reserved TLD: can never be delivered and is not a contact address. */
export function syntheticEmail(githubUserId: number): string {
  return `github-${githubUserId}@accounts.bugwiser.invalid`;
}

/** RFC 4122 version 5 UUID: stable for the same GitHub account, forever. */
export function deterministicUserId(githubUserId: number): string {
  const namespace = Buffer.from(BUGWISER_USER_NAMESPACE.replace(/-/g, ''), 'hex');
  const name = Buffer.from(`github:${githubUserId}`, 'utf8');
  const digest = crypto.createHash('sha1').update(Buffer.concat([namespace, name])).digest();

  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant

  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

export function isUserId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 16 && value.length <= 64;
}

/**
 * Identity metadata mirrored onto `users.raw_user_meta_data`. It keeps the
 * `sub`/`provider_id` GitHub id that rows migrated from the former Supabase Auth
 * table already carried, so old and new rows stay recognisable.
 */
export function githubProfileMetadata(profile: GitHubIdentityProfile): Record<string, unknown> {
  return {
    sub: String(profile.id),
    provider_id: String(profile.id),
    provider: 'github',
    user_name: profile.login,
    preferred_username: profile.login,
    full_name: profile.name,
    avatar_url: profile.avatarUrl,
    bugwiser_identity: 'github_oauth',
  };
}

const RETRYABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'EPIPE',
  // PostgreSQL class 08 (connection exception) and transient server states.
  '08000',
  '08001',
  '08003',
  '08006',
  '57P01',
  '57P02',
  '57P03',
  '53300',
  '55P03',
  '40001',
]);

const RETRYABLE_MESSAGE = /timeout|timed out|terminated|connection|connect |socket|network|starting up|shutting down|too many clients|query_timeout/i;

/** Distinguishes "Neon is asleep" from "this write can never succeed". */
export function isRetryableStoreError(error: StoreError | null | undefined): boolean {
  if (!error) return false;
  if (error.code && RETRYABLE_CODES.has(error.code)) return true;
  return RETRYABLE_MESSAGE.test(error.message || '');
}

/**
 * Runs a storage call with bounded retries and exponential backoff. It never
 * retries a non-transient error (for example a duplicate key), so a real
 * problem is reported immediately instead of being masked by delays.
 */
export async function withStoreRetry<T extends { error: StoreError | null }>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 2);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 300);
  const sleep = options.sleep ?? defaultSleep;

  let result = await operation();
  for (let attempt = 1; attempt < attempts; attempt++) {
    if (!isRetryableStoreError(result.error)) return result;
    await sleep(baseDelayMs * 2 ** (attempt - 1));
    result = await operation();
  }
  return result;
}

function errorMessage(error: StoreError): string {
  // Codes only: the driver message may contain host/database details.
  return error.code ? `storage_error:${error.code}` : 'storage_error';
}

/**
 * Resolves the BugWiser user id for a verified GitHub profile.
 *
 * Never throws: a storage failure degrades to `pending` with the deterministic
 * id, so the caller can establish a session and retry persistence later.
 */
export async function resolveIdentityWithStore(
  profile: GitHubIdentityProfile,
  store: IdentityStore,
  options: RetryOptions = {}
): Promise<IdentityResolution> {
  if (!isUsableGitHubId(profile.id)) return { status: 'invalid' };

  const fallbackId = deterministicUserId(profile.id);
  const lookup = await withStoreRetry(() => store.lookup(profile.id), options);

  if (lookup.error) return { status: 'pending', userId: fallbackId, error: errorMessage(lookup.error) };
  if (isUserId(lookup.userId)) return { status: 'ok', userId: lookup.userId, persisted: true };

  const provisioned = await withStoreRetry(
    () => store.provision(profile, fallbackId),
    options
  );

  if (provisioned.error || !isUserId(provisioned.userId)) {
    return {
      status: 'pending',
      userId: fallbackId,
      error: provisioned.error ? errorMessage(provisioned.error) : 'storage_error',
    };
  }

  return { status: 'ok', userId: provisioned.userId, persisted: true };
}

/**
 * Idempotent "write the user down" used for retries after a pending sign-in.
 * The canonical id returned may differ from `userId` when a concurrent (or
 * legacy) mapping already owns this GitHub account; callers must adopt it.
 */
export async function persistIdentityWithStore(
  profile: GitHubIdentityProfile,
  userId: string,
  store: IdentityStore,
  options: RetryOptions = {}
): Promise<IdentityPersistResult> {
  if (!isUsableGitHubId(profile.id)) {
    return { status: 'pending', userId, error: 'invalid_github_id' };
  }

  const provisioned = await withStoreRetry(() => store.provision(profile, userId), options);

  if (provisioned.error || !isUserId(provisioned.userId)) {
    return {
      status: 'pending',
      userId,
      error: provisioned.error ? errorMessage(provisioned.error) : 'storage_error',
    };
  }

  return { status: 'ok', userId: provisioned.userId };
}
