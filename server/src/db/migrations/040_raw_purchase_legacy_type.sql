-- Add 'legacy' to raw_purchase_type enum so legacy grading submissions
-- (cards owned before tracking purchases in Reactor) can be auto-created with
-- a distinct ID format like YYYYL{N}.

ALTER TYPE raw_purchase_type ADD VALUE IF NOT EXISTS 'legacy';
