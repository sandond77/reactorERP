-- Migration: 057_card_instances_graded_out
--
-- Soft-delete flag for raw card_instances that have been fully transformed
-- into slabs via grading. Replaces the previous hard-delete behavior in
-- processReturn, which orphaned grading_batch_items.card_instance_id refs
-- and nulled out slab_details.source_raw_instance_id (ON DELETE SET NULL).
--
-- After this migration:
--   - processReturn marks the source raw with graded_out=true, quantity=0
--     instead of DELETE FROM card_instances.
--   - source_raw_instance_id stays valid forever on the slab.
--   - grading_batch_items still references a real row; sub detail page can
--     join through it for lifecycle display.
--   - revertReturn becomes a simple "flip the flag back + restore quantity"
--     instead of needing audit-log re-insertion.
--
-- Filter rules going forward:
--   - Active raw inventory views: WHERE graded_out = false
--   - Total cost basis / P&L: WHERE graded_out = false (cost is now on slab)
--   - Sub detail / lifecycle: no filter (intentionally shows graded_out rows)

ALTER TABLE card_instances
  ADD COLUMN IF NOT EXISTS graded_out BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index — graded_out=true rows are a small slice over time; queries
-- almost always filter to false, so the index pays off on the true subset
-- for trace-from-raw-to-slab lookups.
CREATE INDEX IF NOT EXISTS idx_card_instances_graded_out
  ON card_instances(graded_out)
  WHERE graded_out = true;

-- Relax the quantity check from > 0 to >= 0. graded_out rows carry
-- quantity=0 (all physical cards have been converted to slabs), so the
-- stricter check would block the UPDATE that replaces the old hard-delete.
ALTER TABLE card_instances DROP CONSTRAINT IF EXISTS card_instances_quantity_check;
ALTER TABLE card_instances ADD CONSTRAINT card_instances_quantity_check CHECK (quantity >= 0);
