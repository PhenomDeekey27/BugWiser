-- Rollback for 020_public_repository_workspaces.sql
--
-- Drops only what migration 020 added. Existing installation analyses keep
-- working; public analyses and staged workspaces are removed with their rows.

DROP TABLE IF EXISTS analysis_workspace_files;

DROP INDEX IF EXISTS idx_analyses_repository_source;
DROP INDEX IF EXISTS idx_analyses_repository_commit;

ALTER TABLE analyses
  DROP CONSTRAINT IF EXISTS analyses_repository_commit_check,
  DROP CONSTRAINT IF EXISTS analyses_workspace_status_check,
  DROP CONSTRAINT IF EXISTS analyses_issue_source_check,
  DROP CONSTRAINT IF EXISTS analyses_repository_source_check;

ALTER TABLE analyses
  DROP COLUMN IF EXISTS workspace_staged_at,
  DROP COLUMN IF EXISTS workspace_status,
  DROP COLUMN IF EXISTS issue_description,
  DROP COLUMN IF EXISTS issue_url,
  DROP COLUMN IF EXISTS issue_source,
  DROP COLUMN IF EXISTS repository_commit,
  DROP COLUMN IF EXISTS repository_default_branch,
  DROP COLUMN IF EXISTS repository_branch,
  DROP COLUMN IF EXISTS repository_url,
  DROP COLUMN IF EXISTS repository_source;

-- Restore the artifact type list from migration 005.
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
