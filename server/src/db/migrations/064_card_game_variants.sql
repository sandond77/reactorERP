-- Card game variant codes: the enum that drives the 5th SKU segment
-- (e.g. OP-EN-17-110-ALT, PKMN-EN-BASE-004-1ED). Prior to this migration,
-- card_catalog.variant held free-form prose ("First Edition", "Reverse Holo",
-- "Munch: A Retrospective") that never made it into the SKU, causing alt-art
-- cards sharing a card_number to collide onto the base part.
--
-- This migration is additive-only on prod: adds a new lookup table, seeds
-- Pokemon + One Piece codes, adds a nullable catalog_notes column for
-- surviving prose. NO existing rows are modified. NO CHECK or FK constraints
-- are added yet — those come in a later migration (065) with NOT VALID so
-- legacy prose rows are grandfathered.

CREATE TABLE IF NOT EXISTS card_game_variants (
  game        TEXT    NOT NULL,
  code        TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (game, code)
);

-- Seed: Pokemon
INSERT INTO card_game_variants (game, code, name, description, sort_order) VALUES
  ('pokemon',   '1ED',  'First Edition',    'Cards with the 1st Edition stamp on the base printing',   10),
  ('pokemon',   'SHDW', 'Shadowless',       'Base Set printings without the drop shadow on the frame', 20),
  ('pokemon',   'RH',   'Reverse Holo',     'Reverse-holo treatment on an otherwise non-holo card',    30),
  ('pokemon',   'GS',   'Gold Star',        'Gold Star rarity variants',                                40),
  ('pokemon',   'NRS',  'No Rarity Symbol', 'Printings missing the rarity symbol in the bottom-right', 50)
ON CONFLICT (game, code) DO NOTHING;

-- Seed: One Piece
INSERT INTO card_game_variants (game, code, name, description, sort_order) VALUES
  ('one_piece', 'ALT',  'Alt Art',      'Alternate illustration sharing the base card number', 10),
  ('one_piece', 'MNG',  'Manga Art',    'Manga-style illustration variant',                    20),
  ('one_piece', 'PLL',  'Parallel',     'Parallel foil printing',                              30),
  ('one_piece', 'SEC',  'Secret Rare',  'Secret-rare treatment sharing a card number',         40)
ON CONFLICT (game, code) DO NOTHING;

-- Optional prose storage — used by the resolution flow when a legacy variant
-- value doesn't cleanly map to a new code but the user still wants the prose
-- preserved on the part (e.g. "PSA Magazine Exclusive" as a note, not a
-- variant). Nullable, no default, no other row is affected.
ALTER TABLE card_catalog ADD COLUMN IF NOT EXISTS catalog_notes TEXT;
