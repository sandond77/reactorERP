/**
 * One-shot: regenerate card_catalog.sku for rows whose stored SKU prefix
 * doesn't match their game's abbreviation.
 *
 * Why this exists:
 *   Historically createCatalogCard, linkUnlinkedByCardName, and
 *   updateCatalogCard all defaulted to the PKMN gamePrefix regardless of
 *   card_catalog.game. So a One Piece row ended up with a stored SKU like
 *   "PKMN-JP-OP07-500" instead of "OP-JP-OP07-500". The fix in
 *   catalog.service.ts covers new writes; this script backfills existing
 *   rows in place.
 *
 * Behavior:
 *   - Reads every card_catalog row with a set_code + card_number.
 *   - Resolves the expected prefix via card_games.abbreviation
 *     (falls back to PKMN when the game has no row).
 *   - Regenerates the SKU with generatePartNumber(lang, setCode, cardNumber,
 *     gamePrefix) and compares to the stored value.
 *   - Prints a diff table by default. Pass --apply to actually UPDATE.
 *
 * Usage:
 *   npx tsx server/src/scripts/backfill-catalog-skus.ts             # dry-run
 *   npx tsx server/src/scripts/backfill-catalog-skus.ts --apply     # write
 *
 * Prod:
 *   DATABASE_URL=$(railway variables --kv 2>/dev/null | grep DATABASE_PUBLIC_URL | head -1 | cut -d= -f2-) \
 *     npx tsx server/src/scripts/backfill-catalog-skus.ts --apply
 *
 * Safe to re-run: only rewrites rows where the current SKU differs from
 * the recomputed value. Won't touch rows whose SKUs are already correct
 * or whose set_code / card_number is null (can't compute a SKU without both).
 */

import * as path from 'path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not set — check server/.env or export from railway variables');

const APPLY = process.argv.includes('--apply');

// Mirror server/src/utils/set-codes.ts::generatePartNumber. Duplicated here
// so this script has zero runtime dependency on the app's TS compilation
// order — it's a one-shot, not part of the app graph.
function generatePartNumber(language: string, setCode: string, cardNumber: string, gamePrefix: string): string {
  const rawNum = cardNumber.split('/')[0].trim();
  const digitsOnly = rawNum.replace(/[^0-9]/g, '');
  const paddedNum = digitsOnly ? digitsOnly.padStart(3, '0') : rawNum.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `${gamePrefix}-${language}-${setCode}-${paddedNum}`;
}

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });

  // Prefix map from card_games (all users share the same games table today).
  const { rows: gameRows } = await pool.query<{ name: string; abbreviation: string | null }>(
    `SELECT name, abbreviation FROM card_games`,
  );
  const prefixByGame = new Map<string, string>();
  for (const g of gameRows) {
    if (g.abbreviation) prefixByGame.set(g.name.toLowerCase(), g.abbreviation);
  }
  const prefixFor = (game: string | null | undefined) =>
    prefixByGame.get((game ?? '').toLowerCase()) ?? 'PKMN';

  // Every catalog row we could reconstruct a SKU for. Rows with no set_code
  // or no card_number are unreachable by generatePartNumber — leave alone.
  const { rows } = await pool.query<{
    id: string;
    user_id: string;
    game: string | null;
    sku: string | null;
    set_code: string | null;
    card_number: string | null;
    language: string;
    card_name: string | null;
  }>(`
    SELECT id, user_id, game, sku, set_code, card_number, language, card_name
    FROM card_catalog
    WHERE set_code IS NOT NULL
      AND card_number IS NOT NULL
  `);

  type Diff = {
    id: string;
    game: string | null;
    card_name: string | null;
    old: string | null;
    next: string;
  };
  const diffs: Diff[] = [];
  const skippedNoAbbr = new Set<string>();

  for (const r of rows) {
    const gameKey = (r.game ?? '').toLowerCase();
    const knownPrefix = prefixByGame.get(gameKey) ?? null;
    if (!knownPrefix) {
      skippedNoAbbr.add(r.game ?? '(null)');
      continue;  // no authoritative prefix to rewrite to — leave the row alone
    }
    // NARROWED SCOPE: only rewrite when the row's stored SKU has the wrong
    // GAME PREFIX. Do not touch case, zero-padding, or middle segments —
    // the full generatePartNumber would also strip meaningful sub-set
    // prefixes like `TG` / `GG` (Trainer Gallery, Galarian Gallery) and
    // coerce non-JP/EN language codes (e.g. ZH-TW → EN). Those are separate
    // problems from the audit and would be data loss if we rewrote them
    // blindly.
    const oldPrefix = r.sku?.split('-')[0] ?? null;
    if (oldPrefix === knownPrefix) continue;               // already correct
    if (r.sku && !oldPrefix) continue;                     // shouldn't happen
    // Compute the new SKU by ONLY swapping the game-prefix segment, keeping
    // everything after the first `-` untouched. Preserves case, sub-set
    // prefixes, dot-separated numbers, non-standard language codes, etc.
    const next = r.sku
      ? `${knownPrefix}${r.sku.slice(oldPrefix!.length)}`
      : generatePartNumber((r.language ?? 'EN').toUpperCase() === 'JP' ? 'JP' : 'EN', r.set_code!, r.card_number!, knownPrefix);
    if (next !== r.sku) {
      diffs.push({ id: r.id, game: r.game, card_name: r.card_name, old: r.sku, next });
    }
  }

  console.log(`Scanned ${rows.length} catalog rows.`);
  if (skippedNoAbbr.size > 0) {
    console.log(`Games with no card_games.abbreviation (fell back to PKMN): ${[...skippedNoAbbr].join(', ')}`);
  }
  console.log(`${diffs.length} rows need a SKU rewrite.`);

  if (diffs.length === 0) {
    await pool.end();
    return;
  }

  // Group by (old prefix, new prefix) for a compact summary before dumping
  // individual rows.
  const bucket = new Map<string, number>();
  for (const d of diffs) {
    const oldPrefix = d.old?.split('-')[0] ?? '(null)';
    const newPrefix = d.next.split('-')[0];
    const key = `${oldPrefix} → ${newPrefix}  (${d.game ?? '(no game)'})`;
    bucket.set(key, (bucket.get(key) ?? 0) + 1);
  }
  console.log('\nBy prefix change:');
  for (const [k, n] of [...bucket.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(50)} ${n}`);
  }

  console.log('\nFirst 20 rows:');
  for (const d of diffs.slice(0, 20)) {
    console.log(`  ${(d.old ?? '(null)').padEnd(28)} → ${d.next.padEnd(28)}  ${d.card_name ?? ''}`);
  }
  if (diffs.length > 20) console.log(`  … and ${diffs.length - 20} more.`);

  if (!APPLY) {
    console.log('\nDry-run only. Re-run with --apply to write the changes.');
    await pool.end();
    return;
  }

  // Uniqueness on card_catalog is (user_id, sku) per current schema. If a
  // target SKU already exists on the same user with a different id, we can't
  // apply blindly — flag and skip so this script never introduces a conflict
  // (which would 23505 the whole statement). Manual review for those.
  const client = await pool.connect();
  let updated = 0;
  const conflicts: Diff[] = [];
  try {
    await client.query('BEGIN');
    for (const d of diffs) {
      const { rows: clash } = await client.query(
        `SELECT id FROM card_catalog WHERE user_id = (SELECT user_id FROM card_catalog WHERE id = $1) AND sku = $2 AND id <> $1 LIMIT 1`,
        [d.id, d.next],
      );
      if (clash.length > 0) {
        conflicts.push(d);
        continue;
      }
      await client.query(
        `UPDATE card_catalog SET sku = $2, updated_at = NOW() WHERE id = $1`,
        [d.id, d.next],
      );
      updated++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
    throw err;
  }
  client.release();

  console.log(`\nApplied ${updated} SKU rewrites.`);
  if (conflicts.length > 0) {
    console.log(`Skipped ${conflicts.length} rows whose target SKU already exists on the same user (manual merge needed):`);
    for (const d of conflicts.slice(0, 20)) {
      console.log(`  id=${d.id}  ${d.old ?? '(null)'} → ${d.next}  ${d.card_name ?? ''}`);
    }
    if (conflicts.length > 20) console.log(`  … and ${conflicts.length - 20} more.`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
