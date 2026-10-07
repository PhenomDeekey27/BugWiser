'use client';

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { executeRelayJob } from '@/lib/ai/connection/relayJobs';

// Browser relay worker — the OTHER half of lib/ai/connection/relay.ts.
//
// A deployed server cannot reach 127.0.0.1 on the user's machine, so the
// server enqueues an HTTP job in `local_relay_jobs`; this component (mounted
// once in the root layout) runs the user's OWN browser tab against the local
// endpoint and writes the response back for the server to replay.
//
// Loop per tick: getSession → pick the oldest pending, unexpired, OWN job →
// atomically claim it (`status: pending` guard — two open tabs cannot both
// win) → execute it (lib/ai/connection/relayJobs.ts) → write the outcome back
// while SCRUBBING the request payload (headers/body never rest in the row).
//
// Cadence: fast (ACTIVE_POLL_MS) while jobs are flowing; backs off to a few
// seconds when idle so an open tab costs ~one cheap query every few seconds.
// Every CLEANUP_INTERVAL ticks, this tab deletes its own expired rows — no
// janitor process needed. Signed-out tabs (and SSR) do nothing.

const ACTIVE_POLL_MS = 600;
const IDLE_POLL_MS = 4_000;
const IDLE_MAX_MS = 8_000;
const CLEANUP_INTERVAL_TICKS = 30;

export function LocalRelayWorker() {
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      });

    async function claimAndRun(): Promise<boolean> {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session || cancelled) return false;

      const { data: pending, error } = await supabase
        .from('local_relay_jobs')
        .select('id, method, url, headers, body, expires_at, attempts, created_at')
        .eq('user_id', session.user.id)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: true })
        .limit(1);
      if (error) {
        console.warn('[relay-worker] poll failed:', error.message);
        return false;
      }
      const job = pending?.[0];
      if (!job) return false;

      // Atomic claim: only one tab flips pending → claimed for this row.
      const { data: claimed } = await supabase
        .from('local_relay_jobs')
        .update({
          status: 'claimed',
          claimed_at: new Date().toISOString(),
          attempts: (job.attempts ?? 0) + 1,
        })
        .eq('id', job.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();
      if (!claimed) return true; // another tab won it — there IS work, just not ours

      const outcome = await executeRelayJob({
        id: job.id,
        method: job.method,
        url: job.url,
        headers: (job.headers ?? {}) as Record<string, string>,
        body: job.body,
        expires_at: job.expires_at,
      });

      const patch = outcome.ok
        ? {
            status: 'done',
            response_status: outcome.status,
            response_headers: outcome.headers,
            response_body: outcome.body,
            error: null,
          }
        : {
            status: 'error',
            response_status: null,
            response_headers: null,
            response_body: null,
            error: outcome.error,
          };
      // Request payload is scrubbed on EVERY completion — a local endpoint's
      // optional Authorization header must not outlive the job.
      const { error: writeError } = await supabase
        .from('local_relay_jobs')
        .update({ ...patch, headers: {}, body: null, completed_at: new Date().toISOString() })
        .eq('id', job.id)
        .eq('user_id', session.user.id);
      if (writeError) console.warn('[relay-worker] write-back failed:', writeError.message);
      return true;
    }

    async function cleanupExpired(): Promise<void> {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session || cancelled) return;
      // Rows past expires_at are never read again (the server's poll deadline
      // sits ~30s before expiry), so deleting them is safe.
      const { error } = await supabase
        .from('local_relay_jobs')
        .delete()
        .eq('user_id', session.user.id)
        .lt('expires_at', new Date().toISOString());
      if (error) console.warn('[relay-worker] cleanup failed:', error.message);
    }

    async function run(): Promise<void> {
      let delay = ACTIVE_POLL_MS;
      let idleStreak = 0;
      let sinceCleanup = 0;
      while (!cancelled) {
        try {
          const didWork = await claimAndRun();
          if (didWork) {
            idleStreak = 0;
            delay = ACTIVE_POLL_MS;
          } else {
            idleStreak++;
            delay = Math.min(IDLE_MAX_MS, IDLE_POLL_MS + (idleStreak - 1) * 2_000);
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
