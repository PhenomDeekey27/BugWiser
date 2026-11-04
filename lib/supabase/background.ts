// Background/service-role database client.
//
// Application tables live in Neon PostgreSQL, so this returns the Neon client.
// The exported name is unchanged because every server module imports it as the
// "trusted, server-only" client (it ran with the Supabase service role before,
// bypassing RLS; it now connects as the Neon owner role). Ownership is enforced
// by the `user_id` filters in the callers, exactly as before.
//
// Supabase is no longer used anywhere in this application: GitHub
// authentication and user provisioning are handled by lib/auth/identity.ts and
// lib/auth/neon-user-store.ts. Sessions are sealed cookies, so they never reach
// this client at all. This module keeps its old name so the existing call sites
// did not change.

import { createDbClient } from '@/lib/db/client';

export function createBackgroundClient() {
  return createDbClient();
}
