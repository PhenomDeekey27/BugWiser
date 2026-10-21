-- Rollback for migration 018.
-- Safe to run after the application has been rolled back to a build that no
-- longer reads these objects. Existing analyses are NOT deleted; only the
-- additive tables/column/function are removed.

DROP FUNCTION IF EXISTS public.find_auth_user_by_github_id(TEXT);

DROP INDEX IF EXISTS public.idx_analyses_github_installation;
ALTER TABLE analyses DROP COLUMN IF EXISTS github_installation_id;

DROP TABLE IF EXISTS github_installation_repositories;
DROP TABLE IF EXISTS github_installation_users;
DROP TABLE IF EXISTS github_installations;
DROP TABLE IF EXISTS github_identities;
