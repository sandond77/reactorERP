-- Rollback the org_id migration.
-- Drops org_id from all data tables, restores user_id NOT NULL,
-- and restores the original global card_catalog unique indexes.

-- ============================================================
-- 0. Ensure tables that were created via seed scripts (not migrations)
--    exist before we try to ALTER them. IF NOT EXISTS = no-op on
--    databases that already have these tables.
-- ============================================================

CREATE TABLE IF NOT EXISTS card_shows (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  location    TEXT,
  show_date   DATE NOT NULL,
  end_date    DATE,
  num_days    INTEGER NOT NULL DEFAULT 1,
  num_tables  INTEGER,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS card_show_id UUID REFERENCES card_shows(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS locations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  card_type    TEXT NOT NULL DEFAULT 'both',
  is_card_show BOOLEAN NOT NULL DEFAULT false,
  is_container BOOLEAN NOT NULL DEFAULT false,
  parent_id    UUID REFERENCES locations(id) ON DELETE CASCADE,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- In case table already existed without newer columns
ALTER TABLE locations ADD COLUMN IF NOT EXISTS is_container BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE locations ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES locations(id) ON DELETE CASCADE;
ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS trades (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trade_date               DATE,
  person                   TEXT,
  cash_from_customer_cents INT NOT NULL DEFAULT 0,
  cash_to_customer_cents   INT NOT NULL DEFAULT 0,
  trade_percent            NUMERIC(5,2) NOT NULL DEFAULT 80,
  trade_label              TEXT,
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- In case table already existed without trade_label
ALTER TABLE trades ADD COLUMN IF NOT EXISTS trade_label TEXT;
ALTER TABLE sales          ADD COLUMN IF NOT EXISTS trade_id UUID REFERENCES trades(id);
ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS trade_id UUID REFERENCES trades(id);

-- expense_id column on expenses (seed-only column)
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS expense_id TEXT;

CREATE TABLE IF NOT EXISTS trade_sequences (
  user_id  UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year     INT     NOT NULL,
  next_seq INT     NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, year)
);

CREATE TABLE IF NOT EXISTS expense_sequences (
  user_id  UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year     INTEGER NOT NULL,
  next_seq INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, year)
);

-- ============================================================
-- 1. Drop org_id from all data tables
-- ============================================================
ALTER TABLE card_catalog         DROP COLUMN IF EXISTS org_id;
ALTER TABLE card_instances       DROP COLUMN IF EXISTS org_id;
ALTER TABLE card_shows           DROP COLUMN IF EXISTS org_id;
ALTER TABLE card_languages       DROP COLUMN IF EXISTS org_id;
ALTER TABLE csv_imports          DROP COLUMN IF EXISTS org_id;
ALTER TABLE expense_sequences    DROP COLUMN IF EXISTS org_id;
ALTER TABLE expenses             DROP COLUMN IF EXISTS org_id;
ALTER TABLE grade_more_thresholds DROP COLUMN IF EXISTS org_id;
ALTER TABLE grading_batch_sequences DROP COLUMN IF EXISTS org_id;
ALTER TABLE grading_batches      DROP COLUMN IF EXISTS org_id;
ALTER TABLE grading_submissions  DROP COLUMN IF EXISTS org_id;
ALTER TABLE listings             DROP COLUMN IF EXISTS org_id;
ALTER TABLE locations            DROP COLUMN IF EXISTS org_id;
ALTER TABLE pokemon_set_aliases  DROP COLUMN IF EXISTS org_id;
ALTER TABLE raw_purchase_sequences DROP COLUMN IF EXISTS org_id;
ALTER TABLE raw_purchases        DROP COLUMN IF EXISTS org_id;
ALTER TABLE reorder_thresholds   DROP COLUMN IF EXISTS org_id;
ALTER TABLE sales                DROP COLUMN IF EXISTS org_id;
ALTER TABLE slab_details         DROP COLUMN IF EXISTS org_id;
ALTER TABLE trade_sequences      DROP COLUMN IF EXISTS org_id;
ALTER TABLE trades               DROP COLUMN IF EXISTS org_id;
ALTER TABLE alert_overrides      DROP COLUMN IF EXISTS org_id;

-- ============================================================
-- 2. Restore NOT NULL on user_id for all data tables
-- ============================================================
ALTER TABLE card_instances        ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE card_shows            ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE card_languages        ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE csv_imports           ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE expenses              ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE grade_more_thresholds ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE grading_batches       ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE grading_submissions   ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE listings              ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE locations             ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE pokemon_set_aliases   ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE raw_purchases         ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE reorder_thresholds    ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE sales                 ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE slab_details          ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE trades                ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE alert_overrides       ALTER COLUMN user_id SET NOT NULL;

-- ============================================================
-- 3. Restore original global card_catalog unique indexes
--    (dropped in migration 029 and replaced with org-scoped ones)
-- ============================================================
DROP INDEX IF EXISTS idx_card_catalog_sku_org;
DROP INDEX IF EXISTS idx_card_catalog_sku_user;
DROP INDEX IF EXISTS idx_card_catalog_identity_org;
DROP INDEX IF EXISTS idx_card_catalog_identity_user;
DROP INDEX IF EXISTS idx_card_catalog_org_id;

CREATE UNIQUE INDEX idx_card_catalog_sku
  ON card_catalog (sku) WHERE sku IS NOT NULL;

CREATE UNIQUE INDEX idx_card_catalog_identity
  ON card_catalog (game, set_code, card_number, variant, language)
  WHERE set_code IS NOT NULL AND card_number IS NOT NULL AND variant IS NOT NULL;
