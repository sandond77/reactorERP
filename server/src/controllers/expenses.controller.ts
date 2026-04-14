import type { Request, Response, NextFunction } from 'express';
import * as expensesService from '../services/expenses.service';
import * as agentService from '../services/agent.service';
import { z } from 'zod';
import { toCents } from '../utils/cents';
import { AppError } from '../middleware/errorHandler';
import { saveReceiptImage } from '../utils/save-receipt';

function splitCSV(val?: string): string[] | undefined {
  if (val === undefined) return undefined;
  return val.split(',').map((s) => s.trim()).filter(Boolean);
}

const listSchema = z.object({
  page:     z.coerce.number().default(1),
  limit:    z.coerce.number().min(1).max(200).default(50),
  search:   z.string().optional(),
  types:    z.string().optional(),
  sort_by:  z.string().optional(),
  sort_dir: z.enum(['asc', 'desc']).default('desc'),
});

export async function listExpenses(req: Request, res: Response, next: NextFunction) {
  try {
    const { page, limit, search, types, sort_by, sort_dir } = listSchema.parse(req.query);
    const result = await expensesService.listExpenses(
      req.user!.id,
      { page, limit },
      { search, types: splitCSV(types) },
      sort_by,
      sort_dir
    );
    res.json(result);
  } catch (err) { next(err); }
}

export async function getFilterOptions(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await expensesService.getFilterOptions(req.user!.id));
  } catch (err) { next(err); }
}

const bodySchema = z.object({
  date:         z.string(),
  description:  z.string().min(1),
  type:         z.string().min(1),
  amount:       z.union([z.string(), z.number()]).transform((v) => toCents(v)),
  currency:     z.enum(['USD', 'JPY']).default('USD'),
  link:         z.string().url().optional().or(z.literal('')),
  order_number: z.string().optional(),
});

export async function createExpense(req: Request, res: Response, next: NextFunction) {
  try {
    const data = bodySchema.parse(req.body);
    const expense = await expensesService.createExpense(req.user!.id, {
      ...data,
      date: new Date(data.date),
      link: data.link || undefined,
    });
    res.status(201).json({ data: expense });
  } catch (err) { next(err); }
}

export async function updateExpense(req: Request, res: Response, next: NextFunction) {
  try {
    const data = bodySchema.partial().parse(req.body);
    const expense = await expensesService.updateExpense(req.user!.id, req.params['id'] as string, {
      ...data,
      date: data.date ? new Date(data.date) : undefined,
      link: data.link || undefined,
    });
    res.json({ data: expense });
  } catch (err) { next(err); }
}

export async function deleteExpense(req: Request, res: Response, next: NextFunction) {
  try {
    await expensesService.deleteExpense(req.user!.id, req.params['id'] as string);
    res.status(204).send();
  } catch (err) { next(err); }
}

const exportSchema = z.object({
  from:   z.string().optional().transform((v) => v ? new Date(v) : undefined),
  to:     z.string().optional().transform((v) => v ? new Date(v) : undefined),
  types:  z.string().optional(),
  format: z.enum(['csv', 'pdf']).default('csv'),
});

export async function uploadExpenseReceipt(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new AppError(400, 'No image file provided');
    const receiptUrl = await saveReceiptImage(req.user!.id, req.params['id'] as string, req.file.buffer);
    const expense = await expensesService.saveReceiptUrl(req.user!.id, req.params['id'] as string, receiptUrl);
    res.json({ data: expense });
  } catch (err) { next(err); }
}

export async function parseExpenseReceipt(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new AppError(400, 'No image file provided');
    const imageBase64 = req.file.buffer.toString('base64');
    const mediaType = req.file.mimetype as 'image/jpeg' | 'image/png' | 'image/webp';
    const result = await agentService.parseExpenseImage(imageBase64, mediaType);
    res.json({ data: result });
  } catch (err) { next(err); }
}

export async function exportExpenses(req: Request, res: Response, next: NextFunction) {
  try {
    const { from, to, types, format } = exportSchema.parse(req.query);
    const filters = { from, to, types: types ? types.split(',').map((s) => s.trim()).filter(Boolean) : undefined };

    if (format === 'pdf') {
      const buf = await expensesService.exportPDF(req.user!.id, filters);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="expenses.pdf"');
      res.send(buf);
    } else {
      const csv = await expensesService.exportCSV(req.user!.id, filters);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="expenses.csv"');
      res.send(csv);
    }
  } catch (err) { next(err); }
}
