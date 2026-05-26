-- Migration: 053_seed_legacy_catalog_entries
-- Per-user "Legacy" catalog buckets (EN + JP) for the legacy-stash grading
-- workflow. The set_code = 'LEGACY' convention is the signal that:
--   (a) the auto-relink in processReturn swaps a slab off the legacy bucket
--       back to its real part once the slab's name is known, and
--   (b) the lot decrement on return shrinks the stash for any raw_purchase
--       whose catalog entry has set_code = 'LEGACY'.
-- Idempotent via NOT EXISTS — won't duplicate for users who already created
-- one manually.

INSERT INTO card_catalog (user_id, game, sku, set_code, set_name, card_name, language)
SELECT u.id, 'pokemon', 'PKMN-EN-LEGACY-LEGACYCARDS', 'LEGACY', 'Legacy — Various', 'Legacy Cards', 'EN'
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM card_catalog cc
  WHERE cc.user_id = u.id AND cc.sku = 'PKMN-EN-LEGACY-LEGACYCARDS'
);

INSERT INTO card_catalog (user_id, game, sku, set_code, set_name, card_name, language)
SELECT u.id, 'pokemon', 'PKMN-JP-LEGACY-LEGACYCARDS', 'LEGACY', 'Legacy — Various', 'Legacy Cards', 'JP'
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM card_catalog cc
  WHERE cc.user_id = u.id AND cc.sku = 'PKMN-JP-LEGACY-LEGACYCARDS'
);
