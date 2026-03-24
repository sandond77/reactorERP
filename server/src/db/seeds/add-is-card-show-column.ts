/**
 * add-is-card-show-column.ts
 *
 * Adds is_card_show boolean column to card_instances and populates it
 * from existing card_show listings (including recently cancelled ones).
 */

import path from 'path';
import dotenv from 'dotenv';
import { sql } from 'kysely';
dotenv.config({ path: path.join(__dirname, '../../../.env') });

async function main() {
  const { db } = await import('../../config/database');

  // Add column if it doesn't exist
  await sql`
    ALTER TABLE card_instances
    ADD COLUMN IF NOT EXISTS is_card_show BOOLEAN NOT NULL DEFAULT false
  `.execute(db);
  console.log('Column is_card_show added (or already existed).');

  // Populate: mark cards that have any listing with platform = 'card_show'
  // (includes cancelled ones we just created) and are not sold
  const result = await sql`
    UPDATE card_instances ci
    SET is_card_show = true
    WHERE ci.deleted_at IS NULL
    AND ci.status != 'sold'
    AND EXISTS (
      SELECT 1 FROM listings l
      WHERE l.card_instance_id = ci.id
      AND l.platform = 'card_show'
    )
  `.execute(db);

  console.log(`Marked ${result.numUpdatedRows} card(s) as is_card_show = true.`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
