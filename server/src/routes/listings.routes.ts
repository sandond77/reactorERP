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
  grades: z.string().optional(),
  companies: z.string().optional(),
  part_numbers: z.string().optional(),
  num_listed: z.string().optional(),
  num_sold: z.string().optional(),
  card_names: z.string().optional(),
  prices: z.string().optional(),
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
  ebay_listing_url: z.string().url().optional(),
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
      { platforms: splitCSV(q.platforms), grades: splitCSV(q.grades), companies: splitCSV(q.companies), part_numbers: splitCSV(q.part_numbers), num_listed: splitCSV(q.num_listed), num_sold: splitCSV(q.num_sold), card_names: splitCSV(q.card_names), prices: splitCSV(q.prices), search: q.search },
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

const groupKeySchema = z.object({
  part_number:     z.string().nullable(),
  card_name:       z.string().nullable(),
  grade_label:     z.string().nullable(),
  grading_company: z.string().nullable(),
  platform:        z.string(),
  currency:        z.string(),
});

const groupUpdateSchema = groupKeySchema.extend({
  list_price:       z.union([z.string(), z.number()]).transform((v) => toCents(v)).optional(),
  platform_new:     z.string().optional(),
  currency_new:     z.string().optional(),
  ebay_listing_url: z.string().url().nullable().optional(),
});

listingsRouter.patch('/group', requireAuth, async (req, res, next) => {
  try {
    const body = groupUpdateSchema.parse(req.body);
    const { list_price, platform_new, currency_new, ebay_listing_url, ...keyRaw } = body;
    const key = groupKeySchema.parse(keyRaw);
    const updates: Record<string, any> = {};
    if (list_price !== undefined) updates.list_price = list_price;
    if (platform_new !== undefined) updates.platform = platform_new;
    if (currency_new !== undefined) updates.currency = currency_new;
    if (ebay_listing_url !== undefined) updates.ebay_listing_url = ebay_listing_url;
    const result = await listingsService.updateListingsByGroup(req.user!.id, key, updates);
    res.json(result);
  } catch (err) { next(err); }
});

listingsRouter.delete('/group', requireAuth, async (req, res, next) => {
  try {
    const key = groupKeySchema.parse(req.body);
    const result = await listingsService.cancelListingsByGroup(req.user!.id, key);
    res.json(result);
  } catch (err) { next(err); }
});
