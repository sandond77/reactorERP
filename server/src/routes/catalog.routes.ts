import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import * as catalogController from '../controllers/catalog.controller';

export const catalogRouter = Router();
catalogRouter.use(requireAuth);

catalogRouter.get('/inventory-summary', catalogController.inventorySummary);
catalogRouter.get('/empty-parts', catalogController.emptyCatalog);
catalogRouter.post('/', catalogController.createCard);
catalogRouter.patch('/:id', catalogController.updateCard);
catalogRouter.delete('/:id', catalogController.deleteCard);
catalogRouter.get('/sets', catalogController.listSets);
catalogRouter.post('/sync-set', catalogController.syncSet);
