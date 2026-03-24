import type { Request, Response } from 'express';
import * as svc from '../services/raw-purchases.service';

export async function list(req: Request, res: Response) {
  try {
    const userId = req.user!.id;
    const result = await svc.listRawPurchases(userId, {
      type: req.query.type as any,
      status: req.query.status as any,
      search: Array.isArray(req.query.search) ? req.query.search[0] as string : req.query.search as string | undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

export async function getOne(req: Request, res: Response) {
  try {
    const purchase = await svc.getRawPurchase(req.user!.id, req.params['id'] as string);
    if (!purchase) return res.status(404).json({ error: 'Not found' });
    res.json(purchase);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

export async function create(req: Request, res: Response) {
  try {
    const purchase = await svc.createRawPurchase(req.user!.id, req.body);
    res.status(201).json(purchase);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

export async function update(req: Request, res: Response) {
  try {
    const purchase = await svc.updateRawPurchase(req.user!.id, req.params['id'] as string, req.body);
    if (!purchase) return res.status(404).json({ error: 'Not found' });
    res.json(purchase);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

export async function remove(req: Request, res: Response) {
  try {
    await svc.deleteRawPurchase(req.user!.id, req.params['id'] as string);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

export async function addLine(req: Request, res: Response) {
  try {
    const card = await svc.addInspectionLine(req.user!.id, req.params['id'] as string, req.body);
    res.status(201).json(card);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

export async function updateLine(req: Request, res: Response) {
  try {
    const card = await svc.updateInspectionLine(req.user!.id, req.params['cardId'] as string, req.body);
    if (!card) return res.status(404).json({ error: 'Not found' });
    res.json(card);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

export async function deleteLine(req: Request, res: Response) {
  try {
    await svc.deleteInspectionLine(req.user!.id, req.params['cardId'] as string);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
