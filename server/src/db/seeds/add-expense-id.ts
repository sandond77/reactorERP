import path from 'path';
import dotenv from 'dotenv';
import { sql } from 'kysely';
dotenv.config({ path: path.join(__dirname, '../../../.env') });

async function main() {
  const { db } = await import('../../config/database');

  await sql`ALTER TABLE expenses ADD COLUMN IF NOT EXISTS expense_id TEXT`.execute(db);
  await sql`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'expenses_user_expense_id_unique'
      ) THEN
        ALTER TABLE expenses ADD CONSTRAINT expenses_user_expense_id_unique UNIQUE (user_id, expense_id);
      END IF;
    END $$
  `.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS expense_sequences (
      user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      year     INTEGER NOT NULL,
      next_seq INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, year)
    )
  `.execute(db);

  console.log('✓ expense_id column and expense_sequences table created');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
