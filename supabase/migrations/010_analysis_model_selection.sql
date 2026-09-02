-- Migration 010: Analysis model selection record
-- Persists how each analysis chose its model (auto vs manual), the reason,
-- and (for auto) the per-stage assignments.

ALTER TABLE analyses ADD COLUMN IF NOT EXISTS model_selection JSONB;

COMMENT ON COLUMN analyses.model_selection IS
  'Model routing record: { mode: auto|manual, reason, manualFallbackOccurred, stages: { [stage]: { provider, model, fit } } }';

-- Extend analysis_artifacts CHECK to allow a model_selection artifact type.
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
    'model_selection'
  ));