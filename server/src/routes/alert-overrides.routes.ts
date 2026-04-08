import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import * as ctrl from '../controllers/alert-overrides.controller';

export const alertOverridesRouter = Router();

alertOverridesRouter.use(requireAuth);

alertOverridesRouter.get('/stale-ebay', ctrl.getStaleEbay);
alertOverridesRouter.get('/stale-card-show', ctrl.getStaleCardShow);
alertOverridesRouter.post('/mute', ctrl.muteAlert);
alertOverridesRouter.post('/ignore', ctrl.ignoreAlert);
alertOverridesRouter.post('/reset', ctrl.resetAlert);
