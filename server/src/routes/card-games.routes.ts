import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { db } from '../config/database';

export const cardGamesRouter = Router();

cardGamesRouter.use(requireAuth);

cardGamesRouter.get('/', async (_req, res, next) => {
  try {
    const rows = await db
      .selectFrom('card_games')
      .select(['id', 'name', 'abbreviation', 'languages'])
      .orderBy('name')
      .execute();
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});
