import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as svc from '../services/grade-more.service';

export async function getAlerts(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await svc.getActiveGradeMoreAlerts(req.user!.id) });
  } catch (err) { next(err); }
}

export async function listThresholds(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await svc.listGradeMoreThresholds(req.user!.id) });
  } catch (err) { next(err); }
}

export async function listGradedCards(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await svc.listGradedCardsByGrade(req.user!.id) });
  } catch (err) { next(err); }
}

export async function upsertThreshold(req: Request, res: Response, next: NextFunction) {
  try {
    const { catalog_id, company, grade, grade_label, min_quantity } = z.object({
      catalog_id:  z.string().uuid(),
      company:     z.string().min(1),
      grade:       z.number().nullable(),
      grade_label: z.string().nullable(),
      min_quantity: z.number().int().min(1),
    }).parse(req.body);
    await svc.upsertGradeMoreThreshold(req.user!.id, catalog_id, company, grade, grade_label, min_quantity);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function ignoreThreshold(req: Request, res: Response, next: NextFunction) {
  try {
    await svc.ignoreGradeMoreThreshold(req.user!.id, req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function muteThreshold(req: Request, res: Response, next: NextFunction) {
  try {
    await svc.muteGradeMoreThreshold(req.user!.id, req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function resetThreshold(req: Request, res: Response, next: NextFunction) {
  try {
    await svc.resetGradeMoreThreshold(req.user!.id, req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

export async function deleteThreshold(req: Request, res: Response, next: NextFunction) {
  try {
    await svc.deleteGradeMoreThreshold(req.user!.id, req.params.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
}
