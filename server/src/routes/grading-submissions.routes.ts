import { Router } from 'express';
import * as ctrl from '../controllers/grading-submissions.controller';
import { requireAuth } from '../middleware/auth';

export const gradingSubsRouter = Router();
gradingSubsRouter.use(requireAuth);

gradingSubsRouter.get('/',                        ctrl.list);
gradingSubsRouter.post('/',                       ctrl.create);
gradingSubsRouter.get('/:id',                     ctrl.getOne);
gradingSubsRouter.patch('/:id',                   ctrl.update);
gradingSubsRouter.delete('/:id',                  ctrl.remove);
gradingSubsRouter.post('/:id/items',              ctrl.addItem);
gradingSubsRouter.patch('/:id/items/:itemId',     ctrl.updateItem);
gradingSubsRouter.delete('/:id/items/:itemId',    ctrl.removeItem);
gradingSubsRouter.post('/:id/return',             ctrl.processReturn);
gradingSubsRouter.post('/:id/revert-return',      ctrl.revertReturn);
