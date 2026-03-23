import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import * as listingsService from '../services/listings.service';
import { z } from 'zod';

export const listingsRouter = Router();

const querySchema = z.object({
  page: z.coerce.number().default(1),
  limit: z.coerce.number().min(1).max(100).default(25),
  platform: z.string().optional(),
  status: z.string().optional(),
  sort_by: z.string().optional(),
  sort_dir: z.enum(['asc', 'desc']).default('desc'),
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
      { platform: q.platform as any, status: q.status },
      { page: q.page, limit: q.limit },
      q.sort_by,
      q.sort_dir
    );
    res.json(result);
  } catch (err) { next(err); }
});
