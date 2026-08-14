import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as svc from '../services/grading-submissions.service';
import { suggestReturnMatches } from '../services/ai/return-matching.service';
import { AppError } from '../middleware/errorHandler';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await svc.listBatches(req.dataUserId));
  } catch (err) { next(err); }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    const batch = await svc.getBatch(req.dataUserId, req.params['id'] as string);
    if (!batch) return res.status(404).json({ error: 'Not found' });
    res.json(batch);
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const tz = typeof req.body?.tz === 'string' ? req.body.tz : undefined;
    res.status(201).json(await svc.createBatch(req.dataUserId, req.body, tz));
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const batch = await svc.updateBatch(req.dataUserId, req.params['id'] as string, req.body);
    if (!batch) return res.status(404).json({ error: 'Not found' });
    res.json(batch);
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await svc.deleteBatch(req.dataUserId, req.params['id'] as string);
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (err) { next(err); }
}

export async function addItem(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await svc.addItem(req.dataUserId, req.params['id'] as string, req.body));
  } catch (err) { next(err); }
}

export async function addItemsBulk(req: Request, res: Response, next: NextFunction) {
  try {
    const items = (req.body && Array.isArray(req.body.items)) ? req.body.items : [];
    const created = await svc.addItemsBulk(req.dataUserId, req.params['id'] as string, items);
    res.status(201).json({ data: created });
  } catch (err) { next(err); }
}

export async function repeatBatchItems(req: Request, res: Response, next: NextFunction) {
  try {
    const items = (req.body && Array.isArray(req.body.items)) ? req.body.items : [];
    const created = await svc.repeatBatchItems(req.dataUserId, req.params['id'] as string, items);
    res.status(201).json({ data: created });
  } catch (err) { next(err); }
}

export async function listRepeatSources(req: Request, res: Response, next: NextFunction) {
  try {
    const groups = await svc.listRepeatSources(req.dataUserId, req.params['id'] as string);
    res.json({ data: groups });
  } catch (err) { next(err); }
}

export async function addLegacyItem(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await svc.addLegacyItem(req.dataUserId, req.params['id'] as string, req.body));
  } catch (err) { next(err); }
}

export async function updateItem(req: Request, res: Response, next: NextFunction) {
  try {
    const item = await svc.updateItem(req.dataUserId, req.params['itemId'] as string, req.body);
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
  } catch (err) { next(err); }
}

export async function removeItem(req: Request, res: Response, next: NextFunction) {
  try {
    await svc.removeItem(req.dataUserId, req.params['itemId'] as string);
    res.status(204).send();
  } catch (err) { next(err); }
}

export async function processReturn(req: Request, res: Response, next: NextFunction) {
  try {
    const batch = await svc.processReturn(req.dataUserId, req.params['id'] as string, req.body);
    if (!batch) return res.status(404).json({ error: 'Not found' });
    res.json(batch);
  } catch (err) { next(err); }
}

// AI-assisted matching for slabs the deterministic scorer couldn't confidently
// place. Payload is the client-side unmatched batch items + unused CSV candidates
// only, so we don't re-litigate matches that already worked. Caps input size to
// keep model spend bounded on absurd batches.
const aiSuggestSchema = z.object({
  batch_items: z.array(z.object({
    batch_item_id: z.string(),
    card_name: z.string().nullable(),
    set_name: z.string().nullable(),
    card_number: z.string().nullable(),
    language: z.string().nullable(),
    expected_grade: z.number().nullable(),
    line_item_num: z.number(),
  })).max(120),
  candidates: z.array(z.object({
    csv_index: z.number(),
    subject: z.string(),
    cert: z.string(),
    grade: z.number().nullable(),
    grade_label: z.string().optional(),
    card_number: z.string().optional(),
    set_name: z.string().optional(),
    language: z.string().optional(),
    line_num: z.number().optional(),
  })).max(120),
});

export async function aiSuggestReturnMatches(req: Request, res: Response, next: NextFunction) {
  try {
    // Guard: only the batch's owner may run this. Cheapest way to gate is a
    // lightweight ownership lookup — reuse getBatch so we get the same 404
    // semantics as everywhere else.
    const batch = await svc.getBatch(req.dataUserId, req.params['id'] as string);
    if (!batch) throw new AppError(404, 'Batch not found');

    const parsed = aiSuggestSchema.parse(req.body);
    const matches = await suggestReturnMatches(parsed);
    res.json({ data: matches });
  } catch (err) { next(err); }
}

export async function relinkItem(req: Request, res: Response, next: NextFunction) {
  try {
    const updated = await svc.relinkItem(req.dataUserId, req.params['itemId'] as string, req.body);
    res.json(updated);
  } catch (err) { next(err); }
}

export async function relinkItemLegacy(req: Request, res: Response, next: NextFunction) {
  try {
    const updated = await svc.relinkItemLegacy(req.dataUserId, req.params['itemId'] as string, req.body);
    res.json(updated);
  } catch (err) { next(err); }
}

export async function getReturnedSlabs(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await svc.getReturnedSlabs(req.dataUserId, req.params['id'] as string);
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (err) { next(err); }
}

export async function revertReturn(req: Request, res: Response, next: NextFunction) {
  try {
    const batch = await svc.revertReturn(req.dataUserId, req.params['id'] as string);
    if (!batch) return res.status(404).json({ error: 'Not found or not in returned status' });
    res.json(batch);
  } catch (err) { next(err); }
}
