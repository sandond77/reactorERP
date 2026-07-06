-- Add is_personal_collection flag to locations so we can identify the
-- auto-seeded "Personal Collection" root the same way we identify the
-- "Card Show" root via is_card_show. When a card is marked
-- is_personal_collection=true, the app moves it into this location so it
-- lives alongside other personal-collection stock instead of orphaning
-- under whatever binder / show / bin it used to belong to.

ALTER TABLE locations
  ADD COLUMN is_personal_collection boolean NOT NULL DEFAULT false;

-- Backfill: seed a Personal Collection root for every user that already
-- has at least one card_instance marked is_personal_collection=true, and
-- reassign those cards' location_id to the new root so the UI shows them
-- in the right place immediately after this migration lands. Users with
-- no PC cards get their root created lazily by ensurePersonalCollectionLocation
-- on first listLocations call.
WITH pc_users AS (
  SELECT DISTINCT user_id
  FROM card_instances
  WHERE is_personal_collection = true
),
new_locations AS (
  INSERT INTO locations (user_id, parent_id, name, card_type, is_card_show, is_personal_collection, is_container)
  SELECT pu.user_id, NULL, 'Personal Collection', 'both', false, true, false
  FROM pc_users pu
  WHERE NOT EXISTS (
    SELECT 1 FROM locations l2
    WHERE l2.user_id = pu.user_id
      AND l2.is_personal_collection = true
      AND l2.parent_id IS NULL
  )
  RETURNING id, user_id
)
UPDATE card_instances ci
SET location_id = nl.id
FROM new_locations nl
WHERE ci.user_id = nl.user_id
  AND ci.is_personal_collection = true;

CREATE INDEX idx_locations_personal_collection ON locations (user_id, is_personal_collection)
  WHERE is_personal_collection = true;
