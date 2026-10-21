'use client';

import { useEffect } from 'react';
import { executeRelayJob } from '@/lib/ai/connection/relayJobs';

// Browser relay worker — the OTHER half of lib/ai/connection/relay.ts.
//
// A deployed server cannot reach 127.0.0.1 on the user's machine, so the
// server enqueues an HTTP job in `local_relay_jobs`; this component (mounted
// once in the root layout) runs the user's OWN browser tab against the local
// endpoint and writes the response back for the server to replay.
//
// AUTH: the tab talks to same-origin API routes (/api/relay/jobs/*) which are
// authenticated by the BugWiser session cookie. It used to query Supabase
// directly with `supabase.auth.getSession()`, but sign-in moved to a GitHub App
// signed cookie — there is no Supabase Auth session in the browser, so those
// queries returned nothing and every relayed request timed out. The API routes
// scope every read/write to the signed-in user; the browser never sees the
// service role or the job table.
//
// Loop per tick: claim → execute (lib/ai/connection/relayJobs.ts) → write the
// outcome back (the route scrubs the request payload). Cadence is fast while
// jobs flow and backs off when idle. Signed-out tabs do nothing.
// Every CLEANUP_INTERVAL ticks this tab deletes its own expired rows.

const ACTIVE_POLL_MS = 600;
const IDLE_POLL_MS = 2_000;
const IDLE_MAX_MS = 5_000;
// A signed-out or misconfigured deployment must not hammer the endpoint.
const SUPPRESSED_POLL_MS = 30_000;
const CLEANUP_INTERVAL_TICKS = 30;

const CLAIM_URL = '/api/relay/jobs/claim';
const CLEANUP_URL = '/api/relay/jobs/cleanup';

type TickResult = 'worked' | 'idle' | 'suppressed';

async function postJson(url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    credentials: 'same-origin',
    cache: 'no-store',
  });
}

export function LocalRelayWorker() {
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      });

    async function claimAndRun(): Promise<TickResult> {
      let response: Response;
      try {
        response = await postJson(CLAIM_URL);
      } catch {
        return 'idle';
      }
      // 401: no BugWiser session (signed out) — nothing to do until sign-in.
      // 503: relay storage unavailable on this deployment — back off, do not
      // spam. Both are quiet: the UI surfaces connection problems when the
      // user actually asks for one.
      if (response.status === 401 || response.status === 403) return 'suppressed';
      if (response.status === 503) return 'suppressed';
      if (!response.ok) return 'idle';

      const payload = (await response.json().catch(() => null)) as {
        job?: {
          id: string;
          method: string;
          url: string;
          headers: Record<string, string> | null;
          body: string | null;
          expires_at: string;
        } | null;
      } | null;
      const job = payload?.job;
      if (!job) return 'idle';

      const outcome = await executeRelayJob({
        id: job.id,
        method: job.method,
        url: job.url,
        headers: job.headers,
        body: job.body,
        expires_at: job.expires_at,
      });

      try {
        await postJson(
          `/api/relay/jobs/${encodeURIComponent(job.id)}/complete`,
          outcome
        );
      } catch {
        // The server's poller will time the job out; its message covers this.
      }
      return 'worked';
    }

    async function cleanupExpired(): Promise<void> {
      try {
        await postJson(CLEANUP_URL);
      } catch {
        // Best effort: expired rows are ignored by every reader anyway.
      }
    }

    async function run(): Promise<void> {
      let delay = ACTIVE_POLL_MS;
      let idleStreak = 0;
      let sinceCleanup = 0;
      while (!cancelled) {
        let result: TickResult = 'idle';
        try {
          result = await claimAndRun();
          if (result === 'worked') {
            idleStreak = 0;
            delay = ACTIVE_POLL_MS;
          } else if (result === 'suppressed') {
            delay = SUPPRESSED_POLL_MS;
          } else {
            idleStreak++;
            delay = Math.min(IDLE_MAX_MS, IDLE_POLL_MS + (idleStreak - 1) * 1_000);
          }
          if (++sinceCleanup >= CLEANUP_INTERVAL_TICKS) {
            sinceCleanup = 0;
            await cleanupExpired();
          }
        } catch (err) {
          console.warn('[relay-worker] tick failed:', err);
          delay = IDLE_MAX_MS;
        }
        if (cancelled) return;
        await sleep(delay);
      }
    }

    void run();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return null;
}
