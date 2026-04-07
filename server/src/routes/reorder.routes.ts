import { Router } from 'express';
import * as ctrl from '../controllers/reorder.controller';
import { requireAuth } from '../middleware/auth';

export const reorderRouter = Router();

reorderRouter.use(requireAuth);

reorderRouter.get('/alerts',                  ctrl.getAlerts);
reorderRouter.get('/thresholds',              ctrl.listThresholds);
reorderRouter.get('/bulk-cards',              ctrl.listBulkCards);
reorderRouter.get('/bulk-cards-with-thresholds', ctrl.listBulkCardsWithThresholds);
reorderRouter.post('/thresholds',              ctrl.upsertThreshold);
reorderRouter.post('/thresholds/:id/ignore',   ctrl.ignoreThreshold);
reorderRouter.post('/thresholds/:id/mute',     ctrl.muteThreshold);
reorderRouter.post('/thresholds/:id/reset',    ctrl.resetThreshold);
reorderRouter.delete('/thresholds/:id',        ctrl.deleteThreshold);
