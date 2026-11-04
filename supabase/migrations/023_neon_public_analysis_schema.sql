-- Migration 023: Neon-compatible public repository analysis schema.
--
-- Combines the still-missing pieces of migrations 020 and 022 in the required
-- order (020 first, then 022) and removes Supabase-specific RLS policies that
-- depend on auth.uid(), which does not identify BugWiser sessions in Neon.
--
-- Safe to run more than once. Additive only: no existing rows, tables, or
-- constraints are dropped except the two CHECK constraints that are immediately
-- re-added with a superset of their former values (migration 022), and the
-- three ineffective auth.uid()-based policies on analysis_workspace_files.
--
-- Run in the Neon SQL editor (direct, non-pooled endpoint) as the database owner.

-- ── Prerequisites ────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Migration 020: public repositories, pinned commits, workspaces ───────────
ALTER TABLE analyses
  ADD COLUMN IF NOT EXISTS repository_source TEXT NOT NULL DEFAULT 'installation',
  ADD COLUMN IF NOT EXISTS repository_url TEXT,
  ADD COLUMN IF NOT EXISTS repository_branch TEXT,
  ADD COLUMN IF NOT EXISTS repository_default_branch TEXT,
  ADD COLUMN IF NOT EXISTS repository_commit TEXT,
  ADD COLUMN IF NOT EXISTS issue_source TEXT NOT NULL DEFAULT 'github',
  ADD COLUMN IF NOT EXISTS issue_url TEXT,
  ADD COLUMN IF NOT EXISTS issue_description TEXT,
  ADD COLUMN IF NOT EXISTS workspace_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS workspace_staged_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analyses_repository_source_check') THEN
    ALTER TABLE analyses ADD CONSTRAINT analyses_repository_source_check
      CHECK (repository_source IN ('installation', 'public'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analyses_issue_source_check') THEN
    ALTER TABLE analyses ADD CONSTRAINT analyses_issue_source_check
      CHECK (issue_source IN ('github', 'description'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analyses_workspace_status_check') THEN
    ALTER TABLE analyses ADD CONSTRAINT analyses_workspace_status_check
      CHECK (workspace_status IN ('none', 'staged', 'discarded'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'analyses_repository_commit_check') THEN
    ALTER TABLE analyses ADD CONSTRAINT analyses_repository_commit_check
      CHECK (repository_commit IS NULL OR repository_commit ~ '^[0-9a-f]{40}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_analyses_repository_commit
  ON analyses(repository_commit)
  WHERE repository_commit IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analyses_repository_source
  ON analyses(repository_source);

COMMENT ON COLUMN analyses.repository_source IS
  'installation = legacy GitHub App analysis; public = anonymous read of a public repository.';
COMMENT ON COLUMN analyses.repository_commit IS
  'Pinned commit SHA the analysis was generated from. Required for workspace staging.';
COMMENT ON COLUMN analyses.workspace_status IS
  'none | staged | discarded. Workspace files live in analysis_workspace_files.';

CREATE TABLE IF NOT EXISTS analysis_workspace_files (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  analysis_id UUID NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  base_commit TEXT NOT NULL CHECK (base_commit ~ '^[0-9a-f]{40}$'),
  base_content TEXT NOT NULL,
  content TEXT NOT NULL,
  diff TEXT NOT NULL,
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (analysis_id, path)
);

CREATE INDEX IF NOT EXISTS idx_analysis_workspace_files_analysis
  ON analysis_workspace_files(analysis_id);

-- Neon security model: the application connects as the database owner and enforces
-- ownership through user_id filters in server code. RLS is therefore not the
-- authorization boundary here. Keep the table readable/writable only by the
-- owner role; do not install the Supabase auth.uid()-based policies, which
-- cannot identify BugWiser sessions and would deny every row.
ALTER TABLE analysis_workspace_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own workspace files" ON analysis_workspace_files;
DROP POLICY IF EXISTS "Users can insert their own workspace files" ON analysis_workspace_files;
DROP POLICY IF EXISTS "Users can delete their own workspace files" ON analysis_workspace_files;

COMMENT ON TABLE analysis_workspace_files IS
  'Patch applied to the exact source snapshot of one analysis. Never written back to GitHub automatically.';

ALTER TABLE analysis_artifacts
  DROP CONSTRAINT IF EXISTS analysis_artifacts_artifact_type_check;

ALTER TABLE analysis_artifacts
  ADD CONSTRAINT analysis_artifacts_artifact_type_check
  CHECK (artifact_type IN (
    'issue_context',
    'issue_comments',
    'repository_tree',
    'fingerprint',
    'relevant_files',
    'source_files',
    'root_cause',
    'evidence',
    'solution',
    'patch',
    'model_execution',
    'model_selection',
    'repository_context',
    'evidence_verification',
    'verification',
    'workspace'
  ));

-- ── Migration 022: GitHub OAuth App authentication (must run after 020) ──────
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_identity_source_check;

ALTER TABLE users
  ADD CONSTRAINT users_identity_source_check
  CHECK (
    identity_source IS NULL
    OR identity_source IN ('github_app', 'github_oauth', 'guest')
  );

COMMENT ON COLUMN users.identity_source IS
  'github_oauth = OAuth App sign-in; github_app = row migrated from the former App flow; guest = public-only session.';

ALTER TABLE analyses
  DROP CONSTRAINT IF EXISTS analyses_repository_source_check;

ALTER TABLE analyses
  ADD CONSTRAINT analyses_repository_source_check
  CHECK (repository_source IN ('github', 'installation', 'public'));

ALTER TABLE analyses
  ALTER COLUMN repository_source SET DEFAULT 'github';

COMMENT ON COLUMN analyses.repository_source IS
  'github = OAuth-authenticated read with the user token; installation = legacy GitHub App analysis; public = anonymous read of a public repository.';

COMMENT ON TABLE sessions IS
  'Unused since migration 022: sessions are now sealed cookies. Retained for historical data only.';
COMMENT ON TABLE oauth_transactions IS
  'Unused since migration 022: OAuth state is now a signed cookie. Retained for historical data only.';