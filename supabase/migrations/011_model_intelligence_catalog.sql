-- Migration 011: Model Intelligence catalog
-- Stores the per-user analyzed/ranked model catalog.
-- This is the single source of truth for model recommendations.

-- ── Model catalog (per-user analyzed model data) ──
CREATE TABLE IF NOT EXISTS model_catalog (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,

  -- Pricing
  is_free BOOLEAN NOT NULL DEFAULT false,
  input_price DECIMAL(10,6),
  output_price DECIMAL(10,6),

  -- Capabilities
  context_window INTEGER NOT NULL DEFAULT 128000,
  max_output_tokens INTEGER,
  supports_reasoning BOOLEAN NOT NULL DEFAULT false,
  supports_tool_calling BOOLEAN NOT NULL DEFAULT false,
  supports_structured_output BOOLEAN NOT NULL DEFAULT false,
  supports_coding BOOLEAN NOT NULL DEFAULT false,
  supports_vision BOOLEAN NOT NULL DEFAULT false,

  -- Scores (0-100, from AI classification or deterministic ranking)
  coding_score INTEGER NOT NULL DEFAULT 0,
  reasoning_score INTEGER NOT NULL DEFAULT 0,
  speed_score INTEGER NOT NULL DEFAULT 0,
  long_context_score INTEGER NOT NULL DEFAULT 0,
  value_score INTEGER NOT NULL DEFAULT 0,
  overall_score INTEGER NOT NULL DEFAULT 0,

  -- Categories this model is recommended for
  recommended_categories TEXT[] NOT NULL DEFAULT '{}',

  -- Metadata
  availability TEXT NOT NULL DEFAULT 'unknown'
    CHECK (availability IN ('available', 'unavailable', 'unknown')),
  source TEXT NOT NULL DEFAULT 'registry'
    CHECK (source IN ('registry', 'live', 'ai_classified')),
  provider_metadata JSONB,

  -- Change detection
  provider_fingerprint TEXT NOT NULL,

  -- Timestamps
  last_analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, provider, model_id)
);

-- ── Model catalog metadata (per-user catalog state) ──
CREATE TABLE IF NOT EXISTS model_catalog_meta (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_fingerprint TEXT NOT NULL,
  model_count INTEGER NOT NULL DEFAULT 0,
  free_model_count INTEGER NOT NULL DEFAULT 0,
  paid_model_count INTEGER NOT NULL DEFAULT 0,
  classified_by_ai BOOLEAN NOT NULL DEFAULT false,
  classification_model TEXT,
  last_analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_model_catalog_user ON model_catalog(user_id);
CREATE INDEX IF NOT EXISTS idx_model_catalog_user_provider ON model_catalog(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_model_catalog_user_score ON model_catalog(user_id, overall_score DESC);
CREATE INDEX IF NOT EXISTS idx_model_catalog_meta_user ON model_catalog_meta(user_id);

ALTER TABLE model_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_catalog_meta ENABLE ROW LEVEL SECURITY;

-- Server-side managed via service role; users can read their own catalog
DROP POLICY IF EXISTS "Users can view their own model catalog" ON model_catalog;
CREATE POLICY "Users can view their own model catalog"
  ON model_catalog FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own catalog metadata" ON model_catalog_meta;
CREATE POLICY "Users can view their own catalog metadata"
  ON model_catalog_meta FOR SELECT
  USING (auth.uid() = user_id);

-- Updated_at triggers
DROP TRIGGER IF EXISTS update_model_catalog_updated_at ON model_catalog;
CREATE TRIGGER update_model_catalog_updated_at
  BEFORE UPDATE ON model_catalog
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_model_catalog_meta_updated_at ON model_catalog_meta;
CREATE TRIGGER update_model_catalog_meta_updated_at
  BEFORE UPDATE ON model_catalog_meta
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
