/**
 * fix-order-listings.ts
 *
 * Scans all active listings with an ebay_listing_url and cancels any that look
 * like eBay order/purchase URLs rather than active item listing URLs.
 *
 * eBay order URL patterns (not active listings):
 *   - https://www.ebay.com/ord/...
 *   - https://order.ebay.com/...
 *   - URL contains orderId query param
 *   - https://www.ebay.com/mye/myebay/purchase/...
 *
 * Active listing URLs always match:
 *   - https://www.ebay.com/itm/...
 */

import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../../../.env') });

const ORDER_PATTERNS = [
  /ebay\.com\/ord\//i,
  /order\.ebay\.com/i,
  /[?&]orderId=/i,
  /ebay\.com\/mye\/myebay\/purchase/i,
  /ebay\.com\/bfl\//i,
];

function isOrderUrl(url: string): boolean {
  return ORDER_PATTERNS.some((re) => re.test(url));
}

async function main() {
  const { db } = await import('../../config/database');

  const listings = await db
    .selectFrom('listings')
    .select(['id', 'ebay_listing_url'])
    .where('listing_status', '=', 'active')
    .where('ebay_listing_url', 'is not', null)
    .execute();

  const toCancel = listings.filter((l) => isOrderUrl(l.ebay_listing_url!));

  if (toCancel.length === 0) {
    console.log('No order-URL listings found — nothing to do.');
    process.exit(0);
  }

  console.log(`Found ${toCancel.length} listing(s) with order URLs:`);
  for (const l of toCancel) {
    console.log(`  ${l.id}  ${l.ebay_listing_url}`);
  }

  const ids = toCancel.map((l) => l.id);
  const result = await db
    .updateTable('listings')
    .set({ listing_status: 'cancelled' })
    .where('id', 'in', ids)
    .executeTakeFirst();

  console.log(`\nCancelled ${result.numUpdatedRows} listing(s).`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
