-- Corrections feedback loop for the AI extraction subagents (vision, receipts,
-- return-matching). Every time an auto-fill result gets saved with edits, we
-- persist (what the model said, what the user actually saved, which fields
-- changed) so a curation script can turn the pile into concrete prompt
-- improvements — rules and few-shot examples that live alongside the
-- subagent code.
--
-- image_hash lets us dedupe near-identical repeat corrections without storing
-- the actual bytes (SHA-256 of the resized JPEG). Nullable because non-image
-- sources (text-only order parsing) don't have one.
--
-- reviewed flag tracks curation state so the same correction doesn't keep
-- showing up in weekly reports after a human has already decided what to do
-- with it. Default false; the curation script sets it true (with an outcome
-- note) once processed.

CREATE TABLE IF NOT EXISTS ai_extraction_corrections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'card_extraction' | 'receipt' | 'return_matching' — matches the subagent
  -- module name so multiple subagents can share the same corrections table.
  source          TEXT NOT NULL,
  -- SHA-256 hex of the input image (or the parsed text for text-only sources).
  -- Enables cluster-by-image analysis without storing PII/bytes.
  image_hash      TEXT,
  -- Which model produced the output being corrected — the same prompt on a
  -- newer model may not need the same fixes.
  model           TEXT,
  -- Full JSON the subagent returned before any user edits.
  model_output    JSONB NOT NULL,
  -- Full JSON the user saved (post-edit). Diffing these two gives us the
  -- correction signal per field.
  final_output    JSONB NOT NULL,
  -- Denormalized diff — list of top-level fields the user changed. Avoids
  -- re-running JSON diff at query time; makes cluster-by-field trivial.
  fields_changed  TEXT[] NOT NULL,
  reviewed        BOOLEAN NOT NULL DEFAULT false,
  reviewer_note   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Curation queries hit "recent, unreviewed, by source." This index covers
-- both the weekly-report path and the per-source dashboard.
CREATE INDEX IF NOT EXISTS idx_ai_corrections_source_created
  ON ai_extraction_corrections(source, reviewed, created_at DESC);

-- Per-user history for a future "your AI corrections" page.
CREATE INDEX IF NOT EXISTS idx_ai_corrections_user_created
  ON ai_extraction_corrections(user_id, created_at DESC);

-- Field-level clustering (unnest fields_changed) — GIN on the array so
-- "give me every correction that touched card_number" is fast.
CREATE INDEX IF NOT EXISTS idx_ai_corrections_fields
  ON ai_extraction_corrections USING GIN (fields_changed);
