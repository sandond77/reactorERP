import { Router } from 'express';
import * as reportsController from '../controllers/reports.controller';
import { requireAuth } from '../middleware/auth';

export const reportsRouter = Router();

reportsRouter.use(requireAuth);

reportsRouter.get('/pnl', reportsController.getPnl);
reportsRouter.get('/yearly', reportsController.getYearlySummary);
reportsRouter.get('/summary', reportsController.getSummary);
reportsRouter.get('/inventory-value', reportsController.getInventoryValue);
reportsRouter.get('/grading-roi', reportsController.getGradingRoi);
reportsRouter.get('/platform-breakdown', reportsController.getPlatformBreakdown);
