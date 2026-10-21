import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/session';
import {
  completeRelayJob,
  RelayQueueError,
  type RelayJobOutcome,
} from '@/lib/ai/connection/relayQueue';

// Writes the outcome of one executed relay job back for the server poller to
// replay. Authenticated with the BugWiser session cookie; the caller can only
// complete its own jobs. The request payload (headers/body) is scrubbed by
// completeRelayJob, so a local endpoint's optional Authorization header never
// rests in the table.
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { id } = await params;
  if (!id || id.length > 64) {
    return NextResponse.json({ error: 'A valid job id is required' }, { status: 400 });
  }

  let body: Partial<RelayJobOutcome>;
  try {
    body = (await request.json()) as Partial<RelayJobOutcome>;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const result = await completeRelayJob(user.userId, id, body as RelayJobOutcome);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const err = error as Error;
    const kind = error instanceof RelayQueueError ? error.kind : 'storage';
    if (kind === 'unavailable') {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    console.warn('[api/relay/jobs/complete] Error:', err.message);
    return NextResponse.json({ error: 'Could not complete the relay job.' }, { status: 500 });
  }
}
