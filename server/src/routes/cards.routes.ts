import { Router } from 'express';
import * as cardsController from '../controllers/cards.controller';
import { requireAuth } from '../middleware/auth';

export const cardsRouter = Router();

cardsRouter.use(requireAuth);

cardsRouter.get('/', cardsController.listCards);
cardsRouter.post('/', cardsController.createCard);
cardsRouter.get('/:id', cardsController.getCard);
cardsRouter.patch('/:id', cardsController.updateCard);
cardsRouter.delete('/:id', cardsController.deleteCard);
cardsRouter.patch('/:id/status', cardsController.transitionStatus);
