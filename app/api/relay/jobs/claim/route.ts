import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/session';
import {
  claimNextRelayJob,
  RelayQueueError,
} from '@/lib/ai/connection/relayQueue';

// The relay tab claims ONE job at a time. Authenticated with the BugWiser
// session cookie (the same identity every other API route uses), because the
// browser no longer holds a Supabase Auth session to read the job table with.
// The job is scoped to the caller, so a tab can never claim another user's
// request.
export const dynamic = 'force-dynamic';

export async function POST() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const job = await claimNextRelayJob(user.userId);
    return NextResponse.json(
      { job },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    const err = error as Error;
    const kind = error instanceof RelayQueueError ? error.kind : 'storage';
    if (kind === 'unavailable') {
      // 503: this deployment is missing the relay table; the message says so.
      return NextResponse.json(
        { error: err.message },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    console.warn('[api/relay/jobs/claim] Error:', err.message);
    return NextResponse.json(
      { error: 'Could not claim a relay job.' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
