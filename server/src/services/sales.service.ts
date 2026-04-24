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
}

export async function recordSale(userId: string, input: RecordSaleInput) {
  const card = await db
    .selectFrom('card_instances')
    .select(['id', 'status', 'is_personal_collection'])
    .where('id', '=', input.card_instance_id)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (!card) throw new AppError(404, 'Card not found');
  if (card.status === 'sold') throw new AppError(409, 'Card already marked as sold');
  if (card.is_personal_collection) throw new AppError(400, 'Personal collection cards cannot be sold. Remove from personal collection first.');

  const totalCostBasis = await computeCostBasis(input.card_instance_id);

  const sale = await db
    .insertInto('sales')
    .values({
      user_id: userId,
      card_instance_id: input.card_instance_id,
      listing_id: input.listing_id ?? null,
      card_show_id: input.card_show_id ?? null,
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

  await db
    .updateTable('card_instances')
    .set({ status: 'sold', location_id: null })
    .where('id', '=', input.card_instance_id)
    .execute();

  if (input.listing_id) {
    await db
      .updateTable('listings')
      .set({ listing_status: 'sold', sold_at: sale.sold_at })
      .where('id', '=', input.listing_id)
      .execute();
  }

  await logAudit(userId, 'sales', sale.id, 'created', null, sale);
  return sale;
}

export async function recordBulkSale(
  userId: string,
  items: Array<{ card_instance_id: string; listing_id?: string; sale_price: number; platform_fees?: number }>,
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
    .where('s.user_id', '=', userId)
    .$if(filters.platforms !== undefined, (qb) =>
      filters.platforms!.length === 0
        ? qb.where(sql<boolean>`1=0` as any)
        : qb.where('s.platform', 'in', filters.platforms! as any)
    )
    .$if(!!filters.search, (qb) => qb.where(
      sql<string>`COALESCE(ci.card_name_override, cc.card_name)`, 'ilike', `%${filters.search}%`
    ))
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
      'ci.id as card_instance_id',
      'ci.purchase_cost as raw_cost',
      sql<string>`COALESCE(ci.card_name_override, cc.card_name)`.as('card_name'),
      sql<string>`COALESCE(cc.set_name, ci.set_name_override)`.as('set_name'),
      'ci.card_game',
      'sd.grade',
      'sd.grade_label',
      'sd.company as grading_company',
      'sd.cert_number',
      'sd.grading_cost',
      'rp.purchase_id as raw_purchase_label',
      'l.list_price as listed_price',
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
