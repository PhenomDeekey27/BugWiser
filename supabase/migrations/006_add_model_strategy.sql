-- Migration 006: Add model_strategy to analyses table
-- Stores the strategy mode (free, free_paid, fully_paid, custom) for each analysis

ALTER TABLE analyses ADD COLUMN IF NOT EXISTS model_strategy TEXT DEFAULT 'auto'
  CHECK (model_strategy IN ('free', 'free_paid', 'fully_paid', 'custom', 'auto'));

COMMENT ON COLUMN analyses.model_strategy IS 'Strategy mode for AI model selection:
  - auto: BugWiser auto-selects the best model per stage
  - free: every stage uses the best FREE model
  - free_paid: discovery/evidence → FREE, everything else → PAID
  - fully_paid: every stage uses the best PAID model
  - custom: inherits auto strategy, with optional stage_overrides
';
