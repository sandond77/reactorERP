-- Consolidate the weiss-schwarz aliases into a single row, change its
-- abbreviation to 'WC' (per user preference), and add union_arena.
--
-- Backfills any card_catalog rows that referenced the deleted aliases so
-- they point at the canonical 'weiss-schwarz' game name, and rewrites
-- their stored SKU prefix from WS → WC. Union Arena rows (if any) will
-- pick up the new UA prefix the next time their SKU is regenerated.

-- 1. Re-point catalog rows from aliased game names to the canonical one
UPDATE card_catalog SET game = 'weiss-schwarz'
 WHERE game IN ('weiss', 'weiss_schwarz');

-- 2. Drop alias card_games rows + the unused 'old_maid' entry
DELETE FROM card_games WHERE name IN ('weiss', 'weiss_schwarz', 'old_maid');

-- 3. Change Weiss Schwarz abbreviation to WC
UPDATE card_games SET abbreviation = 'WC' WHERE name = 'weiss-schwarz';

-- 4. Add Union Arena
INSERT INTO card_games (name, abbreviation, languages)
VALUES ('union_arena', 'UA', ARRAY['EN','JP']::text[])
ON CONFLICT (name) DO UPDATE SET abbreviation = 'UA';

-- 5. General re-sync: any catalog row whose stored SKU prefix doesn't
--    match its game's current abbreviation gets rewritten. Catches:
--      - WS → WC (Weiss Schwarz rename above)
--      - UNIO → UA (Union Arena rows created before this migration
--        seeded the canonical abbreviation, so the client fallback
--        prefix was used)
--      - Any future drift between catalog SKUs and card_games.abbreviation
UPDATE card_catalog cc
   SET sku = g.abbreviation || SUBSTRING(cc.sku FROM POSITION('-' IN cc.sku))
  FROM card_games g
 WHERE cc.sku IS NOT NULL
   AND POSITION('-' IN cc.sku) > 0
   AND LOWER(g.name) = LOWER(cc.game)
   AND g.abbreviation IS NOT NULL
   AND cc.sku NOT LIKE g.abbreviation || '-%';
