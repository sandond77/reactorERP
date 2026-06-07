-- Migration: 055_grading_batch_items_drop_card_instance_fk
--
-- processReturn hard-deletes the original raw card_instance once every copy
-- in a sub-line has been consumed (each slab is a brand-new card_instance
-- row + slab_details row). The grading_batch_items.card_instance_id FK had
-- ON DELETE NO ACTION, so the delete failed with constraint violation 23503
-- as soon as a qty-1 sub-line went all the way through.
--
-- batch_item.card_instance_id stays useful as a soft reference (revertReturn
-- looks it up via audit_log to restore the original on revert), so the
-- cleanest fix is to drop the FK constraint entirely. The column keeps its
-- UUID value and NOT NULL; we just stop Postgres from enforcing referential
-- integrity, which application code already handles.

ALTER TABLE grading_batch_items
  DROP CONSTRAINT IF EXISTS grading_batch_items_card_instance_id_fkey;
