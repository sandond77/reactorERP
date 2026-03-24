-- Migration: 006_personal_collection
-- Adds is_personal_collection flag to card_instances
-- Cards flagged as personal collection are excluded from listing/sale unsold counts

ALTER TABLE card_instances
  ADD COLUMN is_personal_collection BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX idx_card_instances_personal_collection ON card_instances(user_id, is_personal_collection)
  WHERE is_personal_collection = TRUE;
