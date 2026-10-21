-- Migration 019: idempotent analysis creation.
--
-- A repeated POST /api/analyses for the SAME user intent (double click, client
-- retry after a network error, or a retry after the run request failed) must
-- return the existing analysis instead of inserting a second row.
--
-- Scope is deliberately (user_id, idempotency_key) and NOT repository+issue:
-- a user may intentionally analyze the same issue more than once, and each
-- intentional analysis carries a fresh client-generated key.
--
-- Additive only. Existing rows keep NULL and are unaffected. Rollback:
-- supabase/rollback/019_analysis_idempotency.sql

ALTER TABLE analyses
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

COMMENT ON COLUMN analyses.idempotency_key IS
  'Client-generated key for one analysis-creation operation; NULL on legacy rows. Unique per user.';

-- Partial unique index: only keyed rows participate, so legacy/NULL rows never
-- conflict with each other.
CREATE UNIQUE INDEX IF NOT EXISTS idx_analyses_user_idempotency_key
  ON analyses(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
