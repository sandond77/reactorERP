import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/auth';
import * as ctrl from '../controllers/raw-purchases.controller';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) ? true : false as any);
  },
});

const router = Router();
router.use(requireAuth);

// Purchases
router.get('/',           ctrl.list);
// Legacy bucket picker — must come before /:id to avoid the path being eaten
// by the dynamic id route. Returns lots whose catalog is set_code='LEGACY'
// with remaining capacity.
router.get('/legacy-lots', ctrl.listLegacyBucketLots);
router.get('/:id',        ctrl.getOne);
router.post('/',          ctrl.create);
router.patch('/:id',      ctrl.update);
router.delete('/:id',     ctrl.remove);
router.post('/:id/receipt', upload.single('image'), ctrl.uploadReceipt);

// Inspection lines (card_instances linked to a purchase)
router.post('/:id/lines',              ctrl.addLine);
router.patch('/:id/lines/:cardId',     ctrl.updateLine);
router.delete('/:id/lines/:cardId',    ctrl.deleteLine);

// Revert: clear all inspection lines so the purchase reappears as needing inspection
router.post('/:id/revert-inspection',  ctrl.revertInspection);
// Unreceive: flip status received → ordered (only if no inspection lines exist)
router.post('/:id/unreceive',          ctrl.unreceive);
// Back-link an existing slab (card_instances row with status='graded') to this lot.
// Used during manual legacy migration when the slab is already in Reactor and
// we don't want to re-grade it through inspect → submit → return.
router.post('/:id/back-link-slab',     ctrl.backLinkSlab);
// Remove a slab's back-link to a lot (sets raw_purchase_id NULL — keeps slab)
router.delete('/:id/back-link-slab/:slabId', ctrl.unlinkSlab);

export default router;
