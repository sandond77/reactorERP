import { db } from '../config/database';
import { sql } from 'kysely';

export interface ReorderAlert {
  threshold_id: string;
  catalog_id: string;
  card_name: string;
  set_name: string | null;
  sku: string | null;
  to_grade_quantity: number;
  inbound_quantity: number;
  min_quantity: number;
  is_ignored: boolean;
  muted_until: Date | null;
}

export interface ReorderThreshold {
  id: string;
  catalog_id: string;
  card_name: string;
  set_name: string | null;
  sku: string | null;
  min_quantity: number;
  is_ignored: boolean;
  muted_until: Date | null;
}

/**
 * Returns all reorder thresholds for a user with current unsold bulk quantity.
 * Alerts = rows where unsold < min_quantity AND not ignored AND not muted.
 */
export async function getReorderAlerts(userId: string): Promise<ReorderAlert[]> {
  const rows = await db
    .selectFrom('reorder_thresholds as rt')
    .innerJoin('card_catalog as cc', 'cc.id', 'rt.catalog_id')
    .select([
      'rt.id as threshold_id',
      'rt.catalog_id',
      'cc.card_name',
      sql<string | null>`cc.set_name`.as('set_name'),
      sql<string | null>`cc.sku`.as('sku'),
      'rt.min_quantity',
      'rt.is_ignored',
      'rt.muted_until',
      sql<number>`COALESCE((
        SELECT SUM(ci.quantity)
        FROM card_instances ci
        INNER JOIN raw_purchases rp ON rp.id = ci.raw_purchase_id
        WHERE ci.user_id = rt.user_id
          AND ci.catalog_id = rt.catalog_id
          AND rp.type = 'bulk'
          AND ci.decision = 'grade'
          AND ci.status NOT IN ('sold', 'lost_damaged')
      ), 0)::int`.as('to_grade_quantity'),
      sql<number>`COALESCE((
        SELECT SUM(rp.card_count)
        FROM raw_purchases rp
        WHERE rp.user_id = rt.user_id
          AND rp.catalog_id = rt.catalog_id
          AND rp.type = 'bulk'
          AND rp.status = 'ordered'
      ), 0)::int`.as('inbound_quantity'),
    ])
    .where('rt.user_id', '=', userId)
    .orderBy('cc.card_name', 'asc')
    .execute();

  return rows as ReorderAlert[];
}

/**
 * Returns only thresholds that are actively alerting (unsold < min, not ignored/muted).
 */
export async function getActiveReorderAlerts(userId: string): Promise<ReorderAlert[]> {
  const all = await getReorderAlerts(userId);
  const now = new Date();
  return all.filter((r) => {
    if (r.is_ignored) return false;
    if (r.muted_until && r.muted_until > now) return false;
    return (r.to_grade_quantity + r.inbound_quantity) < r.min_quantity;
  });
}

/**
 * List all thresholds (for the management UI).
 */
export async function listThresholds(userId: string): Promise<ReorderThreshold[]> {
  return db
    .selectFrom('reorder_thresholds as rt')
    .innerJoin('card_catalog as cc', 'cc.id', 'rt.catalog_id')
    .select([
      'rt.id',
      'rt.catalog_id',
      'cc.card_name',
      sql<string | null>`cc.set_name`.as('set_name'),
      sql<string | null>`cc.sku`.as('sku'),
      'rt.min_quantity',
      'rt.is_ignored',
      'rt.muted_until',
    ])
    .where('rt.user_id', '=', userId)
    .orderBy('cc.card_name', 'asc')
    .execute() as Promise<ReorderThreshold[]>;
}

/**
 * Create or update a threshold for a catalog entry.
 */
export async function upsertThreshold(
  userId: string,
  catalogId: string,
  minQuantity: number,
): Promise<void> {
  await db
    .insertInto('reorder_thresholds')
    .values({
      user_id: userId,
      catalog_id: catalogId,
      min_quantity: minQuantity,
      is_ignored: false,
      muted_until: null,
    })
    .onConflict((oc) =>
      oc.columns(['user_id', 'catalog_id']).doUpdateSet({
        min_quantity: minQuantity,
        is_ignored: false,
        muted_until: null,
      }),
    )
    .execute();
}

/**
 * Permanently ignore an alert (won't show again unless un-ignored).
 */
export async function ignoreThreshold(userId: string, thresholdId: string): Promise<void> {
  await db
    .updateTable('reorder_thresholds')
    .set({ is_ignored: true })
    .where('id', '=', thresholdId)
    .where('user_id', '=', userId)
    .execute();
}

/**
 * Mute an alert for 30 days.
 */
export async function muteThreshold(userId: string, thresholdId: string): Promise<void> {
  const mutedUntil = new Date();
  mutedUntil.setDate(mutedUntil.getDate() + 30);
  await db
    .updateTable('reorder_thresholds')
    .set({ muted_until: mutedUntil })
    .where('id', '=', thresholdId)
    .where('user_id', '=', userId)
    .execute();
}

/**
 * Un-ignore / un-mute a threshold.
 */
export async function resetThreshold(userId: string, thresholdId: string): Promise<void> {
  await db
    .updateTable('reorder_thresholds')
    .set({ is_ignored: false, muted_until: null })
    .where('id', '=', thresholdId)
    .where('user_id', '=', userId)
    .execute();
}

/**
 * Delete a threshold entirely.
 */
export async function deleteThreshold(userId: string, thresholdId: string): Promise<void> {
  await db
    .deleteFrom('reorder_thresholds')
    .where('id', '=', thresholdId)
    .where('user_id', '=', userId)
    .execute();
}

/**
 * List bulk card types that exist in inventory and have a catalog_id,
 * for use in the "add threshold" search.
 */
export async function listBulkCatalogCards(userId: string) {
  return db
    .selectFrom('card_instances as ci')
    .innerJoin('raw_purchases as rp', 'rp.id', 'ci.raw_purchase_id')
    .innerJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
    .select([
      'ci.catalog_id',
      'cc.card_name',
      sql<string | null>`cc.set_name`.as('set_name'),
      sql<string | null>`cc.sku`.as('sku'),
      sql<number>`SUM(ci.quantity) FILTER (WHERE ci.status NOT IN ('sold', 'lost_damaged'))::int`.as('unsold_quantity'),
    ])
    .where('ci.user_id', '=', userId)
    .where('rp.type', '=', 'bulk')
    .groupBy(['ci.catalog_id', 'cc.card_name', 'cc.set_name', 'cc.sku'])
    .orderBy('cc.card_name', 'asc')
    .execute();
}

/**
 * All unique bulk catalog cards in inventory, merged with threshold settings.
 * Cards without a threshold have min_quantity = null, threshold_id = null.
 */
export async function listBulkCardsWithThresholds(userId: string) {
  // Use a raw query so we can FULL OUTER JOIN inventory rows with threshold rows.
  // This ensures manually-added thresholds appear even when there's no current stock.
  const rows = await sql<{
    catalog_id: string;
    card_name: string;
    set_name: string | null;
    card_number: string | null;
    sku: string | null;
    threshold_id: string | null;
    min_quantity: number | null;
    is_ignored: boolean | null;
    muted_until: Date | null;
    to_grade_quantity: number;
    inbound_quantity: number;
  }>`
    SELECT
      COALESCE(inv.catalog_id, rt.catalog_id) AS catalog_id,
      cc.card_name,
      cc.set_name,
      cc.card_number,
      cc.sku,
      rt.id                AS threshold_id,
      rt.min_quantity,
      rt.is_ignored,
      rt.muted_until,
      COALESCE(inv.to_grade_quantity, 0)::int  AS to_grade_quantity,
      COALESCE(inv.inbound_quantity,  0)::int  AS inbound_quantity
    FROM (
      SELECT
        ci.catalog_id,
        COALESCE(SUM(ci.quantity) FILTER (WHERE ci.decision = 'grade' AND ci.status NOT IN ('sold', 'lost_damaged')), 0) AS to_grade_quantity,
        COALESCE((
          SELECT SUM(rp2.card_count)
          FROM raw_purchases rp2
          WHERE rp2.user_id = ${userId}
            AND rp2.catalog_id = ci.catalog_id
            AND rp2.type = 'bulk'
            AND rp2.status = 'ordered'
        ), 0) AS inbound_quantity
      FROM card_instances ci
      INNER JOIN raw_purchases rp ON rp.id = ci.raw_purchase_id AND rp.type = 'bulk'
      WHERE ci.user_id = ${userId}
      GROUP BY ci.catalog_id
    ) inv
    FULL OUTER JOIN reorder_thresholds rt
      ON rt.catalog_id = inv.catalog_id AND rt.user_id = ${userId}
    INNER JOIN card_catalog cc
      ON cc.id = COALESCE(inv.catalog_id, rt.catalog_id)
    ORDER BY cc.sku ASC NULLS LAST
  `.execute(db);
  return rows.rows;
}
