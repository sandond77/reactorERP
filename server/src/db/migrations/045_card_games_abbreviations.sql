-- Make SKU prefixes game-aware. Previously every part number was hardcoded
-- with a 'PKMN-' prefix regardless of the catalog row's game value, which
-- showed wrong (e.g. Weiss Schwarz cards labelled PKMN-JP-…).
--
-- Steps:
--   1. Seed `card_games.abbreviation` for known games. SKU prefix comes from
--      this column going forward.
--   2. Insert any games found in card_catalog that don't yet exist in
--      card_games (with a best-guess abbreviation).
--   3. Rewrite `card_catalog.sku` for rows whose current prefix doesn't match
--      their game's abbreviation. Untouches rows that were already correct.

-- 1. Known games
INSERT INTO card_games (name, abbreviation, languages)
VALUES
  ('pokemon',       'PKMN', ARRAY['EN','JP']::text[]),
  ('one_piece',     'OP',   ARRAY['EN','JP']::text[]),
  ('old_maid',      'OM',   ARRAY['JP']::text[]),
  ('weiss-schwarz', 'WS',   ARRAY['EN','JP']::text[]),
  ('weiss_schwarz', 'WS',   ARRAY['EN','JP']::text[]),
  ('weiss',         'WS',   ARRAY['EN','JP']::text[])
ON CONFLICT (name) DO UPDATE
  SET abbreviation = COALESCE(card_games.abbreviation, EXCLUDED.abbreviation);

-- 2. Backfill any missing games from card_catalog
INSERT INTO card_games (name, abbreviation, languages)
SELECT DISTINCT
  LOWER(cc.game),
  UPPER(LEFT(REGEXP_REPLACE(cc.game, '[^a-zA-Z0-9]', '', 'g'), 4)),
  ARRAY[]::text[]
FROM card_catalog cc
WHERE cc.game IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM card_games g WHERE LOWER(g.name) = LOWER(cc.game)
  )
ON CONFLICT (name) DO NOTHING;

-- 3. Rewrite stored SKUs so the prefix matches the game's abbreviation.
--    SKU shape is `<PREFIX>-<LANG>-<SETCODE>-<NUM>`. We replace just the
--    first segment if it doesn't already match.
UPDATE card_catalog cc
SET sku = g.abbreviation || SUBSTRING(cc.sku FROM POSITION('-' IN cc.sku))
FROM card_games g
WHERE cc.sku IS NOT NULL
  AND POSITION('-' IN cc.sku) > 0
  AND LOWER(g.name) = LOWER(cc.game)
  AND g.abbreviation IS NOT NULL
  AND cc.sku NOT LIKE g.abbreviation || '-%';
