-- Rename the inconsistent EN promo set codes from PROMO-XX to XX-P, matching
-- the SV-P / SWSH-P / SM-P pattern already in use for newer generations.
-- Format is "generation - set type" everywhere now (XY1, XY-P) instead of
-- the older mixed style (XY1, PROMO-XY).
--
-- Both set_codes and card_catalog have UNIQUE indexes that include set_code,
-- so we first delete any old PROMO-XX row that would collide with an
-- existing XX-P row for the same identity. Then rename what's left.

-- ── set_codes ──────────────────────────────────────────────────────────────
-- Drop old entries when the new one already exists for the same (user, game, language).
DELETE FROM set_codes a USING set_codes b
 WHERE a.set_code = 'PROMO-XY'   AND b.set_code = 'XY-P'
   AND a.user_id = b.user_id AND a.game = b.game AND a.language = b.language;
DELETE FROM set_codes a USING set_codes b
 WHERE a.set_code = 'PROMO-BW'   AND b.set_code = 'BW-P'
   AND a.user_id = b.user_id AND a.game = b.game AND a.language = b.language;
DELETE FROM set_codes a USING set_codes b
 WHERE a.set_code = 'PROMO-HGSS' AND b.set_code = 'HGSS-P'
   AND a.user_id = b.user_id AND a.game = b.game AND a.language = b.language;
DELETE FROM set_codes a USING set_codes b
 WHERE a.set_code = 'PROMO-DP'   AND b.set_code = 'DP-P'
   AND a.user_id = b.user_id AND a.game = b.game AND a.language = b.language;
DELETE FROM set_codes a USING set_codes b
 WHERE a.set_code = 'PROMO-EX'   AND b.set_code = 'EX-P'
   AND a.user_id = b.user_id AND a.game = b.game AND a.language = b.language;
DELETE FROM set_codes a USING set_codes b
 WHERE a.set_code = 'PROMO-WOTC' AND b.set_code = 'WOTC-P'
   AND a.user_id = b.user_id AND a.game = b.game AND a.language = b.language;

UPDATE set_codes SET set_code = 'XY-P'   WHERE set_code = 'PROMO-XY';
UPDATE set_codes SET set_code = 'BW-P'   WHERE set_code = 'PROMO-BW';
UPDATE set_codes SET set_code = 'HGSS-P' WHERE set_code = 'PROMO-HGSS';
UPDATE set_codes SET set_code = 'DP-P'   WHERE set_code = 'PROMO-DP';
UPDATE set_codes SET set_code = 'EX-P'   WHERE set_code = 'PROMO-EX';
UPDATE set_codes SET set_code = 'WOTC-P' WHERE set_code = 'PROMO-WOTC';

-- ── card_catalog ──────────────────────────────────────────────────────────
-- Same dedup pattern using the catalog identity key
-- (user_id, game, set_code, card_number, variant, language).
DELETE FROM card_catalog a USING card_catalog b
 WHERE a.set_code = 'PROMO-XY'   AND b.set_code = 'XY-P'
   AND a.user_id = b.user_id AND a.game = b.game AND a.language = b.language
   AND a.card_number IS NOT DISTINCT FROM b.card_number
   AND a.variant     IS NOT DISTINCT FROM b.variant;
DELETE FROM card_catalog a USING card_catalog b
 WHERE a.set_code = 'PROMO-BW'   AND b.set_code = 'BW-P'
   AND a.user_id = b.user_id AND a.game = b.game AND a.language = b.language
   AND a.card_number IS NOT DISTINCT FROM b.card_number
   AND a.variant     IS NOT DISTINCT FROM b.variant;
DELETE FROM card_catalog a USING card_catalog b
 WHERE a.set_code = 'PROMO-HGSS' AND b.set_code = 'HGSS-P'
   AND a.user_id = b.user_id AND a.game = b.game AND a.language = b.language
   AND a.card_number IS NOT DISTINCT FROM b.card_number
   AND a.variant     IS NOT DISTINCT FROM b.variant;
DELETE FROM card_catalog a USING card_catalog b
 WHERE a.set_code = 'PROMO-DP'   AND b.set_code = 'DP-P'
   AND a.user_id = b.user_id AND a.game = b.game AND a.language = b.language
   AND a.card_number IS NOT DISTINCT FROM b.card_number
   AND a.variant     IS NOT DISTINCT FROM b.variant;
DELETE FROM card_catalog a USING card_catalog b
 WHERE a.set_code = 'PROMO-EX'   AND b.set_code = 'EX-P'
   AND a.user_id = b.user_id AND a.game = b.game AND a.language = b.language
   AND a.card_number IS NOT DISTINCT FROM b.card_number
   AND a.variant     IS NOT DISTINCT FROM b.variant;
DELETE FROM card_catalog a USING card_catalog b
 WHERE a.set_code = 'PROMO-WOTC' AND b.set_code = 'WOTC-P'
   AND a.user_id = b.user_id AND a.game = b.game AND a.language = b.language
   AND a.card_number IS NOT DISTINCT FROM b.card_number
   AND a.variant     IS NOT DISTINCT FROM b.variant;

UPDATE card_catalog SET set_code = 'XY-P'   WHERE set_code = 'PROMO-XY';
UPDATE card_catalog SET set_code = 'BW-P'   WHERE set_code = 'PROMO-BW';
UPDATE card_catalog SET set_code = 'HGSS-P' WHERE set_code = 'PROMO-HGSS';
UPDATE card_catalog SET set_code = 'DP-P'   WHERE set_code = 'PROMO-DP';
UPDATE card_catalog SET set_code = 'EX-P'   WHERE set_code = 'PROMO-EX';
UPDATE card_catalog SET set_code = 'WOTC-P' WHERE set_code = 'PROMO-WOTC';

-- ── card_catalog.sku ──────────────────────────────────────────────────────
-- Rewrite SKU prefixes (PKMN-EN-PROMO-XY-001 → PKMN-EN-XY-P-001). Unique
-- index is on (user_id, sku); same dedup pattern.
DELETE FROM card_catalog a USING card_catalog b
 WHERE a.sku LIKE '%-PROMO-XY-%'
   AND b.sku = REPLACE(a.sku, '-PROMO-XY-', '-XY-P-')
   AND a.user_id IS NOT DISTINCT FROM b.user_id
   AND a.id != b.id;
UPDATE card_catalog SET sku = REPLACE(sku, '-PROMO-XY-',   '-XY-P-')   WHERE sku LIKE '%-PROMO-XY-%';

DELETE FROM card_catalog a USING card_catalog b
 WHERE a.sku LIKE '%-PROMO-BW-%'
   AND b.sku = REPLACE(a.sku, '-PROMO-BW-', '-BW-P-')
   AND a.user_id IS NOT DISTINCT FROM b.user_id
   AND a.id != b.id;
UPDATE card_catalog SET sku = REPLACE(sku, '-PROMO-BW-',   '-BW-P-')   WHERE sku LIKE '%-PROMO-BW-%';

DELETE FROM card_catalog a USING card_catalog b
 WHERE a.sku LIKE '%-PROMO-HGSS-%'
   AND b.sku = REPLACE(a.sku, '-PROMO-HGSS-', '-HGSS-P-')
   AND a.user_id IS NOT DISTINCT FROM b.user_id
   AND a.id != b.id;
UPDATE card_catalog SET sku = REPLACE(sku, '-PROMO-HGSS-', '-HGSS-P-') WHERE sku LIKE '%-PROMO-HGSS-%';

DELETE FROM card_catalog a USING card_catalog b
 WHERE a.sku LIKE '%-PROMO-DP-%'
   AND b.sku = REPLACE(a.sku, '-PROMO-DP-', '-DP-P-')
   AND a.user_id IS NOT DISTINCT FROM b.user_id
   AND a.id != b.id;
UPDATE card_catalog SET sku = REPLACE(sku, '-PROMO-DP-',   '-DP-P-')   WHERE sku LIKE '%-PROMO-DP-%';

DELETE FROM card_catalog a USING card_catalog b
 WHERE a.sku LIKE '%-PROMO-EX-%'
   AND b.sku = REPLACE(a.sku, '-PROMO-EX-', '-EX-P-')
   AND a.user_id IS NOT DISTINCT FROM b.user_id
   AND a.id != b.id;
UPDATE card_catalog SET sku = REPLACE(sku, '-PROMO-EX-',   '-EX-P-')   WHERE sku LIKE '%-PROMO-EX-%';

DELETE FROM card_catalog a USING card_catalog b
 WHERE a.sku LIKE '%-PROMO-WOTC-%'
   AND b.sku = REPLACE(a.sku, '-PROMO-WOTC-', '-WOTC-P-')
   AND a.user_id IS NOT DISTINCT FROM b.user_id
   AND a.id != b.id;
UPDATE card_catalog SET sku = REPLACE(sku, '-PROMO-WOTC-', '-WOTC-P-') WHERE sku LIKE '%-PROMO-WOTC-%';
