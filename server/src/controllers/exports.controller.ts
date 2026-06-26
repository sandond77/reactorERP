import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as svc from '../services/exports.service';

const FORMAT = z.enum(['csv', 'xlsx', 'pdf']).default('csv');

const dateOpt = z.string().optional().transform((v) => (v ? new Date(v) : undefined));
const csvOpt  = z.string().optional().transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined));

const salesSchema = z.object({
  format:   FORMAT,
  from:     dateOpt,
  to:       dateOpt,
  platform: z.string().optional(),
});

const inventorySchema = z.object({
  format: FORMAT,
  type:   z.enum(['graded', 'raw', 'all']).default('all'),
  status: z.string().optional(),
});

const expensesSchema = z.object({
  format: FORMAT,
  from:   dateOpt,
  to:     dateOpt,
  types:  csvOpt,
});

const MIME = {
  csv:  'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf:  'application/pdf',
} as const;

function fileName(base: string, format: 'csv' | 'xlsx' | 'pdf'): string {
  const today = new Date().toISOString().slice(0, 10);
  return `${base}_${today}.${format}`;
}

function send(res: Response, body: string | Buffer, base: string, format: 'csv' | 'xlsx' | 'pdf') {
  res.setHeader('Content-Type', MIME[format]);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName(base, format)}"`);
  res.send(body);
}

export async function exportSales(req: Request, res: Response, next: NextFunction) {
  try {
    const { format, ...filters } = salesSchema.parse(req.query);
    const body =
      format === 'csv'  ? await svc.exportSalesCSV(req.dataUserId, filters)  :
      format === 'xlsx' ? await svc.exportSalesXLSX(req.dataUserId, filters) :
                          await svc.exportSalesPDF(req.dataUserId, filters);
    send(res, body, 'sales', format);
  } catch (err) { next(err); }
}

export async function exportInventory(req: Request, res: Response, next: NextFunction) {
  try {
    const { format, ...filters } = inventorySchema.parse(req.query);
    const body =
      format === 'csv'  ? await svc.exportInventoryCSV(req.dataUserId, filters)  :
      format === 'xlsx' ? await svc.exportInventoryXLSX(req.dataUserId, filters) :
                          await svc.exportInventoryPDF(req.dataUserId, filters);
    send(res, body, 'inventory', format);
  } catch (err) { next(err); }
}

export async function exportExpenses(req: Request, res: Response, next: NextFunction) {
  try {
    const { format, ...filters } = expensesSchema.parse(req.query);
    const body =
      format === 'csv'  ? await svc.exportExpensesCSV(req.dataUserId, filters)  :
      format === 'xlsx' ? await svc.exportExpensesXLSX(req.dataUserId, filters) :
                          await svc.exportExpensesPDF(req.dataUserId, filters);
    send(res, body, 'expenses', format);
  } catch (err) { next(err); }
}
