-- Rollback for migration 019: idempotent analysis creation.
-- Removes only the index and column added by 019; no analysis rows are deleted.

DROP INDEX IF EXISTS idx_analyses_user_idempotency_key;

ALTER TABLE analyses
  DROP COLUMN IF EXISTS idempotency_key;
