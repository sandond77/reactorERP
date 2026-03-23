import type { Request, Response, NextFunction } from 'express';
import * as salesService from '../services/sales.service';
import { z } from 'zod';
import { toCents } from '../utils/cents';

const paginationSchema = z.object({
  page: z.coerce.number().default(1),
  limit: z.coerce.number().min(1).max(100).default(25),
  platform: z.string().optional(),
  from: z.string().optional().transform((v) => v ? new Date(v) : undefined),
  to: z.string().optional().transform((v) => v ? new Date(v) : undefined),
  sort_by: z.string().optional(),
  sort_dir: z.enum(['asc', 'desc']).default('desc'),
});

export async function listSales(req: Request, res: Response, next: NextFunction) {
  try {
    const { page, limit, platform, from, to, sort_by, sort_dir } = paginationSchema.parse(req.query);
    const result = await salesService.listSales(
      req.user!.id,
      { platform: platform as any, from, to },
      { page, limit },
      sort_by,
      sort_dir
    );
    res.json(result);
  } catch (err) { next(err); }
}

export async function getSaleFilters(req: Request, res: Response, next: NextFunction) {
  try {
    const options = await salesService.getSaleFilterOptions(req.user!.id);
    res.json(options);
  } catch (err) { next(err); }
}

export async function getSale(req: Request, res: Response, next: NextFunction) {
  try {
    const sale = await salesService.getSaleById(req.user!.id, req.params['id'] as string);
    res.json({ data: sale });
  } catch (err) { next(err); }
}

const recordSaleSchema = z.object({
  card_instance_id: z.string().uuid(),
  listing_id: z.string().uuid().optional(),
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
    const sale = await salesService.recordSale(req.user!.id, data as any);
    res.status(201).json({ data: sale });
  } catch (err) { next(err); }
}
