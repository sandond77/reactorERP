/**
 * create-trades-table.ts
 *
 * Creates the trades table and adds trade_id FK columns to sales and card_instances.
 */

import path from 'path';
import dotenv from 'dotenv';
import { sql } from 'kysely';
dotenv.config({ path: path.join(__dirname, '../../../.env') });

async function main() {
  const { db } = await import('../../config/database');

  await sql`
    CREATE TABLE IF NOT EXISTS trades (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      trade_date DATE,
      person TEXT,
      cash_from_customer_cents INT NOT NULL DEFAULT 0,
      cash_to_customer_cents INT NOT NULL DEFAULT 0,
      trade_percent NUMERIC(5,2) NOT NULL DEFAULT 80,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `.execute(db);
  console.log('trades table created (or already existed)');

  await sql`ALTER TABLE sales ADD COLUMN IF NOT EXISTS trade_id UUID REFERENCES trades(id)`.execute(db);
  console.log('trade_id added to sales');

  await sql`ALTER TABLE card_instances ADD COLUMN IF NOT EXISTS trade_id UUID REFERENCES trades(id)`.execute(db);
  console.log('trade_id added to card_instances');

  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
