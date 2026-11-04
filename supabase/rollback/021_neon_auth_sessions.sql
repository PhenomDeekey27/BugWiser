-- Rollback for migration 021.
--
-- Both tables hold only short-lived or re-creatable data:
--   * sessions           — dropping them signs every user out; nothing else is lost,
--   * oauth_transactions — in-flight sign-ins restart from the sign-in page.
-- `users` rows are never touched, so analyses and installations keep their owner.

DROP TABLE IF EXISTS oauth_transactions;
DROP TABLE IF EXISTS sessions;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_identity_source_check;
ALTER TABLE users DROP COLUMN IF EXISTS identity_source;
