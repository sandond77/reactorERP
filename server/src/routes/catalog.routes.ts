import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import * as catalogController from '../controllers/catalog.controller';

export const catalogRouter = Router();
catalogRouter.use(requireAuth);

catalogRouter.get('/inventory-summary', catalogController.inventorySummary);
catalogRouter.get('/sets', catalogController.listSets);
catalogRouter.post('/sync-set', catalogController.syncSet);
