import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import * as listingsService from '../services/listings.service';
import { z } from 'zod';
import { toCents } from '../utils/cents';

export const listingsRouter = Router();

const querySchema = z.object({
  page: z.coerce.number().default(1),
  limit: z.coerce.number().min(1).max(100).default(25),
  platforms: z.string().optional(),
  search: z.string().optional(),
  status: z.string().optional(),
  sort_by: z.string().optional(),
  sort_dir: z.enum(['asc', 'desc']).default('desc'),
});

function splitCSV(val?: string): string[] | undefined {
  if (val === undefined) return undefined;
  return val.split(',').map((s) => s.trim()).filter(Boolean);
}

const createListingSchema = z.object({
  card_instance_id: z.string().uuid(),
  platform: z.enum(['ebay', 'card_show', 'tcgplayer', 'facebook', 'instagram', 'local', 'other']),
  list_price: z.union([z.string(), z.number()]).transform((v) => toCents(v)),
  asking_price: z.union([z.string(), z.number()]).transform((v) => toCents(v)).optional(),
  currency: z.enum(['USD', 'JPY']).default('USD'),
  listed_at: z.string().optional().transform((v) => v ? new Date(v) : undefined),
});

listingsRouter.get('/filters', requireAuth, async (req, res, next) => {
  try {
    const options = await listingsService.getListingFilterOptions(req.user!.id);
    res.json(options);
  } catch (err) { next(err); }
});

listingsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const q = querySchema.parse(req.query);
    const result = await listingsService.listListings(
      req.user!.id,
      { platforms: splitCSV(q.platforms), search: q.search, status: q.status },
      { page: q.page, limit: q.limit },
      q.sort_by,
      q.sort_dir
    );
    res.json(result);
  } catch (err) { next(err); }
});

listingsRouter.post('/', requireAuth, async (req, res, next) => {
  try {
    const data = createListingSchema.parse(req.body);
    const listing = await listingsService.createListing(req.user!.id, data as any);
    res.status(201).json({ data: listing });
  } catch (err) { next(err); }
});
