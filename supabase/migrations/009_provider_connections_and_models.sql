-- Migration 009: Provider connections + user model preferences
-- Server-side encrypted provider credentials and per-user model selection.

-- ── Provider connections (encrypted at rest) ──
CREATE TABLE IF NOT EXISTS provider_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  encrypted_api_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'error')),
  connected_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider)
);

-- ── User model preferences (persistent across repos/issues/sessions) ──
CREATE TABLE IF NOT EXISTS user_model_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT,
  model TEXT,
  selection_mode TEXT NOT NULL DEFAULT 'auto'
    CHECK (selection_mode IN ('auto', 'manual')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_connections_user ON provider_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_user_model_preferences_user ON user_model_preferences(user_id);

ALTER TABLE provider_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_model_preferences ENABLE ROW LEVEL SECURITY;

-- Provider connections are managed server-side via the service role. Users may
-- read their own status; writes go through authenticated server routes that use
-- the service role / confirmed sessions. Keep encryption out of client RLS.
CREATE POLICY "Users can view their own provider connections"
  ON provider_connections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own model preferences"
  ON user_model_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can upsert their own model preferences"
  ON user_model_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own model preferences"
  ON user_model_preferences FOR UPDATE
  USING (auth.uid() = user_id);

-- Updated_at triggers
DROP TRIGGER IF EXISTS update_provider_connections_updated_at ON provider_connections;
CREATE TRIGGER update_provider_connections_updated_at
  BEFORE UPDATE ON provider_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_model_preferences_updated_at ON user_model_preferences;
CREATE TRIGGER update_user_model_preferences_updated_at
  BEFORE UPDATE ON user_model_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();