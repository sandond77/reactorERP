-- Editable set codes per user. The static EN_SETS/JP_SETS arrays in
-- server/src/utils/set-codes.ts seed this table on first request per user
-- (is_seeded=true). Users can edit names + add aliases via the Set Codes
-- settings page; their changes override the seed in lookups and dropdowns.
-- New entries (is_seeded=false) can also be added user-defined.

CREATE TABLE IF NOT EXISTS set_codes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game TEXT NOT NULL DEFAULT 'pokemon',
  language TEXT NOT NULL,
  set_code TEXT NOT NULL,
  set_name TEXT NOT NULL,
  era TEXT,
  aliases TEXT[] NOT NULL DEFAULT '{}',
  is_seeded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, game, language, set_code)
);

CREATE INDEX IF NOT EXISTS idx_set_codes_user_lang ON set_codes(user_id, language);
