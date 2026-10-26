// Guest sessions for public repository analysis.
//
// A visitor without a GitHub account still needs a durable owner for the rows
// they create: `analyses.user_id` references `auth.users`. We therefore
// provision a Supabase auth user with the service role and then issue the same
// signed HttpOnly BugWiser cookie a GitHub sign-in uses. The guest:
//
//   * has no GitHub identity, token, or installation,
//   * can only see and act on its own analyses (existing ownership checks),
//   * can never push a branch or open a pull request.

import { randomUUID } from 'node:crypto';
import { createBackgroundClient } from '@/lib/supabase/background';
import {
  getAuthenticatedUser,
  getSessionSecret,
  setSessionCookie,
  type AuthUser,
} from './session';

export interface GuestSessionResult {
  user: AuthUser;
  created: boolean;
}

export class GuestSessionError extends Error {
  code: 'session_secret_missing' | 'provisioning_failed' | 'service_role_missing';

  constructor(message: string, code: GuestSessionError['code']) {
    super(message);
    this.name = 'GuestSessionError';
    this.code = code;
  }
}

/**
 * Creates the backing auth user. Nothing is written to a public schema: this is
 * an ordinary `auth.users` row with guest metadata, deleted by the same cascade
 * as any other user.
 */
export async function provisionGuestUser(): Promise<AuthUser> {
  if (!getSessionSecret()) {
    throw new GuestSessionError(
      'Guest sessions are not configured: set BUGWISER_SESSION_SECRET (at least 32 characters).',
      'session_secret_missing'
    );
  }

  // The service role is required because the visitor is not signed in yet.
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new GuestSessionError(
      'Guest sessions require SUPABASE_SERVICE_ROLE_KEY to provision an owner.',
      'service_role_missing'
    );
  }

  const token = randomUUID().replace(/-/g, '');
  const login = `guest-${token.slice(0, 8)}`;
  const db = createBackgroundClient();

  const { data, error } = await db.auth.admin.createUser({
    email: `${login}@guests.bugwiser.app`,
    email_confirm: true,
    user_metadata: {
      bugwiser_guest: true,
      user_name: login,
      full_name: 'Guest',
    },
  });

  if (error || !data.user) {
    console.error('[auth/guest] Failed to provision guest user:', error?.message);
    throw new GuestSessionError(
      'Could not create a guest session. Try again later.',
      'provisioning_failed'
    );
  }

  return {
    userId: data.user.id,
    githubUserId: null,
    login,
    name: 'Guest',
    avatarUrl: '',
    source: 'guest',
  };
}

/**
 * Returns the caller's identity, upgrading an anonymous visitor to a guest.
 * The caller sets the cookie only when `created` is true.
 */
export async function resolveOrCreateGuest(): Promise<GuestSessionResult> {
  const existing = await getAuthenticatedUser();
  if (existing) return { user: existing, created: false };

  const user = await provisionGuestUser();
  return { user, created: true };
}

export function applyGuestCookie(
  response: Parameters<typeof setSessionCookie>[0],
  user: AuthUser
): void {
  setSessionCookie(response, user);
}
