import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import * as auditService from '../services/audit.service';
import { z } from 'zod';

export const auditRouter = Router();
auditRouter.use(requireAuth);

const querySchema = z.object({
  page: z.coerce.number().default(1),
  limit: z.coerce.number().default(50),
  actor: z.string().optional(),
  actor_name: z.string().optional(),
  action: z.string().optional(),
  entity_type: z.string().optional(),
});

auditRouter.get('/actors', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await auditService.getAuditActors(req.dataUserId);
    res.json({ data: result });
  } catch (err) { next(err); }
});

auditRouter.get('/log', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const opts = querySchema.parse(req.query);
    const result = await auditService.listAuditLog(req.dataUserId, opts);
    res.json({ data: result });
  } catch (err) { next(err); }
});

auditRouter.post('/revert/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await auditService.revertDeletion(req.dataUserId, req.params['id'] as string);
    res.json({ data: result });
  } catch (err) { next(err); }
});
