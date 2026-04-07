-- Migration: 016_reorder_thresholds
-- Reorder alert thresholds for bulk card inventory

CREATE TABLE reorder_thresholds (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalog_id  UUID NOT NULL REFERENCES card_catalog(id) ON DELETE CASCADE,

  min_quantity  INTEGER NOT NULL DEFAULT 1,  -- alert when unsold < this
  is_ignored    BOOLEAN NOT NULL DEFAULT false, -- permanently silenced
  muted_until   TIMESTAMPTZ,                 -- temporarily silenced until this date

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, catalog_id)
);

CREATE INDEX idx_reorder_thresholds_user ON reorder_thresholds(user_id);

CREATE TRIGGER trg_reorder_thresholds_updated_at
  BEFORE UPDATE ON reorder_thresholds
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
