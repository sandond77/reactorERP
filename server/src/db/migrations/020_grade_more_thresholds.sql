-- Migration: 020_grade_more_thresholds
-- Alert thresholds for graded card inventory per catalog+company+grade

CREATE TABLE grade_more_thresholds (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalog_id  UUID NOT NULL REFERENCES card_catalog(id) ON DELETE CASCADE,
  company     TEXT NOT NULL DEFAULT '',
  grade       NUMERIC(4,1),
  grade_label TEXT,

  min_quantity  INTEGER NOT NULL DEFAULT 1,
  is_ignored    BOOLEAN NOT NULL DEFAULT false,
  muted_until   TIMESTAMPTZ,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, catalog_id, company, grade)
);

CREATE INDEX idx_grade_more_thresholds_user ON grade_more_thresholds(user_id);

CREATE TRIGGER trg_grade_more_thresholds_updated_at
  BEFORE UPDATE ON grade_more_thresholds
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
