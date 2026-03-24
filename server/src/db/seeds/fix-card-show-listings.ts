/**
 * fix-card-show-listings.ts
 *
 * Cancels all active listings with platform = 'card_show'.
 * Card show inventory is tracked separately via is_card_show on card_instances.
 */

import path from 'path';
import dotenv from 'dotenv';
import { sql } from 'kysely';
dotenv.config({ path: path.join(__dirname, '../../../.env') });

async function main() {
  const { db } = await import('../../config/database');

  // Preview what we're about to cancel
  const listings = await db
    .selectFrom('listings as l')
    .innerJoin('card_instances as ci', 'ci.id', 'l.card_instance_id')
    .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
    .leftJoin('slab_details as sd', 'sd.card_instance_id', 'ci.id')
    .select([
      'l.id',
      'l.list_price',
      'l.listed_at',
      sql<string>`COALESCE(ci.card_name_override, cc.card_name)`.as('card_name'),
      'sd.grade_label',
      'sd.company',
    ])
    .where('l.platform', '=', 'card_show')
    .where('l.listing_status', '=', 'active')
    .execute();

  if (listings.length === 0) {
    console.log('No active card_show listings found — nothing to do.');
    process.exit(0);
  }

  console.log(`Found ${listings.length} active card_show listing(s):`);
  for (const l of listings) {
    const price = l.list_price != null ? `$${(Number(l.list_price) / 100).toFixed(2)}` : 'no price';
    const grade = l.grade_label ? `${l.company} ${l.grade_label}` : 'raw';
    console.log(`  ${l.id}  ${l.card_name ?? 'Unknown'}  [${grade}]  ${price}`);
  }

  const ids = listings.map((l) => l.id);
  const result = await db
    .updateTable('listings')
    .set({ listing_status: 'cancelled' })
    .where('id', 'in', ids)
    .executeTakeFirst();

  console.log(`\nCancelled ${result.numUpdatedRows} card_show listing(s).`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
