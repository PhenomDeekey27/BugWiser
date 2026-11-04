// Server wiring for the GitHub → BugWiser identity rules.
//
// The matching and retry rules live in `identity-core.ts` so they can be tested
// against an in-memory store; this module only binds them to the Neon adapter.
//
// There is deliberately no user-token storage here any more. The GitHub token
// lives sealed inside the session cookie, which means it exists exactly where it
// is used and cannot go stale relative to a database row.

import {
  deterministicUserId,
  githubProfileMetadata,
  isUsableGitHubId,
  persistIdentityWithStore,
  resolveIdentityWithStore,
  syntheticEmail,
  type GitHubIdentityProfile,
  type IdentityPersistResult,
  type IdentityResolution,
  type IdentityStore,
  type StoreError,
} from './identity-core';
import { createIdentityStore } from './neon-user-store';

export {
  deterministicUserId,
  githubProfileMetadata,
  isUsableGitHubId,
  syntheticEmail,
  type GitHubIdentityProfile,
  type IdentityPersistResult,
  type IdentityResolution,
  type IdentityStore,
  type StoreError,
};

/**
 * Resolves the BugWiser user id for a GitHub account, provisioning the row when
 * this account has never signed in.
 *
 * Never throws and never blocks sign-in: `pending` means "identity verified by
 * GitHub, row not written yet", and the caller stores a session with the
 * deterministic id so the write can be retried later.
 */
export async function resolveGitHubIdentity(
  profile: GitHubIdentityProfile,
  store: IdentityStore = createIdentityStore()
): Promise<IdentityResolution> {
  return resolveIdentityWithStore(profile, store);
}

/** Idempotent retry used after a pending sign-in. */
export async function persistGitHubIdentity(
  profile: GitHubIdentityProfile,
  userId: string,
  store: IdentityStore = createIdentityStore()
): Promise<IdentityPersistResult> {
  return persistIdentityWithStore(profile, userId, store);
}
