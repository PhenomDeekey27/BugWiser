-- Migration 012: Per-stage model overrides
-- Optional JSONB field for user-configured per-stage model overrides.
-- Empty/missing means the existing global preference behavior is used.

ALTER TABLE user_model_preferences
  ADD COLUMN IF NOT EXISTS stage_overrides JSONB;

COMMENT ON COLUMN user_model_preferences.stage_overrides IS
  'Per-stage model overrides: { "root_cause_analysis": { "provider": "...", "model": "..." }, ... }';

-- Optional index for quick lookup; most reads go through the unique user_id index anyway.
CREATE INDEX IF NOT EXISTS idx_user_model_preferences_stage_overrides ON user_model_preferences(stage_overrides) WHERE stage_overrides IS NOT NULL;