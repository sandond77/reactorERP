-- Remove soft-delete column from card_instances — audit_log is now the source of truth
DROP INDEX IF EXISTS idx_card_instances_active;
ALTER TABLE card_instances DROP COLUMN IF EXISTS deleted_at;
