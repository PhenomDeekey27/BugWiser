import { NextResponse } from 'next/server';
import {
  extendSessionCookie,
  readAppSession,
  resealSessionCookie,
  resealSessionWithCredential,
  shouldRefreshSession,
} from '@/lib/auth/session';
import { refreshCredentialIfExpired } from '@/lib/auth/github-token';
import { retryPendingPersistence } from '@/lib/auth/persistence';
import { GitHubError } from '@/lib/github/errors';
import { logAuthFailure, logAuthEvent } from '@/lib/auth/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Session view for the UI, and the one place background session maintenance
 * happens. Never returns tokens.
 *
 * Three maintenance tasks run here, in this order:
 *   1. renew an expiring GitHub credential (no database involved);
 *   2. retry a `users` row write that failed at sign-in time (durable backoff
 *      stored in the cookie, so a cold start cannot lose it);
 *   3. slide the session expiry forward while the user is active.
 */
export async function GET() {
  const original = await readAppSession();
  if (!original) {
    return NextResponse.json(
      { authenticated: false, user: null, github: null },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  }

  let session = original;
  let credentialRefreshed = false;
  let reauthRequired = false;
  let persistenceChanged = false;

  try {
    const refresh = await refreshCredentialIfExpired(session);
    if (refresh.refreshed) {
      session = { ...session, github: refresh.credential };
      credentialRefreshed = true;
    } else if (refresh.reauthRequired) {
      reauthRequired = true;
    }
  } catch (error) {
    // A transient GitHub failure must not sign the user out: keep the session
    // and let the next request try again.
    logAuthFailure('session_read', 'credential_refresh_failed', {
      github_code: error instanceof GitHubError ? error.code : 'unexpected',
    });
  }

  if (!reauthRequired) {
    try {
      const outcome = await retryPendingPersistence(session);
      if (outcome.changed) {
        session = outcome.session;
        persistenceChanged = true;
      }
    } catch (error) {
      logAuthFailure('session_read', 'persistence_retry_failed', {
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  const response = NextResponse.json(
    {
      authenticated: true,
      user: {
        id: session.userId,
        githubUserId: session.githubUserId,
        login: session.login,
        name: session.name,
        avatarUrl: session.avatarUrl,
        authSource: session.source,
      },
      github: {
        connected: session.source === 'github',
        scopes: session.github?.scopes ?? [],
        /** Only a fresh GitHub authorization can fix this. */
        reauthRequired,
        /** False while the `users` row is still waiting to be written. */
        persisted: session.persisted,
        expiresAt: session.github?.expiresAt ?? 0,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );

  if (credentialRefreshed && session.github) {
    resealSessionWithCredential(response, session, session.github);
  } else if (persistenceChanged) {
    resealSessionCookie(response, session);
  } else if (shouldRefreshSession(session)) {
    extendSessionCookie(response, session);
    logAuthEvent('session_read', 'session extended', { user: session.userId });
  }

  return response;
}
