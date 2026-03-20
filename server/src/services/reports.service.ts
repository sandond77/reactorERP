import { sql } from 'kysely';
import { db } from '../config/database';

export type PnlGroupBy = 'month' | 'platform' | 'game';

export async function getPnlReport(userId: string, from: Date | null, to: Date | null, groupBy: PnlGroupBy = 'month') {
  type Row = {
    label: string;
    num_sales: number;
    total_revenue: number;
    total_fees: number;
    total_net: number;
    total_cost_basis: number;
    total_profit: number;
  };

  let rows: Row[];

  if (groupBy === 'platform') {
    rows = (await db
      .selectFrom('sales as s')
      .innerJoin('card_instances as ci', 'ci.id', 's.card_instance_id')
      .select([
        's.platform as label' as any,
        sql<number>`COUNT(*)::int`.as('num_sales'),
        sql<number>`SUM(s.sale_price)::int`.as('total_revenue'),
        sql<number>`SUM(s.platform_fees + s.shipping_cost)::int`.as('total_fees'),
        sql<number>`SUM(s.net_proceeds)::int`.as('total_net'),
        sql<number>`SUM(COALESCE(s.total_cost_basis, 0))::int`.as('total_cost_basis'),
        sql<number>`SUM(s.net_proceeds - COALESCE(s.total_cost_basis, 0))::int`.as('total_profit'),
      ])
      .where('s.user_id', '=', userId)
      .$if(from != null, (qb) => qb.where('s.sold_at', '>=', from!))
      .$if(to != null, (qb) => qb.where('s.sold_at', '<=', to!))
      .groupBy('s.platform')
      .orderBy('s.platform')
      .execute()) as Row[];
  } else if (groupBy === 'game') {
    rows = (await db
      .selectFrom('sales as s')
      .innerJoin('card_instances as ci', 'ci.id', 's.card_instance_id')
      .select([
        'ci.card_game as label' as any,
        sql<number>`COUNT(*)::int`.as('num_sales'),
        sql<number>`SUM(s.sale_price)::int`.as('total_revenue'),
        sql<number>`SUM(s.platform_fees + s.shipping_cost)::int`.as('total_fees'),
        sql<number>`SUM(s.net_proceeds)::int`.as('total_net'),
        sql<number>`SUM(COALESCE(s.total_cost_basis, 0))::int`.as('total_cost_basis'),
        sql<number>`SUM(s.net_proceeds - COALESCE(s.total_cost_basis, 0))::int`.as('total_profit'),
      ])
      .where('s.user_id', '=', userId)
      .$if(from != null, (qb) => qb.where('s.sold_at', '>=', from!))
      .$if(to != null, (qb) => qb.where('s.sold_at', '<=', to!))
      .groupBy('ci.card_game')
      .orderBy('ci.card_game')
      .execute()) as Row[];
  } else {
    rows = (await db
      .selectFrom('sales as s')
      .innerJoin('card_instances as ci', 'ci.id', 's.card_instance_id')
      .select([
        sql<string>`TO_CHAR(s.sold_at, 'YYYY-MM')`.as('label'),
        sql<number>`COUNT(*)::int`.as('num_sales'),
        sql<number>`SUM(s.sale_price)::int`.as('total_revenue'),
        sql<number>`SUM(s.platform_fees + s.shipping_cost)::int`.as('total_fees'),
        sql<number>`SUM(s.net_proceeds)::int`.as('total_net'),
        sql<number>`SUM(COALESCE(s.total_cost_basis, 0))::int`.as('total_cost_basis'),
        sql<number>`SUM(s.net_proceeds - COALESCE(s.total_cost_basis, 0))::int`.as('total_profit'),
      ])
      .where('s.user_id', '=', userId)
      .$if(from != null, (qb) => qb.where('s.sold_at', '>=', from!))
      .$if(to != null, (qb) => qb.where('s.sold_at', '<=', to!))
      .groupBy(sql`TO_CHAR(s.sold_at, 'YYYY-MM')`)
      .orderBy(sql`TO_CHAR(s.sold_at, 'YYYY-MM')`)
      .execute()) as Row[];
  }

  const totals = rows.reduce(
    (acc, row) => ({
      total_revenue: acc.total_revenue + (row.total_revenue ?? 0),
      total_fees: acc.total_fees + (row.total_fees ?? 0),
      total_net: acc.total_net + (row.total_net ?? 0),
      total_cost_basis: acc.total_cost_basis + (row.total_cost_basis ?? 0),
      total_profit: acc.total_profit + (row.total_profit ?? 0),
      num_sales: acc.num_sales + (row.num_sales ?? 0),
    }),
    { total_revenue: 0, total_fees: 0, total_net: 0, total_cost_basis: 0, total_profit: 0, num_sales: 0 }
  );

  return { rows, totals };
}

export async function getYearlySummary(userId: string) {
  type YearRow = {
    year: string;
    num_sales: number;
    total_revenue: number;
    total_fees: number;
    total_net: number;
    total_cost_basis: number;
    total_profit: number;
  };

  const rows = (await db
    .selectFrom('sales as s')
    .select([
      sql<string>`TO_CHAR(s.sold_at, 'YYYY')`.as('year'),
      sql<number>`COUNT(*)::int`.as('num_sales'),
      sql<number>`SUM(s.sale_price)::int`.as('total_revenue'),
      sql<number>`SUM(s.platform_fees + s.shipping_cost)::int`.as('total_fees'),
      sql<number>`SUM(s.net_proceeds)::int`.as('total_net'),
      sql<number>`SUM(COALESCE(s.total_cost_basis, 0))::int`.as('total_cost_basis'),
      sql<number>`SUM(s.net_proceeds - COALESCE(s.total_cost_basis, 0))::int`.as('total_profit'),
    ])
    .where('s.user_id', '=', userId)
    .groupBy(sql`TO_CHAR(s.sold_at, 'YYYY')`)
    .orderBy(sql`TO_CHAR(s.sold_at, 'YYYY')`)
    .execute()) as YearRow[];

  const totals = rows.reduce(
    (acc, r) => ({
      num_sales: acc.num_sales + (r.num_sales ?? 0),
      total_revenue: acc.total_revenue + (r.total_revenue ?? 0),
      total_fees: acc.total_fees + (r.total_fees ?? 0),
      total_net: acc.total_net + (r.total_net ?? 0),
      total_cost_basis: acc.total_cost_basis + (r.total_cost_basis ?? 0),
      total_profit: acc.total_profit + (r.total_profit ?? 0),
    }),
    { num_sales: 0, total_revenue: 0, total_fees: 0, total_net: 0, total_cost_basis: 0, total_profit: 0 }
  );

  return { rows, totals };
}

export async function getInventoryValue(userId: string) {
  return db
    .selectFrom('card_instances as ci')
    .select([
      'ci.status',
      sql<number>`COUNT(*)::int`.as('count'),
      sql<number>`SUM(ci.purchase_cost)::int`.as('total_cost'),
    ])
    .where('ci.user_id', '=', userId)
    .where('ci.deleted_at', 'is', null)
    .where('ci.status', '!=', 'sold')
    .groupBy('ci.status')
    .execute();
}

export async function getGradingRoi(userId: string) {
  return db
    .selectFrom('sales as s')
    .innerJoin('card_instances as ci', 'ci.id', 's.card_instance_id')
    .innerJoin('slab_details as sd', 'sd.card_instance_id', 'ci.id')
    .leftJoin('grading_submissions as gs', 'gs.id', 'sd.grading_submission_id')
    .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
    .select([
      's.id as sale_id',
      sql<string>`COALESCE(cc.card_name, ci.card_name_override)`.as('card_name'),
      'sd.grade',
      'sd.company as grading_company',
      'ci.purchase_cost as raw_cost',
      sql<number>`COALESCE(gs.grading_fee + gs.shipping_cost, 0)`.as('grading_cost'),
      's.sale_price',
      's.net_proceeds',
      's.total_cost_basis',
      sql<number>`(s.net_proceeds - COALESCE(s.total_cost_basis, 0))`.as('profit'),
    ])
    .where('s.user_id', '=', userId)
    .orderBy('s.sold_at', 'desc')
    .execute();
}

export async function getPlatformBreakdown(userId: string, from: Date, to: Date) {
  return db
    .selectFrom('sales as s')
    .select([
      's.platform',
      sql<number>`COUNT(*)::int`.as('num_sales'),
      sql<number>`SUM(s.sale_price)::int`.as('total_revenue'),
      sql<number>`SUM(s.platform_fees)::int`.as('total_fees'),
      sql<number>`SUM(s.net_proceeds - COALESCE(s.total_cost_basis, 0))::int`.as('total_profit'),
    ])
    .where('s.user_id', '=', userId)
    .where('s.sold_at', '>=', from)
    .where('s.sold_at', '<=', to)
    .groupBy('s.platform')
    .orderBy('total_revenue', 'desc')
    .execute();
}
