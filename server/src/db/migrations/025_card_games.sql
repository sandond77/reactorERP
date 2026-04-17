CREATE TABLE IF NOT EXISTS card_games (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS card_games_name_lower ON card_games (LOWER(name));

INSERT INTO card_games (name) VALUES ('pokemon') ON CONFLICT DO NOTHING;
