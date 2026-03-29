import path from 'path';
import dotenv from 'dotenv';
import { sql } from 'kysely';
dotenv.config({ path: path.join(__dirname, '../../../.env') });

async function main() {
  const { db } = await import('../../config/database');

  await sql`
    CREATE TABLE IF NOT EXISTS expenses (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date         DATE NOT NULL,
      description  TEXT NOT NULL,
      type         TEXT NOT NULL,
      amount       INTEGER NOT NULL,
      currency     TEXT NOT NULL DEFAULT 'USD',
      link         TEXT,
      order_number TEXT,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.execute(db);

  await sql`CREATE INDEX IF NOT EXISTS expenses_user_id_idx ON expenses(user_id)`.execute(db);
  await sql`CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses(date DESC)`.execute(db);

  console.log('✓ expenses table created');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
