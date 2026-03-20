-- Add SKU column to card_catalog for part number system
ALTER TABLE card_catalog ADD COLUMN IF NOT EXISTS sku TEXT;

-- Unique index on SKU
CREATE UNIQUE INDEX IF NOT EXISTS idx_card_catalog_sku
  ON card_catalog(sku) WHERE sku IS NOT NULL;

-- Unique index on external_id for upsert-by-external-id
CREATE UNIQUE INDEX IF NOT EXISTS idx_card_catalog_external_unique
  ON card_catalog(external_id) WHERE external_id IS NOT NULL;

-- Index to speed up set+number+language lookups (core matching key)
CREATE INDEX IF NOT EXISTS idx_card_catalog_match_key
  ON card_catalog(game, set_code, card_number, language)
  WHERE set_code IS NOT NULL AND card_number IS NOT NULL;
