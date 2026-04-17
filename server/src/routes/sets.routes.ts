import { Router } from 'express';
import { db } from '../config/database';
import { z } from 'zod';
import { EN_SETS, JP_SETS } from '../utils/set-codes';

export const setsRouter = Router();

// GET /sets/codes — return all static set definitions (EN + JP)
setsRouter.get('/codes', (_req, res) => {
  const en = EN_SETS.map(s => ({ game: 'pokemon', language: 'EN', set_code: s.code, names: s.names }));
  const jp = JP_SETS.map(s => ({ game: 'pokemon', language: 'JP', set_code: s.code, names: s.names }));
  res.json([...en, ...jp]);
});

// GET /sets/aliases — list aliases for this org
setsRouter.get('/aliases', async (req, res, next) => {
  try {
    const rows = await db
      .selectFrom('pokemon_set_aliases')
      .selectAll()
      .where('user_id', '=', req.dataUserId)
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

// POST /sets/aliases — add a new alias for this org
setsRouter.post('/aliases', async (req, res, next) => {
  try {
    const data = aliasSchema.parse(req.body);
    const row = await db
      .insertInto('pokemon_set_aliases')
      .values({ ...data, user_id: req.dataUserId })
      .returningAll()
      .executeTakeFirstOrThrow();
    res.status(201).json(row);
  } catch (err) { next(err); }
});

// PUT /sets/aliases/:id — update an existing alias (must belong to this org)
setsRouter.put('/aliases/:id', async (req, res, next) => {
  try {
    const data = aliasSchema.parse(req.body);
    const row = await db
      .updateTable('pokemon_set_aliases')
      .set(data)
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.dataUserId)
      .returningAll()
      .executeTakeFirstOrThrow();
    res.json(row);
  } catch (err) { next(err); }
});

// DELETE /sets/aliases/:id (must belong to this org)
setsRouter.delete('/aliases/:id', async (req, res, next) => {
  try {
    await db
      .deleteFrom('pokemon_set_aliases')
      .where('id', '=', req.params.id)
      .where('user_id', '=', req.dataUserId)
      .execute();
    res.status(204).end();
  } catch (err) { next(err); }
});

// GET /sets/games — all registered games (registry + distinct from catalog)
setsRouter.get('/games', async (_req, res, next) => {
  try {
    const [registry, catalog] = await Promise.all([
      db.selectFrom('card_games').selectAll().orderBy('name').execute(),
      db.selectFrom('card_catalog').select('game').distinct().execute(),
    ]);
    const registryNames = new Set(registry.map(r => r.name.toLowerCase()));
    // merge any catalog games not already in registry
    const extra = catalog
      .map(r => r.game.toLowerCase())
      .filter(g => !registryNames.has(g))
      .map(name => ({ id: null, name, created_at: null }));
    res.json([...registry, ...extra]);
  } catch (err) { next(err); }
});

// POST /sets/games — register a new game
setsRouter.post('/games', async (req, res, next) => {
  try {
    const { name } = z.object({ name: z.string().min(1).max(100).transform(s => s.toLowerCase().trim()) }).parse(req.body);
    const row = await db
      .insertInto('card_games')
      .values({ name })
      .onConflict(oc => oc.constraint('card_games_name_unique').doUpdateSet({ name }))
      .returningAll()
      .executeTakeFirstOrThrow();
    res.status(201).json(row);
  } catch (err) { next(err); }
});

// DELETE /sets/games/:id
setsRouter.delete('/games/:id', async (req, res, next) => {
  try {
    await db.deleteFrom('card_games').where('id', '=', req.params.id).execute();
    res.status(204).end();
  } catch (err) { next(err); }
});
