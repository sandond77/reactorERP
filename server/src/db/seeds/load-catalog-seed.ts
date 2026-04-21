/**
 * Load card_catalog_seed data from the committed SQL file.
 * Run this on fresh deployments after migrations:
 *   npx tsx server/src/db/seeds/load-catalog-seed.ts
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const sqlPath = join(__dirname, 'catalog-seed-data.sql');
  const sql = readFileSync(sqlPath, 'utf-8');

  const existing = await pool.query('SELECT COUNT(*) FROM card_catalog_seed');
  if (parseInt(existing.rows[0].count, 10) > 0) {
    console.log(`card_catalog_seed already has ${existing.rows[0].count} rows — skipping.`);
    await pool.end();
    return;
  }

  console.log('Loading catalog seed data...');
  await pool.query(sql);
  const after = await pool.query('SELECT COUNT(*) FROM card_catalog_seed');
  console.log(`Done — ${after.rows[0].count} rows loaded.`);
  await pool.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
