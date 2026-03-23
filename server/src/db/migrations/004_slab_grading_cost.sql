-- Migration: 004_slab_grading_cost
-- Add grading_cost directly to slab_details so we can record the fee
-- without requiring a grading_submission record.

ALTER TABLE slab_details
  ADD COLUMN IF NOT EXISTS grading_cost INTEGER NOT NULL DEFAULT 0;
