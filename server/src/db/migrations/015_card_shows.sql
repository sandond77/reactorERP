-- Up
CREATE TABLE card_shows (
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

ALTER TABLE sales ADD COLUMN card_show_id UUID REFERENCES card_shows(id) ON DELETE SET NULL;

-- Down
ALTER TABLE sales DROP COLUMN IF EXISTS card_show_id;
DROP TABLE IF EXISTS card_shows;
