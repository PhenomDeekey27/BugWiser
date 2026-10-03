-- Migration 016: Per-user provider disable (tombstone) state.
--
-- Extends the provider_connections.status CHECK so a user can explicitly
-- disable a server-env-configured provider for their own account:
--
--   status='disabled' + encrypted_api_key=NULL  ⇒  per-user tombstone
--
-- Effective provider state precedence (implemented in lib/ai/connection/service.ts):
--   DISABLED (tombstone row) > USER ROW (status='connected') > SERVER ENV > NONE
--
-- The tombstone never stores credential material (key is NULL); environment
-- credentials stay server-side only. Migration 015 already made
-- encrypted_api_key nullable, so no column change is needed here. Existing
-- 'connected' and 'error' rows remain valid and keep working unchanged.

ALTER TABLE provider_connections DROP CONSTRAINT IF EXISTS provider_connections_status_check;

ALTER TABLE provider_connections ADD CONSTRAINT provider_connections_status_check
  CHECK (status IN ('connected', 'error', 'disabled'));
