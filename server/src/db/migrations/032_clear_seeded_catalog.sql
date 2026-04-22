-- Remove catalog entries that were auto-seeded on first login.
-- Going forward, card_catalog starts empty and entries are created
-- only when cards are actually added to inventory.
DELETE FROM card_catalog WHERE id NOT IN (
  SELECT DISTINCT catalog_id FROM card_instances WHERE catalog_id IS NOT NULL
);
