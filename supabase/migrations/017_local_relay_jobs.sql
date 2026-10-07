-- Migration 017: Browser relay jobs for local-model endpoints.
--
-- A deployed server (Vercel) cannot reach 127.0.0.1 on the user's machine.
-- The relay flips the direction: the server enqueues an HTTP job HERE, the
-- user's open browser tab claims it, performs the request against the local
-- endpoint from the user's own machine, and writes the response back. The
-- server polls the row and replays the response to its own caller.
--
-- Status lifecycle: pending → claimed → done | error (rows also expire via
-- expires_at when no browser tab picks them up).
--
-- RLS: rows are INSERTed only by the server (service role, bypasses RLS).
-- The authenticated browser may read/update/delete only its OWN rows — the
-- update is how a tab atomically claims a job and later writes the response.

CREATE TABLE IF NOT EXISTS local_relay_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'done', 'error')),
  -- Request payload. headers may contain the local endpoint's optional API
  -- key (Authorization); the worker clears headers/body when it completes the
  -- job so credentials do not rest in the table.
  method TEXT NOT NULL DEFAULT 'GET',
  url TEXT NOT NULL,
  headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  body TEXT,
  -- Response payload (written by the worker on completion).
  response_status INTEGER,
  response_headers JSONB,
  response_body TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_local_relay_jobs_user_status
  ON local_relay_jobs(user_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_local_relay_jobs_expires
  ON local_relay_jobs(expires_at);

ALTER TABLE local_relay_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own relay jobs"
  ON local_relay_jobs FOR SELECT
  USING (auth.uid() = user_id);

-- The claim (pending → claimed) and the response write-back are both plain
-- updates of the user's own row; RLS alone serializes competing claims
-- because the worker's UPDATE is guarded by `status = 'pending'` in its WHERE.
CREATE POLICY "Users can update their own relay jobs"
  ON local_relay_jobs FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own relay jobs"
  ON local_relay_jobs FOR DELETE
  USING (auth.uid() = user_id);
