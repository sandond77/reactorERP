import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as svc from '../services/alert-overrides.service';

const entityTypeSchema = z.enum(['ebay_listing', 'card_show']);
const DAYS_DEFAULT = 30;

export async function getStaleEbay(req: Request, res: Response, next: NextFunction) {
  try {
    const days = z.coerce.number().int().min(1).default(DAYS_DEFAULT).parse(req.query.days);
    const data = await svc.getStaleEbayListingsFull(req.user!.id, days);
    res.json({ data });
  } catch (err) { next(err); }
}

export async function getStaleCardShow(req: Request, res: Response, next: NextFunction) {
  try {
    const days = z.coerce.number().int().min(1).default(DAYS_DEFAULT).parse(req.query.days);
    const data = await svc.getStaleCardShowFull(req.user!.id, days);
    res.json({ data });
  } catch (err) { next(err); }
}

export async function muteAlert(req: Request, res: Response, next: NextFunction) {
  try {
    const { entity_type, entity_id } = z.object({
      entity_type: entityTypeSchema,
      entity_id: z.string().uuid(),
    }).parse(req.body);
    await svc.muteAlert(req.user!.id, entity_type, entity_id);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function ignoreAlert(req: Request, res: Response, next: NextFunction) {
  try {
    const { entity_type, entity_id } = z.object({
      entity_type: entityTypeSchema,
      entity_id: z.string().uuid(),
    }).parse(req.body);
    await svc.ignoreAlert(req.user!.id, entity_type, entity_id);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function resetAlert(req: Request, res: Response, next: NextFunction) {
  try {
    const { entity_type, entity_id } = z.object({
      entity_type: entityTypeSchema,
      entity_id: z.string().uuid(),
    }).parse(req.body);
    await svc.resetAlert(req.user!.id, entity_type, entity_id);
    res.json({ ok: true });
  } catch (err) { next(err); }
}
