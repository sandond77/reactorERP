-- Card languages registry (per-org user-defined languages beyond EN/JP)
CREATE TABLE IF NOT EXISTS card_languages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code        VARCHAR(10) NOT NULL,   -- e.g. "FR", "KR", "DE"
  name        VARCHAR(100) NOT NULL,  -- e.g. "French", "Korean"
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, code)
);
