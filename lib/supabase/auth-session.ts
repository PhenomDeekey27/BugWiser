'use client';

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

/**
 * Canonical GitHub-session predicate — the single source of truth for
 * "is the BugWiser GitHub session still valid?".
 *
 * This is the exact condition the GitHub API routes already use to answer
 * 401 (`app/api/github/repos` / `app/api/github/issues`: session exists but
 * no `provider_token`), the dashboard's token-expiry check, and the original
 * SessionExpiryCheck. Supabase emits `provider_token` only once, right after
 * the OAuth sign-in, so its absence means the GitHub connection can no longer
 * be used and the user must reconnect.
 *
 * Deliberately narrow: a missing Supabase session (signed out) is NOT an
 * "expired" condition — it is simply signed-out. GitHub rate limits, repo
 * 404s, permission errors, network failures, and 5xx responses are NOT
 * session invalidation.
 */
export function isGitHubSessionValid(session: Pick<Session, 'provider_token'> | null | undefined): boolean {
  return !!session?.provider_token;
}

export const SESSION_EXPIRED_MESSAGE = 'Your GitHub session has expired. Please sign in again.';

/** Router surface needed by the invalidation flow (structurally typed so this
 * module can be used from any client component using `useRouter()`). */
type RouterLike = { replace: (href: string) => void };

/** Deduplicates concurrent invalidation triggers (mount check + auth event +
 * API 401 can fire in the same tick). */
let invalidationInFlight = false;

/**
 * The one and only GitHub-session invalidation flow:
 *
 *   session invalid
 *     → clear global auth state (Supabase signOut + local cached selection)
 *     → redirect to /auth/github with the existing `error` query message
 *
 * Loop safety: when already on /auth/github the state is cleared but no
 * redirect happens; after signOut there is no session, so every expiry
 * predicate in the app becomes false. Nothing else is touched — model
 * preferences, AI provider connections, and user data are not modified.
 */
export async function invalidateGitHubSession(router: RouterLike): Promise<void> {
  if (invalidationInFlight) return;
  invalidationInFlight = true;
  try {
    const supabase = createClient();
    await supabase.auth.signOut();
    localStorage.removeItem('analysis-selection');

    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/auth/github')) {
      return; // already on the auth page — cleared, never redirect again
    }

    const params = new URLSearchParams({ error: SESSION_EXPIRED_MESSAGE });
    router.replace(`/auth/github?${params.toString()}`);
  } finally {
    invalidationInFlight = false;
  }
}

/**
 * Subscribes to the canonical auth session and reports whether the GitHub
 * session is currently valid. Initial value is `true` so server-rendered
 * shells (which only render for a session the server already verified) do
 * not flash an unauthenticated state before hydration.
 *
 * Used by the global header/sidebar so they react to the SAME session state
 * the expiry detector uses — clearing stale username/avatar/"GitHub
 * Connected" the moment the session becomes invalid (including
 * TOKEN_REFRESHED, after which Supabase no longer carries provider_token).
 */
export function useGitHubAuthValidity(): boolean {
  const [valid, setValid] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    let alive = true;

    const evaluate = (session: Session | null) => {
      if (alive) setValid(isGitHubSessionValid(session));
    };

    supabase.auth.getSession().then(({ data: { session } }) => evaluate(session));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        // Manual sign-out or the invalidation flow itself — either way the
        // session is gone; never treat it as an "expiry" trigger here.
        if (alive) setValid(false);
        return;
      }
      evaluate(session);
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  return valid;
}
