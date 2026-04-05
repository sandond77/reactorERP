import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import * as ctrl from '../controllers/card-shows.controller';

export const cardShowsRouter = Router();

cardShowsRouter.use(requireAuth);

cardShowsRouter.get('/',         ctrl.list);
cardShowsRouter.post('/',        ctrl.create);
cardShowsRouter.patch('/:id',    ctrl.update);
cardShowsRouter.delete('/:id',   ctrl.remove);
