-- Migration: 001_initial_schema
-- Reactor - Trading Card Inventory Management System

-- EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ============================================================
-- USERS & AUTH
-- ============================================================

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         CITEXT NOT NULL UNIQUE,
  display_name  TEXT,
  avatar_url    TEXT,
  google_sub    TEXT UNIQUE,
  plan          TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX idx_users_google_sub ON users(google_sub);
CREATE INDEX idx_users_email ON users(email);

-- ============================================================
-- CARD CATALOG (shared reference data)
-- Canonical identity of a card — what it IS, not who owns it
-- ============================================================

CREATE TABLE card_catalog (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game          TEXT NOT NULL DEFAULT 'pokemon',  -- 'pokemon', 'one_piece', 'mtg', etc.
  set_name      CITEXT NOT NULL,
  set_code      TEXT,
  card_name     CITEXT NOT NULL,
  card_number   TEXT,           -- e.g. '025/165'
  variant       TEXT,           -- 'holo', 'reverse holo', 'first edition', '1st ed'
  rarity        TEXT,
  language      TEXT NOT NULL DEFAULT 'EN',
  image_url     TEXT,
  image_url_hi  TEXT,           -- high-res front image
  image_url_back TEXT,          -- back image (for slabs)
  tcgplayer_id  TEXT,
  external_id   TEXT,           -- Pokemon TCG API id, etc.
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_card_catalog_game_set ON card_catalog(game, set_name);
CREATE INDEX idx_card_catalog_name ON card_catalog(card_name);
CREATE INDEX idx_card_catalog_external ON card_catalog(external_id);
CREATE UNIQUE INDEX idx_card_catalog_identity
  ON card_catalog(game, set_code, card_number, variant, language)
  WHERE set_code IS NOT NULL AND card_number IS NOT NULL AND variant IS NOT NULL;

-- ============================================================
-- CARD INSTANCES (central ownership + lifecycle entity)
-- One row per physical card owned by a user
-- ============================================================

CREATE TYPE card_status AS ENUM (
  'purchased_raw',      -- just bought, ungraded
  'inspected',          -- inspected, decision pending
  'grading_submitted',  -- sent to grading company
  'graded',             -- returned as a slab
  'raw_for_sale',       -- listing raw
  'sold',               -- sold
  'lost_damaged'        -- lost or damaged (write-off)
);

CREATE TYPE purchase_type AS ENUM (
  'raw',
  'pre_graded'
);

CREATE TABLE card_instances (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalog_id          UUID REFERENCES card_catalog(id) ON DELETE SET NULL,

  -- Free-form overrides when catalog entry doesn't exist
  card_name_override  TEXT,
  set_name_override   TEXT,
  card_number_override TEXT,
  card_game           TEXT NOT NULL DEFAULT 'pokemon',
  language            TEXT NOT NULL DEFAULT 'EN',
  variant             TEXT,
  rarity              TEXT,
  notes               TEXT,

  purchase_type       purchase_type NOT NULL DEFAULT 'raw',
  status              card_status NOT NULL DEFAULT 'purchased_raw',
  quantity            INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),

  -- Cost tracking — all monetary values in smallest unit (cents/yen)
  purchase_cost       INTEGER NOT NULL DEFAULT 0,
  currency            CHAR(3) NOT NULL DEFAULT 'USD',

  -- Source info
  source_link         TEXT,   -- eBay listing, Whatnot, etc.
  order_number        TEXT,

  -- Raw card condition (before grading decision)
  condition           TEXT,   -- 'NM', 'LP', 'MP', 'HP', 'DMG'
  condition_notes     TEXT,

  -- Images
  image_front_url     TEXT,
  image_back_url      TEXT,

  purchased_at        DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ,

  CONSTRAINT chk_has_identity CHECK (
    catalog_id IS NOT NULL OR card_name_override IS NOT NULL
  )
);

CREATE INDEX idx_card_instances_user ON card_instances(user_id);
CREATE INDEX idx_card_instances_status ON card_instances(user_id, status);
CREATE INDEX idx_card_instances_catalog ON card_instances(catalog_id);
CREATE INDEX idx_card_instances_active ON card_instances(user_id, deleted_at)
  WHERE deleted_at IS NULL;

-- ============================================================
-- GRADING SUBMISSIONS
-- ============================================================

CREATE TYPE grading_company AS ENUM (
  'PSA', 'BGS', 'CGC', 'SGC', 'HGA', 'ACE', 'OTHER'
);

CREATE TYPE grading_status AS ENUM (
  'submitted', 'in_review', 'graded', 'returned', 'cancelled'
);

CREATE TABLE grading_submissions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_instance_id    UUID NOT NULL REFERENCES card_instances(id) ON DELETE CASCADE,

  company             grading_company NOT NULL,
  submission_number   TEXT,         -- company tracking/order number
  service_level       TEXT,         -- 'economy', 'regular', 'express', etc.
  status              grading_status NOT NULL DEFAULT 'submitted',

  grading_fee         INTEGER NOT NULL DEFAULT 0,
  shipping_cost       INTEGER NOT NULL DEFAULT 0,
  currency            CHAR(3) NOT NULL DEFAULT 'USD',

  submitted_at        DATE,
  estimated_return    DATE,
  returned_at         DATE,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_grading_submissions_user ON grading_submissions(user_id);
CREATE INDEX idx_grading_submissions_card ON grading_submissions(card_instance_id);
CREATE INDEX idx_grading_submissions_status ON grading_submissions(user_id, status);

-- ============================================================
-- SLAB DETAILS (graded cards)
-- One row per graded card instance
-- ============================================================

CREATE TABLE slab_details (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_instance_id        UUID NOT NULL UNIQUE REFERENCES card_instances(id) ON DELETE CASCADE,
  user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- If this slab came from a raw card the user sent in
  source_raw_instance_id  UUID REFERENCES card_instances(id) ON DELETE SET NULL,
  grading_submission_id   UUID REFERENCES grading_submissions(id) ON DELETE SET NULL,

  company                 grading_company NOT NULL,
  cert_number             TEXT,
  grade                   NUMERIC(4,1),     -- e.g. 9.5, 10, 8
  grade_label             TEXT,             -- 'GEM MINT 10', 'PRISTINE', etc.
  subgrades               JSONB,            -- { centering: 9, corners: 9.5, ... }

  -- Additional cost if purchased as a pre-graded slab
  additional_cost         INTEGER NOT NULL DEFAULT 0,
  currency                CHAR(3) NOT NULL DEFAULT 'USD',

  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_slab_details_user ON slab_details(user_id);
CREATE INDEX idx_slab_details_cert ON slab_details(company, cert_number);
CREATE INDEX idx_slab_details_source_raw ON slab_details(source_raw_instance_id);

-- ============================================================
-- LISTINGS
-- ============================================================

CREATE TYPE listing_platform AS ENUM (
  'ebay', 'card_show', 'tcgplayer', 'facebook', 'instagram', 'local', 'other'
);

CREATE TYPE listing_status AS ENUM (
  'active', 'sold', 'expired', 'cancelled'
);

CREATE TABLE listings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_instance_id    UUID NOT NULL REFERENCES card_instances(id) ON DELETE CASCADE,

  platform            listing_platform NOT NULL,
  listing_status      listing_status NOT NULL DEFAULT 'active',

  -- eBay specific
  ebay_listing_id     TEXT,
  ebay_listing_url    TEXT,

  -- Card show specific
  show_name           TEXT,
  show_date           DATE,
  booth_cost          INTEGER,

  list_price          INTEGER NOT NULL,
  asking_price        INTEGER,
  currency            CHAR(3) NOT NULL DEFAULT 'USD',

  listed_at           TIMESTAMPTZ,
  sold_at             TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_listings_user ON listings(user_id);
CREATE INDEX idx_listings_card ON listings(card_instance_id);
CREATE INDEX idx_listings_status ON listings(user_id, listing_status);
CREATE INDEX idx_listings_platform ON listings(user_id, platform);

-- ============================================================
-- SALES
-- ============================================================

CREATE TABLE sales (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  card_instance_id        UUID NOT NULL REFERENCES card_instances(id) ON DELETE CASCADE,
  listing_id              UUID REFERENCES listings(id) ON DELETE SET NULL,

  platform                listing_platform NOT NULL,
  sale_price              INTEGER NOT NULL,
  platform_fees           INTEGER NOT NULL DEFAULT 0,
  shipping_cost           INTEGER NOT NULL DEFAULT 0,
  currency                CHAR(3) NOT NULL DEFAULT 'USD',

  -- Denormalized at sale time for fast reporting
  total_cost_basis        INTEGER,

  -- Computed column: net proceeds = sale_price - platform_fees - shipping_cost
  net_proceeds            INTEGER GENERATED ALWAYS AS (sale_price - platform_fees - shipping_cost) STORED,

  order_details_link      TEXT,
  unique_id               TEXT,   -- platform order/item ID
  unique_id_2             TEXT,   -- secondary ID (e.g. eBay item # vs order #)

  sold_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sales_user ON sales(user_id);
CREATE INDEX idx_sales_card ON sales(card_instance_id);
CREATE INDEX idx_sales_sold_at ON sales(user_id, sold_at);
CREATE INDEX idx_sales_platform ON sales(user_id, platform);

-- ============================================================
-- CSV IMPORTS
-- ============================================================

CREATE TYPE import_status AS ENUM (
  'pending', 'processing', 'completed', 'failed'
);

CREATE TABLE csv_imports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename        TEXT NOT NULL,
  import_type     TEXT NOT NULL DEFAULT 'cards',  -- 'cards', 'sales', 'graded', 'psa'
  row_count       INTEGER,
  imported_count  INTEGER,
  error_count     INTEGER,
  status          import_status NOT NULL DEFAULT 'pending',
  error_log       JSONB,    -- array of { row, message } objects
  mapping         JSONB,    -- user's column-to-field mapping config
  raw_headers     JSONB,    -- detected CSV headers
  preview_rows    JSONB,    -- first 5 rows for preview
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_csv_imports_user ON csv_imports(user_id);

-- ============================================================
-- AUDIT LOG
-- ============================================================

CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  entity_type   TEXT NOT NULL,
  entity_id     UUID NOT NULL,
  action        TEXT NOT NULL,   -- 'created', 'updated', 'deleted', 'status_changed'
  old_data      JSONB,
  new_data      JSONB,
  ip_address    INET,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_user ON audit_log(user_id, created_at DESC);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_card_instances_updated_at
  BEFORE UPDATE ON card_instances
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_grading_submissions_updated_at
  BEFORE UPDATE ON grading_submissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_slab_details_updated_at
  BEFORE UPDATE ON slab_details
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_listings_updated_at
  BEFORE UPDATE ON listings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_card_catalog_updated_at
  BEFORE UPDATE ON card_catalog
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
