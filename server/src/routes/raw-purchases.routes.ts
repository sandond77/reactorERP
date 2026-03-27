import { Router } from 'express';
import * as ctrl from '../controllers/raw-purchases.controller';

const router = Router();

// Purchases
router.get('/',           ctrl.list);
router.get('/:id',        ctrl.getOne);
router.post('/',          ctrl.create);
router.patch('/:id',      ctrl.update);
router.delete('/:id',     ctrl.remove);

// Inspection lines (card_instances linked to a purchase)
router.post('/:id/lines',              ctrl.addLine);
router.patch('/:id/lines/:cardId',     ctrl.updateLine);
router.delete('/:id/lines/:cardId',    ctrl.deleteLine);

export default router;
