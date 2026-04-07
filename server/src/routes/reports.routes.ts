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
reportsRouter.get('/raw-dashboard', reportsController.getRawDashboard);
reportsRouter.get('/graded-dashboard', reportsController.getGradedDashboard);
reportsRouter.get('/card-show-breakdown/:showId', reportsController.getCardShowBreakdown);
reportsRouter.get('/pending-grading-sub', reportsController.getPendingGradingSub);
reportsRouter.get('/card-trend', reportsController.getCardTrend);
reportsRouter.get('/card-trend-search', reportsController.getCardTrendSearch);
