// ────────────────────────────────────────────────────────────────────────────
// AI extraction corrections — the raw material for the "curated library"
// side of the feedback loop.
//
// When a user saves a form that was pre-populated by one of our AI subagents
// (vision card OCR, receipt parsing, return matching) with edits, the client
// posts the ORIGINAL model output alongside the FINAL saved values. We diff
// them, store the pair, and later run curation to turn common miss patterns
// into concrete prompt rules or examples.
//
// This module owns just the write + read primitives — the curation script
// (server/src/scripts/curate-vision-corrections.ts) is the consumer.
// ────────────────────────────────────────────────────────────────────────────

import * as crypto from 'crypto';
import { db } from '../../config/database';
import type { AiCorrectionSource } from '../../types/db';
import { diffFields } from './corrections.diff';

export { diffFields };

export interface RecordCorrectionInput {
  source: AiCorrectionSource;
  model?: string | null;
  // Either a base64 image (we hash it) OR a pre-computed hash (client already
  // resized/hashed). Never both.
  image_base64?: string;
  image_hash?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model_output: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  final_output: any;
}

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'base64').digest('hex');
}

export async function recordCorrection(userId: string, input: RecordCorrectionInput) {
  const fields_changed = diffFields(input.model_output, input.final_output);
  // Silently skip no-op saves — the point of the table is corrections, not
  // "user accepted AI verbatim." Keeps signal-to-noise high and avoids
  // storing thousands of empty diffs for auto-fills the user just clicked
  // through.
  if (fields_changed.length === 0) return null;

  const image_hash = input.image_hash
    ?? (input.image_base64 ? sha256Hex(input.image_base64) : null);

  const row = await db
    .insertInto('ai_extraction_corrections')
    .values({
      user_id: userId,
      source: input.source,
      image_hash,
      model: input.model ?? null,
      model_output: input.model_output,
      final_output: input.final_output,
      fields_changed,
    })
    .returning(['id', 'fields_changed'])
    .executeTakeFirstOrThrow();
  return row;
}
