-- Migration 013: Allow the /models page setup choices (balanced, quality) in
-- user_model_preferences.selected_strategy. 'free' already exists. The engine
-- strategies ('auto', 'free', 'free_paid', 'fully_paid', 'custom') are
-- unchanged; 'balanced' and 'quality' are persisted UI setups whose concrete
-- per-stage picks live in stage_overrides. analyses.model_strategy still only
-- accepts engine strategies — app/api/analyses maps UI setups to 'custom'.

ALTER TABLE user_model_preferences
  DROP CONSTRAINT IF EXISTS user_model_preferences_selected_strategy_check;

ALTER TABLE user_model_preferences
  ADD CONSTRAINT user_model_preferences_selected_strategy_check
  CHECK (selected_strategy IN ('auto', 'free', 'free_paid', 'fully_paid', 'custom', 'balanced', 'quality'));

COMMENT ON CONSTRAINT user_model_preferences_selected_strategy_check ON user_model_preferences IS
  'Engine strategies (auto/free/free_paid/fully_paid/custom) plus UI setups (balanced/quality) from the /models page.';
