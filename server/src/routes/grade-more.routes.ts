import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import * as ctrl from '../controllers/grade-more.controller';

export const gradeMoreRouter = Router();

gradeMoreRouter.use(requireAuth);

gradeMoreRouter.get('/alerts',        ctrl.getAlerts);
gradeMoreRouter.get('/thresholds',    ctrl.listThresholds);
gradeMoreRouter.post('/thresholds',   ctrl.upsertThreshold);
gradeMoreRouter.post('/:id/ignore',   ctrl.ignoreThreshold);
gradeMoreRouter.post('/:id/mute',     ctrl.muteThreshold);
gradeMoreRouter.post('/:id/reset',    ctrl.resetThreshold);
gradeMoreRouter.delete('/:id',        ctrl.deleteThreshold);
