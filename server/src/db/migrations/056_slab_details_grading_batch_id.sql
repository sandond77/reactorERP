-- Migration: 056_slab_details_grading_batch_id
--
-- Adds slab_details.grading_batch_id so we can fan grading_cost edits on a
-- batch out to every slab created from that batch. processReturn populates
-- it going forward; existing slabs (pre-migration) stay NULL — they can't
-- be linked back without traversing audit_log, so cost basis on those
-- legacy slabs remains the snapshot taken at return time.
--
-- ON DELETE SET NULL so deleting an old batch leaves the slabs intact with
-- their cost basis frozen at last-known value.

ALTER TABLE slab_details
  ADD COLUMN IF NOT EXISTS grading_batch_id UUID
    REFERENCES grading_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_slab_details_grading_batch
  ON slab_details(grading_batch_id)
  WHERE grading_batch_id IS NOT NULL;
