-- Allow 'already_graded' as a valid decision so back-linked slabs render
-- with the right label in the inspection-lines list.

ALTER TABLE card_instances DROP CONSTRAINT IF EXISTS card_instances_decision_check;
ALTER TABLE card_instances ADD CONSTRAINT card_instances_decision_check
  CHECK (decision IS NULL OR decision IN ('sell_raw', 'grade', 'already_graded'));
