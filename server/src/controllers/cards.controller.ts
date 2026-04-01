import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import type { Request, Response, NextFunction } from 'express';
import * as cardsService from '../services/cards.service';
import * as agentService from '../services/agent.service';
import { paginationSchema } from '../middleware/validate';
import { z } from 'zod';
import { toCents } from '../utils/cents';
import { db } from '../config/database';

const cardFiltersSchema = z.object({
  status: z.string().optional(),
  search: z.string().optional(),
  card_game: z.string().optional(),
  language: z.string().optional(),
  condition: z.string().optional(),
  purchase_type: z.string().optional(),
  exclude_decision: z.string().optional(),
  page: z.coerce.number().default(1),
  limit: z.coerce.number().min(1).max(100).default(25),
});

export async function listCards(req: Request, res: Response, next: NextFunction) {
  try {
    const query = cardFiltersSchema.parse(req.query);
    const { page, limit, ...filters } = query;
    const result = await cardsService.listCards(req.user!.id, filters as any, { page, limit });
    res.json(result);
  } catch (err) { next(err); }
}

export async function listCardsGrouped(req: Request, res: Response, next: NextFunction) {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const pipeline = req.query.pipeline as 'sell' | 'grade' | undefined;
    const purchase_type = typeof req.query.purchase_type === 'string' ? req.query.purchase_type : undefined;
    const result = await cardsService.listCardsGroupedByPart(req.user!.id, { search, pipeline, purchase_type });
    res.json(result);
  } catch (err) { next(err); }
}

export async function getCardFilters(req: Request, res: Response, next: NextFunction) {
  try {
    const options = await cardsService.getCardFilterOptions(req.user!.id);
    res.json(options);
  } catch (err) { next(err); }
}

export async function getCard(req: Request, res: Response, next: NextFunction) {
  try {
    const card = await cardsService.getCardById(req.user!.id, req.params['id'] as string);
    res.json({ data: card });
  } catch (err) { next(err); }
}

const createCardSchema = z.object({
  card_name_override: z.string().optional(),
  set_name_override: z.string().optional(),
  card_number_override: z.string().optional(),
  catalog_id: z.string().uuid().optional(),
  card_game: z.string().default('pokemon'),
  language: z.string().default('EN'),
  variant: z.string().optional(),
  rarity: z.string().optional(),
  purchase_type: z.enum(['raw', 'bulk', 'pre_graded']).default('raw'),
  quantity: z.coerce.number().int().min(1).default(1),
  purchase_cost: z.union([z.string(), z.number()]).transform((v) => toCents(v)),
  currency: z.enum(['USD', 'JPY']).default('USD'),
  condition: z.string().optional(),
  condition_notes: z.string().optional(),
  source_link: z.string().url().optional(),
  order_number: z.string().optional(),
  notes: z.string().optional(),
  decision: z.enum(['grade', 'sell_raw']).optional(),
  is_personal_collection: z.boolean().default(false),
  location_id: z.string().uuid().optional().nullable(),
  purchased_at: z.string().optional().transform((v) => v ? new Date(v) : null),
  // Optional slab fields — when provided, a slab_details record is created and status set to 'graded'
  slab_company: z.enum(['PSA', 'BGS', 'CGC', 'SGC', 'HGA', 'ACE', 'ARS', 'OTHER']).optional(),
  slab_grade: z.coerce.number().min(1).max(10).optional(),
  slab_grade_label: z.string().optional(),
  slab_cert_number: z.string().optional(),
  slab_additional_cost: z.union([z.string(), z.number()]).transform((v) => toCents(v)).optional(),
});

export async function createCard(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createCardSchema.parse(req.body);
    const { slab_company, slab_grade, slab_grade_label, slab_cert_number, slab_additional_cost, ...cardData } = data;
    const slabInfo = slab_company && slab_grade != null
      ? { company: slab_company, grade: slab_grade, grade_label: slab_grade_label, cert_number: slab_cert_number, additional_cost: slab_additional_cost ?? 0 }
      : undefined;
    const card = await cardsService.createCard(req.user!.id, cardData as any, slabInfo);
    res.status(201).json({ data: card });
  } catch (err) { next(err); }
}

export async function updateCard(req: Request, res: Response, next: NextFunction) {
  try {
    const card = await cardsService.updateCard(req.user!.id, req.params['id'] as string, req.body);
    res.json({ data: card });
  } catch (err) { next(err); }
}

const transitionSchema = z.object({
  status: z.enum(['purchased_raw', 'inspected', 'grading_submitted', 'graded', 'raw_for_sale', 'sold', 'lost_damaged']),
});

export async function transitionStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const { status } = transitionSchema.parse(req.body);
    const card = await cardsService.transitionCardStatus(req.user!.id, req.params['id'] as string, status);
    res.json({ data: card });
  } catch (err) { next(err); }
}

export async function deleteCard(req: Request, res: Response, next: NextFunction) {
  try {
    await cardsService.softDeleteCard(req.user!.id, req.params['id'] as string);
    res.status(204).send();
  } catch (err) { next(err); }
}

const rawFlatQuerySchema = z.object({
  page:  z.coerce.number().default(1),
  limit: z.coerce.number().min(1).max(200).default(100),
  search:    z.string().optional(),
  status:    z.enum(['all', 'unsold', 'sold', 'for_sale', 'to_grade', 'submitted']).default('unsold'),
  sort_by:   z.string().optional(),
  sort_dir:  z.enum(['asc', 'desc']).default('desc'),
  conditions:     z.string().optional(),
  is_listed:      z.string().optional(),
  purchase_years: z.string().optional(),
  listed_years:   z.string().optional(),
  sold_years:     z.string().optional(),
  purchase_date:  z.string().optional(),
  listed_date:    z.string().optional(),
  sold_date:      z.string().optional(),
});

function splitCSVRaw(val?: string): string[] | undefined {
  if (val === undefined) return undefined;
  return val.split(',').map((s) => s.trim()).filter(Boolean);
}

export async function listRawFlat(req: Request, res: Response, next: NextFunction) {
  try {
    const q = rawFlatQuerySchema.parse(req.query);
    const result = await cardsService.listRawFlat(
      req.user!.id,
      { page: q.page, limit: q.limit },
      q.search,
      q.status,
      q.sort_by,
      q.sort_dir,
      splitCSVRaw(q.conditions),
      q.is_listed,
      splitCSVRaw(q.purchase_years),
      splitCSVRaw(q.listed_years),
      splitCSVRaw(q.sold_years),
      q.purchase_date,
      q.listed_date,
      q.sold_date,
    );
    res.json(result);
  } catch (err) { next(err); }
}

export async function getRawFlatFilters(req: Request, res: Response, next: NextFunction) {
  try {
    const options = await cardsService.getRawFlatFilterOptions(req.user!.id);
    res.json(options);
  } catch (err) { next(err); }
}

export async function uploadCardImage(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) { res.status(400).json({ error: 'No image provided' }); return; }
    const cardId = req.params['id'] as string;
    const side = (req.query['side'] as string) === 'back' ? 'back' : 'front';

    // Verify card belongs to user
    const card = await db.selectFrom('card_instances').select('id')
      .where('id', '=', cardId).where('user_id', '=', req.user!.id)
      .executeTakeFirst();
    if (!card) { res.status(404).json({ error: 'Card not found' }); return; }

    const resized = await sharp(req.file.buffer)
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    const dir = path.join(__dirname, '../../../uploads/card-images', req.user!.id);
    fs.mkdirSync(dir, { recursive: true });
    const filename = `${cardId}-${side}.jpg`;
    fs.writeFileSync(path.join(dir, filename), resized);

    const url = `/uploads/card-images/${req.user!.id}/${filename}`;
    const field = side === 'back' ? 'image_back_url' : 'image_front_url';

    await db.updateTable('card_instances').set({ [field]: url } as any)
      .where('id', '=', cardId).execute();

    res.json({ data: { url } });
  } catch (err) { next(err); }
}

export async function scanImage(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) { res.status(400).json({ error: 'No image provided' }); return; }
    const imageBase64 = req.file.buffer.toString('base64');
    const mediaType = req.file.mimetype as 'image/jpeg' | 'image/png' | 'image/webp';
    const result = await agentService.scanCardImage(imageBase64, mediaType);
    res.json({ data: result });
  } catch (err) { next(err); }
}
