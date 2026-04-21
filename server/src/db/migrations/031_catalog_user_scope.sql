-- Per-user card_catalog isolation.
-- Creates card_catalog_seed as the shared reference table for seeding new users,
-- adds user_id to card_catalog, backfills both existing users, and makes unique
-- indexes user-scoped.

-- ============================================================
-- 1. Create seed table from current catalog state
-- ============================================================
CREATE TABLE card_catalog_seed AS SELECT * FROM card_catalog;

ALTER TABLE card_catalog_seed ADD PRIMARY KEY (id);

-- Indexes needed for ON CONFLICT in upsertCatalogCard / findOrFetchCard
CREATE UNIQUE INDEX idx_catalog_seed_external
  ON card_catalog_seed (external_id) WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX idx_catalog_seed_sku
  ON card_catalog_seed (sku) WHERE sku IS NOT NULL;

CREATE UNIQUE INDEX idx_catalog_seed_identity
  ON card_catalog_seed (game, set_code, card_number, variant, language)
  WHERE set_code IS NOT NULL AND card_number IS NOT NULL AND variant IS NOT NULL;

CREATE INDEX idx_catalog_seed_game_set ON card_catalog_seed (game, set_name);
CREATE INDEX idx_catalog_seed_name     ON card_catalog_seed (card_name);
CREATE INDEX idx_catalog_seed_match    ON card_catalog_seed (game, set_code, card_number, language);

-- ============================================================
-- 2. Add user_id to card_catalog
-- ============================================================
ALTER TABLE card_catalog ADD COLUMN user_id UUID REFERENCES users(id);

-- ============================================================
-- 3. Drop global unique indexes before backfilling
--    (they would block duplicate SKUs across users)
-- ============================================================
DROP INDEX IF EXISTS idx_card_catalog_identity;
DROP INDEX IF EXISTS idx_card_catalog_sku;
DROP INDEX IF EXISTS idx_card_catalog_sku_global;
DROP INDEX IF EXISTS idx_card_catalog_external;
DROP INDEX IF EXISTS idx_card_catalog_external_unique;

-- ============================================================
-- 4. Backfill sandond77 (existing rows belong to this user)
-- ============================================================
UPDATE card_catalog
SET user_id = '99f398e0-105d-4f99-a114-a34e399dbfe6';

-- ============================================================
-- 5. Seed sandondu2 from the seed table
-- ============================================================
INSERT INTO card_catalog (
  game, set_name, set_code, card_name, card_number,
  variant, rarity, language, image_url, image_url_hi,
  image_url_back, tcgplayer_id, external_id, sku,
  created_at, updated_at, user_id
)
SELECT
  game, set_name, set_code, card_name, card_number,
  variant, rarity, language, image_url, image_url_hi,
  image_url_back, tcgplayer_id, external_id, sku,
  created_at, updated_at,
  '5459f8c7-0e18-46f5-9b32-71d94e62d8b2'
FROM card_catalog_seed;

-- ============================================================
-- 6. Make user_id NOT NULL
-- ============================================================
ALTER TABLE card_catalog ALTER COLUMN user_id SET NOT NULL;

-- ============================================================
-- 7. Create user-scoped unique indexes
-- ============================================================

CREATE UNIQUE INDEX idx_card_catalog_sku
  ON card_catalog (user_id, sku) WHERE sku IS NOT NULL;

CREATE UNIQUE INDEX idx_card_catalog_identity
  ON card_catalog (user_id, game, set_code, card_number, variant, language)
  WHERE set_code IS NOT NULL AND card_number IS NOT NULL AND variant IS NOT NULL;

CREATE UNIQUE INDEX idx_card_catalog_external
  ON card_catalog (user_id, external_id) WHERE external_id IS NOT NULL;
