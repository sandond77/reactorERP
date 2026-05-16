-- Rename the inconsistent EN promo set codes from PROMO-XX to XX-P, matching
-- the SV-P / SWSH-P / SM-P pattern already in use for newer generations.
-- Format is "generation - set type" everywhere now (XY1, XY-P) instead of
-- the older mixed style (XY1, PROMO-XY).

WITH renames(old_code, new_code) AS (
  VALUES
    ('PROMO-XY',   'XY-P'),
    ('PROMO-BW',   'BW-P'),
    ('PROMO-HGSS', 'HGSS-P'),
    ('PROMO-DP',   'DP-P'),
    ('PROMO-EX',   'EX-P'),
    ('PROMO-WOTC', 'WOTC-P')
)
-- 1) Update set_codes registry rows
, _upd_set_codes AS (
  UPDATE set_codes sc
     SET set_code = r.new_code
    FROM renames r
   WHERE sc.set_code = r.old_code
   RETURNING 1
)
-- 2) Rewrite card_catalog.set_code on any matching rows
, _upd_catalog_set_code AS (
  UPDATE card_catalog cc
     SET set_code = r.new_code
    FROM renames r
   WHERE cc.set_code = r.old_code
   RETURNING 1
)
-- 3) Rewrite card_catalog.sku prefixes that contain the old code.
--    SKUs look like PKMN-EN-PROMO-XY-001 → become PKMN-EN-XY-P-001.
, _upd_catalog_sku AS (
  UPDATE card_catalog cc
     SET sku = REPLACE(cc.sku, '-' || r.old_code || '-', '-' || r.new_code || '-')
    FROM renames r
   WHERE cc.sku IS NOT NULL
     AND cc.sku LIKE '%-' || r.old_code || '-%'
   RETURNING 1
)
SELECT 1;
