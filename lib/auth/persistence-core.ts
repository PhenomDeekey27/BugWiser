// Durable retry for "GitHub said yes, but the user row was not written".
//
// THE PROBLEM
// Sign-in must not depend on Neon being awake. So the OAuth callback always
// establishes a session, and the `users`/`github_identities` write is attempted
// afterwards. When that write fails, the session is marked `persisted: false`
// and must be retried later.
//
// WHY THE SCHEDULE LIVES IN THE COOKIE
// Serverless instances are disposable and cold starts forget everything. An
// in-memory queue or an unawaited promise would be lost, and the user would stay
// unpersisted forever. Instead the attempt count and the next allowed attempt
// time are sealed inside the session cookie, so any later request — from any
// instance — continues the same retry schedule:
//
//   attempt 1 → wait 30s → attempt 2 → 60s → 120s … capped at 15 minutes
//
// The user id is deterministic (`uuidv5(github:<id>)`), so a retry after an
// outage writes exactly the row the pending session already refers to, and a
// disabled/racing write still ends with one row.
//
// The store is injected, so these rules are testable without PostgreSQL.
// `persistence.ts` supplies the Neon adapter.

import type { GitHubIdentityProfile, IdentityStore } from './identity-core.ts';
import { persistIdentityWithStore } from './identity-core.ts';
import { logAuthEvent, logAuthFailure } from './log.ts';
import { persistenceBackoffSeconds, type AppSession } from './session-token.ts';

export interface PersistenceOutcome {
  session: AppSession;
  /** True when the session cookie must be re-sealed to store the new state. */
  changed: boolean;
}

export function githubProfileFromSession(
  session: AppSession
): GitHubIdentityProfile | null {
  if (!session.githubUserId) return null;
  const id = Number(session.githubUserId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;

  return {
    id,
    login: session.login,
    name: session.name,
    avatarUrl: session.avatarUrl,
  };
}

/**
 * Attempts the pending write when the backoff schedule allows it.
 *
 * Never throws: a storage problem is recorded in the returned session so the
 * caller can carry on with a working request.
 */
export async function retryPendingPersistenceWithStore(
  session: AppSession,
  store: IdentityStore,
  nowMs: number = Date.now()
): Promise<PersistenceOutcome> {
  if (session.persisted || session.source !== 'github') {
    return { session, changed: false };
  }

  const profile = githubProfileFromSession(session);
  if (!profile) return { session, changed: false };

  const nowSeconds = Math.floor(nowMs / 1000);
  if (session.nextPersistAt > nowSeconds) {
    // Still inside the backoff window: do nothing, keep the schedule.
    return { session, changed: false };
  }

  const result = await persistIdentityWithStore(profile, session.userId, store);

  if (result.status === 'ok') {
    logAuthEvent('persistence', 'identity persisted', {
      user: result.userId,
      attempts: session.persistAttempts,
    });

    return {
      session: {
        ...session,
        userId: result.userId,
        persisted: true,
        persistAttempts: 0,
        nextPersistAt: 0,
      },
      changed: true,
    };
  }

  const attempts = session.persistAttempts + 1;
  const nextPersistAt = nowSeconds + persistenceBackoffSeconds(attempts);

  logAuthFailure('persistence', 'identity still pending', {
    user: session.userId,
    attempts,
    next_attempt_in_seconds: nextPersistAt - nowSeconds,
    error: result.error,
  });

  return {
    session: { ...session, persistAttempts: attempts, nextPersistAt },
    changed: true,
  };
}

/** Whether the session still needs its `users` row written. */
export function needsPersistence(session: AppSession): boolean {
  return !session.persisted && session.source === 'github';
}
