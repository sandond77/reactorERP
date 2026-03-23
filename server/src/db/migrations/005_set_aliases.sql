CREATE TABLE IF NOT EXISTS pokemon_set_aliases (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  language   TEXT NOT NULL CHECK (language IN ('EN', 'JP')),
  alias      TEXT NOT NULL,          -- lowercase PSA name fragment
  set_code   TEXT NOT NULL,          -- internal code part, e.g. 'SWSH9', 'SPEC-S8a'
  set_name   TEXT,                   -- optional human-readable canonical name
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (language, alias)
);
CREATE INDEX IF NOT EXISTS idx_set_aliases_lang ON pokemon_set_aliases(language);
