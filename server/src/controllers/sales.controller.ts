import type { Request, Response, NextFunction } from 'express';
import * as salesService from '../services/sales.service';
import { z } from 'zod';
import { toCents } from '../utils/cents';

const paginationSchema = z.object({
  page: z.coerce.number().default(1),
  limit: z.coerce.number().min(1).max(100).default(25),
  platforms: z.string().optional(),
  search: z.string().optional(),
  from: z.string().optional().transform((v) => v ? new Date(v) : undefined),
  to: z.string().optional().transform((v) => v ? new Date(v) : undefined),
  sort_by: z.string().optional(),
  sort_dir: z.enum(['asc', 'desc']).default('desc'),
  card_type: z.enum(['all', 'graded', 'raw']).default('all'),
});

function splitCSV(val?: string): string[] | undefined {
  if (val === undefined) return undefined;
  return val.split(',').map((s) => s.trim()).filter(Boolean);
}

export async function listSales(req: Request, res: Response, next: NextFunction) {
  try {
    const { page, limit, platforms, search, from, to, sort_by, sort_dir, card_type } = paginationSchema.parse(req.query);
    const result = await salesService.listSales(
      req.dataUserId,
      { platforms: splitCSV(platforms), search, from, to, cardType: card_type === 'all' ? undefined : card_type },
      { page, limit },
      sort_by,
      sort_dir
    );
    res.json(result);
  } catch (err) { next(err); }
}

export async function getSaleFilters(req: Request, res: Response, next: NextFunction) {
  try {
    const options = await salesService.getSaleFilterOptions(req.dataUserId);
    res.json(options);
  } catch (err) { next(err); }
}

export async function getSale(req: Request, res: Response, next: NextFunction) {
  try {
    const sale = await salesService.getSaleById(req.dataUserId, req.params['id'] as string);
    res.json({ data: sale });
  } catch (err) { next(err); }
}

const recordSaleSchema = z.object({
  card_instance_id: z.string().uuid(),
  listing_id: z.string().uuid().optional(),
  card_show_id: z.string().uuid().optional(),
  platform: z.enum(['ebay', 'card_show', 'tcgplayer', 'facebook', 'instagram', 'local', 'other']),
  sale_price: z.union([z.string(), z.number()]).transform((v) => toCents(v)),
  platform_fees: z.union([z.string(), z.number()]).transform((v) => toCents(v)).optional(),
  shipping_cost: z.union([z.string(), z.number()]).transform((v) => toCents(v)).optional(),
  currency: z.enum(['USD', 'JPY']).default('USD'),
  order_details_link: z.string().url().optional(),
  unique_id: z.string().optional(),
  unique_id_2: z.string().optional(),
  sold_at: z.string().optional().transform((v) => v ? new Date(v) : undefined),
});

export async function recordSale(req: Request, res: Response, next: NextFunction) {
  try {
    const data = recordSaleSchema.parse(req.body);
    const sale = await salesService.recordSale(req.dataUserId, data as any);
    res.status(201).json({ data: sale });
  } catch (err) { next(err); }
}

export async function recordBulkSale(req: Request, res: Response, next: NextFunction) {
  try {
    const { items, platform, card_show_id, currency, sold_at, unique_id_2 } = z.object({
      items: z.array(z.object({
        card_instance_id: z.string().uuid(),
        listing_id: z.string().uuid().optional(),
        sale_price: z.number().int().positive(),
        platform_fees: z.number().int().nonnegative().default(0),
      })).min(1),
      platform: z.enum(['ebay', 'card_show', 'tcgplayer', 'facebook', 'instagram', 'local', 'other']),
      card_show_id: z.string().uuid().optional(),
      unique_id: z.string().optional(),
      order_details_link: z.string().optional(),
      currency: z.enum(['USD', 'JPY']).default('USD'),
      sold_at: z.string().optional().transform((v) => v ? new Date(v) : undefined),
      unique_id_2: z.string().optional(),
    }).parse(req.body);
    const sales = await salesService.recordBulkSale(req.dataUserId, items, { platform, card_show_id, unique_id, order_details_link, currency, sold_at, unique_id_2 });
    res.status(201).json({ data: sales, count: sales.length });
  } catch (err) { next(err); }
}

const updateSaleSchema = recordSaleSchema.omit({ card_instance_id: true }).partial();

export async function updateSale(req: Request, res: Response, next: NextFunction) {
  try {
    const data = updateSaleSchema.parse(req.body);
    const sale = await salesService.updateSale(req.dataUserId, req.params['id'] as string, data as any);
    res.json({ data: sale });
  } catch (err) { next(err); }
}

export async function deleteSale(req: Request, res: Response, next: NextFunction) {
  try {
    await salesService.deleteSale(req.dataUserId, req.params['id'] as string);
    res.status(204).send();
  } catch (err) { next(err); }
}
