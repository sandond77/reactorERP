-- Add actor column to audit_log to distinguish user vs agent actions
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor TEXT NOT NULL DEFAULT 'user';

-- Backfill existing rows
UPDATE audit_log SET actor = 'user' WHERE actor IS NULL OR actor = '';

-- Index for filtering by actor
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(user_id, actor, created_at DESC);
