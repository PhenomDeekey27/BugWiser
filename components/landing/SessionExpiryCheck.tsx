'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { fetchAuthSession, invalidateGitHubSession } from '@/lib/auth/client-session';

/**
 * Global session-expiry detector. Mounted once in the root layout so every
 * page shares one detection → invalidation → redirect flow instead of each
 * page improvising.
 *
 * Only a definitive "not authenticated" answer from `/api/auth/session`
 * triggers the flow. A transport failure leaves the session alone, and public
 * pages keep working while signed out.
 */
export function SessionExpiryCheck() {
  const router = useRouter();

  useEffect(() => {
    let alive = true;

    const check = async () => {
      const session = await fetchAuthSession({ force: true });
      if (!alive || !session) return;

      // Signed out on a public page is normal; only a protected page needs the
      // redirect, and the middleware handles that before render.
      const path = window.location.pathname;
      const isProtected =
        path.startsWith('/dashboard') || path.startsWith('/analysis') || path.startsWith('/models');
      if (!session.authenticated && isProtected) {
        void invalidateGitHubSession(router);
      }
    };

    void check();

    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);

    return () => {
      alive = false;
      window.removeEventListener('focus', onFocus);
    };
  }, [router]);

  return null;
}
