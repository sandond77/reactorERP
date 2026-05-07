-- @no-transaction
-- Add 'legacy' to raw_purchase_type enum so legacy grading submissions
-- (cards owned before tracking purchases in Reactor) can be auto-created with
-- a distinct ID format like YYYYL{N}.
--
-- ALTER TYPE ADD VALUE cannot run inside a transaction block, so this file
-- carries the @no-transaction directive for the migration runner.

ALTER TYPE raw_purchase_type ADD VALUE IF NOT EXISTS 'legacy';
