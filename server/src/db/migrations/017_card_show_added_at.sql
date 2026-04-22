-- Up
ALTER TABLE card_instances
  ADD COLUMN IF NOT EXISTS is_card_show BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE card_instances
  ADD COLUMN IF NOT EXISTS card_show_added_at TIMESTAMPTZ;

-- Backfill existing card-show inventory with created_at as a reasonable baseline
UPDATE card_instances
SET card_show_added_at = created_at
WHERE is_card_show = true AND card_show_added_at IS NULL;

-- Down
ALTER TABLE card_instances DROP COLUMN IF EXISTS card_show_added_at;
