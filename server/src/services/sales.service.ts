import { sql } from 'kysely';
import { db } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { computeCostBasis } from './cards.service';
import { logAudit } from '../utils/audit';
import type { ListingPlatform } from '../types/db';
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination';
import type { PaginationParams } from '../utils/pagination';

export interface RecordSaleInput {
  card_instance_id: string;
  listing_id?: string;
  card_show_id?: string;
  platform: ListingPlatform;
  sale_price: number;
  platform_fees?: number;
  shipping_cost?: number;
  currency?: string;
  order_details_link?: string;
  unique_id?: string;
  unique_id_2?: string;
  sold_at?: Date;
  /** Partial-sale quantity for raw lots with quantity > 1. Omit (or pass the
   *  full row quantity) to mark the whole instance sold. */
  quantity?: number;
}

export async function recordSale(userId: string, input: RecordSaleInput) {
  const card = await db
    .selectFrom('card_instances')
    .selectAll()
    .where('id', '=', input.card_instance_id)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (!card) throw new AppError(404, 'Card not found');
  if (card.status === 'sold') throw new AppError(409, 'Card already marked as sold');
  if (card.is_personal_collection) throw new AppError(400, 'Personal collection cards cannot be sold. Remove from personal collection first.');

  // Partial-sale split: if caller asked to sell fewer cards than the row holds,
  // shave the sold qty off the source row and insert a sibling "sold" row that
  // the sale will reference. Avoids the old behavior of marking a whole stack
  // sold when only one copy went out.
  const sellQty = input.quantity ?? card.quantity;
  if (sellQty < 1) throw new AppError(400, 'Sale quantity must be at least 1');
  if (sellQty > card.quantity) throw new AppError(409, `Only ${card.quantity} of these in inventory; can't sell ${sellQty}`);

  let saleCardInstanceId = input.card_instance_id;
  let isSplit = false;
  if (sellQty < card.quantity) {
    isSplit = true;
    // Shave the sold qty off the source row
    await db
      .updateTable('card_instances')
      .set({ quantity: card.quantity - sellQty })
      .where('id', '=', input.card_instance_id)
      .execute();
    // Insert a sibling sold row with the same identity + the per-card cost basis.
    // Copy every field we care about so reports/cost calcs see the same data.
    const sibling = await db
      .insertInto('card_instances')
      .values({
        user_id: userId,
        catalog_id: card.catalog_id,
        raw_purchase_id: card.raw_purchase_id,
        purchase_type: card.purchase_type,
        card_game: card.card_game,
        status: 'sold',
        decision: card.decision,
        condition: card.condition,
        quantity: sellQty,
        purchase_cost: card.purchase_cost,
        currency: card.currency,
        language: card.language,
        card_name_override: card.card_name_override,
        set_name_override: card.set_name_override,
        card_number_override: card.card_number_override,
        location_id: null,
        notes: card.notes,
        purchased_at: card.purchased_at,
        is_personal_collection: card.is_personal_collection,
      } as any)
      .returningAll()
      .executeTakeFirstOrThrow();
    saleCardInstanceId = sibling.id;
  }

  const totalCostBasis = await computeCostBasis(saleCardInstanceId);

  // Auto-resolve card_show_id by sale date when platform=card_show and the
  // caller didn't pass one. Same matching rule as backfillCardShowLinks but
  // applied at insert time so single-sale paths (agent record_sale, etc.)
  // pick up the show without waiting for a later backfill.
  let resolvedCardShowId = input.card_show_id ?? null;
  if (!resolvedCardShowId && input.platform === 'card_show') {
    const soldAt = input.sold_at ?? new Date();
    const match = await db
      .selectFrom('card_shows')
      .select('id')
      .where('user_id', '=', userId)
      .where(sql<boolean>`DATE(${soldAt}) BETWEEN show_date AND COALESCE(end_date, show_date)`)
      .limit(1)
      .executeTakeFirst();
    if (match) resolvedCardShowId = match.id;
  }

  // Auto-resolve listing_id when the caller didn't pass one but the card has
  // an active listing. Without this, agent-recorded sales lose their link to
  // the listing — listed_price shows as "—" in the Sales table and the
  // listing row stays `active` even though the card is now sold.
  let resolvedListingId = input.listing_id ?? null;
  if (!resolvedListingId) {
    const activeListing = await db
      .selectFrom('listings')
      .select('id')
      .where('card_instance_id', '=', input.card_instance_id)
      .where('user_id', '=', userId)
      .where('listing_status', '=', 'active')
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (activeListing) resolvedListingId = activeListing.id;
  }

  const sale = await db
    .insertInto('sales')
    .values({
      user_id: userId,
      card_instance_id: saleCardInstanceId,
      listing_id: resolvedListingId,
      card_show_id: resolvedCardShowId,
      platform: input.platform,
      sale_price: input.sale_price,
      platform_fees: input.platform_fees ?? 0,
      shipping_cost: input.shipping_cost ?? 0,
      currency: input.currency ?? 'USD',
      total_cost_basis: totalCostBasis,
      order_details_link: input.order_details_link ?? null,
      unique_id: input.unique_id ?? null,
      unique_id_2: input.unique_id_2 ?? null,
      sold_at: input.sold_at ?? new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  // Only set status='sold' on the original row when we DIDN'T split it. The
  // split-off sibling was inserted with status='sold' already.
  if (!isSplit) {
    await db
      .updateTable('card_instances')
      .set({ status: 'sold', location_id: null })
      .where('id', '=', input.card_instance_id)
      .execute();
  }

  if (resolvedListingId) {
    await db
      .updateTable('listings')
      .set({ listing_status: 'sold', sold_at: sale.sold_at })
      .where('id', '=', resolvedListingId)
      .execute();
  }

  await logAudit(userId, 'sales', sale.id, 'created', null, sale);
  return sale;
}

export async function recordBulkSale(
  userId: string,
  items: Array<{ card_instance_id: string; listing_id?: string; sale_price: number; platform_fees?: number; quantity?: number }>,
  shared: {
    platform: ListingPlatform;
    card_show_id?: string;
    unique_id?: string;
    order_details_link?: string;
    currency?: string;
    sold_at?: Date;
    unique_id_2?: string;
  }
) {
  // Pre-flight: surface every already-sold card up front instead of failing
  // mid-loop and leaving the batch partially committed. Tells the user
  // exactly which cards to remove from the cart on retry.
  const sourceCards = await db
    .selectFrom('card_instances as ci')
    .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
    .leftJoin('slab_details as sd', 'sd.card_instance_id', 'ci.id')
    .select([
      'ci.id',
      'ci.status',
      'ci.is_personal_collection',
      sql<string>`COALESCE(ci.card_name_override, cc.card_name)`.as('card_name'),
      'sd.cert_number',
    ])
    .where('ci.user_id', '=', userId)
    .where('ci.id', 'in', items.map((i) => i.card_instance_id))
    .execute();
  const byId = new Map(sourceCards.map((c) => [c.id, c]));
  const blocked: string[] = [];
  for (const it of items) {
    const c = byId.get(it.card_instance_id);
    if (!c) { blocked.push(`Unknown card (${it.card_instance_id.slice(0, 8)}…)`); continue; }
    if (c.status === 'sold') {
      const label = c.card_name ?? (c.cert_number ? `cert #${c.cert_number}` : `card ${it.card_instance_id.slice(0, 8)}…`);
      blocked.push(label);
    }
  }
  if (blocked.length) {
    throw new AppError(409, `${blocked.length} card${blocked.length === 1 ? '' : 's'} already sold — remove from cart: ${blocked.slice(0, 5).join(', ')}${blocked.length > 5 ? '…' : ''}`);
  }

  const sales = [];
  for (const item of items) {
    const sale = await recordSale(userId, {
      card_instance_id: item.card_instance_id,
      listing_id: item.listing_id,
      sale_price: item.sale_price,
      platform_fees: item.platform_fees ?? 0,
      platform: shared.platform,
      card_show_id: shared.card_show_id,
      unique_id: shared.unique_id,
      order_details_link: shared.order_details_link,
      currency: shared.currency,
      sold_at: shared.sold_at,
      unique_id_2: shared.unique_id_2,
      quantity: item.quantity,
    });
    sales.push(sale);
  }
  return sales;
}

const SALES_SORT_COLS: Record<string, string> = {
  card_name: `COALESCE(ci.card_name_override, cc.card_name)`,
  platform: 's.platform',
  sale_price: 's.sale_price',
  net_proceeds: 's.net_proceeds',
  profit: `(s.net_proceeds - COALESCE(s.total_cost_basis, 0))`,
  sold_at: 's.sold_at',
};

export async function getSaleFilterOptions(userId: string) {
  const platforms = await db
    .selectFrom('sales as s')
    .select(sql<string>`DISTINCT s.platform`.as('platform'))
    .where('s.user_id', '=', userId)
    .execute();
  return { platforms: platforms.map((r) => r.platform) };
}

export async function listSales(
  userId: string,
  filters: { platforms?: string[]; search?: string; from?: Date; to?: Date; cardType?: 'all' | 'graded' | 'raw'; soldDates?: string[] },
  pagination: PaginationParams,
  sortBy?: string,
  sortDir?: 'asc' | 'desc'
) {
  const baseQuery = () => db
    .selectFrom('sales as s')
    .innerJoin('card_instances as ci', 'ci.id', 's.card_instance_id')
    .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
    .leftJoin('slab_details as sd', 'sd.card_instance_id', 'ci.id')
    .leftJoin('raw_purchases as rp_search', 'rp_search.id', 'ci.raw_purchase_id')
    .where('s.user_id', '=', userId)
    .$if(filters.platforms !== undefined, (qb) =>
      filters.platforms!.length === 0
        ? qb.where(sql<boolean>`1=0` as any)
        : qb.where('s.platform', 'in', filters.platforms! as any)
    )
    .$if(!!filters.search, (qb) => {
      const q = `%${filters.search}%`;
      return qb.where((eb) => eb.or([
        eb(sql<string>`COALESCE(ci.card_name_override, cc.card_name)`, 'ilike', q),
        eb(sql<string>`sd.cert_number`, 'ilike', q),
        eb(sql<string>`rp_search.purchase_id`, 'ilike', q),
        eb(sql<string>`cc.sku`, 'ilike', q),
        eb(sql<string>`s.unique_id`, 'ilike', q),
        eb(sql<string>`s.unique_id_2`, 'ilike', q),
      ]));
    })
    .$if(!!filters.from, (qb) => qb.where('s.sold_at', '>=', filters.from!))
    .$if(!!filters.to, (qb) => qb.where('s.sold_at', '<=', filters.to!))
    .$if(!!filters.soldDates?.length, (qb) => qb.where(sql<boolean>`(s.sold_at AT TIME ZONE 'UTC')::date IN (${sql.join(filters.soldDates!.map((v) => sql`${v}::date`))})` as any))
    .$if(filters.cardType === 'graded', (qb) => qb.where('sd.company', 'is not', null))
    .$if(filters.cardType === 'raw', (qb) => qb.where('sd.company', 'is', null));

  const total = Number(
    (await baseQuery()
      .select((eb) => eb.fn.count<number>('s.id').as('count'))
      .executeTakeFirst())?.count ?? 0
  );

  const data = await baseQuery()
    .leftJoin('raw_purchases as rp', 'rp.id', 'ci.raw_purchase_id')
    .leftJoin('listings as l', 'l.id', 's.listing_id')
    .leftJoin('card_shows as csh', 'csh.id', 's.card_show_id')
    .select([
      's.id',
      's.platform',
      's.sale_price',
      's.platform_fees',
      's.shipping_cost',
      's.net_proceeds',
      's.total_cost_basis',
      's.currency',
      's.unique_id',
      's.unique_id_2',
      's.order_details_link',
      sql<string>`(s.sold_at AT TIME ZONE 'UTC')::date`.as('sold_at'),
      's.created_at',
      's.card_show_id',
      'csh.name as card_show_name',
      'ci.id as card_instance_id',
      'ci.purchase_cost as raw_cost',
      sql<string>`COALESCE(ci.card_name_override, cc.card_name)`.as('card_name'),
      sql<string>`COALESCE(cc.set_name, ci.set_name_override)`.as('set_name'),
      'ci.card_game',
      'ci.condition',
      'ci.quantity',
      'sd.grade',
      'sd.grade_label',
      'sd.company as grading_company',
      'sd.cert_number',
      'sd.grading_cost',
      'rp.purchase_id as raw_purchase_label',
      // For card_show sales the "asking price" is the sticker price on the
      // card, not the eBay list price. Show whichever matches the platform.
      sql<number | null>`CASE WHEN s.platform = 'card_show' THEN ci.card_show_price ELSE l.list_price END`.as('listed_price'),
      sql<number>`(s.net_proceeds - COALESCE(s.total_cost_basis, 0))`.as('profit'),
    ])
    .orderBy(sql.raw(SALES_SORT_COLS[sortBy ?? ''] ?? 's.sold_at'), sortDir ?? 'desc')
    .limit(pagination.limit)
    .offset(getPaginationOffset(pagination.page, pagination.limit))
    .execute();

  return buildPaginatedResult(data, total, pagination.page, pagination.limit);
}

export async function updateSale(userId: string, saleId: string, input: Partial<RecordSaleInput>) {
  const existing = await db.selectFrom('sales').selectAll().where('id', '=', saleId).where('user_id', '=', userId).executeTakeFirst();
  if (!existing) throw new AppError(404, 'Sale not found');

  await db.updateTable('sales').set({
    ...(input.platform !== undefined && { platform: input.platform }),
    ...(input.sale_price !== undefined && { sale_price: input.sale_price }),
    ...(input.platform_fees !== undefined && { platform_fees: input.platform_fees }),
    ...(input.shipping_cost !== undefined && { shipping_cost: input.shipping_cost }),
    ...(input.currency !== undefined && { currency: input.currency }),
    ...(input.sold_at !== undefined && { sold_at: input.sold_at }),
    ...(input.unique_id !== undefined && { unique_id: input.unique_id }),
    ...(input.unique_id_2 !== undefined && { unique_id_2: input.unique_id_2 }),
    ...(input.order_details_link !== undefined && { order_details_link: input.order_details_link }),
  }).where('id', '=', saleId).where('user_id', '=', userId).execute();

  // Quantity edit: updates the linked card_instance's quantity directly.
  // Doesn't try to rebalance against sibling instances in the same lot —
  // that's the user's call. Just guards against zero/negative qty.
  if (input.quantity !== undefined) {
    if (input.quantity < 1) throw new AppError(400, 'Sale quantity must be at least 1');
    await db
      .updateTable('card_instances')
      .set({ quantity: input.quantity })
      .where('id', '=', existing.card_instance_id)
      .where('user_id', '=', userId)
      .execute();
  }

  const updated = await getSaleById(userId, saleId);
  await logAudit(userId, 'sales', saleId, 'updated', existing, updated);
  return updated;
}

export async function deleteSale(userId: string, saleId: string) {
  const sale = await db.selectFrom('sales').selectAll().where('id', '=', saleId).where('user_id', '=', userId).executeTakeFirst();
  if (!sale) throw new AppError(404, 'Sale not found');

  await logAudit(userId, 'sales', saleId, 'deleted', sale, null);
  await db.deleteFrom('sales').where('id', '=', saleId).where('user_id', '=', userId).execute();

  // Determine correct revert status: graded slabs → 'graded', raw cards → 'raw_for_sale'
  const hasSlab = await db.selectFrom('slab_details').select('card_instance_id')
    .where('card_instance_id', '=', sale.card_instance_id).executeTakeFirst();
  const revertStatus = hasSlab ? 'graded' : 'raw_for_sale';

  await db.updateTable('card_instances').set({ status: revertStatus }).where('id', '=', sale.card_instance_id).execute();

  // Revert listing status if linked
  if (sale.listing_id) {
    await db.updateTable('listings').set({ listing_status: 'active', sold_at: null }).where('id', '=', sale.listing_id).execute();
  }
}

export async function getSaleById(userId: string, saleId: string) {
  const sale = await db
    .selectFrom('sales as s')
    .innerJoin('card_instances as ci', 'ci.id', 's.card_instance_id')
    .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
    .leftJoin('slab_details as sd', 'sd.card_instance_id', 'ci.id')
    .selectAll('s')
    .select([
      sql<string>`COALESCE(ci.card_name_override, cc.card_name)`.as('card_name'),
      sql<string>`COALESCE(cc.set_name, ci.set_name_override)`.as('set_name'),
      'ci.card_game',
      'ci.purchase_cost',
      'sd.grade',
      'sd.grade_label',
      'sd.company as grading_company',
      'sd.cert_number',
      sql<number>`(s.net_proceeds - COALESCE(s.total_cost_basis, 0))`.as('profit'),
    ])
    .where('s.id', '=', saleId)
    .where('s.user_id', '=', userId)
    .executeTakeFirst();

  if (!sale) throw new AppError(404, 'Sale not found');
  return sale;
}
