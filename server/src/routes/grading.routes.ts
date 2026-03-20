import { Router } from 'express';
import * as gradingController from '../controllers/grading.controller';
import { requireAuth } from '../middleware/auth';

export const gradingRouter = Router();

gradingRouter.use(requireAuth);

gradingRouter.get('/slabs/filters', gradingController.getSlabFilters);
gradingRouter.get('/slabs', gradingController.listSlabs);
gradingRouter.get('/', gradingController.listSubmissions);
gradingRouter.post('/', gradingController.submitForGrading);
gradingRouter.post('/:id/return', gradingController.recordReturn);
