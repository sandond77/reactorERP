import { sql } from 'kysely';
import { db } from '../config/database';

export type AlertEntityType = 'ebay_listing' | 'card_show';

export async function muteAlert(userId: string, entityType: AlertEntityType, entityId: string) {
  const mutedUntil = new Date();
  mutedUntil.setDate(mutedUntil.getDate() + 30);
  await db
    .insertInto('alert_overrides')
    .values({ user_id: userId, entity_type: entityType, entity_id: entityId, muted_until: mutedUntil })
    .onConflict((oc) => oc.columns(['user_id', 'entity_type', 'entity_id']).doUpdateSet({ muted_until: mutedUntil, is_ignored: false, updated_at: new Date() }))
    .execute();
}

export async function ignoreAlert(userId: string, entityType: AlertEntityType, entityId: string) {
  await db
    .insertInto('alert_overrides')
    .values({ user_id: userId, entity_type: entityType, entity_id: entityId, is_ignored: true, muted_until: null })
    .onConflict((oc) => oc.columns(['user_id', 'entity_type', 'entity_id']).doUpdateSet({ is_ignored: true, muted_until: null, updated_at: new Date() }))
    .execute();
}

export async function resetAlert(userId: string, entityType: AlertEntityType, entityId: string) {
  await db
    .deleteFrom('alert_overrides')
    .where('user_id', '=', userId)
    .where('entity_type', '=', entityType)
    .where('entity_id', '=', entityId)
    .execute();
}

// Mirrors of the last_activity SQL fragments in reports.service.ts —
// duplicated because Kysely inline sql`` fragments can't be reused across
// module boundaries without turning into either a compiled RawBuilder or a
// factory. Keep the two definitions in sync when either query changes.
const EBAY_LAST_ACTIVITY_SQL = sql<Date>`GREATEST(
  l.listed_at,
  (SELECT MAX(s.sold_at) FROM sales s WHERE s.listing_id = l.id),
  (SELECT MAX(sib.listed_at) FROM listings sib
     WHERE sib.user_id = l.user_id
       AND sib.ebay_listing_url IS NOT NULL
       AND sib.ebay_listing_url = l.ebay_listing_url
       AND sib.id <> l.id)
)`;

const CARD_SHOW_LAST_ACTIVITY_SQL = sql<Date>`GREATEST(
  ci.card_show_added_at,
  (SELECT MAX(s.sold_at) FROM sales s
     JOIN card_instances ci_a ON ci_a.id = s.card_instance_id
    WHERE ci_a.user_id = ci.user_id
      AND ci_a.catalog_id IS NOT NULL
      AND ci_a.catalog_id = ci.catalog_id
      AND s.card_show_id IS NOT NULL),
  (SELECT MAX(ci_b.card_show_added_at) FROM card_instances ci_b
    WHERE ci_b.user_id = ci.user_id
      AND ci_b.catalog_id IS NOT NULL
      AND ci_b.catalog_id = ci.catalog_id
      AND ci_b.is_card_show = true)
)`;

export async function getStaleEbayListingsFull(userId: string, days: number) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return db
    .selectFrom('listings as l')
    .innerJoin('card_instances as ci', 'ci.id', 'l.card_instance_id')
    .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
    .leftJoin('slab_details as sd', 'sd.card_instance_id', 'ci.id')
    .leftJoin('alert_overrides as ao', (join) =>
      join.on('ao.user_id', '=', userId)
        .on('ao.entity_type', '=', 'ebay_listing')
        .onRef('ao.entity_id', '=', 'l.id'),
    )
    .select([
      'l.id',
      sql<string>`COALESCE(cc.card_name, ci.card_name_override)`.as('card_name'),
      sql<string>`COALESCE(cc.set_name, ci.set_name_override)`.as('set_name'),
      sql<string | null>`cc.sku`.as('sku'),
      sql<string | null>`COALESCE(ci.card_number_override, cc.card_number)`.as('card_number'),
      'l.list_price',
      'l.listed_at',
      'l.ebay_listing_url',
      sql<number>`EXTRACT(DAY FROM NOW() - ${EBAY_LAST_ACTIVITY_SQL})::int`.as('days_listed'),
      'sd.company as grading_company',
      'sd.grade_label',
      sql<string | null>`sd.cert_number::text`.as('cert_number'),
      'ci.condition',
      sql<boolean>`COALESCE(ao.is_ignored, false)`.as('is_ignored'),
      sql<Date | null>`ao.muted_until`.as('muted_until'),
    ])
    .where('l.user_id', '=', userId)
    .where('l.listing_status', '=', 'active')
    .where('l.platform', '=', 'ebay')
    .where(sql`${EBAY_LAST_ACTIVITY_SQL} < ${cutoff}` as any)
    .orderBy(sql`${EBAY_LAST_ACTIVITY_SQL}` as any, 'asc')
    .execute();
}

export async function getStaleCardShowFull(userId: string, days: number) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return db
    .selectFrom('card_instances as ci')
    .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
    .leftJoin('slab_details as sd', 'sd.card_instance_id', 'ci.id')
    .leftJoin('alert_overrides as ao', (join) =>
      join.on('ao.user_id', '=', userId)
        .on('ao.entity_type', '=', 'card_show')
        .onRef('ao.entity_id', '=', 'ci.id'),
    )
    .select([
      'ci.id',
      sql<string>`COALESCE(cc.card_name, ci.card_name_override)`.as('card_name'),
      sql<string>`COALESCE(cc.set_name, ci.set_name_override)`.as('set_name'),
      sql<string | null>`cc.sku`.as('sku'),
      sql<string | null>`COALESCE(ci.card_number_override, cc.card_number)`.as('card_number'),
      'ci.quantity',
      'ci.purchase_cost',
      'ci.card_show_added_at',
      sql<number>`EXTRACT(DAY FROM NOW() - ${CARD_SHOW_LAST_ACTIVITY_SQL})::int`.as('days_held'),
      'sd.company as grading_company',
      'sd.grade_label',
      sql<string | null>`sd.cert_number::text`.as('cert_number'),
      'ci.condition',
      sql<boolean>`COALESCE(ao.is_ignored, false)`.as('is_ignored'),
      sql<Date | null>`ao.muted_until`.as('muted_until'),
    ])
    .where('ci.user_id', '=', userId)
    .where('ci.is_card_show', '=', true)
    .where('ci.status', 'not in', ['sold', 'lost_damaged'])
    .where(sql`${CARD_SHOW_LAST_ACTIVITY_SQL} < ${cutoff}` as any)
    .orderBy(sql`${CARD_SHOW_LAST_ACTIVITY_SQL}` as any, 'asc')
    .execute();
}
