import type { Request, Response, NextFunction } from 'express';
import * as gradingService from '../services/grading.service';
import { z } from 'zod';
import { toCents } from '../utils/cents';

const paginationSchema = z.object({
  page: z.coerce.number().default(1),
  limit: z.coerce.number().min(1).max(100).default(25),
});

export async function listSubmissions(req: Request, res: Response, next: NextFunction) {
  try {
    const { page, limit } = paginationSchema.parse(req.query);
    const result = await gradingService.listSubmissions(req.user!.id, { page, limit });
    res.json(result);
  } catch (err) { next(err); }
}

const slabsQuerySchema = z.object({
  page: z.coerce.number().default(1),
  limit: z.coerce.number().min(1).max(200).default(50),
  search: z.string().optional(),
  status: z.enum(['graded', 'sold', 'all']).default('all'),
  sort_by: z.string().optional(),
  sort_dir: z.enum(['asc', 'desc']).default('desc'),
  companies: z.string().optional(),
  grades: z.string().optional(),
  is_listed: z.string().optional(),    // 'yes' | 'no'
  is_card_show: z.string().optional(), // 'yes' | 'no'
  purchase_years: z.string().optional(),
  listed_years: z.string().optional(),
  sold_years: z.string().optional(),
});

function splitCSV(val?: string): string[] {
  return val ? val.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

export async function listSlabs(req: Request, res: Response, next: NextFunction) {
  try {
    const q = slabsQuerySchema.parse(req.query);
    const result = await gradingService.listSlabs(
      req.user!.id,
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
      splitCSV(q.sold_years)
    );
    res.json(result);
  } catch (err) { next(err); }
}

export async function getSlabFilters(req: Request, res: Response, next: NextFunction) {
  try {
    const options = await gradingService.getSlabFilterOptions(req.user!.id);
    res.json(options);
  } catch (err) { next(err); }
}

const submitSchema = z.object({
  card_instance_id: z.string().uuid(),
  company: z.enum(['PSA', 'BGS', 'CGC', 'SGC', 'HGA', 'ACE', 'OTHER']),
  submission_number: z.string().optional(),
  service_level: z.string().optional(),
  grading_fee: z.union([z.string(), z.number()]).transform((v) => toCents(v)).optional(),
  shipping_cost: z.union([z.string(), z.number()]).transform((v) => toCents(v)).optional(),
  currency: z.enum(['USD', 'JPY']).default('USD'),
  submitted_at: z.string().optional().transform((v) => v ? new Date(v) : undefined),
  estimated_return: z.string().optional().transform((v) => v ? new Date(v) : undefined),
});

export async function submitForGrading(req: Request, res: Response, next: NextFunction) {
  try {
    const data = submitSchema.parse(req.body);
    const submission = await gradingService.submitForGrading(req.user!.id, data as any);
    res.status(201).json({ data: submission });
  } catch (err) { next(err); }
}

const returnSchema = z.object({
  grade: z.coerce.number().min(1).max(10),
  grade_label: z.string().optional(),
  cert_number: z.string().optional(),
  subgrades: z.record(z.number()).optional(),
  returned_at: z.string().optional().transform((v) => v ? new Date(v) : undefined),
});

export async function recordReturn(req: Request, res: Response, next: NextFunction) {
  try {
    const data = returnSchema.parse(req.body);
    const slab = await gradingService.recordGradeReturn(req.user!.id, {
      submission_id: req.params['id'] as string,
      ...data,
    });
    res.json({ data: slab });
  } catch (err) { next(err); }
}
