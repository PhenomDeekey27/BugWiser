-- Migration 015: Local OpenAI-compatible endpoint connection.
-- provider_connections gains a per-connection base_url (the user's own
-- endpoint — display metadata, never a secret) and encrypted_api_key becomes
-- nullable so a keyless local server (no Authorization header needed) can be
-- stored as a connected row. Existing rows are untouched: every one of them
-- already has a key, so dropping the NOT NULL constraint only relaxes the
-- schema. RLS/read policies from migration 009 apply unchanged.

ALTER TABLE provider_connections
  ADD COLUMN IF NOT EXISTS base_url TEXT;

ALTER TABLE provider_connections
  ALTER COLUMN encrypted_api_key DROP NOT NULL;
