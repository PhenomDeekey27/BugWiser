-- Migration 014: Pricing provenance for the model intelligence catalog.
-- Distinguishes live provider pricing, static registry pricing, and
-- unknown/unavailable pricing. NULL/missing pricing stays unknown — it is
-- never interpreted as free, and no price is ever fabricated.

ALTER TABLE model_catalog
  ADD COLUMN IF NOT EXISTS price_source TEXT
    NOT NULL DEFAULT 'unknown'
    CHECK (price_source IN ('live', 'registry', 'unknown')),
  ADD COLUMN IF NOT EXISTS price_fetched_at TIMESTAMPTZ;

ALTER TABLE model_catalog_meta
  ADD COLUMN IF NOT EXISTS price_source TEXT
    NOT NULL DEFAULT 'unknown'
    CHECK (price_source IN ('live', 'registry', 'unknown')),
  ADD COLUMN IF NOT EXISTS price_fetched_at TIMESTAMPTZ;
