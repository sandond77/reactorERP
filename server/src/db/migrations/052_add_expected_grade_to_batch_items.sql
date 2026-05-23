-- Migration: 052_add_expected_grade_to_batch_items
-- expected_grade has been referenced in code (types/db.ts, the grading-subs
-- GET handler, and the Add/Edit Card form) since the original grading-subs
-- feature, but no migration ever created the column. On any DB that didn't
-- receive an out-of-band ALTER, GET /api/v1/grading-subs/:id returns 500
-- ("column gbi.expected_grade does not exist") and the sub-detail page
-- can't load. NUMERIC(4,1) matches slab_details.grade so half-grades
-- (e.g. 9.5) round-trip cleanly. Idempotent via IF NOT EXISTS.

ALTER TABLE grading_batch_items
  ADD COLUMN IF NOT EXISTS expected_grade NUMERIC(4,1);
