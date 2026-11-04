// Neon wiring for the durable persistence retry.
//
// The retry rules — backoff schedule, idempotent write, never throwing — live in
// `persistence-core.ts` so they can be tested without a database. This module
// only supplies the storage adapter.

import type { IdentityStore } from './identity-core';
import { createIdentityStore } from './neon-user-store';
import {
  retryPendingPersistenceWithStore,
  type PersistenceOutcome,
} from './persistence-core';
import type { AppSession } from './session-token';

export { needsPersistence, githubProfileFromSession } from './persistence-core';
export type { PersistenceOutcome };

export async function retryPendingPersistence(
  session: AppSession,
  options: { store?: IdentityStore; nowMs?: number } = {}
): Promise<PersistenceOutcome> {
  return retryPendingPersistenceWithStore(
    session,
    options.store ?? createIdentityStore(),
    options.nowMs ?? Date.now()
  );
}
