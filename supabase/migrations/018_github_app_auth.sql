-- Migration 018: GitHub App identity, installations, and repository access.
--
-- Additive only. No existing row, column, policy, or auth user is rewritten.
-- Existing analyses keep their `user_id`; a GitHub App login is mapped onto the
-- SAME auth.users UUID when the GitHub numeric id already belongs to a Supabase
-- user. New users are provisioned in auth.users with a non-deliverable,
-- deterministic address (never matched by email).
--
-- Rollback: supabase/rollback/018_github_app_auth.sql

-- ── GitHub identity linked to a BugWiser (auth.users) user ──────────────────
CREATE TABLE IF NOT EXISTS github_identities (
  github_user_id BIGINT PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  login TEXT NOT NULL,
  avatar_url TEXT,
  -- App user-to-server token, encrypted with BUGWISER_ENCRYPTION_KEY at rest.
  -- Used ONLY to verify installation ownership and list a user's installations.
  -- It is never returned to a client, placed in a cookie, or logged.
  user_token_enc TEXT,
  user_token_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_github_identities_user ON github_identities(user_id);

-- ── Installations (one row per GitHub App installation) ────────────────────
CREATE TABLE IF NOT EXISTS github_installations (
  installation_id BIGINT PRIMARY KEY,
  account_id BIGINT NOT NULL,
  account_login TEXT NOT NULL,
  account_type TEXT NOT NULL,
  repository_selection TEXT,
  permissions JSONB,
  suspended_at TIMESTAMPTZ,
  html_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The installation page URL shown in the dashboard ("Manage repositories").
ALTER TABLE github_installations
  ADD COLUMN IF NOT EXISTS html_url TEXT;

-- ── Which BugWiser users may use which installation ────────────────────────
CREATE TABLE IF NOT EXISTS github_installation_users (
  installation_id BIGINT NOT NULL REFERENCES github_installations(installation_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (installation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_github_installation_users_user
  ON github_installation_users(user_id);

-- ── Repositories visible to an installation ────────────────────────────────
CREATE TABLE IF NOT EXISTS github_installation_repositories (
  installation_id BIGINT NOT NULL REFERENCES github_installations(installation_id) ON DELETE CASCADE,
  repo_id BIGINT NOT NULL,
  full_name TEXT NOT NULL,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  private BOOLEAN NOT NULL DEFAULT FALSE,
  default_branch TEXT,
  html_url TEXT,
  pushed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (installation_id, repo_id)
);

CREATE INDEX IF NOT EXISTS idx_github_installation_repositories_full_name
  ON github_installation_repositories(full_name);
CREATE INDEX IF NOT EXISTS idx_github_installation_repositories_installation
  ON github_installation_repositories(installation_id);

-- ── Analysis → installation association (nullable, additive) ───────────────
ALTER TABLE analyses
  ADD COLUMN IF NOT EXISTS github_installation_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_analyses_github_installation
  ON analyses(github_installation_id)
  WHERE github_installation_id IS NOT NULL;

-- ── Map a GitHub numeric id onto an existing Supabase user ─────────────────
-- Prefers the provider identity table (authoritative) and only then falls back
-- to raw metadata. It never matches on email or username.
CREATE OR REPLACE FUNCTION public.find_auth_user_by_github_id(p_github_id TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  matched UUID;
BEGIN
  IF p_github_id IS NULL OR p_github_id !~ '^[0-9]+$' THEN
    RETURN NULL;
  END IF;

  SELECT i.user_id
    INTO matched
    FROM auth.identities i
   WHERE i.provider = 'github'
     AND i.provider_id = p_github_id
   LIMIT 1;

  IF matched IS NOT NULL THEN
    RETURN matched;
  END IF;

  SELECT u.id
    INTO matched
    FROM auth.users u
   WHERE u.raw_user_meta_data->>'sub' = p_github_id
      OR u.raw_user_meta_data->>'provider_id' = p_github_id
   LIMIT 1;

  RETURN matched;
END;
$$;

REVOKE ALL ON FUNCTION public.find_auth_user_by_github_id(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.find_auth_user_by_github_id(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.find_auth_user_by_github_id(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.find_auth_user_by_github_id(TEXT) TO service_role;

-- ── Row Level Security ─────────────────────────────────────────────────────
-- Reads are limited to the owning user. All writes go through service-role
-- server handlers after an explicit ownership check.
ALTER TABLE github_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE github_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE github_installation_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE github_installation_repositories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own GitHub identity" ON github_identities;
CREATE POLICY "Users can view their own GitHub identity"
  ON github_identities FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own installation links" ON github_installation_users;
CREATE POLICY "Users can view their own installation links"
  ON github_installation_users FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view their own installations" ON github_installations;
CREATE POLICY "Users can view their own installations"
  ON github_installations FOR SELECT
  USING (
    installation_id IN (
      SELECT installation_id FROM github_installation_users WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can view repositories of their installations" ON github_installation_repositories;
CREATE POLICY "Users can view repositories of their installations"
  ON github_installation_repositories FOR SELECT
  USING (
    installation_id IN (
      SELECT installation_id FROM github_installation_users WHERE user_id = auth.uid()
    )
  );

-- ── Timestamps ─────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS update_github_identities_updated_at ON github_identities;
CREATE TRIGGER update_github_identities_updated_at
  BEFORE UPDATE ON github_identities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_github_installations_updated_at ON github_installations;
CREATE TRIGGER update_github_installations_updated_at
  BEFORE UPDATE ON github_installations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
