// ────────────────────────────────────────────────────────────────────────────
// Return-matching subagent — AI-assisted PSA/BGS return slotting.
//
// Sub returns work like this: a grading batch of N cards ships to PSA, and
// weeks later a CSV arrives listing the returned slabs. Each CSV row must
// be mapped back to the batch item it came from so we can record cert,
// grade, and (for name-drift cases) a new card_name_override.
//
// The client already runs a deterministic scorer (`scoreMatch` in
// SubReturns.tsx) that handles 80% of returns — perfect name/card-number
// overlaps trivially. This subagent handles the tail: PSA's "Subject" text
// diverges from our stored name (translation drift, abbreviations, extra
// qualifiers, holo variants), the card number lives inside prose instead
// of a dedicated column, or the CSV has typos.
//
// Design choices:
//   - Model: Haiku 4.5. Text-only, cheap, fast. The whole payload is a few
//     KB even for 100-card batches.
//   - Cache: system prompt is stable → `cache_control: ephemeral` on
//     the system block. Callers should submit only the UNRESOLVED batch
//     items and UNUSED candidates so payloads stay small; the deterministic
//     matches already found don't need to be re-litigated by the model.
//   - Output shape mirrors what the deterministic scorer already emits:
//     { batch_item_id, csv_index, confidence, reasoning }.
// ────────────────────────────────────────────────────────────────────────────

import { anthropic } from './client';

export interface UnmatchedBatchItem {
  batch_item_id: string;
  card_name: string | null;
  set_name: string | null;
  card_number: string | null;
  language: string | null;
  expected_grade: number | null;
  line_item_num: number;
}

export interface UnusedCandidate {
  csv_index: number;
  subject: string;
  cert: string;
  grade: number | null;
  grade_label?: string;
  card_number?: string;
  set_name?: string;
  language?: string;
  line_num?: number;
}

export interface AiReturnMatch {
  batch_item_id: string;
  csv_index: number;
  confidence: 'strong' | 'good' | 'weak';
  reasoning: string;
}

const RETURN_MATCH_SYSTEM_PROMPT = `You are matching returned graded-card CSV rows back to their original submission entries.

Input:
- BATCH ITEMS: cards the user submitted for grading, with the fields we stored (card_name, set_name, card_number, language, expected_grade, line_item_num).
- CSV CANDIDATES: rows from PSA/BGS's return CSV, with a free-text "subject" plus any structured columns we could pull out (cert, grade, card_number, set_name, language, line_num).

The client's deterministic scorer already handled all trivial (exact name / exact card_number) matches. You are only receiving items that scored weakly or not at all. Reasons that typically break the deterministic scorer:
- PSA translates or paraphrases Japanese names ("エリカのミニリュウ" stored, "Erika's Dratini" in CSV; "旧裏" stored, "Old Back" in CSV).
- Set names diverge in style ("Sword & Shield Promo" vs "SWSH Black Star Promo").
- Card number sits inside the subject prose instead of its own column.
- Qualifiers (Holo / Reverse Holo / 1st Edition) are added or dropped between our record and PSA's label.
- Typos or missing spaces in the CSV subject.

Match rules:
1. A CSV row can be assigned to at most ONE batch item, and vice versa. Choose the pairing where the evidence is strongest, then move on.
2. Prefer confidence: strong (name + card # both align, even if worded differently), good (one strong signal + one supporting), weak (plausible best-fit among the remaining, but you're not sure).
3. If line_item_num on our side equals line_num on the CSV row, that's a very strong signal — PSA preserves line order more often than not.
4. If nothing in the candidate list is a plausible match for a batch item, LEAVE IT OUT of the response. Do not force-assign.
5. If nothing on either side is unambiguous, prefer omitting over guessing — the user reviews weak matches manually anyway.

Return ONLY a JSON array of matches (no prose, no markdown, no code fences). Each element:
{ "batch_item_id": "<uuid from BATCH ITEMS>", "csv_index": <number from CSV CANDIDATES>, "confidence": "strong" | "good" | "weak", "reasoning": "<one sentence>" }

An empty array is a valid response if nothing matches confidently.`;

export function parseAiReturnMatches(raw: string): AiReturnMatch[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is { batch_item_id: unknown; csv_index: unknown; confidence: unknown; reasoning?: unknown } =>
          x && typeof x === 'object',
      )
      .map((x): AiReturnMatch => {
        const conf = x.confidence;
        const normalized: AiReturnMatch['confidence'] =
          conf === 'strong' || conf === 'good' || conf === 'weak' ? conf : 'weak';
        return {
          batch_item_id: String(x.batch_item_id ?? ''),
          csv_index: Number(x.csv_index),
          confidence: normalized,
          reasoning: typeof x.reasoning === 'string' ? x.reasoning : '',
        };
      })
      .filter((m) => m.batch_item_id.length > 0 && Number.isFinite(m.csv_index));
  } catch {
    return [];
  }
}

function dedupeGreedy(matches: AiReturnMatch[]): AiReturnMatch[] {
  // Belt-and-suspenders: the model is told a batch_item / csv_index may only
  // appear once, but reality is messier. Rank by confidence and enforce uniqueness.
  const rank: Record<AiReturnMatch['confidence'], number> = { strong: 3, good: 2, weak: 1 };
  const sorted = [...matches].sort((a, b) => rank[b.confidence] - rank[a.confidence]);
  const usedItems = new Set<string>();
  const usedCands = new Set<number>();
  const out: AiReturnMatch[] = [];
  for (const m of sorted) {
    if (usedItems.has(m.batch_item_id) || usedCands.has(m.csv_index)) continue;
    usedItems.add(m.batch_item_id);
    usedCands.add(m.csv_index);
    out.push(m);
  }
  return out;
}

export async function suggestReturnMatches(input: {
  batch_items: UnmatchedBatchItem[];
  candidates: UnusedCandidate[];
}): Promise<AiReturnMatch[]> {
  if (input.batch_items.length === 0 || input.candidates.length === 0) return [];

  const userTurn = `BATCH ITEMS (${input.batch_items.length}):
${JSON.stringify(input.batch_items, null, 2)}

CSV CANDIDATES (${input.candidates.length}):
${JSON.stringify(input.candidates, null, 2)}

Return only the JSON array of matches per the schema. Empty array is fine.`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    system: [
      { type: 'text', text: RETURN_MATCH_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userTurn }],
  });

  const text = response.content.find((b) => b.type === 'text')?.text ?? '[]';
  return dedupeGreedy(parseAiReturnMatches(text));
}
