-- Migration: 011_grading_batch_submission_number
-- Add company submission/order number to grading_batches

ALTER TABLE grading_batches
  ADD COLUMN IF NOT EXISTS submission_number TEXT;
