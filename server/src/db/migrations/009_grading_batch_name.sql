-- Migration: 009_grading_batch_name
-- Add human-readable name to grading_batches and rename cost_per_card semantics

ALTER TABLE grading_batches ADD COLUMN name TEXT;
ALTER TABLE grading_batch_items ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1;
