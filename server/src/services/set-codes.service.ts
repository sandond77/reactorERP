import { db } from '../config/database';
import { sql } from 'kysely';
import { EN_SETS, JP_SETS } from '../utils/set-codes';

// ── Helpers ───────────────────────────────────────────────────────────────────

function deriveEra(code: string, lang: 'EN' | 'JP'): string {
  if (lang === 'EN') {
    if (/^(BS|JU|FO|TR|GY|G1|G2|N1|N2|N3|N4|NEO)/.test(code)) return 'Vintage';
    if (/^(LC|EX|RS|SS|HL|MA|HP|CG|DF|PK|DR|UF|EM|TR2)/.test(code)) return 'EX';
    if (/^DP/.test(code)) return 'Diamond & Pearl';
    if (/^PL/.test(code)) return 'Platinum';
    if (/^HGSS|^HS/.test(code)) return 'HGSS';
    if (/^BW/.test(code)) return 'Black & White';
    if (/^XY/.test(code)) return 'XY';
    if (/^SM/.test(code)) return 'Sun & Moon';
    if (/^SWSH/.test(code)) return 'Sword & Shield';
    if (/^SV/.test(code)) return 'Scarlet & Violet';
    if (/^M\d|^Mb/i.test(code)) return 'Mega Evolution Era';
    return 'Other';
  }
  // JP
  if (/^(BS|JU|FO|TR|GY|N1|N2|N3|N4|NEO)/.test(code)) return 'Vintage';
  if (/^(E\d|VS|WEB|VEND|CDPROMO)/.test(code)) return 'e-Card / Misc Vintage';
  if (/^(ADV)/.test(code)) return 'ADV';
  if (/^(PCG)/.test(code)) return 'PCG (EX)';
  if (/^(DP)/.test(code)) return 'Diamond & Pearl';
  if (/^(DPt)/.test(code)) return 'Platinum';
  if (/^(L\d|HGSS)/.test(code)) return 'HGSS';
  if (/^(BW)/.test(code)) return 'Black & White';
  if (/^(XY)/.test(code)) return 'XY';
  if (/^(SM|S0)/.test(code)) return 'Sun & Moon';
  if (/^(S\d|S-P)/.test(code)) return 'Sword & Shield';
  if (/^M\d|^Mb/i.test(code)) return 'Mega Series Era';
  if (/^(SV|Cl|Sv)/i.test(code)) return 'Scarlet & Violet';
  return 'Other';
}

// ── Seeding ───────────────────────────────────────────────────────────────────

/** Seed this user's set_codes from the static arrays if they have no rows yet. */
async function seedIfNeeded(userId: string): Promise<void> {
  const existing = await db
    .selectFrom('set_codes')
    .select(({ fn }) => [fn.count<number>('id').as('n')])
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if ((existing?.n ?? 0) > 0) return;

  const rows: Array<{
    user_id: string; game: string; language: string; set_code: string;
    set_name: string; era: string | null; aliases: string[]; is_seeded: boolean;
  }> = [];

  for (const e of EN_SETS) {
    rows.push({
      user_id: userId, game: 'pokemon', language: 'EN', set_code: e.code,
      set_name: e.names[0] ?? e.code,
      era: deriveEra(e.code, 'EN'),
      aliases: e.names.slice(1),
      is_seeded: true,
    });
  }
  for (const e of JP_SETS) {
    rows.push({
      user_id: userId, game: 'pokemon', language: 'JP', set_code: e.code,
      set_name: e.names[0] ?? e.code,
      era: deriveEra(e.code, 'JP'),
      aliases: e.names.slice(1),
      is_seeded: true,
    });
  }

  if (rows.length === 0) return;
  await db.insertInto('set_codes').values(rows as any).onConflict((c) => c.doNothing()).execute();
}

// ── In-memory cache (per-user) ────────────────────────────────────────────────

interface CachedEntry {
  id: string;
  set_code: string;
  set_name: string;
  era: string | null;
  aliases: string[];
  language: string;
  is_seeded: boolean;
}

type LangIndex = { byAlias: Map<string, string>; entries: CachedEntry[] };
const cache = new Map<string, { en: LangIndex; jp: LangIndex }>();

async function loadCache(userId: string) {
  await seedIfNeeded(userId);
  const rows = await db.selectFrom('set_codes').selectAll().where('user_id', '=', userId).execute();
  const en: LangIndex = { byAlias: new Map(), entries: [] };
  const jp: LangIndex = { byAlias: new Map(), entries: [] };
  for (const r of rows) {
    const target = r.language === 'JP' ? jp : en;
    const entry: CachedEntry = {
      id: r.id, set_code: r.set_code, set_name: r.set_name, era: r.era,
      aliases: r.aliases as unknown as string[], language: r.language, is_seeded: r.is_seeded,
    };
    target.entries.push(entry);
    target.byAlias.set(entry.set_name.toLowerCase(), entry.set_code);
    target.byAlias.set(entry.set_code.toLowerCase(), entry.set_code);
    for (const alias of entry.aliases) target.byAlias.set(alias.toLowerCase(), entry.set_code);
  }
  cache.set(userId, { en, jp });
  return { en, jp };
}

async function getCache(userId: string) {
  return cache.get(userId) ?? await loadCache(userId);
}

function invalidate(userId: string) {
  cache.delete(userId);
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function listSetCodesForUser(userId: string) {
  const { en, jp } = await getCache(userId);
  return {
    en: en.entries.sort((a, b) => a.set_code.localeCompare(b.set_code)),
    jp: jp.entries.sort((a, b) => a.set_code.localeCompare(b.set_code)),
  };
}

/** Async lookup that uses the per-user cache. Falls back to substring matching. */
export async function lookupSetCodeForUser(userId: string, language: 'EN' | 'JP', text: string): Promise<string | null> {
  const { en, jp } = await getCache(userId);
  const idx = language === 'JP' ? jp : en;
  const norm = text.toLowerCase().trim();
  if (idx.byAlias.has(norm)) return idx.byAlias.get(norm)!;
  // Longest substring match — same heuristic as the static lookupSetCode
  let best: { code: string; len: number } | null = null;
  for (const [alias, code] of idx.byAlias) {
    if (alias && norm.includes(alias) && (!best || alias.length > best.len)) {
      best = { code, len: alias.length };
    }
  }
  return best?.code ?? null;
}

export interface UpdateSetCodeInput {
  set_name?: string;
  set_code?: string;
  era?: string | null;
  aliases?: string[];
}

export async function updateSetCodeForUser(userId: string, id: string, input: UpdateSetCodeInput) {
  const update: Record<string, unknown> = {};
  if (input.set_name !== undefined) update.set_name = input.set_name;
  if (input.set_code !== undefined) update.set_code = input.set_code;
  if (input.era      !== undefined) update.era = input.era;
  if (input.aliases  !== undefined) update.aliases = input.aliases;
  if (Object.keys(update).length === 0) return null;
  update.updated_at = new Date();

  const updated = await db.updateTable('set_codes')
    .set(update)
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .returningAll()
    .executeTakeFirst();
  invalidate(userId);
  return updated ?? null;
}

export async function createSetCodeForUser(userId: string, input: {
  language: string;
  set_code: string;
  set_name: string;
  era?: string | null;
  aliases?: string[];
}) {
  const row = await db.insertInto('set_codes').values({
    user_id: userId,
    game: 'pokemon',
    language: input.language,
    set_code: input.set_code,
    set_name: input.set_name,
    era: input.era ?? null,
    aliases: (input.aliases ?? []) as any,
    is_seeded: false,
  }).returningAll().executeTakeFirstOrThrow();
  invalidate(userId);
  return row;
}

export async function deleteSetCodeForUser(userId: string, id: string) {
  // Allow deleting either user-defined or seeded entries (some seeded data is
  // wrong — e.g. JP BW10 doesn't exist). Reseed via the static arrays only fires
  // when a user has zero rows, so deletes won't be silently restored.
  await db.deleteFrom('set_codes')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .execute();
  invalidate(userId);
}

/** Reset a seeded entry back to its original name + aliases from the static array. */
export async function resetSetCodeForUser(userId: string, id: string) {
  const row = await db.selectFrom('set_codes').selectAll()
    .where('id', '=', id).where('user_id', '=', userId).where('is_seeded', '=', true).executeTakeFirst();
  if (!row) return null;
  const sourceArr = row.language === 'JP' ? JP_SETS : EN_SETS;
  const seed = sourceArr.find(s => s.code === row.set_code);
  if (!seed) return null;
  const updated = await db.updateTable('set_codes')
    .set({
      set_name: seed.names[0] ?? row.set_code,
      aliases: seed.names.slice(1) as any,
      era: deriveEra(row.set_code, row.language === 'JP' ? 'JP' : 'EN'),
      updated_at: new Date(),
    })
    .where('id', '=', id).where('user_id', '=', userId)
    .returningAll().executeTakeFirst();
  invalidate(userId);
  return updated ?? null;
}
