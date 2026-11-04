-- Migration 022: GitHub OAuth App authentication.
--
-- The application now authenticates users with a standard GitHub OAuth App and
-- reads repositories with the user's own token. Two CHECK constraints from the
-- former GitHub App design no longer describe reality:
--
--   * `users.identity_source` allowed only 'github_app' and 'guest';
--   * `analyses.repository_source` allowed only 'installation' and 'public'.
--
-- Both are widened, never narrowed: every existing row stays valid and keeps its
-- value. 'installation' remains accepted so historical analyses keep working.
--
-- Additive only. Nothing is dropped except the two CHECK constraints, which are
-- immediately re-added with a superset of their former values.
--
-- Rollback: supabase/rollback/022_github_oauth.sql

-- ── users: how the row was provisioned ──────────────────────────────────────
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_identity_source_check;

ALTER TABLE users
  ADD CONSTRAINT users_identity_source_check
  CHECK (
    identity_source IS NULL
    OR identity_source IN ('github_app', 'github_oauth', 'guest')
  );

COMMENT ON COLUMN users.identity_source IS
  'github_oauth = OAuth App sign-in; github_app = row migrated from the former App flow; guest = public-only session.';

-- ── analyses: where the repository came from ────────────────────────────────
ALTER TABLE analyses
  DROP CONSTRAINT IF EXISTS analyses_repository_source_check;

ALTER TABLE analyses
  ADD CONSTRAINT analyses_repository_source_check
  CHECK (repository_source IN ('github', 'installation', 'public'));

-- New analyses are authenticated reads. Keep the old default only for rows that
-- were created before this migration; the application always writes the column
-- explicitly.
ALTER TABLE analyses
  ALTER COLUMN repository_source SET DEFAULT 'github';

COMMENT ON COLUMN analyses.repository_source IS
  'github = OAuth-authenticated read with the user token; installation = legacy GitHub App analysis; public = anonymous read of a public repository.';

-- ── Former server-side session tables ───────────────────────────────────────
-- Migration 021 created `sessions` and `oauth_transactions` for a database-backed
-- session design that was superseded by a sealed cookie session. They are kept
-- (not dropped) so no historical data is lost; the application no longer reads
-- or writes them.
COMMENT ON TABLE sessions IS
  'Unused since migration 022: sessions are now sealed cookies. Retained for historical data only.';
COMMENT ON TABLE oauth_transactions IS
  'Unused since migration 022: OAuth state is now a signed cookie. Retained for historical data only.';
