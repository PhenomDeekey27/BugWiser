-- Migration 020: public repositories, pinned commits, and isolated workspaces.
--
-- Additive only. Existing analyses are 'installation' rows and keep their
-- nullable new columns. Rollback: supabase/rollback/020_public_repository_workspaces.sql

-- ── Analysis source ──────────────────────────────────────────────────────────
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
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'analyses_repository_source_check'
  ) THEN
    ALTER TABLE analyses ADD CONSTRAINT analyses_repository_source_check
      CHECK (repository_source IN ('installation', 'public'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'analyses_issue_source_check'
  ) THEN
    ALTER TABLE analyses ADD CONSTRAINT analyses_issue_source_check
      CHECK (issue_source IN ('github', 'description'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'analyses_workspace_status_check'
  ) THEN
    ALTER TABLE analyses ADD CONSTRAINT analyses_workspace_status_check
      CHECK (workspace_status IN ('none', 'staged', 'discarded'));
  END IF;

  -- A pinned commit is a full 40-character SHA when present.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'analyses_repository_commit_check'
  ) THEN
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
  'installation = GitHub App repository; public = anonymous read of a public repository.';
COMMENT ON COLUMN analyses.repository_commit IS
  'Pinned commit SHA the analysis was generated from. Required for workspace staging.';
COMMENT ON COLUMN analyses.workspace_status IS
  'none | staged | discarded. Workspace files live in analysis_workspace_files.';

-- ── Isolated per-analysis workspace ──────────────────────────────────────────
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

ALTER TABLE analysis_workspace_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own workspace files" ON analysis_workspace_files;
CREATE POLICY "Users can view their own workspace files"
  ON analysis_workspace_files FOR SELECT
  USING (
    analysis_id IN (SELECT id FROM analyses WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can insert their own workspace files" ON analysis_workspace_files;
CREATE POLICY "Users can insert their own workspace files"
  ON analysis_workspace_files FOR INSERT
  WITH CHECK (
    analysis_id IN (SELECT id FROM analyses WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can delete their own workspace files" ON analysis_workspace_files;
CREATE POLICY "Users can delete their own workspace files"
  ON analysis_workspace_files FOR DELETE
  USING (
    analysis_id IN (SELECT id FROM analyses WHERE user_id = auth.uid())
  );

COMMENT ON TABLE analysis_workspace_files IS
  'Patch applied to the exact source snapshot of one analysis. Never written back to GitHub automatically.';

-- ── New artifact types ───────────────────────────────────────────────────────
ALTER TABLE analysis_artifacts DROP CONSTRAINT IF EXISTS analysis_artifacts_artifact_type_check;

ALTER TABLE analysis_artifacts ADD CONSTRAINT analysis_artifacts_artifact_type_check
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
