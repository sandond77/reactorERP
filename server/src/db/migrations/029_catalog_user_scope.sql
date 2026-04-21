-- Add user_id to card_catalog for per-user isolation.
-- NULL user_id = global/TCGdex-sourced entries (shared across all users).
ALTER TABLE card_catalog ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- Drop old global unique indexes that don't account for user scope
DROP INDEX IF EXISTS idx_card_catalog_sku;
DROP INDEX IF EXISTS idx_card_catalog_identity;

-- User-scoped unique: (user_id, sku)
CREATE UNIQUE INDEX idx_card_catalog_sku_user   ON card_catalog (user_id, sku)  WHERE sku IS NOT NULL AND user_id IS NOT NULL;
-- Global unique: sku alone (for TCGdex/shared entries with no user_id)
CREATE UNIQUE INDEX idx_card_catalog_sku_global ON card_catalog (sku)           WHERE sku IS NOT NULL AND user_id IS NULL;

-- User-scoped identity unique
CREATE UNIQUE INDEX idx_card_catalog_identity_user ON card_catalog (user_id, game, set_code, card_number, variant, language)
  WHERE set_code IS NOT NULL AND card_number IS NOT NULL AND variant IS NOT NULL AND user_id IS NOT NULL;
