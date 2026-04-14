-- Add actor_name to audit_log to store the actual user's display name
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_name TEXT;
