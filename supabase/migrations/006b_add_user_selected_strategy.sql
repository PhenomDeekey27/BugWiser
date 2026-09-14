-- Migration 006b: Add selected_strategy to user_model_preferences
-- Stores the user's persistent default strategy for new analyses.
-- Existing rows default to 'auto' for backward compatibility.

ALTER TABLE user_model_preferences ADD COLUMN IF NOT EXISTS selected_strategy TEXT DEFAULT 'auto'
  CHECK (selected_strategy IN ('auto', 'free', 'free_paid', 'fully_paid', 'custom'));

COMMENT ON COLUMN user_model_preferences.selected_strategy IS '
  User''s persistent default BugWiser strategy for new analyses.
  - auto: Auto-selects the best model per stage (default)
  - free: Every stage uses the best FREE model
  - free_paid: Discovery/evidence → FREE, analysis/generation → PAID
  - fully_paid: Every stage uses the best PAID model
  - custom: Inherits auto strategy, with optional stage_overrides
';
