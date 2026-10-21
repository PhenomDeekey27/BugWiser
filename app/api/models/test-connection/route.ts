import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { testLocalConnection } from '@/lib/ai/connection/testConnection';
import { relayEnabledFor, relayProbeDeps } from '@/lib/ai/connection/relay';

// A relayed probe waits up to RELAY_PROBE_FETCH_TIMEOUT_MS for the browser
// tab — give the request headroom beyond platform defaults.
export const maxDuration = 60;

// Task J — server-side "Test Connection" for a local OpenAI-compatible
// endpoint. Authenticated; runs the connection test server-side and returns a
// structured result. This route NEVER persists or registers a provider — a
// failed test cannot create an active provider, and a successful test only
// returns verified information for the UI to subsequently register (through
// the existing provider connection architecture).
//
// The API key (optional) is used only to build the outbound Authorization
// header inside testLocalConnection; it is never logged or echoed back.
//
// Relay: when deployed, the local endpoint is only reachable from the user's
// own machine — relayProbeDeps routes the probe through an open browser tab
// (local_relay_jobs) and the response reports `relayed` so the UI can explain
// why the check takes a moment.

export async function POST(request: Request) {
  try {
    const user = await getAuthenticatedUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let body: { baseUrl?: unknown; apiKey?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { baseUrl, apiKey } = body;
    if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
      return NextResponse.json({ error: 'A base URL is required' }, { status: 400 });
    }
    if (apiKey !== undefined && apiKey !== null && typeof apiKey !== 'string') {
      return NextResponse.json({ error: 'API key must be a string' }, { status: 400 });
    }

    // Structured outcome (success or failure) — the test itself ran, so the
    // result is data: HTTP 200 with success/compatibility/error fields.
    const result = await testLocalConnection(
      {
        baseUrl,
        apiKey: typeof apiKey === 'string' ? apiKey : undefined,
      },
      relayProbeDeps(user.userId, baseUrl)
    );
    // Report the relay decision for the endpoint that was actually tested (the
    // normalized URL — the raw input may be scheme-less).
    const relayed = result.baseUrl ? relayEnabledFor(result.baseUrl) : false;
    return NextResponse.json({ ...result, relayed });
  } catch (error) {
    const err = error as Error;
    console.error('[api/models/test-connection] Error:', err.message);
    return NextResponse.json({ error: 'Failed to test connection' }, { status: 500 });
  }
}
