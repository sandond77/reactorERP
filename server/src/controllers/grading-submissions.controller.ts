import type { Request, Response, NextFunction } from 'express';
import * as svc from '../services/grading-submissions.service';

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
    res.status(201).json(await svc.createBatch(req.dataUserId, req.body));
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
    await svc.deleteBatch(req.dataUserId, req.params['id'] as string);
    res.status(204).send();
  } catch (err) { next(err); }
}

export async function addItem(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await svc.addItem(req.dataUserId, req.params['id'] as string, req.body));
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

export async function revertReturn(req: Request, res: Response, next: NextFunction) {
  try {
    const batch = await svc.revertReturn(req.dataUserId, req.params['id'] as string);
    if (!batch) return res.status(404).json({ error: 'Not found or not in returned status' });
    res.json(batch);
  } catch (err) { next(err); }
}
