-- Rollback for migration 024. Leaves the legacy patch columns (migration 007/008)
-- intact so an existing fix branch/commit record is not lost.
ALTER TABLE analyses
  DROP CONSTRAINT IF EXISTS analyses_fix_status_check,
  DROP CONSTRAINT IF EXISTS analyses_fix_mode_check;

DROP INDEX IF EXISTS idx_analyses_fix_status;
DROP INDEX IF EXISTS idx_analyses_pull_request_number;

ALTER TABLE analyses
  DROP COLUMN IF EXISTS fix_status,
  DROP COLUMN IF EXISTS fix_mode,
  DROP COLUMN IF EXISTS fix_target_repository,
  DROP COLUMN IF EXISTS fix_target_owner,
  DROP COLUMN IF EXISTS fix_head_repository,
  DROP COLUMN IF EXISTS fix_base_branch,
  DROP COLUMN IF EXISTS fix_base_commit,
  DROP COLUMN IF EXISTS fix_used_fork,
  DROP COLUMN IF EXISTS fix_error,
  DROP COLUMN IF EXISTS fix_updated_at,
  DROP COLUMN IF EXISTS fix_attempts,
  DROP COLUMN IF EXISTS pull_request_number,
  DROP COLUMN IF EXISTS pull_request_state,
  DROP COLUMN IF EXISTS pull_request_created_at;
