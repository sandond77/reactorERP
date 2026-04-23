import { Router } from 'express';
import { db } from '../config/database';
import { z } from 'zod';
import { EN_SETS, JP_SETS } from '../utils/set-codes';
import { requireAuth } from '../middleware/auth';

export const setsRouter = Router();

setsRouter.use(requireAuth);

function deriveEra(code: string, language: 'EN' | 'JP'): string {
  const c = code.toUpperCase();
  if (language === 'EN') {
    if (/^(BS2?|JU|FO|TR|G[12]|N[1-4]|LC|PROMO-WOTC)$/.test(c)) return 'WOTC';
    if (/^(EXP|AQ|SK)$/.test(c)) return 'e-Card';
    if (/^EX/.test(c)) return 'EX';
    if (/^DP/.test(c)) return 'Diamond & Pearl';
    if (/^PL/.test(c)) return 'Platinum';
    if (/^(HS|HGSS|PROMO-HGSS)/.test(c)) return 'HeartGold & SoulSilver';
    if (/^BW/.test(c) || c === 'PROMO-BW') return 'Black & White';
    if (/^(KSS|XY)/.test(c) || c === 'PROMO-XY') return 'XY';
    if (/^SM/.test(c) || c === 'SM-P') return 'Sun & Moon';
    if (/^SWSH/.test(c) || c === 'SWSH-P') return 'Sword & Shield';
    if (/^SV/.test(c)) return 'Scarlet & Violet';
    return 'Other';
  } else {
    if (/^(BS|JU|FO|TR|GY|N[1-4]|NEO|VS|WEB|VEND|CDPROMO|PROMO-P)$/.test(c)) return 'WOTC / Vintage';
    if (/^E[1-5]$/.test(c)) return 'e-Card';
    if (/^ADV/.test(c)) return 'ADV';
    if (/^PCG/.test(c)) return 'PCG (EX Era)';
    if (/^(DP|DPt)/.test(c)) return 'Diamond & Pearl';
    if (/^PL/.test(c)) return 'Platinum';
    if (/^(L[1-4]|HGSS)/.test(c)) return 'HeartGold & SoulSilver';
    if (/^BW/.test(c)) return 'Black & White';
    if (/^XY/.test(c)) return 'XY';
    if (/^SM/.test(c)) return 'Sun & Moon';
    if (/^S\d/.test(c) || c === 'S-P') return 'Sword & Shield';
    if (/^SV/.test(c)) return 'Scarlet & Violet';
    if (/^M/.test(c)) return 'Mega Evolution';
    if (/^(CLF|CLK|CLL|SVG)$/i.test(c)) return 'Classic Collection';
    return 'Other';
  }
}

// GET /sets/codes — return all static set definitions (EN + JP)
setsRouter.get('/codes', (_req, res) => {
  const en = EN_SETS.map(s => ({ game: 'pokemon', language: 'EN', set_code: s.code, names: s.names, era: deriveEra(s.code, 'EN') }));
  const jp = JP_SETS.map(s => ({ game: 'pokemon', language: 'JP', set_code: s.code, names: s.names, era: deriveEra(s.code, 'JP') }));
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
  language: z.string().min(1).max(10).transform(s => s.toUpperCase().trim()),
  game: z.string().min(1).max(100).transform(s => s.toLowerCase().trim()).default('pokemon'),
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

// GET /sets/languages — all languages (built-in EN/JP + user-registered)
setsRouter.get('/languages', async (req, res, next) => {
  try {
    const custom = await db
      .selectFrom('card_languages' as any)
      .selectAll()
      .where('user_id' as any, '=', req.dataUserId)
      .orderBy('code' as any)
      .execute() as { id: string; code: string; name: string }[];
    const builtIn = [
      { id: null, code: 'EN', name: 'English' },
      { id: null, code: 'JP', name: 'Japanese' },
    ];
    const customCodes = new Set(custom.map(l => l.code));
    const merged = [...builtIn.filter(l => !customCodes.has(l.code)), ...custom]
      .sort((a, b) => a.code.localeCompare(b.code));
    res.json(merged);
  } catch (err) { next(err); }
});

// POST /sets/languages — register a new language
setsRouter.post('/languages', async (req, res, next) => {
  try {
    const { code, name } = z.object({
      code: z.string().min(1).max(10).transform(s => s.toUpperCase().trim()),
      name: z.string().min(1).max(100).trim(),
    }).parse(req.body);
    const row = await db
      .insertInto('card_languages' as any)
      .values({ user_id: req.dataUserId, code, name } as any)
      .onConflict((oc: any) => oc.columns(['user_id', 'code']).doUpdateSet({ name } as any))
      .returningAll()
      .executeTakeFirstOrThrow();
    res.status(201).json(row);
  } catch (err) { next(err); }
});

// GET /sets/games — all registered games (registry + distinct from catalog) with card_count
setsRouter.get('/games', async (req, res, next) => {
  try {
    const [registry, catalog, counts] = await Promise.all([
      db.selectFrom('card_games').selectAll().orderBy('name').execute(),
      db.selectFrom('card_catalog').select('game').distinct().execute(),
      db.selectFrom('card_instances')
        .select(['card_game', db.fn.count<string>('id').as('cnt')])
        .where('user_id', '=', req.dataUserId)
        .groupBy('card_game')
        .execute(),
    ]);
    const countMap = new Map(counts.map(r => [r.card_game.toLowerCase(), Number(r.cnt)]));
    const registryNames = new Set(registry.map(r => r.name.toLowerCase()));
    const extra = catalog
      .map(r => r.game.toLowerCase())
      .filter(g => !registryNames.has(g))
      .map(name => ({ id: null, name, abbreviation: null, languages: [] as string[], created_at: null }));
    const all = [...registry, ...extra];
    res.json(all.map(g => ({ ...g, card_count: countMap.get(g.name.toLowerCase()) ?? 0 })));
  } catch (err) { next(err); }
});

const gameSchema = z.object({
  name: z.string().min(1).max(100).transform(s => s.toLowerCase().trim()),
  abbreviation: z.string().max(20).optional().nullable(),
  languages: z.array(z.string().min(1).max(20)).optional(),
});

// POST /sets/games — register a new game
setsRouter.post('/games', async (req, res, next) => {
  try {
    const { name, abbreviation, languages } = gameSchema.parse(req.body);
    const row = await db
      .insertInto('card_games')
      .values({ name, abbreviation: abbreviation ?? null, languages: (languages ?? []) as any })
      .onConflict(oc => oc.constraint('card_games_name_unique').doUpdateSet({ name }))
      .returningAll()
      .executeTakeFirstOrThrow();
    res.status(201).json(row);
  } catch (err) { next(err); }
});

// PUT /sets/games/:id — update a game (cascades name change to related tables)
setsRouter.put('/games/:id', async (req, res, next) => {
  try {
    const { name, abbreviation, languages } = gameSchema.parse(req.body);
    const existing = await db
      .selectFrom('card_games')
      .select('name')
      .where('id', '=', req.params.id)
      .executeTakeFirst();
    const row = await db
      .updateTable('card_games')
      .set({ name, abbreviation: abbreviation ?? null, languages: (languages ?? []) as any })
      .where('id', '=', req.params.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    if (existing && existing.name !== name) {
      await Promise.all([
        db.updateTable('card_instances').set({ card_game: name }).where('card_game', '=', existing.name).execute(),
        db.updateTable('card_catalog').set({ game: name }).where('game', '=', existing.name).execute(),
        db.updateTable('pokemon_set_aliases').set({ game: name }).where('game', '=', existing.name).execute(),
      ]);
    }
    res.json(row);
  } catch (err) { next(err); }
});

// DELETE /sets/games/:id
setsRouter.delete('/games/:id', async (req, res, next) => {
  try {
    await db.deleteFrom('card_games').where('id', '=', req.params.id).execute();
    res.status(204).end();
  } catch (err) { next(err); }
});
