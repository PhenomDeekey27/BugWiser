// Guest sessions for public repository analysis.
//
// A visitor without a GitHub account still needs a durable owner for the rows
// they create: `analyses.user_id` references `users.id`. A guest is therefore an
// ordinary `users` row with `identity_source = 'guest'`, provisioned in Neon with
// an app-generated UUID, and the same sealed HttpOnly BugWiser session cookie a
// GitHub sign-in uses.
//
//   * no GitHub identity, token, or repository access,
//   * can only see and act on its own analyses (existing ownership checks),
//   * can never push a branch or open a pull request.
//
// Unlike a GitHub sign-in, guest provisioning has no separate authority to fall
// back on: the row IS the identity. When Neon is unreachable the request fails
// cleanly and the visitor can retry — no half-created session is ever issued.

import { randomUUID } from 'node:crypto';
import { getAuthenticatedUser, getSessionSecret, type AuthUser } from './session';
import { createGuestUser } from './neon-user-store';

export interface GuestSessionResult {
  user: AuthUser;
  created: boolean;
}

export class GuestSessionError extends Error {
  code: 'session_secret_missing' | 'provisioning_failed';

  constructor(message: string, code: GuestSessionError['code']) {
    super(message);
    this.name = 'GuestSessionError';
    this.code = code;
  }
}

export interface GuestProfile {
  userId: string;
  login: string;
  email: string | null;
  metadata: Record<string, unknown>;
}

/** Pure: the identity a guest session is given. `email` stays null on purpose. */
export function buildGuestProfile(nonce: string = randomUUID()): GuestProfile {
  const compact = nonce.replace(/-/g, '');
  const login = `guest-${compact.slice(0, 8)}`;
  return {
    userId: nonce,
    login,
    email: null,
    metadata: {
      bugwiser_guest: true,
      user_name: login,
      full_name: 'Guest',
    },
  };
}

export async function provisionGuestUser(): Promise<AuthUser> {
  if (!getSessionSecret()) {
    throw new GuestSessionError(
      'Guest sessions are not configured: set BUGWISER_SESSION_SECRET (at least 32 characters).',
      'session_secret_missing'
    );
  }

  const profile = buildGuestProfile();
  const { error } = await createGuestUser({
    id: profile.userId,
    email: profile.email,
    metadata: profile.metadata,
  });

  if (error) {
    console.error('[auth/guest] Failed to provision guest user:', error.message);
    throw new GuestSessionError(
      'Could not create a guest session. Try again later.',
      'provisioning_failed'
    );
  }

  return {
    userId: profile.userId,
    githubUserId: null,
    login: profile.login,
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
