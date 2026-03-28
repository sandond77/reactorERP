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
  listing_type: z.enum(['graded', 'raw']).optional(),
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

listingsRouter.get('/by-url', requireAuth, async (req, res, next) => {
  try {
    const url = typeof req.query.url === 'string' ? req.query.url : null;
    if (!url) { res.status(400).json({ error: 'url required' }); return; }
    const { db } = await import('../config/database');
    const { sql } = await import('kysely');
    const row = await db
      .selectFrom('listings as l')
      .innerJoin('card_instances as ci', 'ci.id', 'l.card_instance_id')
      .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
      .leftJoin('slab_details as sd', 'sd.card_instance_id', 'ci.id')
      .leftJoin('raw_purchases as rp', 'rp.id', 'ci.raw_purchase_id')
      .select([
        'ci.id',
        sql<string>`COALESCE(ci.card_name_override, cc.card_name)`.as('card_name'),
        sql<string>`COALESCE(cc.set_name, ci.set_name_override)`.as('set_name'),
        'sd.cert_number',
        'sd.grade_label',
        'sd.grade as numeric_grade',
        'sd.company',
        'ci.currency',
        'ci.condition',
        'ci.purchased_at as raw_purchase_date',
        'rp.purchase_id as raw_purchase_label',
        'l.list_price as listed_price',
        'l.id as listing_id',
        sql<boolean>`true`.as('is_listed'),
        sql<boolean>`false`.as('is_personal_collection'),
      ])
      .where('l.user_id', '=', req.user!.id)
      .where('l.ebay_listing_url', '=', url)
      .where('l.listing_status', '=', 'active')
      .executeTakeFirst();
    if (!row) { res.status(404).json({ error: 'No active listing found for that URL' }); return; }
    res.json({ data: row });
  } catch (err) { next(err); }
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
      { platforms: splitCSV(q.platforms), grades: splitCSV(q.grades), companies: splitCSV(q.companies), part_numbers: splitCSV(q.part_numbers), num_listed: splitCSV(q.num_listed), num_sold: splitCSV(q.num_sold), card_names: splitCSV(q.card_names), prices: splitCSV(q.prices), search: q.search, listing_type: q.listing_type },
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
