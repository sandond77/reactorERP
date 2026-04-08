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

export async function getStaleEbayListingsFull(userId: string, days: number) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return db
    .selectFrom('listings as l')
    .innerJoin('card_instances as ci', 'ci.id', 'l.card_instance_id')
    .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
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
      sql<number>`EXTRACT(DAY FROM NOW() - l.listed_at)::int`.as('days_listed'),
      sql<boolean>`COALESCE(ao.is_ignored, false)`.as('is_ignored'),
      sql<Date | null>`ao.muted_until`.as('muted_until'),
    ])
    .where('l.user_id', '=', userId)
    .where('l.listing_status', '=', 'active')
    .where('l.platform', '=', 'ebay')
    .where('l.listed_at', '<', cutoff)
    .orderBy('l.listed_at', 'asc')
    .execute();
}

export async function getStaleCardShowFull(userId: string, days: number) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return db
    .selectFrom('card_instances as ci')
    .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
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
      sql<number>`EXTRACT(DAY FROM NOW() - ci.card_show_added_at)::int`.as('days_held'),
      sql<boolean>`COALESCE(ao.is_ignored, false)`.as('is_ignored'),
      sql<Date | null>`ao.muted_until`.as('muted_until'),
    ])
    .where('ci.user_id', '=', userId)
    .where('ci.is_card_show', '=', true)
    .where('ci.status', 'not in', ['sold', 'lost_damaged'])
    .where('ci.card_show_added_at', '<', cutoff)
    .orderBy('ci.card_show_added_at', 'asc')
    .execute();
}
