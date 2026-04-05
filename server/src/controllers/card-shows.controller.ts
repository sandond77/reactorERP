import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as service from '../services/card-shows.service';
import { AppError } from '../middleware/errorHandler';

const createSchema = z.object({
  name: z.string().min(1),
  location: z.string().nullish(),
  show_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  num_days: z.number().int().min(1).optional(),
  num_tables: z.number().int().min(1).nullish(),
  notes: z.string().nullish(),
});

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await service.listCardShows(req.user!.id);
    res.json({ data: rows });
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createSchema.parse(req.body);
    const row = await service.createCardShow(req.user!.id, data);
    res.status(201).json(row);
  } catch (err) { next(err); }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const data = createSchema.partial().parse(req.body);
    const row = await service.updateCardShow(req.user!.id, req.params.id, data);
    if (!row) throw new AppError(404, 'Card show not found');
    res.json(row);
  } catch (err) { next(err); }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await service.deleteCardShow(req.user!.id, req.params.id);
    res.status(204).send();
  } catch (err) { next(err); }
}
