import { Router } from 'express';
import { db } from '../config/database';
import { z } from 'zod';
import { EN_SETS, JP_SETS } from '../utils/set-codes';

export const setsRouter = Router();

// GET /sets/codes — return all static set definitions (EN + JP)
setsRouter.get('/codes', (_req, res) => {
  const en = EN_SETS.map(s => ({ language: 'EN', set_code: s.code, names: s.names }));
  const jp = JP_SETS.map(s => ({ language: 'JP', set_code: s.code, names: s.names }));
  res.json([...en, ...jp]);
});

// GET /sets/aliases — list all custom set aliases
setsRouter.get('/aliases', async (req, res, next) => {
  try {
    const rows = await db
      .selectFrom('pokemon_set_aliases')
      .selectAll()
      .orderBy('language')
      .orderBy('set_code')
      .orderBy('alias')
      .execute();
    res.json(rows);
  } catch (err) { next(err); }
});

const aliasSchema = z.object({
  language: z.enum(['EN', 'JP']),
  alias: z.string().min(1).max(200).transform(s => s.toLowerCase().trim()),
  set_code: z.string().min(1).max(50).transform(s => s.trim()),
  set_name: z.string().max(200).optional(),
});

// POST /sets/aliases — add a new alias
setsRouter.post('/aliases', async (req, res, next) => {
  try {
    const data = aliasSchema.parse(req.body);
    const row = await db
      .insertInto('pokemon_set_aliases')
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();
    res.status(201).json(row);
  } catch (err) { next(err); }
});

// PUT /sets/aliases/:id — update an existing alias
setsRouter.put('/aliases/:id', async (req, res, next) => {
  try {
    const data = aliasSchema.parse(req.body);
    const row = await db
      .updateTable('pokemon_set_aliases')
      .set(data)
      .where('id', '=', req.params.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    res.json(row);
  } catch (err) { next(err); }
});

// DELETE /sets/aliases/:id
setsRouter.delete('/aliases/:id', async (req, res, next) => {
  try {
    await db
      .deleteFrom('pokemon_set_aliases')
      .where('id', '=', req.params.id)
      .execute();
    res.status(204).end();
  } catch (err) { next(err); }
});
