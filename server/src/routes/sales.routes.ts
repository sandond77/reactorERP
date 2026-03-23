import { Router } from 'express';
import * as salesController from '../controllers/sales.controller';
import { requireAuth } from '../middleware/auth';

export const salesRouter = Router();

salesRouter.use(requireAuth);

salesRouter.get('/filters', salesController.getSaleFilters);
salesRouter.get('/', salesController.listSales);
salesRouter.post('/', salesController.recordSale);
salesRouter.get('/:id', salesController.getSale);
