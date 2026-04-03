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
    .where('ci.status', '!=', 'sold')
    .groupBy('ci.status')
    .execute();
}

export async function getGradingRoi(userId: string) {
  return db
    .selectFrom('sales as s')
    .innerJoin('card_instances as ci', 'ci.id', 's.card_instance_id')
    .innerJoin('slab_details as sd', 'sd.card_instance_id', 'ci.id')
    .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
    .select([
      's.id as sale_id',
      sql<string>`COALESCE(ci.card_name_override, cc.card_name)`.as('card_name'),
      'sd.grade',
      'sd.company as grading_company',
      'ci.purchase_cost as raw_cost',
      sql<number>`sd.grading_cost`.as('grading_cost'),
      's.sale_price',
      's.net_proceeds',
      's.total_cost_basis',
      sql<number>`(s.net_proceeds - COALESCE(s.total_cost_basis, 0))`.as('profit'),
    ])
    .where('s.user_id', '=', userId)
    .orderBy('s.sold_at', 'desc')
    .execute();
}

export async function getGradedDashboard(userId: string) {
  // ── Inventory by company ────────────────────────────────────────────────────
  const inventoryByCompanyQuery = sql<{
    company: string; count: number; cost_cents: number;
  }>`
    SELECT sd.company, COUNT(*)::int as count,
      COALESCE(SUM(ci.purchase_cost + sd.grading_cost + sd.additional_cost), 0)::int as cost_cents
    FROM card_instances ci
    JOIN slab_details sd ON sd.card_instance_id = ci.id
    WHERE ci.user_id = ${userId} AND ci.status = 'graded'
    GROUP BY sd.company
  `.execute(db);

  // ── Grade distribution ──────────────────────────────────────────────────────
  const gradeDistributionQuery = sql<{
    grade_range: string; count: number;
  }>`
    SELECT
      CASE
        WHEN sd.grade >= 10 THEN '10'
        WHEN sd.grade >= 9.5 THEN '9.5'
        WHEN sd.grade >= 9 THEN '9'
        WHEN sd.grade >= 8 THEN '8'
        WHEN sd.grade >= 7 THEN '7'
        ELSE '1-6'
      END as grade_range,
      COUNT(*)::int as count
    FROM card_instances ci
    JOIN slab_details sd ON sd.card_instance_id = ci.id
    WHERE ci.user_id = ${userId} AND ci.status = 'graded'
    GROUP BY grade_range
  `.execute(db);

  // ── Pipeline ────────────────────────────────────────────────────────────────
  const pipelineQuery = db
    .selectFrom('card_instances as ci')
    .select([
      sql<number>`COUNT(*) FILTER (WHERE ci.status = 'grading_submitted')::int`.as('at_graders'),
      sql<number>`COUNT(*) FILTER (WHERE ci.decision = 'grade' AND ci.status = 'inspected' AND ci.purchase_type = 'raw')::int`.as('unsubmitted'),
    ])
    .where('ci.user_id', '=', userId)
    .executeTakeFirst();

  // ── Sales ───────────────────────────────────────────────────────────────────
  const salesQuery = sql<{
    total_sold: number;
    avg_raw_cost_cents: number;
    avg_grading_cost_cents: number;
    avg_total_cost_cents: number;
    avg_sale_price_cents: number;
    avg_profit_cents: number;
    avg_profit_pct: number;
    total_revenue_cents: number;
    total_profit_cents: number;
  }>`
    SELECT
      COUNT(*)::int as total_sold,
      COALESCE(AVG(ci.purchase_cost), 0)::int as avg_raw_cost_cents,
      COALESCE(AVG(sd.grading_cost), 0)::int as avg_grading_cost_cents,
      COALESCE(AVG(COALESCE(s.total_cost_basis, ci.purchase_cost + sd.grading_cost + sd.additional_cost)), 0)::int as avg_total_cost_cents,
      COALESCE(AVG(s.sale_price), 0)::int as avg_sale_price_cents,
      COALESCE(AVG(s.net_proceeds - COALESCE(s.total_cost_basis, 0)), 0)::int as avg_profit_cents,
      COALESCE(AVG(
        CASE WHEN COALESCE(s.total_cost_basis, 0) > 0
        THEN (s.net_proceeds - COALESCE(s.total_cost_basis, 0))::float / s.total_cost_basis * 100
        ELSE NULL END
      ), 0) as avg_profit_pct,
      COALESCE(SUM(s.sale_price), 0)::int as total_revenue_cents,
      COALESCE(SUM(s.net_proceeds - COALESCE(s.total_cost_basis, 0)), 0)::int as total_profit_cents
    FROM sales s
    JOIN card_instances ci ON ci.id = s.card_instance_id
    JOIN slab_details sd ON sd.card_instance_id = ci.id
    WHERE s.user_id = ${userId}
  `.execute(db);

  // ── By company (sold) ───────────────────────────────────────────────────────
  const byCompanyQuery = sql<{
    company: string;
    count_sold: number;
    avg_sale_price_cents: number;
    avg_profit_pct: number;
  }>`
    SELECT sd.company, COUNT(*)::int as count_sold,
      COALESCE(AVG(s.sale_price), 0)::int as avg_sale_price_cents,
      COALESCE(AVG(
        CASE WHEN COALESCE(s.total_cost_basis, 0) > 0
        THEN (s.net_proceeds - COALESCE(s.total_cost_basis, 0))::float / s.total_cost_basis * 100
        ELSE NULL END
      ), 0) as avg_profit_pct
    FROM sales s
    JOIN card_instances ci ON ci.id = s.card_instance_id
    JOIN slab_details sd ON sd.card_instance_id = ci.id
    WHERE s.user_id = ${userId}
    GROUP BY sd.company
    ORDER BY count_sold DESC
  `.execute(db);

  // ── Listing vs Sale ─────────────────────────────────────────────────────────
  const listingVsSaleQuery = sql<{
    count: number;
    avg_asking_price_cents: number;
    avg_sale_price_cents: number;
    avg_pct_of_asking: number;
    avg_discount_pct: number;
  }>`
    SELECT
      COUNT(*)::int as count,
      COALESCE(AVG(l.asking_price), 0)::int as avg_asking_price_cents,
      COALESCE(AVG(s.sale_price), 0)::int as avg_sale_price_cents,
      COALESCE(AVG(s.sale_price::float / NULLIF(l.asking_price, 0) * 100), 0) as avg_pct_of_asking,
      COALESCE(AVG((l.asking_price - s.sale_price)::float / NULLIF(l.asking_price, 0) * 100), 0) as avg_discount_pct
    FROM sales s
    JOIN card_instances ci ON ci.id = s.card_instance_id
    JOIN slab_details sd ON sd.card_instance_id = ci.id
    JOIN listings l ON l.id = s.listing_id
    WHERE s.user_id = ${userId} AND s.listing_id IS NOT NULL
  `.execute(db);

  const [inventoryByCompany, gradeDistribution, pipeline, salesResult, byCompany, listingVsSale] = await Promise.all([
    inventoryByCompanyQuery,
    gradeDistributionQuery,
    pipelineQuery,
    salesQuery,
    byCompanyQuery,
    listingVsSaleQuery,
  ]);

  const invRows = inventoryByCompany.rows;
  const totalInventory = invRows.reduce((s, r) => s + r.count, 0);
  const totalCostCents = invRows.reduce((s, r) => s + r.cost_cents, 0);

  const s = salesResult.rows[0];
  const lvs = listingVsSale.rows[0];

  return {
    inventory: {
      total: totalInventory,
      total_cost_cents: totalCostCents,
      by_company: invRows.map((r) => ({ company: r.company, count: r.count, cost_cents: r.cost_cents })),
      by_grade: gradeDistribution.rows.map((r) => ({ grade: r.grade_range, count: r.count })),
    },
    pipeline: {
      at_graders: pipeline?.at_graders ?? 0,
      unsubmitted: pipeline?.unsubmitted ?? 0,
    },
    sales: {
      total_sold: s?.total_sold ?? 0,
      avg_raw_cost_cents: s?.avg_raw_cost_cents ?? 0,
      avg_grading_cost_cents: s?.avg_grading_cost_cents ?? 0,
      avg_total_cost_cents: s?.avg_total_cost_cents ?? 0,
      avg_sale_price_cents: s?.avg_sale_price_cents ?? 0,
      avg_profit_cents: s?.avg_profit_cents ?? 0,
      avg_profit_pct: s != null ? Number(s.avg_profit_pct) : 0,
      total_revenue_cents: s?.total_revenue_cents ?? 0,
      total_profit_cents: s?.total_profit_cents ?? 0,
    },
    by_company: byCompany.rows.map((r) => ({
      company: r.company,
      count_sold: r.count_sold,
      avg_sale_price_cents: r.avg_sale_price_cents,
      avg_profit_pct: Number(r.avg_profit_pct),
    })),
    listing_vs_sale: {
      count: lvs?.count ?? 0,
      avg_asking_price_cents: lvs?.avg_asking_price_cents ?? 0,
      avg_sale_price_cents: lvs?.avg_sale_price_cents ?? 0,
      avg_pct_of_asking: lvs != null ? Number(lvs.avg_pct_of_asking) : 0,
      avg_discount_pct: lvs != null ? Number(lvs.avg_discount_pct) : 0,
    },
  };
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

export async function getRawDashboard(userId: string) {
  // ── Purchases ──────────────────────────────────────────────────────────────
  const purchasesQuery = db
    .selectFrom('raw_purchases as rp')
    .select([
      sql<number>`COUNT(*)::int`.as('orders_made'),
      sql<number>`COUNT(*) FILTER (WHERE rp.status = 'ordered')::int`.as('orders_pending'),
      sql<number>`COUNT(*) FILTER (WHERE rp.status = 'received')::int`.as('orders_received'),
      sql<number>`COUNT(*) FILTER (WHERE rp.status = 'cancelled')::int`.as('orders_canceled'),
      sql<number>`COALESCE(SUM(rp.card_count) FILTER (WHERE rp.status = 'received'), 0)::int`.as('cards_received'),
      sql<number>`COALESCE(SUM(rp.card_count) FILTER (WHERE rp.type = 'bulk' AND rp.status = 'received'), 0)::int`.as('bulk_cards_received'),
      sql<number>`COALESCE(SUM(rp.card_count) FILTER (WHERE rp.type = 'raw' AND rp.status = 'received'), 0)::int`.as('raw_cards_received'),
    ])
    .where('rp.user_id', '=', userId)
    .executeTakeFirst();

  // ── Raws & Bulk ────────────────────────────────────────────────────────────
  const rawsAndBulkQuery = db
    .selectFrom('card_instances as ci')
    .leftJoin('raw_purchases as rp', 'rp.id', 'ci.raw_purchase_id')
    .select([
      sql<number>`COALESCE(SUM(ci.quantity) FILTER (WHERE rp.type = 'bulk'), 0)::int`.as('bulk_inspected'),
      sql<number>`COALESCE(SUM(ci.quantity) FILTER (WHERE rp.type = 'raw'), 0)::int`.as('raws_inspected'),
      sql<number>`COALESCE(SUM(ci.quantity) FILTER (WHERE ci.decision = 'sell_raw' AND ci.status NOT IN ('sold', 'lost_damaged')), 0)::int`.as('ungradable_to_sell'),
      sql<number>`COALESCE(SUM(ci.quantity) FILTER (WHERE ci.decision = 'sell_raw' AND ci.status = 'raw_for_sale' AND rp.type = 'raw'), 0)::int`.as('sellable_ungradable_raws'),
      sql<number>`COALESCE(SUM(ci.quantity) FILTER (WHERE ci.decision = 'sell_raw' AND ci.status = 'raw_for_sale' AND rp.type = 'bulk'), 0)::int`.as('sellable_ungradable_bulk'),
      sql<number>`COALESCE(SUM(ci.quantity) FILTER (WHERE ci.decision = 'sell_raw' AND ci.status = 'sold' AND rp.type = 'raw'), 0)::int`.as('ungradable_raws_sold'),
      sql<number>`COALESCE(SUM(ci.quantity) FILTER (WHERE ci.decision = 'sell_raw' AND ci.status = 'sold' AND rp.type = 'bulk'), 0)::int`.as('ungradable_bulk_sold'),
    ])
    .where('ci.user_id', '=', userId)
    .where('ci.purchase_type', '=', 'raw')
    .executeTakeFirst();

  // ── Grading ────────────────────────────────────────────────────────────────
  const gradingQuery = db
    .selectFrom('card_instances as ci')
    .leftJoin('raw_purchases as rp', 'rp.id', 'ci.raw_purchase_id')
    .select([
      sql<number>`COALESCE(SUM(ci.quantity) FILTER (WHERE ci.decision = 'grade' AND ci.status NOT IN ('sold', 'lost_damaged')), 0)::int`.as('total_for_grading'),
      sql<number>`COALESCE(SUM(ci.quantity) FILTER (WHERE ci.decision = 'grade' AND ci.status NOT IN ('sold', 'lost_damaged') AND rp.type = 'bulk'), 0)::int`.as('bulk_for_grading'),
      sql<number>`COALESCE(SUM(ci.quantity) FILTER (WHERE ci.decision = 'grade' AND ci.status NOT IN ('sold', 'lost_damaged') AND rp.type = 'raw'), 0)::int`.as('raw_for_grading'),
      sql<number>`COALESCE(SUM(ci.quantity) FILTER (WHERE ci.decision = 'grade' AND ci.status = 'inspected' AND rp.type = 'raw'), 0)::int`.as('unsubmitted_raw'),
      sql<number>`COALESCE(SUM(ci.quantity) FILTER (WHERE ci.decision = 'grade' AND ci.status = 'inspected' AND rp.type = 'bulk'), 0)::int`.as('unsubmitted_bulk'),
      sql<number>`COALESCE(SUM(ci.quantity) FILTER (WHERE ci.status = 'grading_submitted' AND rp.type = 'raw'), 0)::int`.as('submitted_raws'),
      sql<number>`COALESCE(SUM(ci.quantity) FILTER (WHERE ci.status = 'grading_submitted' AND rp.type = 'bulk'), 0)::int`.as('submitted_bulk'),
    ])
    .where('ci.user_id', '=', userId)
    .where('ci.purchase_type', '=', 'raw')
    .executeTakeFirst();

  // ── Turnover ───────────────────────────────────────────────────────────────
  const turnoverQuery = db
    .selectFrom('sales as s')
    .innerJoin('card_instances as ci', 'ci.id', 's.card_instance_id')
    .leftJoin('raw_purchases as rp', 'rp.id', 'ci.raw_purchase_id')
    .select([
      sql<number | null>`AVG(EXTRACT(EPOCH FROM (s.sold_at - ci.purchased_at))/86400) FILTER (WHERE ci.decision = 'sell_raw' AND rp.type = 'raw')`.as('avg_days_sell_raw'),
      sql<number | null>`AVG(EXTRACT(EPOCH FROM (s.sold_at - ci.purchased_at))/86400) FILTER (WHERE ci.decision = 'sell_raw' AND rp.type = 'bulk')`.as('avg_days_sell_bulk'),
      sql<number | null>`AVG(EXTRACT(EPOCH FROM (s.sold_at - ci.purchased_at))/86400) FILTER (WHERE ci.decision = 'grade' AND rp.type = 'raw' AND s.user_id = ${userId})`.as('avg_days_grade_raw'),
      sql<number | null>`AVG(EXTRACT(EPOCH FROM (s.sold_at - ci.purchased_at))/86400) FILTER (WHERE ci.decision = 'grade' AND rp.type = 'bulk' AND s.user_id = ${userId})`.as('avg_days_grade_bulk'),
    ])
    .where('s.user_id', '=', userId)
    .where('ci.purchase_type', '=', 'raw')
    .executeTakeFirst();

  // ── Cash Flow ──────────────────────────────────────────────────────────────
  // Only raw cards sold AS RAW — exclude any card that has a slab_details row
  // (those are raw cards that went through grading and sold as graded slabs)
  const cashFlowSalesQuery = db
    .selectFrom('sales as s')
    .innerJoin('card_instances as ci', 'ci.id', 's.card_instance_id')
    .leftJoin('raw_purchases as rp', 'rp.id', 'ci.raw_purchase_id')
    .where((eb) => eb.not(eb.exists(
      eb.selectFrom('slab_details as sd').select('sd.id').whereRef('sd.card_instance_id', '=', 'ci.id')
    )))
    .select([
      sql<number>`COALESCE(SUM(s.sale_price), 0)::int`.as('gross_revenue_cents'),
      sql<number>`COALESCE(SUM(s.total_cost_basis), 0)::int`.as('cogs_sold_cents'),
      sql<number>`COALESCE(SUM(s.net_proceeds - COALESCE(s.total_cost_basis, 0)), 0)::int`.as('net_profit_sold_cents'),
      sql<number>`COALESCE(AVG(s.net_proceeds - COALESCE(s.total_cost_basis, 0)) FILTER (WHERE rp.type = 'raw'), 0)::int`.as('avg_profit_sold_raw_cents'),
      sql<number>`COALESCE(AVG(s.net_proceeds - COALESCE(s.total_cost_basis, 0)) FILTER (WHERE rp.type = 'bulk'), 0)::int`.as('avg_profit_sold_bulk_cents'),
      sql<number>`COALESCE(SUM(s.net_proceeds - COALESCE(s.total_cost_basis, 0)) FILTER (WHERE rp.type = 'raw'), 0)::int`.as('net_gain_loss_sold_raw_cents'),
      sql<number>`COALESCE(SUM(s.net_proceeds - COALESCE(s.total_cost_basis, 0)) FILTER (WHERE rp.type = 'bulk'), 0)::int`.as('net_gain_loss_sold_bulk_cents'),
    ])
    .where('s.user_id', '=', userId)
    .where('ci.purchase_type', '=', 'raw')
    .executeTakeFirst();

  // Only unsold raw cards not yet graded (exclude cards in graded status — those belong to slab dashboard)
  const cashFlowUnsoldQuery = db
    .selectFrom('card_instances as ci')
    .leftJoin('raw_purchases as rp', 'rp.id', 'ci.raw_purchase_id')
    .where((eb) => eb.not(eb.exists(
      eb.selectFrom('slab_details as sd').select('sd.id').whereRef('sd.card_instance_id', '=', 'ci.id')
    )))
    .select([
      sql<number>`COALESCE(SUM(ci.purchase_cost), 0)::int`.as('cogs_unsold_cents'),
      sql<number>`COALESCE(SUM(ci.purchase_cost) FILTER (WHERE rp.type = 'raw'), 0)::int`.as('cogs_unsold_raw_cents'),
      sql<number>`COALESCE(SUM(ci.purchase_cost) FILTER (WHERE rp.type = 'bulk'), 0)::int`.as('cogs_unsold_bulk_cents'),
      sql<number>`COALESCE(AVG(ci.purchase_cost) FILTER (WHERE rp.type = 'raw'), 0)::int`.as('avg_cost_unsold_raw_cents'),
      sql<number>`COALESCE(AVG(ci.purchase_cost) FILTER (WHERE rp.type = 'bulk'), 0)::int`.as('avg_cost_unsold_bulk_cents'),
    ])
    .where('ci.user_id', '=', userId)
    .where('ci.purchase_type', '=', 'raw')
    .where('ci.status', 'not in', ['sold', 'lost_damaged'])
    .executeTakeFirst();

  const [purchases, rawsAndBulk, grading, turnover, cashFlowSales, cashFlowUnsold] = await Promise.all([
    purchasesQuery,
    rawsAndBulkQuery,
    gradingQuery,
    turnoverQuery,
    cashFlowSalesQuery,
    cashFlowUnsoldQuery,
  ]);

  const net_profit_sold = cashFlowSales?.net_profit_sold_cents ?? 0;
  const cogs_unsold = cashFlowUnsold?.cogs_unsold_cents ?? 0;

  return {
    purchases: {
      orders_made: purchases?.orders_made ?? 0,
      orders_pending: purchases?.orders_pending ?? 0,
      orders_received: purchases?.orders_received ?? 0,
      orders_canceled: purchases?.orders_canceled ?? 0,
      cards_received: purchases?.cards_received ?? 0,
      bulk_cards_received: purchases?.bulk_cards_received ?? 0,
      raw_cards_received: purchases?.raw_cards_received ?? 0,
    },
    raws_and_bulk: {
      bulk_inspected: rawsAndBulk?.bulk_inspected ?? 0,
      raws_inspected: rawsAndBulk?.raws_inspected ?? 0,
      ungradable_to_sell: rawsAndBulk?.ungradable_to_sell ?? 0,
      sellable_ungradable_raws: rawsAndBulk?.sellable_ungradable_raws ?? 0,
      sellable_ungradable_bulk: rawsAndBulk?.sellable_ungradable_bulk ?? 0,
      ungradable_raws_sold: rawsAndBulk?.ungradable_raws_sold ?? 0,
      ungradable_bulk_sold: rawsAndBulk?.ungradable_bulk_sold ?? 0,
    },
    grading: {
      total_for_grading: grading?.total_for_grading ?? 0,
      bulk_for_grading: grading?.bulk_for_grading ?? 0,
      raw_for_grading: grading?.raw_for_grading ?? 0,
      unsubmitted_raw: grading?.unsubmitted_raw ?? 0,
      unsubmitted_bulk: grading?.unsubmitted_bulk ?? 0,
      submitted_raws: grading?.submitted_raws ?? 0,
      submitted_bulk: grading?.submitted_bulk ?? 0,
    },
    turnover: {
      avg_days_sell_raw: turnover?.avg_days_sell_raw != null ? Math.round(Number(turnover.avg_days_sell_raw)) : null,
      avg_days_sell_bulk: turnover?.avg_days_sell_bulk != null ? Math.round(Number(turnover.avg_days_sell_bulk)) : null,
      avg_days_grade_raw: turnover?.avg_days_grade_raw != null ? Math.round(Number(turnover.avg_days_grade_raw)) : null,
      avg_days_grade_bulk: turnover?.avg_days_grade_bulk != null ? Math.round(Number(turnover.avg_days_grade_bulk)) : null,
    },
    cash_flow: {
      gross_revenue_cents: cashFlowSales?.gross_revenue_cents ?? 0,
      cogs_sold_cents: cashFlowSales?.cogs_sold_cents ?? 0,
      net_profit_sold_cents: net_profit_sold,
      cogs_unsold_cents: cogs_unsold,
      cogs_unsold_raw_cents: cashFlowUnsold?.cogs_unsold_raw_cents ?? 0,
      cogs_unsold_bulk_cents: cashFlowUnsold?.cogs_unsold_bulk_cents ?? 0,
      overall_gain_loss_cents: net_profit_sold - cogs_unsold,
      avg_cost_unsold_raw_cents: cashFlowUnsold?.avg_cost_unsold_raw_cents ?? 0,
      avg_cost_unsold_bulk_cents: cashFlowUnsold?.avg_cost_unsold_bulk_cents ?? 0,
      avg_profit_sold_raw_cents: cashFlowSales?.avg_profit_sold_raw_cents ?? 0,
      avg_profit_sold_bulk_cents: cashFlowSales?.avg_profit_sold_bulk_cents ?? 0,
      net_gain_loss_sold_raw_cents: cashFlowSales?.net_gain_loss_sold_raw_cents ?? 0,
      net_gain_loss_sold_bulk_cents: cashFlowSales?.net_gain_loss_sold_bulk_cents ?? 0,
    },
  };
}
