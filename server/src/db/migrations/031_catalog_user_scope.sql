-- Per-user card_catalog isolation.
-- Creates card_catalog_seed as the shared reference table for seeding new users,
-- adds user_id to card_catalog, and makes unique indexes user-scoped.
--
-- On a FRESH deployment:
--   1. Run this migration (creates empty seed table + user-scoped catalog)
--   2. Run: node -e "..." to load seed data from src/db/seeds/catalog-seed-data.sql
--      (or run sync-catalog.ts to pull from TCGdex API)
--
-- On the EXISTING sandond77 DB (already applied):
--   Migration was run with backfill steps included. The seed table is populated.

-- ============================================================
-- 1. Create card_catalog_seed table
-- ============================================================
CREATE TABLE IF NOT EXISTS card_catalog_seed (
  id          UUID        NOT NULL DEFAULT gen_random_uuid(),
  game        TEXT        NOT NULL DEFAULT 'pokemon',
  set_name    TEXT        NOT NULL,
  set_code    TEXT,
  card_name   TEXT        NOT NULL,
  card_number TEXT,
  variant     TEXT,
  rarity      TEXT,
  language    TEXT        NOT NULL DEFAULT 'EN',
  image_url   TEXT,
  image_url_hi  TEXT,
  image_url_back TEXT,
  tcgplayer_id  TEXT,
  external_id   TEXT,
  sku           TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_seed_external
  ON card_catalog_seed (external_id) WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_seed_sku
  ON card_catalog_seed (sku) WHERE sku IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_seed_identity
  ON card_catalog_seed (game, set_code, card_number, variant, language)
  WHERE set_code IS NOT NULL AND card_number IS NOT NULL AND variant IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_catalog_seed_game_set ON card_catalog_seed (game, set_name);
CREATE INDEX IF NOT EXISTS idx_catalog_seed_name     ON card_catalog_seed (card_name);
CREATE INDEX IF NOT EXISTS idx_catalog_seed_match    ON card_catalog_seed (game, set_code, card_number, language);

-- ============================================================
-- 2. Add user_id to card_catalog
-- ============================================================
ALTER TABLE card_catalog ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);

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
-- 4. Make user_id NOT NULL (skip if already set — fresh DB has no rows)
-- ============================================================
-- On fresh DB this is a no-op since there are no rows yet.
-- On existing DB, caller must backfill user_id before this runs
-- (handled by the Node.js migration script that ran 031 on the live DB).
ALTER TABLE card_catalog ALTER COLUMN user_id SET NOT NULL;

-- ============================================================
-- 5. Create user-scoped unique indexes
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_card_catalog_sku
  ON card_catalog (user_id, sku) WHERE sku IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_card_catalog_identity
  ON card_catalog (user_id, game, set_code, card_number, variant, language)
  WHERE set_code IS NOT NULL AND card_number IS NOT NULL AND variant IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_card_catalog_external
  ON card_catalog (user_id, external_id) WHERE external_id IS NOT NULL;
