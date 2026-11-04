-- Migration 024: persisted state for the approved-patch → branch → push → PR workflow.
--
-- Why this exists:
--   The former GitHub App design could push with an installation token, so the
--   only record it needed was `patch_status` / `created_branch` / `commit_sha`
--   (migration 007) and `pull_request_url` (migration 008). With GitHub OAuth the
--   write can be refused, forked, or fail at any one of several GitHub calls, and
--   the workflow must survive a refresh and an authorization redirect. That needs
--   an explicit status plus the repository the branch actually went to.
--
-- Additive only, idempotent, safe to run more than once.
-- Rollback: supabase/rollback/024_fix_workflow.sql

ALTER TABLE analyses
  ADD COLUMN IF NOT EXISTS fix_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS fix_mode TEXT,
  ADD COLUMN IF NOT EXISTS fix_target_repository TEXT,
  ADD COLUMN IF NOT EXISTS fix_target_owner TEXT,
  ADD COLUMN IF NOT EXISTS fix_head_repository TEXT,
  ADD COLUMN IF NOT EXISTS fix_base_branch TEXT,
  ADD COLUMN IF NOT EXISTS fix_base_commit TEXT,
  ADD COLUMN IF NOT EXISTS fix_used_fork BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS fix_error TEXT,
  ADD COLUMN IF NOT EXISTS fix_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fix_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pull_request_number INTEGER,
  ADD COLUMN IF NOT EXISTS pull_request_state TEXT,
  ADD COLUMN IF NOT EXISTS pull_request_created_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analyses_fix_status_check') THEN
    ALTER TABLE analyses ADD CONSTRAINT analyses_fix_status_check
      CHECK (fix_status IN (
        'none',
        'awaiting_authorization',
        'branch_creating',
        'branch_created',
        'committing',
        'committed',
        'pushing',
        'pushed',
        'creating_pr',
        'pr_created',
        'pr_failed',
        'failed'
      ));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analyses_fix_mode_check') THEN
    ALTER TABLE analyses ADD CONSTRAINT analyses_fix_mode_check
      CHECK (fix_mode IS NULL OR fix_mode IN ('branch', 'pull_request'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_analyses_fix_status
  ON analyses(fix_status)
  WHERE fix_status <> 'none';

CREATE INDEX IF NOT EXISTS idx_analyses_pull_request_number
  ON analyses(pull_request_number)
  WHERE pull_request_number IS NOT NULL;

COMMENT ON COLUMN analyses.fix_status IS
  'Last confirmed stage of the fix workflow. Resumable: a refresh reads this and continues.';
COMMENT ON COLUMN analyses.fix_target_repository IS
  'Repository the fix branch was pushed to (a fork when the user had no upstream write access).';
COMMENT ON COLUMN analyses.fix_head_repository IS
  'Repository that owns the pull-request head branch: owner:branch is built from it.';
COMMENT ON COLUMN analyses.fix_base_branch IS
  'Base branch the fix branch was cut from and the PR targets.';
COMMENT ON COLUMN analyses.fix_base_commit IS
  'Exact commit the fix branch started from.';
COMMENT ON COLUMN analyses.fix_used_fork IS
  'True when the branch lives on the user''s fork and the PR targets the upstream repository.';
COMMENT ON COLUMN analyses.fix_attempts IS
  'Number of push attempts, so a retry can be shown without guessing.';
COMMENT ON COLUMN analyses.pull_request_number IS
  'GitHub pull request number, only set after GitHub confirms creation.';
