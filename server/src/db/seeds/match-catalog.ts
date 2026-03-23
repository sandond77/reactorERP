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
import { buildLookupWithDbAliases } from '../../utils/set-codes';
// Dynamic import after dotenv — catalog.service triggers Kysely env validation at load time
let findOrCreateCatalogCard: (typeof import('../../services/catalog.service'))['findOrCreateCatalogCard'];

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
  setName: string | null;       // human-readable set name (e.g. 'Brilliant Stars', 'VMAX Climax')
  cardNumber: string | null;
  cardName: string | null;
  rarity: string | null;
  variant: string | null;
  isPromo: boolean;
  confidence: 'high' | 'medium' | 'low';
}

// ── Claude parsing ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a Pokemon TCG card expert specializing in PSA/CGC/SGC grading company label formats.

You will receive a list of grading-company label strings (card names as they appear on slabs).
For each label, extract:
- language: "EN" (English) or "JP" (Japanese) — always use exactly "JP" or "EN", never "JPN"
- If the card is not a Pokemon TCG card (e.g. One Piece, Old Maid, non-TCG products), set confidence to "low" and all fields to null
- setName: the human-readable Pokemon TCG set name only (e.g. "Brilliant Stars", "VMAX Climax", "Base Set", "Jungle")
  Do NOT include "Sword and Shield" or "Scarlet & Violet" prefix — just the specific set name.
  For vintage JP sets use: "Basic" (base), "Fossil", "Jungle", "Neo Genesis", "Neo Discovery", "Neo Revelation", "Neo Destiny"
  For Carddass products use the EXACT product name: "Bandai Carddass Vending" (1996 Bandai non-TCG cards) vs "Pocket Monsters Carddass" (1997 series) vs "Vending" (1998-2000 TCG vending machine series)
  For promos: use the promo series name e.g. "SM Promo", "SWSH Black Star Promo", "SV Promo", "Promo Card Pack 25th Anniversary"
- cardNumber: numeric card number only (e.g. "4", "080", "025") — strip any "/total" suffix
- cardName: the Pokemon or Trainer card name only (no set, no year, no rarity)
- rarity: exactly as stated in label (e.g. "Art Rare", "Common", "Holo Rare", "Two Star") — null if not mentioned
- variant: if stated (e.g. "First Edition", "Shadowless", "Reverse Holo") — null if not present
- isPromo: true if this is a promotional card (Black Star Promo, SM-P, SV-P, SWSH promo, etc.), false otherwise
- confidence: "high" if certain, "medium" if reasonable guess, "low" if unsure

Return a JSON array with one object per input label in the same order.
If you cannot parse a label, set all fields to null except original, isPromo: false, and confidence: "low".`;

async function parseBatch(labels: string[]): Promise<ParsedCard[]> {
  const userContent = labels.map((l, i) => `${i + 1}. ${l}`).join('\n');

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 8192,
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
  ({ findOrCreateCatalogCard } = await import('../../services/catalog.service'));

  const pgClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await pgClient.connect();

  const lookupWithDb = await buildLookupWithDbAliases(pgClient);

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

      // Claude sometimes returns numeric confidence (0-1) instead of string
      const confStr = typeof p.confidence === 'number'
        ? (p.confidence < 0.6 ? 'low' : p.confidence < 0.8 ? 'medium' : 'high')
        : p.confidence;
      if (confStr === 'low') {
        lowConfidence.push(card.card_name_override);
      }

      if (!p.setName || !p.cardNumber || !p.language) {
        unmatched++;
        continue;
      }

      // Look up our internal set code from the set name
      const lang = p.language as 'EN' | 'JP';
      let setCodePart: string | null = null;

      if (p.isPromo) {
        // For promos, look up promo-specific code or fall back to generic 'P'
        setCodePart = lookupWithDb(lang, p.setName) ?? 'P';
      } else {
        setCodePart = lookupWithDb(lang, p.setName);
      }

      if (!setCodePart) {
        console.warn(`  NO SET CODE  lang=${lang} setName="${p.setName}"  "${card.card_name_override}"`);
        unmatched++;
        continue;
      }

      try {
        const catalogId = await findOrCreateCatalogCard({
          setCodePart,
          cardNumber: p.cardNumber,
          cardName: p.cardName ?? card.card_name_override,
          setName: p.setName,
          language: lang,
          rarity: p.rarity ?? null,
          variant: p.variant ?? null,
        });

        if (!catalogId) {
          unmatched++;
          continue;
        }

        if (!DRY_RUN) {
          await pgClient.query(
            `UPDATE card_instances SET catalog_id = $1, language = $2 WHERE id = $3`,
            [catalogId, lang, card.id]
          );
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
