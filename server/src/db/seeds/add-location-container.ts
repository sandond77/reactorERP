import path from 'path';
import dotenv from 'dotenv';
import { sql } from 'kysely';
dotenv.config({ path: path.join(__dirname, '../../../.env') });

async function main() {
  const { db } = await import('../../config/database');

  await sql`
    ALTER TABLE locations
    ADD COLUMN IF NOT EXISTS is_container BOOLEAN NOT NULL DEFAULT false
  `.execute(db);
  console.log('is_container added to locations');

  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
