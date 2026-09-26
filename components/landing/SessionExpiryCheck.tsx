'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { invalidateGitHubSession, isGitHubSessionValid } from '@/lib/supabase/auth-session';

/**
 * Global GitHub-session expiry detector. Mounted once in the root layout so
 * every page (protected and public alike) shares one detection →
 * invalidation → redirect flow instead of each page improvising.
 *
 * Triggers ONLY on a session that exists but no longer carries the GitHub
 * `provider_token` (the canonical condition shared in
 * `lib/supabase/auth-session.ts`). A missing session is a normal signed-out
 * state and is left to the middleware and the pages themselves.
 */
export function SessionExpiryCheck() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    let alive = true;

    const invalidateIfExpired = (session: Parameters<typeof isGitHubSessionValid>[0]) => {
      if (!alive) return;
      // Session exists but lost its GitHub token → expired. No session at
      // all is just "signed out" and must NOT trigger the expiry flow.
      if (session && !isGitHubSessionValid(session)) {
        void invalidateGitHubSession(router);
      }
    };

    supabase.auth.getSession().then(({ data: { session } }) => invalidateIfExpired(session));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // SIGNED_OUT is either the user's own sign-out or the invalidation flow
      // itself — both are already handled; only "session exists but expired"
      // is ours to invalidate.
      if (event === 'SIGNED_OUT') return;
      invalidateIfExpired(session);
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, [router]);

  return null;
}
