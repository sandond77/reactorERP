import path from 'path';
import dotenv from 'dotenv';
import { sql } from 'kysely';
dotenv.config({ path: path.join(__dirname, '../../../.env') });

async function main() {
  const { db } = await import('../../config/database');

  await sql`
    ALTER TABLE locations
    ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES locations(id) ON DELETE CASCADE
  `.execute(db);
  console.log('parent_id added to locations');

  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
