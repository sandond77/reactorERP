import type { Request, Response, NextFunction } from 'express';
import * as reportsService from '../services/reports.service';
import { z } from 'zod';

const dateRangeSchema = z.object({
  from: z.string().default(() => {
    const d = new Date(); d.setDate(1); d.setMonth(0); return d.toISOString().split('T')[0];
  }),
  to: z.string().default(() => new Date().toISOString().split('T')[0]),
  group_by: z.enum(['month', 'platform', 'game']).optional(),
  groupBy: z.enum(['month', 'platform', 'game']).optional(),
  channel: z.enum(['all', 'ebay', 'card_show', 'other']).optional(),
  cardType: z.enum(['all', 'graded', 'ungraded']).optional(),
});

export async function getPnl(req: Request, res: Response, next: NextFunction) {
  try {
    const { from, to, group_by, groupBy, channel, cardType } = dateRangeSchema.parse(req.query);
    const grouping = group_by ?? groupBy ?? 'month';
    const fromDate = req.query.from ? new Date(from) : null;
    const toDate = req.query.to ? new Date(to) : null;
    const result = await reportsService.getPnlReport(
      req.user!.id,
      fromDate,
      toDate,
      grouping,
      channel ?? 'all',
      cardType ?? 'all',
    );
    res.json(result);
  } catch (err) { next(err); }
}

export async function getYearlySummary(req: Request, res: Response, next: NextFunction) {
  try {
    const channel = z.enum(['all', 'ebay', 'card_show', 'other']).optional().parse(req.query.channel) ?? 'all';
    const cardType = z.enum(['all', 'graded', 'ungraded']).optional().parse(req.query.cardType) ?? 'all';
    const result = await reportsService.getYearlySummary(req.user!.id, channel, cardType);
    res.json(result);
  } catch (err) { next(err); }
}

export async function getInventoryValue(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await reportsService.getInventoryValue(req.user!.id);
    res.json(result);
  } catch (err) { next(err); }
}

export async function getGradingRoi(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await reportsService.getGradingRoi(req.user!.id);
    res.json({ data: result });
  } catch (err) { next(err); }
}

export async function getSummary(req: Request, res: Response, next: NextFunction) {
  try {
    const { db } = await import('../config/database');
    const { sql } = await import('kysely');
    const now = Date.now();
    const MS = 24 * 60 * 60 * 1000;

    const query = (days: number | null) => {
      let q = db
        .selectFrom('sales')
        .select([
          sql<number>`COUNT(*)::int`.as('count'),
          sql<number>`SUM(sale_price)::int`.as('total_gross'),
          sql<number>`SUM(net_proceeds)::int`.as('total_net'),
          sql<number>`SUM(COALESCE(total_cost_basis, 0))::int`.as('total_cost'),
          sql<number>`SUM(net_proceeds - COALESCE(total_cost_basis, 0))::int`.as('total_profit'),
        ])
        .where('user_id', '=', req.user!.id);
      if (days !== null) q = q.where('sold_at', '>=', new Date(now - days * MS));
      return q.executeTakeFirst();
    };

    const slabCheck = `EXISTS (SELECT 1 FROM slab_details sd WHERE sd.card_instance_id = card_instances.id)`;
    const cardCounts = await db
      .selectFrom('card_instances')
      .select([
        sql<number>`SUM(quantity)::int`.as('total'),
        sql<number>`SUM(quantity) FILTER (WHERE status != 'sold' AND status != 'lost_damaged')::int`.as('unsold'),
        sql<number>`SUM(quantity) FILTER (WHERE status = 'sold')::int`.as('sold'),
        sql<number>`SUM(quantity) FILTER (WHERE ${sql.raw(slabCheck)})::int`.as('graded_total'),
        sql<number>`SUM(quantity) FILTER (WHERE ${sql.raw(slabCheck)} AND status != 'sold' AND status != 'lost_damaged')::int`.as('graded_unsold'),
        sql<number>`SUM(quantity) FILTER (WHERE ${sql.raw(slabCheck)} AND status = 'sold')::int`.as('graded_sold'),
        sql<number>`SUM(quantity) FILTER (WHERE NOT ${sql.raw(slabCheck)})::int`.as('raw_total'),
        sql<number>`SUM(quantity) FILTER (WHERE NOT ${sql.raw(slabCheck)} AND status != 'sold' AND status != 'lost_damaged')::int`.as('raw_unsold'),
        sql<number>`SUM(quantity) FILTER (WHERE NOT ${sql.raw(slabCheck)} AND status = 'sold')::int`.as('raw_sold'),
        sql<number>`SUM(quantity) FILTER (WHERE is_card_show = true)::int`.as('card_show_total'),
        sql<number>`SUM(quantity) FILTER (WHERE is_card_show = true AND status != 'sold' AND status != 'lost_damaged')::int`.as('card_show_unsold'),
      ])
      .where('user_id', '=', req.user!.id)
      .executeTakeFirst();

    const listedCount = await db
      .selectFrom('listings as l')
      .innerJoin('card_instances as ci', 'ci.id', 'l.card_instance_id')
      .select([
        sql<number>`COUNT(*)::int`.as('total'),
        sql<number>`COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM slab_details sd WHERE sd.card_instance_id = ci.id))::int`.as('graded'),
        sql<number>`COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM slab_details sd WHERE sd.card_instance_id = ci.id))::int`.as('raw'),
      ])
      .where('l.user_id', '=', req.user!.id)
      .where('l.listing_status', '=', 'active')
      .executeTakeFirst();

    const gradingStats = await db
      .selectFrom('grading_batches as gb')
      .innerJoin('grading_batch_items as gbi', 'gbi.batch_id', 'gb.id')
      .select([
        sql<number>`COUNT(DISTINCT gb.id)::int`.as('sub_count'),
        sql<number>`SUM(gbi.quantity)::int`.as('card_count'),
      ])
      .where('gb.user_id', '=', req.user!.id)
      .where('gb.status', 'not in', ['returned', 'cancelled'])
      .executeTakeFirst();

    const channelQuery = (days: number | null) => {
      let q = db
        .selectFrom('sales')
        .select([
          sql<string>`platform`.as('platform'),
          sql<number>`COUNT(*)::int`.as('count'),
          sql<number>`SUM(net_proceeds - COALESCE(total_cost_basis, 0))::int`.as('total_profit'),
        ])
        .where('user_id', '=', req.user!.id);
      if (days !== null) q = q.where('sold_at', '>=', new Date(now - days * MS));
      return (q as any).groupBy('platform').execute();
    };

    const yearStart = new Date(new Date().getFullYear(), 0, 1);

    const queryYear = () => db
      .selectFrom('sales')
      .select([
        sql<number>`COUNT(*)::int`.as('count'),
        sql<number>`SUM(sale_price)::int`.as('total_gross'),
        sql<number>`SUM(net_proceeds)::int`.as('total_net'),
        sql<number>`SUM(COALESCE(total_cost_basis, 0))::int`.as('total_cost'),
        sql<number>`SUM(net_proceeds - COALESCE(total_cost_basis, 0))::int`.as('total_profit'),
      ])
      .where('user_id', '=', req.user!.id)
      .where('sold_at', '>=', yearStart)
      .executeTakeFirst();

    const channelQueryYear = () => (db
      .selectFrom('sales')
      .select([
        sql<string>`platform`.as('platform'),
        sql<number>`COUNT(*)::int`.as('count'),
        sql<number>`SUM(net_proceeds - COALESCE(total_cost_basis, 0))::int`.as('total_profit'),
      ])
      .where('user_id', '=', req.user!.id)
      .where('sold_at', '>=', yearStart) as any)
      .groupBy('platform').execute();

    const expensesQuery = (days: number | null, from?: Date) => {
      let q = db.selectFrom('expenses')
        .select(sql<number>`COALESCE(SUM(amount), 0)::int`.as('total'))
        .where('user_id', '=', req.user!.id);
      if (from) q = q.where('date', '>=', from);
      else if (days !== null) q = q.where('date', '>=', new Date(now - days * MS));
      return q.executeTakeFirst();
    };

    const pipelineQuery = db
      .selectFrom('card_instances')
      .select([
        sql<number>`SUM(quantity) FILTER (WHERE status = 'purchased_raw')::int`.as('needs_inspection'),
        sql<number>`SUM(quantity) FILTER (WHERE status = 'inspected')::int`.as('inspected'),
        sql<number>`SUM(quantity) FILTER (WHERE status = 'inspected' AND decision = 'grade')::int`.as('pending_grading_sub'),
        sql<number>`SUM(quantity) FILTER (WHERE status = 'grading_submitted')::int`.as('grading_submitted'),
      ])
      .where('user_id', '=', req.user!.id)
      .executeTakeFirst();

    const performanceQuery = sql<{
      avg_hold_days: number | null;
      listings_value: number;
      pending_orders: number;
    }>`
      SELECT
        (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (s.sold_at - ci.purchased_at)) / 86400))::int
         FROM sales s
         INNER JOIN card_instances ci ON ci.id = s.card_instance_id
         WHERE s.user_id = ${req.user!.id} AND ci.purchased_at IS NOT NULL) AS avg_hold_days,
        (SELECT COALESCE(SUM(list_price), 0)::int
         FROM listings
         WHERE user_id = ${req.user!.id} AND listing_status = 'active') AS listings_value,
        (SELECT COUNT(*)::int
         FROM raw_purchases
         WHERE user_id = ${req.user!.id} AND status = 'ordered') AS pending_orders
    `.execute(db);

    const [d30, d60, d90, dYear, lifetime, ch30, ch60, ch90, chYear, chLifetime, exp30, exp60, exp90, expYear, expLifetime, pipeline, perfResult] = await Promise.all([
      query(30), query(60), query(90), queryYear(), query(null),
      channelQuery(30), channelQuery(60), channelQuery(90), channelQueryYear(), channelQuery(null),
      expensesQuery(30), expensesQuery(60), expensesQuery(90), expensesQuery(null, yearStart), expensesQuery(null),
      pipelineQuery, performanceQuery,
    ]);
    const perf = perfResult.rows[0] ?? { avg_hold_days: null, avg_listed_days: null, listings_value: 0 };

    type CRow = { platform: string; count: number; total_profit: number };
    const channelGroup = (rows: CRow[]) => {
      const sum = (filter: (r: CRow) => boolean) =>
        rows.filter(filter).reduce((s, r) => ({ count: s.count + r.count, total_profit: s.total_profit + r.total_profit }), { count: 0, total_profit: 0 });
      return {
        ebay:      sum(r => r.platform === 'ebay'),
        card_show: sum(r => r.platform === 'card_show'),
        other:     sum(r => r.platform !== 'ebay' && r.platform !== 'card_show'),
      };
    };

    const snap = (r: typeof d30, exp: typeof exp30) => ({
      ...(r ?? { count: 0, total_gross: 0, total_net: 0, total_cost: 0, total_profit: 0 }),
      total_expenses: Number(exp?.total ?? 0),
    });
    res.json({
      last_30_days: snap(d30, exp30),
      last_60_days: snap(d60, exp60),
      last_90_days: snap(d90, exp90),
      this_year:    snap(dYear, expYear),
      lifetime:     snap(lifetime, expLifetime),
      by_channel: {
        last_30_days: channelGroup(ch30 as CRow[]),
        last_60_days: channelGroup(ch60 as CRow[]),
        last_90_days: channelGroup(ch90 as CRow[]),
        this_year:    channelGroup(chYear as CRow[]),
        lifetime:     channelGroup(chLifetime as CRow[]),
      },
      grading: { sub_count: Number(gradingStats?.sub_count ?? 0), card_count: Number(gradingStats?.card_count ?? 0) },
      cards: {
        total:         { all: Number(cardCounts?.total        ?? 0), graded: Number(cardCounts?.graded_total  ?? 0), raw: Number(cardCounts?.raw_total  ?? 0) },
        unsold:        { all: Number(cardCounts?.unsold       ?? 0), graded: Number(cardCounts?.graded_unsold ?? 0), raw: Number(cardCounts?.raw_unsold ?? 0) },
        sold:          { all: Number(cardCounts?.sold         ?? 0), graded: Number(cardCounts?.graded_sold   ?? 0), raw: Number(cardCounts?.raw_sold   ?? 0) },
        listed:        { all: Number(listedCount?.total       ?? 0), graded: Number(listedCount?.graded       ?? 0), raw: Number(listedCount?.raw        ?? 0) },
        card_show:     { all: Number(cardCounts?.card_show_total ?? 0), unsold: Number(cardCounts?.card_show_unsold ?? 0) },
      },
      pipeline: {
        needs_inspection:    Number(pipeline?.needs_inspection    ?? 0),
        inspected:           Number(pipeline?.inspected           ?? 0),
        pending_grading_sub: Number(pipeline?.pending_grading_sub ?? 0),
        grading_submitted:   Number(pipeline?.grading_submitted   ?? 0),
      },
      performance: {
        avg_hold_days:  perf.avg_hold_days != null ? Number(perf.avg_hold_days) : null,
        listings_value: Number(perf.listings_value ?? 0),
        pending_orders: Number(perf.pending_orders ?? 0),
      },
    });
  } catch (err) { next(err); }
}

export async function getPlatformBreakdown(req: Request, res: Response, next: NextFunction) {
  try {
    const { from, to } = dateRangeSchema.parse(req.query);
    const result = await reportsService.getPlatformBreakdown(
      req.user!.id,
      new Date(from),
      new Date(to)
    );
    res.json({ data: result });
  } catch (err) { next(err); }
}

export async function getRawDashboard(req: Request, res: Response, next: NextFunction) {
  try {
    const view = z.enum(['all', 'sold', 'unsold']).optional().parse(req.query.view) ?? 'unsold';
    const type = z.enum(['both', 'raw', 'bulk']).optional().parse(req.query.type) ?? 'both';
    const result = await reportsService.getRawDashboard(req.user!.id, view, type);
    res.json(result);
  } catch (err) { next(err); }
}

export async function getGradedDashboard(req: Request, res: Response, next: NextFunction) {
  try {
    const view = z.enum(['all', 'sold', 'unsold']).optional().parse(req.query.view) ?? 'unsold';
    const result = await reportsService.getGradedDashboard(req.user!.id, view);
    res.json(result);
  } catch (err) { next(err); }
}

export async function getCardShowBreakdown(req: Request, res: Response, next: NextFunction) {
  try {
    const showId = z.string().uuid().parse(req.params.showId);
    const result = await reportsService.getCardShowBreakdown(req.user!.id, showId);
    res.json(result);
  } catch (err) { next(err); }
}

export async function getCardTrendSearch(req: Request, res: Response, next: NextFunction) {
  try {
    const q = z.string().min(1).parse(req.query.q);
    const results = await reportsService.cardTrendSearch(req.user!.id, q);
    res.json({ data: results });
  } catch (err) { next(err); }
}

export async function getCardTrend(req: Request, res: Response, next: NextFunction) {
  try {
    const catalogId = z.string().uuid().parse(req.query.catalog_id);
    const result = await reportsService.getCardTrend(req.user!.id, catalogId);
    res.json(result);
  } catch (err) { next(err); }
}

export async function getPendingGradingSub(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await reportsService.getPendingGradingSub(req.user!.id);
    res.json({ data: result });
  } catch (err) { next(err); }
}
