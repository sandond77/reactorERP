/**
 * Backfill slab_details.grading_cost from the CSV inventory.
 *
 * For each CSV row with a valid numeric cert and grading cost > $0,
 * finds the matching slab_details row via cert_number and sets grading_cost.
 *
 * Usage:
 *   npx tsx server/src/db/seeds/update-grading-fees.ts [csv-path] [--dry-run]
 *
 * Defaults:
 *   csv-path = ~/Desktop/Master Card Inventory - Slab Inventory.csv
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Papa from 'papaparse';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL not set — check server/.env');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CSV_PATH =
  args.find(a => !a.startsWith('--')) ??
  path.join(os.homedir(), 'Desktop', 'Master Card Inventory - Slab Inventory.csv');

function parseDollars(val: string | undefined): number {
  if (!val) return 0;
  const cleaned = val.replace(/[$, ]/g, '').trim();
  if (!cleaned || cleaned === '-') return 0;
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : Math.round(n * 100);
}

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV not found: ${CSV_PATH}`);
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log('Connected to database.');
  if (DRY_RUN) console.log('DRY RUN — no changes will be written.\n');

  try {
    const csvContent = fs.readFileSync(CSV_PATH, 'utf-8');
    const { data: rawRows } = Papa.parse<Record<string, string>>(csvContent, {
      header: true,
      skipEmptyLines: true,
    });

    // Only rows with a purely numeric cert and grading cost > $0
    const candidates = rawRows
      .map(r => ({
        cert: r['Cert']?.trim() ?? '',
        gradingFee: parseDollars(r['Grading Cost']),
        cardName: r['Card']?.trim() ?? '',
      }))
      .filter(r => r.gradingFee > 0 && /^\d+$/.test(r.cert));

    console.log(`Found ${candidates.length} rows with grading cost > $0 and numeric cert.\n`);

    let updated = 0;
    let notFound = 0;

    for (const row of candidates) {
      const res = await client.query<{ id: string; grading_cost: number }>(
        `SELECT id, grading_cost FROM slab_details WHERE cert_number = $1 LIMIT 1`,
        [row.cert]
      );

      if (!res.rows.length) {
        console.warn(`  NOT FOUND  cert=${row.cert}  "${row.cardName}"`);
        notFound++;
        continue;
      }

      const slab = res.rows[0];
      const feeDollars = (row.gradingFee / 100).toFixed(2);
      const prevDollars = (slab.grading_cost / 100).toFixed(2);

      console.log(
        `  UPDATE  cert=${row.cert}  $${prevDollars} → $${feeDollars}  "${row.cardName}"`
      );

      if (!DRY_RUN) {
        await client.query(
          `UPDATE slab_details SET grading_cost = $1, updated_at = NOW() WHERE id = $2`,
          [row.gradingFee, slab.id]
        );
      }
      updated++;
    }

    console.log('\n─── Summary ──────────────────────────────────────────────');
    console.log(`  Updated : ${updated}`);
    console.log(`  Not found in DB : ${notFound}`);
    if (DRY_RUN) console.log('\n(Dry run — nothing written)');
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
