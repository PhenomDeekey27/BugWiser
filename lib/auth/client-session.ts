'use client';

import { useEffect, useState } from 'react';

/**
 * Browser-side view of the BugWiser session.
 *
 * The real session is an HttpOnly cookie the browser cannot read, so every
 * check goes through `/api/auth/session`. Tokens (GitHub user tokens,
 * installation tokens, the session itself) are never exposed here.
 */

export interface ClientAuthUser {
  id: string;
  githubUserId: string | null;
  login: string;
  name: string | null;
  avatarUrl: string;
  authSource: 'github_app' | 'supabase';
}

export interface ClientInstallationSummary {
  installationId: number;
  accountLogin: string;
  accountType: string;
  repositorySelection: string | null;
  suspended: boolean;
  htmlUrl: string | null;
}

export interface ClientInstallationStatus {
  configured: boolean;
  installations: ClientInstallationSummary[];
  repositoryCount: number;
  installUrl: string | null;
  manageUrl: string;
  needsInstallation: boolean;
}

export interface ClientAuthSession {
  authenticated: boolean;
  user: ClientAuthUser | null;
  installation: ClientInstallationStatus | null;
}

export const SESSION_EXPIRED_MESSAGE = 'Your GitHub session has expired. Please sign in again.';

/** The session is cheap to check but checked by several components at once. */
const CACHE_TTL_MS = 15_000;
let cached: { session: ClientAuthSession; at: number } | null = null;
let inFlight: Promise<ClientAuthSession | null> | null = null;

/** Fired after sign-in/sign-out so mounted shells update immediately. */
export const AUTH_CHANGED_EVENT = 'bugwiser:auth-changed';

function notifyAuthChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(AUTH_CHANGED_EVENT));
}

export function invalidateAuthCache(): void {
  cached = null;
}

/**
 * Reads the server session. Returns `null` when the state could not be
 * determined (network error, non-2xx) — callers must NOT treat that as
 * "signed out", or a transient failure would log the user out.
 */
export async function fetchAuthSession(options?: {
  force?: boolean;
}): Promise<ClientAuthSession | null> {
  if (!options?.force && cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.session;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const response = await fetch('/api/auth/session', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return null;
      const session = (await response.json()) as ClientAuthSession;
      cached = { session, at: Date.now() };
      return session;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Router surface needed by the redirect flows (structurally typed). */
export type RouterLike = { replace: (href: string) => void; push?: (href: string) => void };

/** Deduplicates concurrent triggers (mount check + API 401 in the same tick). */
let invalidationInFlight = false;

/**
 * Ends the server session and sends the user to the sign-in page. Used for
 * explicit sign-out and for an expired/invalid session.
 */
export async function endSession(router: RouterLike, options?: { expired?: boolean }): Promise<void> {
  if (invalidationInFlight) return;
  invalidationInFlight = true;
  try {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    } catch {
      // Even if the request fails the redirect below is still correct: the
      // server will reject the stale cookie on the next protected request.
    }

    invalidateAuthCache();
    localStorage.removeItem('analysis-selection');
    notifyAuthChanged();

    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/auth/github')) {
      return; // already on the sign-in page — never redirect in a loop
    }

    const query = options?.expired
      ? `?${new URLSearchParams({ error: SESSION_EXPIRED_MESSAGE }).toString()}`
      : '';
    router.replace(`/auth/github${query}`);
  } finally {
    invalidationInFlight = false;
  }
}

/** Expired/invalid session: clear it and go to sign-in with an explanation. */
export async function invalidateGitHubSession(router: RouterLike): Promise<void> {
  await endSession(router, { expired: true });
}

/** Explicit sign-out: clear the session and return to the landing page. */
export async function signOut(router: RouterLike): Promise<void> {
  if (invalidationInFlight) return;
  invalidationInFlight = true;
  try {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    } catch {
      // Ignore; the cookie is cleared server-side when reachable.
    }
    invalidateAuthCache();
    localStorage.removeItem('analysis-selection');
    notifyAuthChanged();

    if (router.push) router.push('/');
    else router.replace('/');
  } finally {
    invalidationInFlight = false;
  }
}

/** Maps the server session onto the display-only viewer shape. */
export function viewerFromSession(session: ClientAuthSession | null): ClientAuthUser | null {
  if (!session?.authenticated) return null;
  return session.user;
}

/**
 * Reports whether the GitHub session is currently valid. Initial value is
 * `true` so a server-rendered shell (which only renders for a session the
 * server already verified) does not flash a signed-out state before
 * hydration. A failed check keeps the current value instead of signing out.
 */
export function useGitHubAuthValidity(): boolean {
  const [valid, setValid] = useState(true);

  useEffect(() => {
    let alive = true;

    const check = async (force: boolean) => {
      const session = await fetchAuthSession({ force });
      if (alive && session) setValid(session.authenticated);
    };

    void check(false);

    const onChanged = () => {
      invalidateAuthCache();
      void check(true);
    };
    window.addEventListener(AUTH_CHANGED_EVENT, onChanged);

    // Re-check when the tab regains focus: cookies can expire while idle.
    const onFocus = () => void check(true);
    window.addEventListener('focus', onFocus);

    return () => {
      alive = false;
      window.removeEventListener(AUTH_CHANGED_EVENT, onChanged);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  return valid;
}
