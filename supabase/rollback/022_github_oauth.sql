-- Rollback for migration 022.
--
-- Restores the pre-OAuth CHECK constraints. This FAILS if any row already uses
-- 'github_oauth' or 'github' — that is deliberate: downgrading must not silently
-- rewrite or delete user data. Convert those rows first if a rollback is truly
-- required.

ALTER TABLE analyses
  DROP CONSTRAINT IF EXISTS analyses_repository_source_check;

ALTER TABLE analyses
  ADD CONSTRAINT analyses_repository_source_check
  CHECK (repository_source IN ('installation', 'public'));

ALTER TABLE analyses
  ALTER COLUMN repository_source SET DEFAULT 'installation';

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_identity_source_check;

ALTER TABLE users
  ADD CONSTRAINT users_identity_source_check
  CHECK (identity_source IS NULL OR identity_source IN ('github_app', 'guest'));

COMMENT ON TABLE sessions IS NULL;
COMMENT ON TABLE oauth_transactions IS NULL;
