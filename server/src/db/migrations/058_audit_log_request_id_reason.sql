-- Add request correlation + free-text reason to audit_log.
--
-- request_id groups every audit row produced by a single inbound HTTP request
-- so cascading mutations (e.g. delete a raw_purchase, which unlinks N
-- card_instances) can be queried as one unit.
--
-- reason captures the "why" — agent tools record the originating user message
-- and the tool name; manual server-side fixes record a short note; the field
-- is nullable so untouched call sites keep working.

ALTER TABLE audit_log
  ADD COLUMN request_id uuid,
  ADD COLUMN reason     text;

CREATE INDEX idx_audit_log_request ON audit_log (request_id);
