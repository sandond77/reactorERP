import { sql } from 'kysely';
import { db } from '../config/database';

export type PnlGroupBy = 'month' | 'platform' | 'game';
export type PnlChannel = 'all' | 'ebay' | 'card_show' | 'other';
export type PnlCardType = 'all' | 'graded' | 'ungraded';

export async function getPnlReport(
  userId: string,
  from: Date | null,
  to: Date | null,
  groupBy: PnlGroupBy = 'month',
  channel: PnlChannel = 'all',
  cardType: PnlCardType = 'all',
) {
  type Row = {
    label: string;
    show_id: string | null;
    num_sales: number;
    total_revenue: number;
    total_fees: number;
    total_net: number;
    total_cost_basis: number;
    total_profit: number;
  };

  const channelFilter = channel === 'ebay' ? sql<boolean>`s.platform = 'ebay'`
    : channel === 'card_show' ? sql<boolean>`s.platform = 'card_show'`
    : channel === 'other' ? sql<boolean>`s.platform NOT IN ('ebay', 'card_show')`
    : sql<boolean>`TRUE`;

  const slabExists = sql<boolean>`EXISTS (SELECT 1 FROM slab_details sd WHERE sd.card_instance_id = ci.id)`;
  const cardTypeFilter = cardType === 'graded' ? slabExists
    : cardType === 'ungraded' ? sql<boolean>`NOT ${slabExists}`
    : sql<boolean>`TRUE`;

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
      .where(sql<boolean>`${channelFilter}` as any)
      .where(sql<boolean>`${cardTypeFilter}` as any)
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
      .where(sql<boolean>`${channelFilter}` as any)
      .where(sql<boolean>`${cardTypeFilter}` as any)
      .groupBy('ci.card_game')
      .orderBy('ci.card_game')
      .execute()) as Row[];
  } else if (channel === 'card_show') {
    // Group by individual card show event — only shows with a linked card_show record
    rows = (await db
      .selectFrom('sales as s')
      .innerJoin('card_instances as ci', 'ci.id', 's.card_instance_id')
      .innerJoin('card_shows as cs', 'cs.id', 's.card_show_id')
      .select([
        sql<string>`cs.name || ' (' || TO_CHAR(cs.show_date, 'Mon DD, YYYY') || ')'`.as('label'),
        sql<string>`cs.id::text`.as('show_id'),
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
      .$if(cardType === 'graded', (qb) => qb.where(sql<boolean>`EXISTS (SELECT 1 FROM slab_details sd WHERE sd.card_instance_id = ci.id)`))
      .$if(cardType === 'ungraded', (qb) => qb.where(sql<boolean>`NOT EXISTS (SELECT 1 FROM slab_details sd WHERE sd.card_instance_id = ci.id)`))
      .groupBy(['cs.id', 'cs.name', 'cs.show_date'])
      .orderBy('cs.show_date', 'desc')
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
      .where(sql<boolean>`${channelFilter}` as any)
      .where(sql<boolean>`${cardTypeFilter}` as any)
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

export async function getYearlySummary(userId: string, channel: PnlChannel = 'all', cardType: PnlCardType = 'all') {
  type YearRow = {
    year: string;
    num_sales: number;
    total_revenue: number;
    total_fees: number;
    total_net: number;
    total_cost_basis: number;
    total_profit: number;
  };

  const channelFilter = channel === 'ebay' ? sql<boolean>`s.platform = 'ebay'`
    : channel === 'card_show' ? sql<boolean>`s.platform = 'card_show'`
    : channel === 'other' ? sql<boolean>`s.platform NOT IN ('ebay', 'card_show')`
    : sql<boolean>`TRUE`;

  const slabExists = sql<boolean>`EXISTS (SELECT 1 FROM slab_details sd WHERE sd.card_instance_id = ci.id)`;
  const cardTypeFilter = cardType === 'graded' ? slabExists
    : cardType === 'ungraded' ? sql<boolean>`NOT ${slabExists}`
    : sql<boolean>`TRUE`;

  const rows = (await db
    .selectFrom('sales as s')
    .innerJoin('card_instances as ci', 'ci.id', 's.card_instance_id')
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
    .where(channelFilter)
    .where(cardTypeFilter)
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

export async function getGradedDashboard(userId: string, view: 'all' | 'sold' | 'unsold' = 'unsold') {
  const statusFilter = view === 'all'
    ? sql`ci.status IN ('graded', 'sold')`
    : view === 'sold'
      ? sql`ci.status = 'sold'`
      : sql`ci.status = 'graded'`;

  // ── Inventory by company ────────────────────────────────────────────────────
  const inventoryByCompanyQuery = sql<{
    company: string; count: number; cost_cents: number; raw_cost_cents: number;
  }>`
    SELECT sd.company, COUNT(*)::int as count,
      COALESCE(SUM(ci.purchase_cost + sd.grading_cost + COALESCE(sd.additional_cost, 0)), 0)::int as cost_cents,
      COALESCE(SUM(ci.purchase_cost), 0)::int as raw_cost_cents
    FROM card_instances ci
    JOIN slab_details sd ON sd.card_instance_id = ci.id
    WHERE ci.user_id = ${userId} AND ${statusFilter}
    GROUP BY sd.company
  `.execute(db);

  // ── Grade distribution ──────────────────────────────────────────────────────
  const gradeDistributionQuery = sql<{
    grade: number; grade_label: string | null; company: string; count: number;
  }>`
    SELECT sd.grade,
      CASE
        WHEN sd.grade_label ILIKE 'gem%mint%' OR sd.grade_label ILIKE 'gem%mt%' THEN 'GEM MINT'
        WHEN sd.grade_label ILIKE 'near%mint%mint%' THEN 'NEAR MINT-MINT'
        WHEN sd.grade_label ILIKE 'near%mint%'  THEN 'NEAR MINT'
        WHEN sd.grade_label ILIKE 'mint%'       THEN 'MINT'
        WHEN sd.grade_label ILIKE 'excellent%mint%' THEN 'EXCELLENT-MINT'
        WHEN sd.grade_label ILIKE 'excellent%'  THEN 'EXCELLENT'
        WHEN sd.grade_label ILIKE 'very%good%excellent%' THEN 'VERY GOOD-EXCELLENT'
        WHEN sd.grade_label ILIKE 'very%good%'  THEN 'VERY GOOD'
        WHEN sd.grade_label ILIKE 'good%'       THEN 'GOOD'
        WHEN sd.grade_label ILIKE 'poor%'       THEN 'POOR'
        ELSE sd.grade_label
      END AS grade_label,
      sd.company, COUNT(*)::int as count
    FROM card_instances ci
    JOIN slab_details sd ON sd.card_instance_id = ci.id
    WHERE ci.user_id = ${userId} AND ${statusFilter}
    GROUP BY sd.grade, grade_label, sd.company
    ORDER BY sd.grade, grade_label
  `.execute(db);

  // ── Pipeline ────────────────────────────────────────────────────────────────
  const pipelineQuery = db
    .selectFrom('card_instances as ci')
    .select([
      sql<number>`COUNT(*) FILTER (WHERE ci.status = 'grading_submitted')::int`.as('at_graders'),
      sql<number>`COALESCE(SUM(ci.purchase_cost) FILTER (WHERE ci.status = 'grading_submitted'), 0)::int`.as('at_graders_cost'),
      sql<number>`COUNT(*) FILTER (WHERE ci.decision = 'grade' AND ci.status = 'inspected' AND ci.purchase_type = 'raw')::int`.as('unsubmitted'),
      sql<number>`COALESCE(SUM(ci.purchase_cost) FILTER (WHERE ci.decision = 'grade' AND ci.status = 'inspected' AND ci.purchase_type = 'raw'), 0)::int`.as('unsubmitted_cost'),
      sql<number>`COUNT(*) FILTER (WHERE ci.status = 'graded')::int`.as('returned'),
      sql<number>`COALESCE(AVG(
        EXTRACT(DAY FROM NOW() - ci.updated_at)
      ) FILTER (WHERE ci.status = 'grading_submitted'), 0)::int`.as('avg_days_at_graders'),
    ])
    .where('ci.user_id', '=', userId)
    .executeTakeFirst();

  // ── Active batches ──────────────────────────────────────────────────────────
  const activeBatchesQuery = db
    .selectFrom('grading_batches as gb')
    .leftJoin('grading_batch_items as gbi', 'gbi.batch_id', 'gb.id')
    .leftJoin('card_instances as ci', 'ci.id', 'gbi.card_instance_id')
    .select([
      'gb.id',
      'gb.batch_id',
      'gb.name',
      'gb.company',
      'gb.tier',
      'gb.submitted_at',
      'gb.status',
      'gb.grading_cost',
      sql<number>`COALESCE(SUM(gbi.quantity), 0)::int`.as('card_count'),
      sql<number>`COALESCE(SUM(ci.purchase_cost * gbi.quantity), 0)::int`.as('raw_cost'),
      sql<number>`COALESCE(SUM(gbi.estimated_value * gbi.quantity), 0)::int`.as('estimated_total'),
      sql<number>`COALESCE(EXTRACT(DAY FROM NOW() - gb.submitted_at), 0)::int`.as('days_elapsed'),
    ])
    .where('gb.user_id', '=', userId)
    .where('gb.status', '!=', 'returned')
    .groupBy('gb.id')
    .orderBy('gb.submitted_at', 'asc')
    .execute();

  // ── Sales ───────────────────────────────────────────────────────────────────
  const salesQuery = sql<{
    total_sold: number;
    avg_raw_cost_cents: number;
    avg_grading_cost_cents: number;
    avg_total_cost_cents: number;
    avg_sale_price_cents: number;
    avg_profit_cents: number;
    avg_profit_pct: number;
    avg_fees_cents: number;
    avg_fees_pct: number;
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
      COALESCE(AVG(s.sale_price - s.net_proceeds), 0)::int as avg_fees_cents,
      COALESCE(AVG(
        CASE WHEN s.sale_price > 0
        THEN (s.sale_price - s.net_proceeds)::float / s.sale_price * 100
        ELSE NULL END
      ), 0) as avg_fees_pct,
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

  const [inventoryByCompany, gradeDistribution, pipeline, salesResult, byCompany, listingVsSale, activeBatches] = await Promise.all([
    inventoryByCompanyQuery,
    gradeDistributionQuery,
    pipelineQuery,
    salesQuery,
    byCompanyQuery,
    listingVsSaleQuery,
    activeBatchesQuery,
  ]);

  const invRows = inventoryByCompany.rows;
  const totalInventory = invRows.reduce((s, r) => s + r.count, 0);
  const totalCostCents = invRows.reduce((s, r) => s + r.cost_cents, 0);
  const totalRawCostCents = invRows.reduce((s, r) => s + r.raw_cost_cents, 0);

  const s = salesResult.rows[0];
  const lvs = listingVsSale.rows[0];

  return {
    inventory: {
      total: totalInventory,
      total_cost_cents: totalCostCents,
      total_raw_cost_cents: totalRawCostCents,
      by_company: invRows.map((r) => ({ company: r.company, count: r.count, cost_cents: r.cost_cents })),
      by_grade: gradeDistribution.rows.map((r) => ({ grade: r.grade, grade_label: r.grade_label ?? null, company: r.company, count: r.count })),
    },
    pipeline: {
      at_graders: pipeline?.at_graders ?? 0,
      at_graders_cost: pipeline?.at_graders_cost ?? 0,
      unsubmitted: pipeline?.unsubmitted ?? 0,
      unsubmitted_cost: pipeline?.unsubmitted_cost ?? 0,
      returned: pipeline?.returned ?? 0,
      avg_days_at_graders: pipeline?.avg_days_at_graders ?? 0,
      active_batches: activeBatches.map((b) => {
        const cardCount = Number(b.card_count);
        const rawCost = Number(b.raw_cost);
        const gradingCost = (b.grading_cost ?? 0) * cardCount;
        return {
          id: b.id,
          batch_id: b.batch_id,
          name: b.name,
          company: b.company,
          tier: b.tier,
          submitted_at: b.submitted_at,
          status: b.status,
          card_count: cardCount,
          days_elapsed: Number(b.days_elapsed),
          raw_cost: rawCost,
          grading_cost: gradingCost,
          total_cost: rawCost + gradingCost,
          estimated_total: Number(b.estimated_total),
        };
      }),
    },
    sales: {
      total_sold: s?.total_sold ?? 0,
      avg_raw_cost_cents: s?.avg_raw_cost_cents ?? 0,
      avg_grading_cost_cents: s?.avg_grading_cost_cents ?? 0,
      avg_total_cost_cents: s?.avg_total_cost_cents ?? 0,
      avg_sale_price_cents: s?.avg_sale_price_cents ?? 0,
      avg_profit_cents: s?.avg_profit_cents ?? 0,
      avg_profit_pct: s != null ? Number(s.avg_profit_pct) : 0,
      avg_fees_cents: s?.avg_fees_cents ?? 0,
      avg_fees_pct: s != null ? Number(s.avg_fees_pct) : 0,
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

export async function getRawDashboard(userId: string, view: 'all' | 'sold' | 'unsold' = 'unsold', type: 'both' | 'raw' | 'bulk' = 'both') {
  // Status filters (exclude cards that went to grading → became slabs)
  const unsoldFilter = sql`ci.status IN ('purchased_raw', 'inspected', 'raw_for_sale')`;
  const soldFilter = sql`(ci.status = 'sold' AND ci.decision = 'sell_raw')`;
  const allFilter = sql`(ci.status IN ('purchased_raw', 'inspected', 'raw_for_sale') OR (ci.status = 'sold' AND ci.decision = 'sell_raw'))`;
  const statusFilter = view === 'all' ? allFilter : view === 'sold' ? soldFilter : unsoldFilter;

  const typeFilter = type === 'raw' ? sql`COALESCE(rp.type, 'raw') = 'raw'`
    : type === 'bulk' ? sql`rp.type = 'bulk'`
    : sql`TRUE`;

  const noSlabCondition = sql`NOT EXISTS (SELECT 1 FROM slab_details sd WHERE sd.card_instance_id = ci.id)`;

  // ── Inventory by type (view-filtered) ──────────────────────────────────────
  const inventoryByTypeQuery = sql<{
    type: string; count: number; cost_cents: number;
  }>`
    SELECT COALESCE(rp.type, 'raw') as type,
      COUNT(*)::int as count,
      COALESCE(SUM(ci.purchase_cost), 0)::int as cost_cents
    FROM card_instances ci
    LEFT JOIN raw_purchases rp ON rp.id = ci.raw_purchase_id
    WHERE ci.user_id = ${userId}
      AND ci.purchase_type = 'raw'
      AND ${noSlabCondition}
      AND ${statusFilter}
      AND ${typeFilter}
    GROUP BY COALESCE(rp.type, 'raw')
  `.execute(db);

  // ── Condition distribution (view + type filtered) ─────────────────────────
  const conditionQuery = sql<{
    condition: string; count: number;
  }>`
    SELECT COALESCE(ci.condition, 'Unknown') as condition, COUNT(*)::int as count
    FROM card_instances ci
    LEFT JOIN raw_purchases rp ON rp.id = ci.raw_purchase_id
    WHERE ci.user_id = ${userId}
      AND ci.purchase_type = 'raw'
      AND ${noSlabCondition}
      AND ${statusFilter}
      AND ${typeFilter}
    GROUP BY COALESCE(ci.condition, 'Unknown')
    ORDER BY count DESC
  `.execute(db);

  // ── Orders (type-filtered, not view/status filtered) ──────────────────────
  const ordersQuery = db
    .selectFrom('raw_purchases as rp')
    .select([
      sql<number>`COUNT(*)::int`.as('total'),
      sql<number>`COUNT(*) FILTER (WHERE rp.status = 'ordered')::int`.as('pending'),
      sql<number>`COUNT(*) FILTER (WHERE rp.status = 'received')::int`.as('received'),
      sql<number>`COUNT(*) FILTER (WHERE rp.status = 'cancelled')::int`.as('canceled'),
      sql<number>`COALESCE(SUM(rp.card_count) FILTER (WHERE rp.status = 'received'), 0)::int`.as('cards_received'),
    ])
    .where('rp.user_id', '=', userId)
    .$if(type !== 'both', (qb) => qb.where('rp.type', '=', type as 'raw' | 'bulk'))
    .executeTakeFirst();

  // ── Pipeline (always full, not view-filtered, but type-filtered) ────────────
  const pipelineQuery = sql<{
    purchased_raw: number; inspected: number; raw_for_sale: number; grading_submitted: number;
    purchased_raw_cost: number; inspected_cost: number; raw_for_sale_cost: number; grading_submitted_cost: number;
    routed_sell_raw: number; routed_grade: number;
  }>`
    SELECT
      COUNT(*) FILTER (WHERE ci.status = 'purchased_raw')::int as purchased_raw,
      COUNT(*) FILTER (WHERE ci.status = 'inspected')::int as inspected,
      COUNT(*) FILTER (WHERE ci.status = 'raw_for_sale')::int as raw_for_sale,
      COUNT(*) FILTER (WHERE ci.status = 'grading_submitted')::int as grading_submitted,
      COALESCE(SUM(ci.purchase_cost) FILTER (WHERE ci.status = 'purchased_raw'), 0)::int as purchased_raw_cost,
      COALESCE(SUM(ci.purchase_cost) FILTER (WHERE ci.status = 'inspected'), 0)::int as inspected_cost,
      COALESCE(SUM(ci.purchase_cost) FILTER (WHERE ci.status = 'raw_for_sale'), 0)::int as raw_for_sale_cost,
      COALESCE(SUM(ci.purchase_cost) FILTER (WHERE ci.status = 'grading_submitted'), 0)::int as grading_submitted_cost,
      COUNT(*) FILTER (WHERE ci.decision = 'sell_raw')::int as routed_sell_raw,
      COUNT(*) FILTER (WHERE ci.decision = 'grade')::int as routed_grade
    FROM card_instances ci
    LEFT JOIN raw_purchases rp ON rp.id = ci.raw_purchase_id
    WHERE ci.user_id = ${userId}
      AND ci.purchase_type = 'raw'
      AND ${noSlabCondition}
      AND ${typeFilter}
  `.execute(db);

  // ── Sales (type-filtered, not view-filtered) ───────────────────────────────
  const salesQuery = sql<{
    total_sold: number;
    total_revenue_cents: number;
    total_profit_cents: number;
    avg_sale_price_cents: number;
    avg_profit_cents: number;
    avg_profit_pct: number;
    avg_fees_cents: number;
    avg_fees_pct: number;
  }>`
    SELECT
      COUNT(*)::int as total_sold,
      COALESCE(SUM(s.sale_price), 0)::int as total_revenue_cents,
      COALESCE(SUM(s.net_proceeds - COALESCE(s.total_cost_basis, 0)), 0)::int as total_profit_cents,
      COALESCE(AVG(s.sale_price), 0)::int as avg_sale_price_cents,
      COALESCE(AVG(s.net_proceeds - COALESCE(s.total_cost_basis, 0)), 0)::int as avg_profit_cents,
      COALESCE(AVG(
        CASE WHEN COALESCE(s.total_cost_basis, 0) > 0
        THEN (s.net_proceeds - COALESCE(s.total_cost_basis, 0))::float / s.total_cost_basis * 100
        ELSE NULL END
      ), 0) as avg_profit_pct,
      COALESCE(AVG(s.sale_price - s.net_proceeds), 0)::int as avg_fees_cents,
      COALESCE(AVG(
        CASE WHEN s.sale_price > 0
        THEN (s.sale_price - s.net_proceeds)::float / s.sale_price * 100
        ELSE NULL END
      ), 0) as avg_fees_pct
    FROM sales s
    JOIN card_instances ci ON ci.id = s.card_instance_id
    LEFT JOIN raw_purchases rp ON rp.id = ci.raw_purchase_id
    WHERE s.user_id = ${userId}
      AND ci.purchase_type = 'raw'
      AND ci.decision = 'sell_raw'
      AND ${noSlabCondition}
      AND ${typeFilter}
  `.execute(db);

  // ── Turnover (type-filtered) ───────────────────────────────────────────────
  const turnoverQuery = sql<{
    avg_days_raw: number | null;
    avg_days_bulk: number | null;
  }>`
    SELECT
      AVG(EXTRACT(EPOCH FROM (s.sold_at - ci.purchased_at))/86400) FILTER (WHERE rp.type = 'raw') as avg_days_raw,
      AVG(EXTRACT(EPOCH FROM (s.sold_at - ci.purchased_at))/86400) FILTER (WHERE rp.type = 'bulk') as avg_days_bulk
    FROM sales s
    JOIN card_instances ci ON ci.id = s.card_instance_id
    LEFT JOIN raw_purchases rp ON rp.id = ci.raw_purchase_id
    WHERE s.user_id = ${userId}
      AND ci.purchase_type = 'raw'
      AND ci.decision = 'sell_raw'
      AND ${typeFilter}
  `.execute(db);

  const [invByType, pipelineResult, salesResult, turnoverResult, ordersResult, conditionResult] = await Promise.all([
    inventoryByTypeQuery,
    pipelineQuery,
    salesQuery,
    turnoverQuery,
    ordersQuery,
    conditionQuery,
  ]);

  const invRows = invByType.rows;
  const totalCards = invRows.reduce((s, r) => s + r.count, 0);
  const totalCostCents = invRows.reduce((s, r) => s + r.cost_cents, 0);
  const pl = pipelineResult.rows[0];
  const s = salesResult.rows[0];
  const t = turnoverResult.rows[0];
  const o = ordersResult;

  return {
    inventory: {
      total: totalCards,
      total_cost_cents: totalCostCents,
      by_type: invRows.map((r) => ({ type: r.type, count: r.count, cost_cents: r.cost_cents })),
    },
    orders: {
      total: o?.total ?? 0,
      pending: o?.pending ?? 0,
      received: o?.received ?? 0,
      canceled: o?.canceled ?? 0,
      cards_received: o?.cards_received ?? 0,
    },
    pipeline: {
      purchased_raw: pl?.purchased_raw ?? 0,
      inspected: pl?.inspected ?? 0,
      raw_for_sale: pl?.raw_for_sale ?? 0,
      grading_submitted: pl?.grading_submitted ?? 0,
      purchased_raw_cost: pl?.purchased_raw_cost ?? 0,
      inspected_cost: pl?.inspected_cost ?? 0,
      raw_for_sale_cost: pl?.raw_for_sale_cost ?? 0,
      grading_submitted_cost: pl?.grading_submitted_cost ?? 0,
      routed_sell_raw: pl?.routed_sell_raw ?? 0,
      routed_grade: pl?.routed_grade ?? 0,
    },
    sales: {
      total_sold: s?.total_sold ?? 0,
      total_revenue_cents: s?.total_revenue_cents ?? 0,
      total_profit_cents: s?.total_profit_cents ?? 0,
      avg_sale_price_cents: s?.avg_sale_price_cents ?? 0,
      avg_profit_cents: s?.avg_profit_cents ?? 0,
      avg_profit_pct: s != null ? Number(s.avg_profit_pct) : 0,
      avg_fees_cents: s?.avg_fees_cents ?? 0,
      avg_fees_pct: s != null ? Number(s.avg_fees_pct) : 0,
    },
    turnover: {
      avg_days_raw: t?.avg_days_raw != null ? Math.round(Number(t.avg_days_raw)) : null,
      avg_days_bulk: t?.avg_days_bulk != null ? Math.round(Number(t.avg_days_bulk)) : null,
    },
    by_condition: conditionResult.rows.map((r) => ({ condition: r.condition, count: r.count })),
  };
}

export async function getCardShowBreakdown(userId: string, showId: string) {
  const slabCheck = sql<boolean>`EXISTS (SELECT 1 FROM slab_details sd WHERE sd.card_instance_id = ci.id)`;

  const result = await db
    .selectFrom('sales as s')
    .innerJoin('card_instances as ci', 'ci.id', 's.card_instance_id')
    .innerJoin('card_shows as cs', 'cs.id', 's.card_show_id')
    .select([
      sql<number>`COUNT(*) FILTER (WHERE ${slabCheck})::int`.as('slab_count'),
      sql<number>`COALESCE(SUM(s.sale_price) FILTER (WHERE ${slabCheck}), 0)::int`.as('slab_revenue'),
      sql<number>`COALESCE(SUM(s.platform_fees + s.shipping_cost) FILTER (WHERE ${slabCheck}), 0)::int`.as('slab_fees'),
      sql<number>`COALESCE(SUM(s.net_proceeds) FILTER (WHERE ${slabCheck}), 0)::int`.as('slab_net'),
      sql<number>`COALESCE(SUM(COALESCE(s.total_cost_basis, 0)) FILTER (WHERE ${slabCheck}), 0)::int`.as('slab_cost'),
      sql<number>`COUNT(*) FILTER (WHERE NOT ${slabCheck})::int`.as('raw_count'),
      sql<number>`COALESCE(SUM(s.sale_price) FILTER (WHERE NOT ${slabCheck}), 0)::int`.as('raw_revenue'),
      sql<number>`COALESCE(SUM(s.platform_fees + s.shipping_cost) FILTER (WHERE NOT ${slabCheck}), 0)::int`.as('raw_fees'),
      sql<number>`COALESCE(SUM(s.net_proceeds) FILTER (WHERE NOT ${slabCheck}), 0)::int`.as('raw_net'),
      sql<number>`COALESCE(SUM(COALESCE(s.total_cost_basis, 0)) FILTER (WHERE NOT ${slabCheck}), 0)::int`.as('raw_cost'),
    ])
    .where('s.user_id', '=', userId)
    .where('s.card_show_id', '=', showId)
    .executeTakeFirstOrThrow();

  return result;
}

export async function cardTrendSearch(userId: string, q: string) {
  // Only return catalog entries that exist in this user's inventory
  return db
    .selectFrom('card_catalog as cc')
    .innerJoin('card_instances as ci', 'ci.catalog_id', 'cc.id')
    .select([
      'cc.id as catalog_id',
      'cc.card_name',
      'cc.set_name',
      'cc.card_number',
      'cc.sku',
    ])
    .where('ci.user_id', '=', userId)
    .where((eb) => eb.or([
      eb('cc.sku', 'ilike', `%${q}%`),
      eb('cc.card_name', 'ilike', `%${q}%`),
    ]))
    .groupBy(['cc.id', 'cc.card_name', 'cc.set_name', 'cc.card_number', 'cc.sku'])
    .orderBy('cc.sku', 'asc')
    .limit(15)
    .execute();
}

export async function getCardTrend(userId: string, catalogId: string) {
  // Sales history — one row per sale
  const sales = await db
    .selectFrom('sales as s')
    .innerJoin('card_instances as ci', 'ci.id', 's.card_instance_id')
    .leftJoin('slab_details as sd', 'sd.card_instance_id', 'ci.id')
    .select([
      's.id',
      's.sold_at',
      's.sale_price',
      's.net_proceeds',
      sql<number>`COALESCE(s.total_cost_basis, 0)`.as('total_cost_basis'),
      's.platform',
      sql<boolean>`(sd.id IS NOT NULL)`.as('is_graded'),
      sql<number | null>`sd.grade`.as('grade'),
      sql<string | null>`sd.grade_label`.as('grade_label'),
      sql<string | null>`sd.company`.as('company'),
      sql<string | null>`ci.condition`.as('condition'),
    ])
    .where('s.user_id', '=', userId)
    .where('ci.catalog_id', '=', catalogId)
    .orderBy('s.sold_at', 'asc')
    .execute();

  // Cost/purchase history — one row per card instance
  const costs = await db
    .selectFrom('card_instances as ci')
    .leftJoin('slab_details as sd', 'sd.card_instance_id', 'ci.id')
    .select([
      'ci.id',
      'ci.purchased_at',
      'ci.purchase_cost',
      'ci.quantity',
      sql<boolean>`(sd.id IS NOT NULL)`.as('is_graded'),
      sql<number | null>`sd.grade`.as('grade'),
      sql<string | null>`sd.grade_label`.as('grade_label'),
      sql<string | null>`sd.company`.as('company'),
      sql<string | null>`ci.condition`.as('condition'),
    ])
    .where('ci.user_id', '=', userId)
    .where('ci.catalog_id', '=', catalogId)
    .where('ci.purchased_at', 'is not', null)
    .orderBy('ci.purchased_at', 'asc')
    .execute();

  return { sales, costs };
}

export async function getPendingGradingSub(userId: string) {
  return db
    .selectFrom('card_instances as ci')
    .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
    .innerJoin('raw_purchases as rp', 'rp.id', 'ci.raw_purchase_id')
    .select([
      'ci.id',
      sql<string>`COALESCE(ci.card_name_override, cc.card_name)`.as('card_name'),
      sql<string>`COALESCE(cc.set_name, ci.set_name_override)`.as('set_name'),
      'ci.condition',
      'ci.quantity',
      'ci.purchase_cost',
      sql<string>`rp.purchase_id`.as('raw_purchase_label'),
    ])
    .where('ci.user_id', '=', userId)
    .where('ci.status', '=', 'inspected')
    .where('ci.decision', '=', 'grade')
    .where('rp.type', '=', 'raw')
    .orderBy('ci.created_at', 'asc')
    .execute();
}


export async function getStaleEbayListings(userId: string, days: number) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return db
    .selectFrom('listings as l')
    .innerJoin('card_instances as ci', 'ci.id', 'l.card_instance_id')
    .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
    .select([
      'l.id',
      sql<string>`COALESCE(ci.card_name_override, cc.card_name)`.as('card_name'),
      sql<string>`COALESCE(cc.set_name, ci.set_name_override)`.as('set_name'),
      'l.list_price',
      'l.listed_at',
      'l.ebay_listing_url',
      sql<number>`EXTRACT(DAY FROM NOW() - l.listed_at)::int`.as('days_listed'),
    ])
    .where('l.user_id', '=', userId)
    .where('l.listing_status', '=', 'active')
    .where('l.platform', '=', 'ebay')
    .where('l.listed_at', '<', cutoff)
    .orderBy('l.listed_at', 'asc')
    .execute();
}

export async function getStaleCardShowInventory(userId: string, days: number) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return db
    .selectFrom('card_instances as ci')
    .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
    .select([
      'ci.id',
      sql<string>`COALESCE(ci.card_name_override, cc.card_name)`.as('card_name'),
      sql<string>`COALESCE(cc.set_name, ci.set_name_override)`.as('set_name'),
      'ci.quantity',
      'ci.purchase_cost',
      'ci.card_show_added_at',
      sql<number>`EXTRACT(DAY FROM NOW() - ci.card_show_added_at)::int`.as('days_held'),
    ])
    .where('ci.user_id', '=', userId)
    .where('ci.is_card_show', '=', true)
    .where('ci.status', 'not in', ['sold', 'lost_damaged'])
    .where('ci.card_show_added_at', '<', cutoff)
    .orderBy('ci.card_show_added_at', 'asc')
    .execute();
}
