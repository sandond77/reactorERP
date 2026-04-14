import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as reorderService from '../services/reorder.service';

export async function getAlerts(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await reorderService.getActiveReorderAlerts(req.dataUserId);
    res.json({ data });
  } catch (err) { next(err); }
}

export async function listThresholds(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await reorderService.listThresholds(req.dataUserId);
    res.json({ data });
  } catch (err) { next(err); }
}

export async function listBulkCards(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await reorderService.listBulkCatalogCards(req.dataUserId);
    res.json({ data });
  } catch (err) { next(err); }
}

export async function listBulkCardsWithThresholds(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await reorderService.listBulkCardsWithThresholds(req.dataUserId);
    res.json({ data });
  } catch (err) { next(err); }
}

export async function upsertThreshold(req: Request, res: Response, next: NextFunction) {
  try {
    const { catalog_id, min_quantity } = z.object({
      catalog_id: z.string().uuid(),
      min_quantity: z.number().int().min(1),
    }).parse(req.body);
    await reorderService.upsertThreshold(req.dataUserId, catalog_id, min_quantity);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function ignoreThreshold(req: Request, res: Response, next: NextFunction) {
  try {
    const id = z.string().uuid().parse(req.params.id);
    await reorderService.ignoreThreshold(req.dataUserId, id);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function muteThreshold(req: Request, res: Response, next: NextFunction) {
  try {
    const id = z.string().uuid().parse(req.params.id);
    await reorderService.muteThreshold(req.dataUserId, id);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function resetThreshold(req: Request, res: Response, next: NextFunction) {
  try {
    const id = z.string().uuid().parse(req.params.id);
    await reorderService.resetThreshold(req.dataUserId, id);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function deleteThreshold(req: Request, res: Response, next: NextFunction) {
  try {
    const id = z.string().uuid().parse(req.params.id);
    await reorderService.deleteThreshold(req.dataUserId, id);
    res.json({ ok: true });
  } catch (err) { next(err); }
}
