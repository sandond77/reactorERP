-- Migration: 010_grading_batch_line_item
-- Add line item number to grading_batch_items for ordered tracking

ALTER TABLE grading_batch_items ADD COLUMN line_item_num INTEGER NOT NULL DEFAULT 1;
