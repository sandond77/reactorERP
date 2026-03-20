/**
 * Batch-match existing card_instances to card_catalog entries.
 *
 * Uses Claude to parse PSA/grading-company label strings into structured fields,
 * then matches by (setCode, cardNumber, language) — stable across PSA label drift.
 *
 * Usage:
 *   npx tsx server/src/db/seeds/match-catalog.ts [--limit N] [--dry-run]
 *
 * Options:
 *   --limit N    Process only first N unmatched cards (default: all)
 *   --dry-run    Parse + lookup without writing catalog_id back
 *   --reparse    Re-parse all cards, even ones already matched
 */

import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../../../.env') });

import Anthropic from '@anthropic-ai/sdk';
import pg from 'pg';
// Dynamic import after dotenv — catalog.service triggers Kysely env validation at load time
let findOrFetchCard: (typeof import('../../services/catalog.service'))['findOrFetchCard'];

const args = process.argv.slice(2);
const limitArg = args[args.indexOf('--limit') + 1];
const DRY_RUN = args.includes('--dry-run');
const REPARSE = args.includes('--reparse');
const LIMIT = limitArg ? parseInt(limitArg) : null;
const BATCH_SIZE = 25; // cards per Claude call

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// ── Types ────────────────────────────────────────────────────────────────────

interface ParsedCard {
  original: string;
  language: 'EN' | 'JP' | null;
  setCode: string | null;       // TCGdex set ID (e.g. 'base1', 'SV1a')
  setName: string | null;       // human-readable set name
  cardNumber: string | null;    // e.g. '4', '080', '025'
  cardName: string | null;
  rarity: string | null;        // as stated in label (e.g. 'Art Rare', 'Common')
  variant: string | null;       // e.g. 'First Edition', 'Shadowless'
  confidence: 'high' | 'medium' | 'low';
}

// ── Claude parsing ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a Pokemon TCG card expert specializing in PSA/CGC/SGC grading company label formats.

You will receive a list of grading-company label strings (card names as they appear on slabs).
For each label, extract:
- language: "EN" (English) or "JP" (Japanese)
- setCode: the TCGdex API set ID (e.g. "base1", "sv1a", "SV1a", "swsh1", "xy1", "dp1")
  IMPORTANT: TCGdex uses lowercase for EN sets (e.g. "sv01", "swsh1", "base1") and preserves case for JP sets (e.g. "SV1a", "S8a")
- setName: human-readable set name (e.g. "Base Set", "Scarlet & Violet", "Triplet Beat")
- cardNumber: numeric card number only (e.g. "4", "080", "025") — strip any "/total" suffix
- cardName: the Pokemon or Trainer card name only (no set, no year, no rarity)
- rarity: exactly as stated in label (e.g. "Art Rare", "Common", "Holo Rare", "Two Star")
  For PSA Japanese labels, common rarity terms: Art Rare, Special Art Rare, Two Star, Three Star, Hyper Rare
  For PSA English labels: Common, Uncommon, Rare, Holo Rare, Ultra Rare, Illustration Rare, etc.
- variant: if stated (e.g. "First Edition", "Shadowless", "Reverse Holo") — null if not present
- confidence: "high" if you're certain, "medium" if reasonable guess, "low" if unsure

Return a JSON array with one object per input label in the same order.
If you cannot parse a label, set all fields to null except original and confidence="low".`;

async function parseBatch(labels: string[]): Promise<ParsedCard[]> {
  const userContent = labels.map((l, i) => `${i + 1}. ${l}`).join('\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Parse these ${labels.length} grading label strings:\n\n${userContent}\n\nReturn a JSON array.`,
      },
    ],
  });

  const text = response.content.find((b) => b.type === 'text')?.text ?? '';

  // Extract JSON from response
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`No JSON array in response: ${text.slice(0, 200)}`);

  const parsed: ParsedCard[] = JSON.parse(jsonMatch[0]);

  // Ensure same length
  if (parsed.length !== labels.length) {
    throw new Error(`Expected ${labels.length} results, got ${parsed.length}`);
  }

  // Re-attach originals (Claude may omit or truncate)
  for (let i = 0; i < parsed.length; i++) {
    parsed[i].original = labels[i];
  }

  return parsed;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  ({ findOrFetchCard } = await import('../../services/catalog.service'));

  const pgClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgClient.connect();

  // Fetch unmatched card_instances (with card_name_override, no catalog_id)
  const whereClause = REPARSE
    ? `WHERE ci.card_name_override IS NOT NULL AND ci.deleted_at IS NULL`
    : `WHERE ci.catalog_id IS NULL AND ci.card_name_override IS NOT NULL AND ci.deleted_at IS NULL`;

  const limitClause = LIMIT ? `LIMIT ${LIMIT}` : '';

  const { rows: cards } = await pgClient.query<{
    id: string;
    card_name_override: string;
    language: string;
  }>(`
    SELECT ci.id, ci.card_name_override, ci.language
    FROM card_instances ci
    INNER JOIN slab_details sd ON sd.card_instance_id = ci.id
    ${whereClause}
    ORDER BY ci.created_at
    ${limitClause}
  `);

  console.log(`Found ${cards.length} cards to process${DRY_RUN ? ' [DRY RUN]' : ''}`);

  let matched = 0;
  let unmatched = 0;
  let errors = 0;
  const lowConfidence: string[] = [];

  // Process in batches
  for (let i = 0; i < cards.length; i += BATCH_SIZE) {
    const batch = cards.slice(i, i + BATCH_SIZE);
    const labels = batch.map((c) => c.card_name_override);

    process.stdout.write(`Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(cards.length / BATCH_SIZE)} (${i + 1}–${Math.min(i + BATCH_SIZE, cards.length)})… `);

    let parsed: ParsedCard[];
    try {
      parsed = await parseBatch(labels);
    } catch (err) {
      console.error('Parse error:', err instanceof Error ? err.message : err);
      errors += batch.length;
      continue;
    }

    let batchMatched = 0;

    for (let j = 0; j < parsed.length; j++) {
      const p = parsed[j];
      const card = batch[j];

      if (p.confidence === 'low') {
        lowConfidence.push(card.card_name_override);
      }

      if (!p.setCode || !p.cardNumber || !p.language) {
        unmatched++;
        continue;
      }

      try {
        const catalogId = await findOrFetchCard({
          setCode: p.setCode,
          cardNumber: p.cardNumber,
          cardName: p.cardName ?? card.card_name_override,
          language: p.language,
          rarity: p.rarity ?? null,
        });

        if (!catalogId) {
          unmatched++;
          continue;
        }

        if (!DRY_RUN) {
          await pgClient.query(
            `UPDATE card_instances SET catalog_id = $1, language = $2 WHERE id = $3`,
            [catalogId, p.language, card.id]
          );

          // Also update variant on card_instance if parsed
          if (p.variant) {
            await pgClient.query(
              `UPDATE card_instances SET variant = $1 WHERE id = $2`,
              [p.variant, card.id]
            );
          }
        }

        matched++;
        batchMatched++;
      } catch (err) {
        errors++;
        console.error(`  Error matching "${card.card_name_override}":`, err instanceof Error ? err.message : err);
      }
    }

    process.stdout.write(`${batchMatched}/${batch.length} matched\n`);

    // Small delay between Claude calls
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log('\n=== Matching complete ===');
  console.log(`  Matched:       ${matched}`);
  console.log(`  Unmatched:     ${unmatched}`);
  console.log(`  Errors:        ${errors}`);
  console.log(`  Low confidence: ${lowConfidence.length}`);

  if (lowConfidence.length > 0) {
    console.log('\nLow-confidence parses (review manually):');
    lowConfidence.slice(0, 20).forEach((l) => console.log(`  - ${l}`));
    if (lowConfidence.length > 20) console.log(`  … and ${lowConfidence.length - 20} more`);
  }

  await pgClient.end();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
