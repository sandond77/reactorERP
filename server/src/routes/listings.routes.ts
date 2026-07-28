import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import * as listingsService from '../services/listings.service';
import { z } from 'zod';
import { toCents } from '../utils/cents';
import { db } from '../config/database';
import { sql } from 'kysely';

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
  multi_qty: z.string().optional(),
  card_names: z.string().optional(),
  prices: z.string().optional(),
  search: z.string().optional(),
  listing_type: z.enum(['graded', 'raw', 'graded_set', 'raw_set']).optional(),
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
  listing_group_id: z.string().uuid().optional(),
  listing_group_name: z.string().optional(),
  is_multi_qty: z.boolean().optional(),
});

function buildByUrlQuery(userId: string, url: string) {
  return db
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
    .where('l.user_id', '=', userId)
    .where('l.ebay_listing_url', '=', url)
    .where('l.listing_status', '=', 'active');
}

listingsRouter.get('/by-url', requireAuth, async (req, res, next) => {
  try {
    const url = typeof req.query.url === 'string' ? req.query.url : null;
    if (!url) { res.status(400).json({ error: 'url required' }); return; }
    const row = await buildByUrlQuery(req.dataUserId, url).executeTakeFirst();
    if (!row) { res.status(404).json({ error: 'No active listing found for that URL' }); return; }
    res.json({ data: row });
  } catch (err) { next(err); }
});

// Returns every active listing sharing the URL — for set/group listings where
// one eBay URL maps to multiple card_instances.
listingsRouter.get('/by-url/all', requireAuth, async (req, res, next) => {
  try {
    const url = typeof req.query.url === 'string' ? req.query.url : null;
    if (!url) { res.status(400).json({ error: 'url required' }); return; }
    const rows = await buildByUrlQuery(req.dataUserId, url).execute();
    if (!rows.length) { res.status(404).json({ error: 'No active listings found for that URL' }); return; }
    res.json({ data: rows });
  } catch (err) { next(err); }
});

listingsRouter.get('/filters', requireAuth, async (req, res, next) => {
  try {
    const options = await listingsService.getListingFilterOptions(req.dataUserId);
    res.json(options);
  } catch (err) { next(err); }
});

listingsRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const q = querySchema.parse(req.query);
    const result = await listingsService.listListings(
      req.dataUserId,
      { platforms: splitCSV(q.platforms), grades: splitCSV(q.grades), companies: splitCSV(q.companies), part_numbers: splitCSV(q.part_numbers), num_listed: splitCSV(q.num_listed), num_sold: splitCSV(q.num_sold), card_names: splitCSV(q.card_names), prices: splitCSV(q.prices), multi_qty: splitCSV(q.multi_qty), search: q.search, listing_type: q.listing_type },
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
    const listing = await listingsService.createListing(req.dataUserId, data as any);
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

listingsRouter.post('/migrate-order-urls', requireAuth, async (req, res, next) => {
  try {
    const result = await listingsService.migrateOrderUrlListings(req.dataUserId);
    res.json(result);
  } catch (err) { next(err); }
});

listingsRouter.patch('/set-group/:groupId', requireAuth, async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const body = z.object({
      listing_group_name: z.string().optional(),
      ebay_listing_url: z.string().url().nullable().optional(),
      list_price: z.union([z.string(), z.number()]).transform((v) => toCents(v)).optional(),
    }).parse(req.body);
    const result = await listingsService.updateSetGroup(req.dataUserId, groupId as string, body as any);
    res.json(result);
  } catch (err) { next(err); }
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
    const result = await listingsService.updateListingsByGroup(req.dataUserId, key, updates);
    res.json(result);
  } catch (err) { next(err); }
});

listingsRouter.delete('/set-group/:groupId', requireAuth, async (req, res, next) => {
  try {
    const result = await listingsService.cancelSetGroup(req.dataUserId, req.params.groupId as string);
    res.json(result);
  } catch (err) { next(err); }
});

// Set listing — Add Copy reuses the same client modal as multi-qty Add Cert.
// Client hits these two endpoints under `/set-group/:groupId/`; the shapes
// match `/listings/:listingId/candidate-certs` and `/listings/:id/certs` so
// the modal component is base-URL agnostic. Server flattens slot candidates
// into a single CandidateCert-style list here and unpacks + slot-maps ids
// on submit via addSetCopy.
listingsRouter.get('/set-group/:groupId/candidate-certs', requireAuth, async (req, res, next) => {
  try {
    const ctx = await listingsService.listSetCopySlots(req.dataUserId, req.params.groupId as string);
    const seen = new Set<string>();
    const data = ctx.slots.flatMap(s =>
      s.candidates
        .filter(c => {
          if (seen.has(c.card_instance_id)) return false;
          seen.add(c.card_instance_id);
          return true;
        })
        .map(c => ({
          id: c.card_instance_id,
          card_name: s.card_name,
          cert_number: c.cert_number,
          grade_label: c.grade_label,
          company: c.company,
          purchase_cost: c.purchase_cost,
        }))
    );
    res.json({ data });
  } catch (err) { next(err); }
});
const addSetCopySchema = z.object({
  card_instance_ids: z.array(z.string().uuid()).min(1).max(50),
});
listingsRouter.post('/set-group/:groupId/certs', requireAuth, async (req, res, next) => {
  try {
    const body = addSetCopySchema.parse(req.body);
    const result = await listingsService.addSetCopy(req.dataUserId, req.params.groupId as string, body.card_instance_ids);
    res.json({ added: result.added, new_group_id: result.new_group_id });
  } catch (err) { next(err); }
});

listingsRouter.delete('/group', requireAuth, async (req, res, next) => {
  try {
    const key = groupKeySchema.parse(req.body);
    const result = await listingsService.cancelListingsByGroup(req.dataUserId, key);
    res.json(result);
  } catch (err) { next(err); }
});

// Per-listing PATCH — currently only list_price (cents). Powers the
// Record Sale modal's editable Listed Price field. Other fields can be
// added here as the form expands; the underlying updateListing accepts
// any subset of NewListing.
const singleUpdateSchema = z.object({
  list_price: z.union([z.string(), z.number()]).transform((v) => toCents(v)).optional(),
});
listingsRouter.patch('/:listingId', requireAuth, async (req, res, next) => {
  try {
    const body = singleUpdateSchema.parse(req.body);
    const updated = await listingsService.updateListing(req.dataUserId, req.params.listingId as string, body);
    res.json(updated);
  } catch (err) { next(err); }
});

listingsRouter.delete('/:listingId', requireAuth, async (req, res, next) => {
  try {
    const result = await listingsService.cancelSingleListing(req.dataUserId, req.params.listingId as string);
    res.json(result);
  } catch (err) { next(err); }
});

// ── Multi-qty listing operations ────────────────────────────────────────────
// Certs eligible to be added to the listing (same catalog + graded + unsold
// + no active listing + not personal collection).
listingsRouter.get('/:listingId/candidate-certs', requireAuth, async (req, res, next) => {
  try {
    const rows = await listingsService.listCandidateCertsForListing(req.dataUserId, req.params.listingId as string);
    res.json({ data: rows });
  } catch (err) { next(err); }
});


// Promote an active solo listing (and any siblings sharing its eBay id/url)
// to multi-qty. From that point the caller can add certs to it.
listingsRouter.post('/:listingId/promote-multi-qty', requireAuth, async (req, res, next) => {
  try {
    const result = await listingsService.promoteToMultiQty(req.dataUserId, req.params.listingId as string);
    res.json(result);
  } catch (err) { next(err); }
});

// Add N certs to an existing multi-qty listing. Certs must be same-catalog
// graded slabs the caller owns, not already on another active listing.
const addCertsSchema = z.object({
  card_instance_ids: z.array(z.string().uuid()).min(1).max(50),
});
listingsRouter.post('/:listingId/certs', requireAuth, async (req, res, next) => {
  try {
    const body = addCertsSchema.parse(req.body);
    const result = await listingsService.addCertsToListing(req.dataUserId, req.params.listingId as string, body.card_instance_ids);
    res.json(result);
  } catch (err) { next(err); }
});

// End every active row in the multi-qty group. Sold rows untouched.
listingsRouter.delete('/:listingId/group-multi-qty', requireAuth, async (req, res, next) => {
  try {
    const result = await listingsService.cancelMultiQtyGroup(req.dataUserId, req.params.listingId as string);
    res.json(result);
  } catch (err) { next(err); }
});

// End (close) a persistent multi-qty listing — flips is_ended=true on every
// row in the group so it stops appearing in Listings. Sold rows keep their
// sales trail; any still-active certs get cancelled as part of the close.
listingsRouter.post('/:listingId/end-multi-qty', requireAuth, async (req, res, next) => {
  try {
    const result = await listingsService.endMultiQtyListing(req.dataUserId, req.params.listingId as string);
    res.json(result);
  } catch (err) { next(err); }
});
