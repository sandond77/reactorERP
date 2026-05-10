import { Router } from 'express';
import { z } from 'zod';
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

const createSchema = z.object({
  name:         z.string().min(1).transform(s => s.toLowerCase().trim()),
  abbreviation: z.string().min(1).max(8).transform(s => s.toUpperCase().trim()),
  languages:    z.array(z.string()).optional(),
});

cardGamesRouter.post('/', async (req, res, next) => {
  try {
    const { name, abbreviation, languages } = createSchema.parse(req.body);
    const row = await db
      .insertInto('card_games')
      .values({ name, abbreviation, languages: languages ?? [] })
      .onConflict((c) => c.column('name').doUpdateSet({
        abbreviation,
        languages: languages ?? [],
      }))
      .returning(['id', 'name', 'abbreviation', 'languages'])
      .executeTakeFirstOrThrow();
    res.status(201).json({ data: row });
  } catch (err) {
    next(err);
  }
});
