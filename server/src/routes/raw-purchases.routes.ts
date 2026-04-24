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
router.get('/:id',        ctrl.getOne);
router.post('/',          ctrl.create);
router.patch('/:id',      ctrl.update);
router.delete('/:id',     ctrl.remove);
router.post('/:id/receipt', upload.single('image'), ctrl.uploadReceipt);

// Inspection lines (card_instances linked to a purchase)
router.post('/:id/lines',              ctrl.addLine);
router.patch('/:id/lines/:cardId',     ctrl.updateLine);
router.delete('/:id/lines/:cardId',    ctrl.deleteLine);

export default router;
