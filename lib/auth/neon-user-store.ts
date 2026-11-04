// Neon adapters for the identity storage surface.
//
// Everything here is best-effort by contract: a failure is returned as a
// `StoreError`, never thrown, so the authentication flow can continue with a
// pending session. That is why these rows are written *after* GitHub
// authentication succeeds and never gate it.
//
// Every query carries an explicit `query_timeout` so a suspended Neon compute
// degrades sign-in speed instead of hanging a request.

import type { QueryConfig } from 'pg';
import { getPool } from '@/lib/db/pool';
import {
  githubProfileMetadata,
  isUserId,
  type GitHubIdentityProfile,
  type IdentityStore,
  type StoreError,
} from './identity-core';

/** Time allowed for one identity query. Neon wake-up is seconds, not minutes. */
export const IDENTITY_QUERY_TIMEOUT_MS = 3_000;

interface QueryResult<T> {
  rows: T[];
  error: StoreError | null;
}

function mapError(error: unknown): StoreError {
  const err = error as { message?: string; code?: string };
  return {
    message: err?.message || 'Database query failed',
    code: err?.code,
  };
}

async function query<T>(
  text: string,
  values: unknown[],
  timeoutMs: number = IDENTITY_QUERY_TIMEOUT_MS
): Promise<QueryResult<T>> {
  try {
    const pool = getPool();
    // `query_timeout` is a documented node-postgres option that the bundled
    // type definitions do not declare, hence the intersection cast.
    const config: QueryConfig<unknown[]> & { query_timeout: number } = {
      text,
      values,
      query_timeout: timeoutMs,
    };
    const result = await pool.query(config);
    return { rows: result.rows as T[], error: null };
  } catch (error) {
    return { rows: [], error: mapError(error) };
  }
}

/**
 * Writes `users` and `github_identities` for one GitHub account.
 *
 * Guarantees, all enforced by SQL rather than by a read-then-write race:
 *   * the same GitHub id always resolves to one `users.id`;
 *   * an existing mapping is never repointed (that would orphan analyses);
 *   * calling it twice with the same input changes nothing but display fields.
 */
export function createIdentityStore(): IdentityStore {
  return {
    async lookup(githubUserId) {
      const { rows, error } = await query<{ user_id: string }>(
        'select user_id from github_identities where github_user_id = $1 limit 1',
        [githubUserId]
      );
      if (error) return { userId: null, error };

      const userId = rows[0]?.user_id ?? null;
      // A malformed stored id is treated as "no usable mapping", which forces a
      // re-provision instead of handing an unusable owner to the session.
      return { userId: isUserId(userId) ? userId : null, error: null };
    },

    async provision(profile: GitHubIdentityProfile, userId: string) {
      if (!isUserId(userId)) {
        return { userId: null, error: { message: 'Invalid candidate user id' }, createdUser: false };
      }

      // 1. `users` row. `xmax = 0` distinguishes a real insert from the
      //    conflict branch, which tells us whether we own a disposable row.
      const userWrite = await query<{ inserted: boolean }>(
        `insert into users (id, email, raw_user_meta_data, identity_source)
         values ($1, $2, $3::jsonb, 'github_oauth')
         on conflict (id) do update
           set raw_user_meta_data = excluded.raw_user_meta_data,
               email = coalesce(users.email, excluded.email),
               updated_at = now()
         returning (xmax = 0) as inserted`,
        [
          userId,
          `github-${profile.id}@accounts.bugwiser.invalid`,
          JSON.stringify(githubProfileMetadata(profile)),
        ]
      );

      if (userWrite.error) {
        return { userId: null, error: userWrite.error, createdUser: false };
      }
      const createdUser = userWrite.rows[0]?.inserted === true;

      // 2. Identity mapping. On conflict the login/avatar are refreshed but
      //    `user_id` is left untouched, so the original owner keeps its data.
      const link = await query<{ user_id: string }>(
        `insert into github_identities (github_user_id, user_id, login, avatar_url)
         values ($1, $2, $3, $4)
         on conflict (github_user_id) do update
           set login = excluded.login,
               avatar_url = excluded.avatar_url,
               updated_at = now()
         returning user_id`,
        [profile.id, userId, profile.login, profile.avatarUrl]
      );

      if (link.error) {
        return { userId: null, error: link.error, createdUser };
      }

      const canonical = link.rows[0]?.user_id;
      if (!isUserId(canonical)) {
        return {
          userId: null,
          error: { message: 'Identity write returned no owner' },
          createdUser,
        };
      }

      // Lost a race against an existing mapping: the row we just created owns
      // nothing, so remove it rather than leaving an orphan user behind.
      if (canonical !== userId && createdUser) {
        await query(
          `delete from users u
            where u.id = $1
              and not exists (select 1 from analyses a where a.user_id = u.id)`,
          [userId]
        );
      }

      return { userId: canonical, error: null, createdUser };
    },
  };
}

/**
 * Creates a guest `users` row. Guests exist so public analyses have a durable
 * owner; they have no GitHub identity and no credential.
 */
export async function createGuestUser(row: {
  id: string;
  email: string | null;
  metadata: Record<string, unknown>;
}): Promise<{ error: StoreError | null }> {
  const { error } = await query(
    `insert into users (id, email, raw_user_meta_data, identity_source)
     values ($1, $2, $3::jsonb, 'guest')
     on conflict (id) do nothing`,
    [row.id, row.email, JSON.stringify(row.metadata)]
  );
  return { error };
}

/**
 * Read-only availability probe for diagnostics. Returns a boolean plus a
 * driver message; it never throws, so it cannot break a health endpoint.
 */
export async function probeDatabase(): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await query('select 1 as ok', [], 2_500);
  return { ok: !error, error: error ? error.message : null };
}
