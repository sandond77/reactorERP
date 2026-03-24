-- Migration: 007_raw_purchases
-- Raw card purchase intake and inspection workflow

CREATE TYPE raw_purchase_type AS ENUM ('raw', 'bulk');
CREATE TYPE raw_purchase_status AS ENUM ('ordered', 'received', 'cancelled');

-- ============================================================
-- RAW PURCHASES (intake lots)
-- ============================================================

CREATE TABLE raw_purchases (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Human-readable purchase ID, e.g. "2025R1", "2025B3"
  purchase_id      TEXT NOT NULL,

  type             raw_purchase_type NOT NULL DEFAULT 'raw',
  source           TEXT,          -- Buyee, Yahoo Auctions, etc.
  order_number     TEXT,
  language         TEXT NOT NULL DEFAULT 'JP',

  -- Card identity (denormalized from spreadsheet row)
  catalog_id       UUID REFERENCES card_catalog(id) ON DELETE SET NULL,
  card_name        TEXT,
  set_name         TEXT,
  card_number      TEXT,

  -- Cost tracking
  total_cost_yen   INTEGER,       -- raw yen amount
  fx_rate          NUMERIC(10,4), -- JPY → USD rate at time of purchase
  total_cost_usd   INTEGER,       -- cents (computed or manual)
  card_count       INTEGER NOT NULL DEFAULT 1,

  status           raw_purchase_status NOT NULL DEFAULT 'ordered',
  purchased_at     DATE,
  received_at      DATE,
  reserved         BOOLEAN NOT NULL DEFAULT false,
  notes            TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, purchase_id)
);

CREATE INDEX idx_raw_purchases_user ON raw_purchases(user_id);
CREATE INDEX idx_raw_purchases_status ON raw_purchases(user_id, status);

-- ============================================================
-- SEQUENCE TRACKER for purchase ID generation
-- ============================================================

CREATE TABLE raw_purchase_sequences (
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year      INTEGER NOT NULL,
  type      raw_purchase_type NOT NULL,
  next_seq  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, year, type)
);

-- ============================================================
-- LINK card_instances BACK TO A RAW PURCHASE
-- ============================================================

ALTER TABLE card_instances
  ADD COLUMN IF NOT EXISTS raw_purchase_id UUID REFERENCES raw_purchases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decision TEXT CHECK (decision IN ('sell_raw', 'grade'));

CREATE INDEX idx_card_instances_raw_purchase ON card_instances(raw_purchase_id);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================

CREATE TRIGGER trg_raw_purchases_updated_at
  BEFORE UPDATE ON raw_purchases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
