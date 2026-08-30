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

// ── Variant codes ────────────────────────────────────────────────────────────
// The 5th SKU segment (OP-EN-17-110-ALT) is driven by a fixed enum, per game.
// Codes are global (no user_id) so all users share the same vocabulary — the
// whole point of the enum is to prevent ALT/ALTART/AA drift.
//
// Any authenticated user can add a new code for any game via POST; the input
// is normalized (uppercased, alnum only, ≤6 chars) and duplicates 409. There's
// intentionally no DELETE endpoint here — removing a code that's in use would
// leave orphan variant values on card_catalog rows. If a bad code is added,
// leave it (users just stop selecting it).

cardGamesRouter.get('/:game/variants', async (req, res, next) => {
  try {
    const game = String(req.params.game ?? '').toLowerCase().trim();
    if (!game) return res.status(400).json({ error: 'game required' });
    const rows = await db
      .selectFrom('card_game_variants')
      .select(['code', 'name', 'description', 'sort_order'])
      .where('game', '=', game)
      .orderBy('sort_order', 'asc')
      .orderBy('code', 'asc')
      .execute();
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

const variantSchema = z.object({
  code: z.string().min(1).max(6).transform(s => s.toUpperCase().trim().replace(/[^A-Z0-9]/g, '')),
  name: z.string().min(1).max(80).transform(s => s.trim()),
  description: z.string().max(500).optional().transform(s => s?.trim() || undefined),
});

cardGamesRouter.post('/:game/variants', async (req, res, next) => {
  try {
    const game = String(req.params.game ?? '').toLowerCase().trim();
    if (!game) return res.status(400).json({ error: 'game required' });
    const parsed = variantSchema.parse(req.body);
    if (parsed.code.length === 0) {
      return res.status(400).json({ error: 'code must contain at least one A-Z or 0-9 character' });
    }
    const nextSort = await db
      .selectFrom('card_game_variants')
      .select(({ fn }) => fn.max<number>('sort_order').as('max'))
      .where('game', '=', game)
      .executeTakeFirst();
    const sortOrder = (nextSort?.max ?? 0) + 10;
    const row = await db
      .insertInto('card_game_variants')
      .values({
        game,
        code: parsed.code,
        name: parsed.name,
        description: parsed.description ?? null,
        sort_order: sortOrder,
      })
      .returning(['code', 'name', 'description', 'sort_order'])
      .executeTakeFirstOrThrow();
    res.status(201).json({ data: row });
  } catch (err: any) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'That variant code already exists for this game.' });
    }
    next(err);
  }
});
