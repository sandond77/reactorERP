import type { Request, Response, NextFunction } from 'express';
import * as gradingService from '../services/grading.service';
import { z } from 'zod';

const slabsQuerySchema = z.object({
  page: z.coerce.number().default(1),
  limit: z.coerce.number().min(1).max(200).default(50),
  search: z.string().optional(),
  status: z.enum(['graded', 'sold', 'unsold', 'all']).default('all'),
  sort_by: z.string().optional(),
  sort_dir: z.enum(['asc', 'desc']).default('desc'),
  companies: z.string().optional(),
  grades: z.string().optional(),
  is_listed: z.string().optional(),             // 'yes' | 'no'
  is_card_show: z.string().optional(),          // 'yes' | 'no'
  personal_collection: z.string().optional(),   // 'yes' | 'no'
  for_sale: z.string().optional(),              // 'yes' — active listing OR card show
  in_set_listing: z.string().optional(),        // 'yes' — active listing with listing_group_id set
  purchase_years: z.string().optional(),
  listed_years: z.string().optional(),
  sold_years: z.string().optional(),
  purchase_dates: z.string().optional(),
  listed_dates: z.string().optional(),
  sold_dates: z.string().optional(),
});

// Returns undefined when param not sent (no filter), [] when sent as empty (filter to nothing)
function splitCSV(val?: string): string[] | undefined {
  if (val === undefined) return undefined;
  return val.split(',').map((s) => s.trim()).filter(Boolean);
}

export async function listSlabs(req: Request, res: Response, next: NextFunction) {
  try {
    const q = slabsQuerySchema.parse(req.query);
    const result = await gradingService.listSlabs(
      req.dataUserId,
      { page: q.page, limit: q.limit },
      q.search,
      q.status,
      q.sort_by,
      q.sort_dir,
      splitCSV(q.companies),
      splitCSV(q.grades),
      q.is_listed,
      q.is_card_show,
      splitCSV(q.purchase_years),
      splitCSV(q.listed_years),
      splitCSV(q.sold_years),
      q.personal_collection,
      q.for_sale,
      splitCSV(q.purchase_dates),
      splitCSV(q.listed_dates),
      splitCSV(q.sold_dates),
      q.in_set_listing
    );
    res.json(result);
  } catch (err) { next(err); }
}

export async function getSlabFilters(req: Request, res: Response, next: NextFunction) {
  try {
    const options = await gradingService.getSlabFilterOptions(req.dataUserId);
    res.json(options);
  } catch (err) { next(err); }
}

// Batch pricing suggestions for a set of slabs about to be added to a
// card show. Capped at the same 25-item ceiling the Add-to-Card-Show
// modal enforces client-side, so a broken caller can't ask for a
// megabatch of lookups.
const pricingSchema = z.object({
  slab_ids: z.array(z.string().uuid()).min(1).max(25),
});

export async function getCardShowPricingSuggestions(req: Request, res: Response, next: NextFunction) {
  try {
    const { slab_ids } = pricingSchema.parse(req.body);
    const suggestions = await gradingService.getCardShowPricingSuggestions(req.dataUserId, slab_ids);
    res.json({ data: suggestions });
  } catch (err) { next(err); }
}


