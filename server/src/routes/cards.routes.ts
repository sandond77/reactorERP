import { Router } from 'express';
import multer from 'multer';
import * as cardsController from '../controllers/cards.controller';
import { requireAuth } from '../middleware/auth';

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) as any);
  },
});

export const cardsRouter = Router();

cardsRouter.use(requireAuth);

cardsRouter.get('/filters', cardsController.getCardFilters);
cardsRouter.get('/by-part', cardsController.listCardsGrouped);
cardsRouter.get('/raw-flat/filters', cardsController.getRawFlatFilters);
cardsRouter.get('/raw-flat', cardsController.listRawFlat);
cardsRouter.post('/scan-image', imageUpload.single('image'), cardsController.scanImage);
cardsRouter.get('/', cardsController.listCards);
cardsRouter.post('/', cardsController.createCard);
cardsRouter.get('/:id', cardsController.getCard);
cardsRouter.patch('/:id', cardsController.updateCard);
cardsRouter.delete('/:id', cardsController.deleteCard);
cardsRouter.patch('/:id/status', cardsController.transitionStatus);
cardsRouter.post('/:id/image', imageUpload.single('image'), cardsController.uploadCardImage);
