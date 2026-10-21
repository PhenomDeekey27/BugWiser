import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/session';
import {
  discardExpiredRelayJobs,
  RelayQueueError,
} from '@/lib/ai/connection/relayQueue';

// Housekeeping for the relay tab: delete this user's expired jobs. Authenticated
// with the BugWiser session cookie and scoped to the caller. Replaces the
// Supabase-Auth-based cleanup the worker used to run (a session that no longer
// exists after the GitHub App sign-in migration).
export const dynamic = 'force-dynamic';

export async function POST() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const removed = await discardExpiredRelayJobs(user.userId);
    return NextResponse.json(
      { ok: true, removed },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const err = error as Error;
    const kind = error instanceof RelayQueueError ? error.kind : 'storage';
    if (kind === 'unavailable') {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    console.warn('[api/relay/jobs/cleanup] Error:', err.message);
    return NextResponse.json({ error: 'Could not clean up relay jobs.' }, { status: 500 });
  }
}
