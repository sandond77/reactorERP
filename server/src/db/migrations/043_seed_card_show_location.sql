-- Seed a "Card Show" root location for every existing user that doesn't have
-- one (matches the lazy-seed in locations.service.ts so existing users don't
-- need to wait for their first listLocations call to materialize it).
--
-- Then backfill: any card_instance flagged is_card_show=true that isn't
-- already located somewhere under that user's Card Show root gets reassigned
-- to it. Cards already inside a sub-location of Card Show are left alone so
-- we don't clobber manual sub-location assignments.

INSERT INTO locations (user_id, parent_id, name, card_type, is_card_show, is_container, notes)
SELECT u.id, NULL, 'Card Show', 'both', true, false, NULL
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM locations l
  WHERE l.user_id = u.id
    AND l.parent_id IS NULL
    AND l.is_card_show = true
);

WITH RECURSIVE card_show_tree(user_id, location_id) AS (
  SELECT user_id, id FROM locations
  WHERE parent_id IS NULL AND is_card_show = true
  UNION ALL
  SELECT cst.user_id, l.id FROM locations l
  JOIN card_show_tree cst ON l.parent_id = cst.location_id
)
UPDATE card_instances ci
SET location_id = (
  SELECT id FROM locations
  WHERE user_id = ci.user_id AND parent_id IS NULL AND is_card_show = true
  LIMIT 1
)
WHERE ci.is_card_show = true
  AND (
    ci.location_id IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM card_show_tree cst
      WHERE cst.user_id = ci.user_id AND cst.location_id = ci.location_id
    )
  );
