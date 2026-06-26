import { Router } from 'express';
import * as ctrl from '../controllers/exports.controller';
import { requireAuth } from '../middleware/auth';

export const exportsRouter = Router();

exportsRouter.use(requireAuth);

exportsRouter.get('/sales',     ctrl.exportSales);
exportsRouter.get('/inventory', ctrl.exportInventory);
exportsRouter.get('/expenses',  ctrl.exportExpenses);
