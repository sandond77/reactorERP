import type { Request, Response, NextFunction } from 'express';
import * as importService from '../services/import/import.service';
import { AppError } from '../middleware/errorHandler';
import { z } from 'zod';

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
