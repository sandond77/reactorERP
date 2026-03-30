import type { Request, Response, NextFunction } from 'express';
import * as importService from '../services/import/import.service';
import { AppError } from '../middleware/errorHandler';
import { z } from 'zod';

const TEMPLATES: Record<string, { filename: string; headers: string[]; sample: string[] }> = {
  graded: {
    filename: 'graded-cards-template.csv',
    headers: ['card_name', 'set_name', 'card_number', 'cert_number', 'grade', 'company', 'purchase_cost', 'grading_cost', 'currency', 'purchased_at', 'order_number', 'notes'],
    sample:  ['Charizard', 'Base Set', '4/102', '12345678', '9', 'PSA', '250.00', '25.00', 'USD', '2026-01-15', 'ORD-001', ''],
  },
  raw_purchase: {
    filename: 'raw-purchases-template.csv',
    headers: ['card_name', 'set_name', 'card_number', 'condition', 'quantity', 'cost', 'currency', 'order_number', 'source', 'purchased_at', 'language', 'type', 'notes'],
    sample:  ['Pikachu', 'Base Set', '58/102', 'NM', '1', '15.00', 'USD', 'ORD-123', 'eBay', '2026-03-01', 'EN', 'raw', ''],
  },
  bulk_sale: {
    filename: 'bulk-sales-template.csv',
    headers: ['identifier', 'sale_price', 'platform', 'platform_fees', 'shipping_cost', 'currency', 'sold_at', 'unique_id'],
    sample:  ['12345678', '300.00', 'ebay', '30.00', '5.00', 'USD', '2026-03-28', ''],
  },
};

export async function getTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    const type = req.params['type'] as string;
    const tpl = TEMPLATES[type];
    if (!tpl) throw new AppError(404, 'Template not found');

    const lines = [tpl.headers.join(','), tpl.sample.join(',')];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${tpl.filename}"`);
    res.send(lines.join('\r\n'));
  } catch (err) { next(err); }
}

export async function uploadCsv(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new AppError(400, 'No CSV file provided');

    const importType = (req.body.import_type as string) ?? 'cards';
    const result = await importService.uploadCsv(
      req.user!.id,
      req.file.originalname,
      req.file.buffer,
      importType
    );
    res.status(201).json({ data: result });
  } catch (err) { next(err); }
}

const mappingSchema = z.object({
  mapping: z.record(z.string()),
});

export async function saveMapping(req: Request, res: Response, next: NextFunction) {
  try {
    const { mapping } = mappingSchema.parse(req.body);
    const result = await importService.saveColumnMapping(req.user!.id, req.params['id'] as string, mapping);
    res.json({ data: result });
  } catch (err) { next(err); }
}

export async function executeImport(req: Request, res: Response, next: NextFunction) {
  try {
    // Re-upload needed for execution — client must send file again
    if (!req.file) throw new AppError(400, 'No CSV file provided for execution');
    const result = await importService.executeImport(req.user!.id, req.params['id'] as string, req.file.buffer);
    res.json({ data: result });
  } catch (err) { next(err); }
}

export async function getImportStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await importService.getImportStatus(req.user!.id, req.params['id'] as string);
    res.json({ data: result });
  } catch (err) { next(err); }
}

export async function listImports(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await importService.listImports(req.user!.id);
    res.json({ data: result });
  } catch (err) { next(err); }
}
