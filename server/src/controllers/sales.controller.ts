import type { Request, Response, NextFunction } from 'express';
import * as salesService from '../services/sales.service';
import { z } from 'zod';
import { toCents } from '../utils/cents';
import { parseSaleFromText, type ParsedSaleData } from '../services/ai/parse-sale.service';
import { listSlabs } from '../services/grading.service';

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
  sold_dates: z.string().optional(),
});

function splitCSV(val?: string): string[] | undefined {
  if (val === undefined) return undefined;
  return val.split(',').map((s) => s.trim()).filter(Boolean);
}

export async function listSales(req: Request, res: Response, next: NextFunction) {
  try {
    const { page, limit, platforms, search, from, to, sort_by, sort_dir, card_type, sold_dates } = paginationSchema.parse(req.query);
    const result = await salesService.listSales(
      req.dataUserId,
      { platforms: splitCSV(platforms), search, from, to, cardType: card_type === 'all' ? undefined : card_type, soldDates: splitCSV(sold_dates) },
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
  quantity: z.coerce.number().int().positive().optional(),
});

export async function recordSale(req: Request, res: Response, next: NextFunction) {
  try {
    const data = recordSaleSchema.parse(req.body);
    const sale = await salesService.recordSale(req.dataUserId, data as any);
    res.status(201).json({ data: sale });
  } catch (err) { next(err); }
}

export async function parseOrderItems(req: Request, res: Response, next: NextFunction) {
  try {
    const body = z.object({
      text: z.string().optional(),
      image: z.object({
        data: z.string().min(1),
        media_type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
      }).optional(),
    }).parse(req.body);
    const results = await salesService.parseOrderItems(req.dataUserId, body);
    res.json({ data: results });
  } catch (err) { next(err); }
}

export async function recordBulkSale(req: Request, res: Response, next: NextFunction) {
  try {
    const { items, platform, card_show_id, unique_id, order_details_link, currency, sold_at, unique_id_2 } = z.object({
      items: z.array(z.object({
        card_instance_id: z.string().uuid(),
        // Accept null too — bulk-cart rows from raw cards with no active
        // listing send null. Coerced to undefined for the service layer.
        listing_id: z.string().uuid().nullable().optional().transform((v) => v ?? undefined),
        sale_price: z.number().int().nonnegative(),
        platform_fees: z.number().int().nonnegative().default(0),
        quantity: z.coerce.number().int().positive().optional(),
        // Per-item override for order metadata — Combined Order flow uses
        // this when eBay splits a buyer's combined-shipping order into
        // multiple order-detail URLs. Empty falls back to the shared value.
        order_details_link: z.string().optional(),
        unique_id: z.string().optional(),
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

const updateSaleSchema = recordSaleSchema.omit({ card_instance_id: true }).partial().extend({
  card_show_id: z.string().uuid().nullable().optional(),
});

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

// ── Quick sale: text → parsed sale + candidate inventory rows ────────────────
// One-shot endpoint for the mobile /quick-sale flow. Takes a natural sentence,
// runs the Haiku parser, then executes an inventory search for the parsed
// card_query so the client can render a confirm modal with the top matching
// slabs. Never touches the sales table itself — the client submits the
// confirmed row to POST /sales like any other sale, which keeps the actual
// sale-recording code path a single implementation.

const quickParseSchema = z.object({
  text: z.string().min(1).max(500),
});

interface QuickCandidate {
  id: string;
  card_name: string | null;
  set_name: string | null;
  cert_number: string | null;
  grade_label: string | null;
  numeric_grade: number | null;
  company: string;
  is_listed: boolean;
  listed_price: number | null;
  card_show_price: number | null;
  raw_cost: number;
  grading_cost: number;
}

export async function quickParseSale(req: Request, res: Response, next: NextFunction) {
  try {
    const { text } = quickParseSchema.parse(req.body);
    const todayISO = new Date().toISOString().slice(0, 10);
    const parsed: ParsedSaleData = await parseSaleFromText(text, todayISO);

    // Search inventory for candidates. Priority: cert number > card_query.
    // Cert numbers are globally unique per company, so a cert hit is a
    // single-candidate confirm. When only card_query is available, we return
    // up to 10 matching unsold slabs and let the user pick.
    const searchTerm = parsed.cert_number ?? parsed.card_query ?? '';
    let candidates: QuickCandidate[] = [];
    if (searchTerm) {
      const result = await listSlabs(
        req.dataUserId,
        { page: 1, limit: 10 },
        searchTerm,
        'unsold',
        'cert_number', 'asc',
      );
      candidates = result.data.map((r) => ({
        id: r.id,
        card_name: r.card_name,
        set_name: r.set_name,
        cert_number: r.cert_number,
        grade_label: r.grade_label,
        numeric_grade: r.numeric_grade,
        company: r.company,
        is_listed: r.is_listed,
        listed_price: r.listed_price,
        card_show_price: r.card_show_price,
        raw_cost: r.raw_cost,
        grading_cost: r.grading_cost,
      }));
    }

    // Refine: if the parser gave us grade + company, prefer candidates that
    // match both. Never zero out results — a strict filter that leaves the
    // list empty is worse than showing all matches for the name.
    let refined = candidates;
    if (parsed.grade != null || parsed.company) {
      const strict = candidates.filter((c) => {
        const gradeMatch = parsed.grade == null || (c.numeric_grade != null && Number(c.numeric_grade) === parsed.grade);
        const companyMatch = !parsed.company || c.company === parsed.company;
        return gradeMatch && companyMatch;
      });
      if (strict.length > 0) refined = strict;
    }

    res.json({ parsed, candidates: refined });
  } catch (err) { next(err); }
}
