import path from 'path';
import dotenv from 'dotenv';
import { sql } from 'kysely';
dotenv.config({ path: path.join(__dirname, '../../../.env') });

async function main() {
  const { db } = await import('../../config/database');

  await sql`ALTER TABLE trades ADD COLUMN IF NOT EXISTS trade_label TEXT`.execute(db);
  console.log('trade_label added to trades');

  await sql`
    CREATE TABLE IF NOT EXISTS trade_sequences (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      year INT NOT NULL,
      next_seq INT NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, year)
    )
  `.execute(db);
  console.log('trade_sequences table created');

  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
