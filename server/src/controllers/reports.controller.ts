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
});

export async function getPnl(req: Request, res: Response, next: NextFunction) {
  try {
    const { from, to, group_by, groupBy } = dateRangeSchema.parse(req.query);
    const grouping = group_by ?? groupBy ?? 'month';
    // Pass null to get all-time data when no explicit dates provided
    const fromDate = req.query.from ? new Date(from) : null;
    const toDate = req.query.to ? new Date(to) : null;
    const result = await reportsService.getPnlReport(
      req.user!.id,
      fromDate,
      toDate,
      grouping
    );
    res.json(result);
  } catch (err) { next(err); }
}

export async function getYearlySummary(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await reportsService.getYearlySummary(req.user!.id);
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
    const recentSales = await db
      .selectFrom('sales')
      .select([
        sql<number>`COUNT(*)::int`.as('count'),
        sql<number>`SUM(net_proceeds)::int`.as('total_net'),
        sql<number>`SUM(net_proceeds - COALESCE(total_cost_basis, 0))::int`.as('total_profit'),
      ])
      .where('user_id', '=', req.user!.id)
      .where('sold_at', '>=', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
      .executeTakeFirst();
    res.json({ last_30_days: recentSales ?? { count: 0, total_net: 0, total_profit: 0 } });
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
    const result = await reportsService.getRawDashboard(req.user!.id);
    res.json(result);
  } catch (err) { next(err); }
}

export async function getGradedDashboard(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await reportsService.getGradedDashboard(req.user!.id);
    res.json(result);
  } catch (err) { next(err); }
}
