-- Migration: 054_legacy_source_catalog_id
-- Adds a nullable back-reference on card_instances pointing at the legacy
-- catalog bucket a card was pulled from (when it was pulled via the Legacy
-- tab in Add Card to Batch). The slab created on grading return inherits
-- this column from its source raw, so legacy buckets can cross-tally their
-- "graded" count even though the slab itself lives under its real
-- catalog_id. ON DELETE SET NULL so removing the legacy bucket doesn't
-- delete the slab — it just stops the cross-tally for that row.

ALTER TABLE card_instances
  ADD COLUMN IF NOT EXISTS legacy_source_catalog_id UUID
    REFERENCES card_catalog(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_card_instances_legacy_source
  ON card_instances(legacy_source_catalog_id)
  WHERE legacy_source_catalog_id IS NOT NULL;
