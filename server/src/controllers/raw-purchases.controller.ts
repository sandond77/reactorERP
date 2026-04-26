import type { Request, Response } from 'express';
import * as svc from '../services/raw-purchases.service';
import { saveReceiptImage } from '../utils/save-receipt';

export async function list(req: Request, res: Response) {
  try {
    const userId = req.dataUserId;
    const result = await svc.listRawPurchases(userId, {
      type: req.query.type as any,
      status: req.query.status as any,
      needs_inspection: req.query.needs_inspection === 'true',
      search: Array.isArray(req.query.search) ? req.query.search[0] as string : req.query.search as string | undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
      sortBy: req.query.sort_by as string | undefined,
      sortDir: req.query.sort_dir === 'asc' ? 'asc' : req.query.sort_dir === 'desc' ? 'desc' : undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

export async function getOne(req: Request, res: Response) {
  try {
    const purchase = await svc.getRawPurchase(req.dataUserId, req.params['id'] as string);
    if (!purchase) return res.status(404).json({ error: 'Not found' });
    res.json(purchase);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

export async function create(req: Request, res: Response) {
  try {
    const purchase = await svc.createRawPurchase(req.dataUserId, req.body);
    res.status(201).json(purchase);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

export async function update(req: Request, res: Response) {
  try {
    const purchase = await svc.updateRawPurchase(req.dataUserId, req.params['id'] as string, req.body);
    if (!purchase) return res.status(404).json({ error: 'Not found' });
    res.json(purchase);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

export async function remove(req: Request, res: Response) {
  try {
    await svc.deleteRawPurchase(req.dataUserId, req.params['id'] as string);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

export async function addLine(req: Request, res: Response) {
  try {
    const card = await svc.addInspectionLine(req.dataUserId, req.params['id'] as string, req.body);
    res.status(201).json(card);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

export async function updateLine(req: Request, res: Response) {
  try {
    const card = await svc.updateInspectionLine(req.dataUserId, req.params['cardId'] as string, req.body);
    if (!card) return res.status(404).json({ error: 'Not found' });
    res.json(card);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

export async function deleteLine(req: Request, res: Response) {
  try {
    await svc.deleteInspectionLine(req.dataUserId, req.params['cardId'] as string);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}

export async function uploadReceipt(req: Request, res: Response) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });
    const receiptUrl = await saveReceiptImage(req.dataUserId, req.params['id'] as string, req.file.buffer);
    const purchase = await svc.saveReceiptUrl(req.dataUserId, req.params['id'] as string, receiptUrl);
    res.json(purchase);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
