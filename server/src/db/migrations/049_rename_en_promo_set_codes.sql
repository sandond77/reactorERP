-- Rename the inconsistent EN promo set codes from PROMO-XX to XX-P, matching
-- the SV-P / SWSH-P / SM-P pattern already in use for newer generations.
-- Format is "generation - set type" everywhere now (XY1, XY-P) instead of
-- the older mixed style (XY1, PROMO-XY).

-- 1) Update set_codes registry rows
UPDATE set_codes SET set_code = 'XY-P'   WHERE set_code = 'PROMO-XY';
UPDATE set_codes SET set_code = 'BW-P'   WHERE set_code = 'PROMO-BW';
UPDATE set_codes SET set_code = 'HGSS-P' WHERE set_code = 'PROMO-HGSS';
UPDATE set_codes SET set_code = 'DP-P'   WHERE set_code = 'PROMO-DP';
UPDATE set_codes SET set_code = 'EX-P'   WHERE set_code = 'PROMO-EX';
UPDATE set_codes SET set_code = 'WOTC-P' WHERE set_code = 'PROMO-WOTC';

-- 2) Rewrite card_catalog.set_code on matching rows
UPDATE card_catalog SET set_code = 'XY-P'   WHERE set_code = 'PROMO-XY';
UPDATE card_catalog SET set_code = 'BW-P'   WHERE set_code = 'PROMO-BW';
UPDATE card_catalog SET set_code = 'HGSS-P' WHERE set_code = 'PROMO-HGSS';
UPDATE card_catalog SET set_code = 'DP-P'   WHERE set_code = 'PROMO-DP';
UPDATE card_catalog SET set_code = 'EX-P'   WHERE set_code = 'PROMO-EX';
UPDATE card_catalog SET set_code = 'WOTC-P' WHERE set_code = 'PROMO-WOTC';

-- 3) Rewrite card_catalog.sku prefixes that contain the old code.
--    SKUs look like PKMN-EN-PROMO-XY-001 → PKMN-EN-XY-P-001.
UPDATE card_catalog SET sku = REPLACE(sku, '-PROMO-XY-',   '-XY-P-')   WHERE sku LIKE '%-PROMO-XY-%';
UPDATE card_catalog SET sku = REPLACE(sku, '-PROMO-BW-',   '-BW-P-')   WHERE sku LIKE '%-PROMO-BW-%';
UPDATE card_catalog SET sku = REPLACE(sku, '-PROMO-HGSS-', '-HGSS-P-') WHERE sku LIKE '%-PROMO-HGSS-%';
UPDATE card_catalog SET sku = REPLACE(sku, '-PROMO-DP-',   '-DP-P-')   WHERE sku LIKE '%-PROMO-DP-%';
UPDATE card_catalog SET sku = REPLACE(sku, '-PROMO-EX-',   '-EX-P-')   WHERE sku LIKE '%-PROMO-EX-%';
UPDATE card_catalog SET sku = REPLACE(sku, '-PROMO-WOTC-', '-WOTC-P-') WHERE sku LIKE '%-PROMO-WOTC-%';
