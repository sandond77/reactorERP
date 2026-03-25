import axios from 'axios';
import { sql } from 'kysely';
import { db } from '../config/database';
import { lookupSetCode, generatePartNumber } from '../utils/set-codes';

// ── Rarity code map ──────────────────────────────────────────────────────────
// Maps TCGdex rarity strings AND PSA label rarity terms → SKU abbreviation
export const RARITY_CODE: Record<string, string> = {
  // Core
  'Common': 'C',
  'Uncommon': 'U',
  'Rare': 'R',
  // Holo
  'Rare Holo': 'H',
  'Holo Rare': 'H',
  // V/VMAX/VSTAR era (SWSH)
  'Holo Rare V': 'V',
  'Holo Rare VMAX': 'VMAX',
  'Holo Rare VSTAR': 'VSTAR',
  'Double rare': 'DR',
  // Ultra / Full Art
  'Ultra Rare': 'UR',
  'Full Art Trainer': 'FA',
  // Illustration Rares (SV era EN)
  'Illustration rare': 'IR',
  'Special illustration rare': 'SIR',
  // Hyper Rare (rainbow equivalent in SV)
  'Hyper rare': 'HR',
  // ACE SPEC
  'ACE SPEC Rare': 'ACE',
  // Secret Rare
  'Secret Rare': 'SR',
  // Radiant (SWSH)
  'Radiant Rare': 'RAD',
  // Shiny (SWSH shiny vault)
  'Shiny rare': 'SHR',
  'Shiny rare V': 'SHRV',
  'Shiny rare VMAX': 'SHRVMAX',
  'Shiny Ultra Rare': 'SHUR',
  // LEGEND (HGSS era)
  'LEGEND': 'LG',
  // LV.X (DP era)
  'Rare Holo LV.X': 'LVX',
  // PRIME (HGSS)
  'Rare PRIME': 'PRIME',
  // Amazing Rare (SWSH)
  'Amazing Rare': 'AMZ',
  // Classic Collection (SV151)
  'Classic Collection': 'CC',
  // Crown (e-Card era)
  'Crown': 'CR',
  // Black & White
  'Black White Rare': 'BWR',
  // Mega Hyper Rare
  'Mega Hyper Rare': 'MHR',
  // Japanese diamond/star/shiny system
  'One Diamond': '1D',
  'Two Diamond': '2D',
  'Three Diamond': '3D',
  'Four Diamond': '4D',
  'One Star': '1S',
  'Two Star': '2S',
  'Three Star': '3S',
  'One Shiny': '1SHN',
  'Two Shiny': '2SHN',
  // PSA Japanese rarity terms (not in TCGdex)
  'Art Rare': 'AR',
  'Special Art Rare': 'SAR',
  'Super Art Rare': 'SAR',
};

// ── Variant code map ─────────────────────────────────────────────────────────
export const VARIANT_CODE: Record<string, string> = {
  'First Edition': '1ED',
  '1st Edition': '1ED',
  'first edition': '1ED',
  'Shadowless': 'SH',
  'shadowless': 'SH',
  'Reverse Holo': 'RH',
  'reverse holo': 'RH',
  '1999-2000 Copyright': 'CP',
  '1999-2000-copyright': 'CP',
  'Promo': 'P',
  'promo': 'P',
};

// ── SKU generation ───────────────────────────────────────────────────────────

export function generateSku(params: {
  language: string;
  setCode: string;
  cardNumber: string;
  rarity?: string | null;
  variant?: string | null;
}): string {
  const lang = params.language.toUpperCase() === 'JPN' ? 'JP' : params.language.toUpperCase() as 'EN' | 'JP';
  return generatePartNumber(lang, params.setCode, params.cardNumber);
}

// ── TCGdex API types ─────────────────────────────────────────────────────────

interface TCGdexSet {
  id: string;
  name: string;
  cardCount: { total: number; official: number };
}

interface TCGdexCardBrief {
  id: string;
  localId: string;
  name: string;
  image?: string;
}

interface TCGdexCardDetail extends TCGdexCardBrief {
  rarity?: string | null;
  set: { id: string; name: string };
  variants?: {
    firstEdition?: boolean;
    holo?: boolean;
    normal?: boolean;
    reverse?: boolean;
  };
}

const TCGDEX_BASE = 'https://api.tcgdex.net/v2';

async function fetchWithRetry<T>(url: string, params?: Record<string, string>): Promise<T | null> {
  try {
    const res = await axios.get<T>(url, { params, timeout: 8000 });
    return res.data;
  } catch {
    return null;
  }
}

// ── Catalog sync ─────────────────────────────────────────────────────────────

export async function listTCGdexSets(lang: 'en' | 'ja'): Promise<TCGdexSet[]> {
  const data = await fetchWithRetry<TCGdexSet[]>(`${TCGDEX_BASE}/${lang}/sets`);
  return data ?? [];
}

export async function fetchSetCards(setId: string, lang: 'en' | 'ja'): Promise<TCGdexCardBrief[]> {
  const data = await fetchWithRetry<TCGdexCardBrief[]>(`${TCGDEX_BASE}/${lang}/cards`, { set: setId });
  return Array.isArray(data) ? data : [];
}

export async function fetchCardDetail(cardId: string, lang: 'en' | 'ja'): Promise<TCGdexCardDetail | null> {
  return fetchWithRetry<TCGdexCardDetail>(`${TCGDEX_BASE}/${lang}/cards/${cardId}`);
}

// Upsert a single card into card_catalog. Returns the catalog id.
export async function upsertCatalogCard(params: {
  externalId: string;     // TCGdex card ID e.g. 'base1-4' or 'SV1a-080'
  setCode: string;
  setName: string;
  cardNumber: string;     // localId
  cardName: string;
  language: 'EN' | 'JP';
  rarity?: string | null;
  imageUrl?: string | null;
}): Promise<string> {
  const sku = generateSku({
    language: params.language,
    setCode: params.setCode,
    cardNumber: params.cardNumber,
    rarity: params.rarity,
  });

  const result = await sql<{ id: string }>`
    INSERT INTO card_catalog (
      game, set_name, set_code, card_name, card_number,
      language, rarity, image_url, external_id, sku
    ) VALUES (
      'pokemon',
      ${params.setName},
      ${params.setCode},
      ${params.cardName},
      ${params.cardNumber},
      ${params.language},
      ${params.rarity ?? null},
      ${params.imageUrl ?? null},
      ${params.externalId},
      ${sku}
    )
    ON CONFLICT (external_id) WHERE external_id IS NOT NULL
    DO UPDATE SET
      card_name  = EXCLUDED.card_name,
      set_name   = EXCLUDED.set_name,
      rarity     = COALESCE(EXCLUDED.rarity, card_catalog.rarity),
      image_url  = COALESCE(EXCLUDED.image_url, card_catalog.image_url),
      sku        = CASE
        WHEN EXCLUDED.rarity IS NOT NULL THEN EXCLUDED.sku
        ELSE card_catalog.sku
      END,
      updated_at = NOW()
    RETURNING id
  `.execute(db);

  return result.rows[0].id;
}

// Find a catalog entry by (setCode, cardNumber, language). Returns id or null.
export async function findCatalogByKey(
  setCode: string,
  cardNumber: string,
  language: 'EN' | 'JP'
): Promise<{ id: string; sku: string | null; rarity: string | null } | null> {
  // Normalize card number
  const rawNum = cardNumber.split('/')[0].trim();
  const paddedNum = rawNum.replace(/[^0-9]/g, '').padStart(3, '0') || rawNum;

  const rows = await sql<{ id: string; sku: string | null; rarity: string | null }>`
    SELECT id, sku, rarity
    FROM card_catalog
    WHERE game = 'pokemon'
      AND language = ${language}
      AND LOWER(set_code) = LOWER(${setCode})
      AND (card_number = ${paddedNum} OR card_number = ${rawNum})
    LIMIT 1
  `.execute(db);

  return rows.rows[0] ?? null;
}

// Find or fetch from TCGdex — used during matching when catalog entry may not exist yet.
// Falls back to creating a catalog entry from parsed data if TCGdex doesn't have the card.
export async function findOrFetchCard(params: {
  setCode: string;
  cardNumber: string;
  cardName: string;
  setName?: string | null;
  language: 'EN' | 'JP';
  rarity?: string | null;
}): Promise<string | null> {
  const rawNum = params.cardNumber.split('/')[0].trim();
  const paddedNum = rawNum.replace(/[^0-9]/g, '').padStart(3, '0') || rawNum;
  const lang = params.language === 'JP' ? 'ja' : 'en';

  // 1. Check catalog first (handles multiple set code casings)
  const existing = await findCatalogByKey(params.setCode, params.cardNumber, params.language);
  if (existing) {
    if (params.rarity && !existing.rarity) {
      const newSku = generateSku({
        language: params.language,
        setCode: params.setCode,
        cardNumber: params.cardNumber,
        rarity: params.rarity,
      });
      await sql`
        UPDATE card_catalog
        SET rarity = ${params.rarity}, sku = ${newSku}, updated_at = NOW()
        WHERE id = ${existing.id}
      `.execute(db);
    }
    return existing.id;
  }

  // 2. Try TCGdex with a few set code variations
  const setCodeVariants = [
    params.setCode,
    params.setCode.toLowerCase(),
    params.setCode.toUpperCase(),
    params.setCode.replace(/-/g, ''),
    params.setCode.replace(/-/g, '').toLowerCase(),
  ].filter((v, i, a) => a.indexOf(v) === i);

  let detail: Awaited<ReturnType<typeof fetchCardDetail>> = null;
  let matchedSetCode = params.setCode;

  for (const sc of setCodeVariants) {
    const cardId = `${sc}-${paddedNum}`;
    detail = await fetchCardDetail(cardId, lang);
    if (detail?.id) {
      matchedSetCode = sc;
      break;
    }
  }

  const rarity = params.rarity ?? detail?.rarity ?? null;
  const setName = params.setName ?? detail?.set?.name ?? params.setCode;
  const cardName = detail?.name ?? params.cardName;
  const externalId = detail?.id ?? null;

  // 3. Upsert catalog entry — even without a TCGdex match we create from parsed data
  const sku = generateSku({
    language: params.language,
    setCode: matchedSetCode,
    cardNumber: detail?.localId ?? paddedNum,
    rarity,
  });

  const result = await sql<{ id: string }>`
    INSERT INTO card_catalog (
      game, set_name, set_code, card_name, card_number,
      language, rarity, image_url, external_id, sku
    ) VALUES (
      'pokemon',
      ${setName},
      ${matchedSetCode},
      ${cardName},
      ${detail?.localId ?? paddedNum},
      ${params.language},
      ${rarity},
      ${detail?.image ?? null},
      ${externalId},
      ${sku}
    )
    ON CONFLICT (external_id) WHERE external_id IS NOT NULL
    DO UPDATE SET
      card_name  = EXCLUDED.card_name,
      set_name   = EXCLUDED.set_name,
      rarity     = COALESCE(EXCLUDED.rarity, card_catalog.rarity),
      image_url  = COALESCE(EXCLUDED.image_url, card_catalog.image_url),
      sku        = CASE WHEN EXCLUDED.rarity IS NOT NULL THEN EXCLUDED.sku ELSE card_catalog.sku END,
      updated_at = NOW()
    RETURNING id
  `.execute(db);

  return result.rows[0]?.id ?? null;
}

/**
 * Find or create a card_catalog entry using our internal set code map.
 * No external API — purely from parsed data.
 */
export async function findOrCreateCatalogCard(params: {
  setCodePart: string;   // e.g. 'SWSH9', 'SPEC-S8a', 'P', 'PROMO-SV'
  cardNumber: string;
  cardName: string;
  setName: string;
  language: 'EN' | 'JP';
  rarity?: string | null;
  variant?: string | null;
}): Promise<string | null> {
  const rawNum = params.cardNumber.split('/')[0].trim();
  const paddedNum = rawNum.replace(/[^0-9]/g, '').padStart(3, '0') || rawNum;
  const sku = generatePartNumber(params.language, params.setCodePart, paddedNum);

  // 1. Try to find by SKU (most precise match)
  const bySkuRows = await sql<{ id: string }>`
    SELECT id FROM card_catalog WHERE sku = ${sku} LIMIT 1
  `.execute(db);
  if (bySkuRows.rows.length) return bySkuRows.rows[0].id;

  // 2. Try to find by (setCode, cardNumber, language)
  const byKeyRows = await sql<{ id: string }>`
    SELECT id FROM card_catalog
    WHERE game = 'pokemon'
      AND language = ${params.language}
      AND LOWER(set_code) = LOWER(${params.setCodePart})
      AND (card_number = ${paddedNum} OR card_number = ${rawNum})
    LIMIT 1
  `.execute(db);
  if (byKeyRows.rows.length) return byKeyRows.rows[0].id;

  // 3. Create new entry
  try {
    const inserted = await sql<{ id: string }>`
      INSERT INTO card_catalog (
        game, set_name, set_code, card_name, card_number,
        language, rarity, variant, sku
      ) VALUES (
        'pokemon',
        ${params.setName},
        ${params.setCodePart},
        ${params.cardName},
        ${paddedNum},
        ${params.language},
        ${params.rarity ?? null},
        ${params.variant ?? null},
        ${sku}
      )
      ON CONFLICT (sku) WHERE sku IS NOT NULL
      DO UPDATE SET
        card_name  = EXCLUDED.card_name,
        set_name   = EXCLUDED.set_name,
        rarity     = COALESCE(EXCLUDED.rarity, card_catalog.rarity),
        updated_at = NOW()
      RETURNING id
    `.execute(db);
    return inserted.rows[0].id;
  } catch {
    return null;
  }
}

// ── Inventory summary ────────────────────────────────────────────────────────

export async function getInventorySummary(userId: string) {
  const rows = await sql<{
    sku: string | null;
    card_name: string | null;
    set_name: string | null;
    set_code: string | null;
    card_number: string | null;
    rarity: string | null;
    variant: string | null;
    language: string;
    company: string;
    grade: number | null;
    grade_label: string | null;
    qty_total: number;
    qty_unsold: number;
    qty_sold: number;
    total_cost: number;
    avg_cost: number;
    qty_listed: number;
    catalog_id: string | null;
  }>`
    SELECT
      cc.sku,
      COALESCE(ci.card_name_override, cc.card_name)   AS card_name,
      COALESCE(cc.set_name,  ci.set_name_override)    AS set_name,
      cc.set_code,
      COALESCE(cc.card_number, ci.card_number_override) AS card_number,
      cc.rarity,
      cc.variant,
      COALESCE(cc.language, ci.language)              AS language,
      sd.company,
      sd.grade,
      sd.grade_label,
      COUNT(*)::int                                                  AS qty_total,
      COUNT(*) FILTER (WHERE ci.status != 'sold')::int               AS qty_unsold,
      COUNT(*) FILTER (WHERE ci.status = 'sold')::int                AS qty_sold,
      SUM(ci.purchase_cost + sd.grading_cost)::int AS total_cost,
      AVG(ci.purchase_cost + sd.grading_cost)::int AS avg_cost,
      COUNT(*) FILTER (WHERE l.id IS NOT NULL)::int   AS qty_listed,
      ci.catalog_id
    FROM card_instances ci
    INNER JOIN slab_details sd ON sd.card_instance_id = ci.id
    LEFT JOIN card_catalog cc ON cc.id = ci.catalog_id
    LEFT JOIN LATERAL (
      SELECT id FROM listings
      WHERE card_instance_id = ci.id
        AND listing_status = 'active'
      ORDER BY created_at DESC LIMIT 1
    ) l ON true
    WHERE ci.user_id = ${userId}
      AND ci.deleted_at IS NULL
    GROUP BY
      cc.sku, cc.card_name, ci.card_name_override,
      cc.set_name, ci.set_name_override,
      cc.set_code, cc.card_number, ci.card_number_override,
      cc.rarity, cc.variant, cc.language, ci.language,
      sd.company, sd.grade, sd.grade_label,
      ci.catalog_id
    ORDER BY
      cc.sku NULLS LAST,
      card_name,
      sd.company,
      sd.grade DESC NULLS LAST
  `.execute(db);

  return rows.rows;
}

export async function createCatalogCard(params: {
  game: string;
  sku?: string | null;
  card_name: string;
  set_name: string;
  set_code?: string | null;
  card_number?: string | null;
  language: string;
  rarity?: string | null;
  variant?: string | null;
}): Promise<string> {
  const lang = params.language.toUpperCase() === 'JP' || params.language.toUpperCase() === 'JPN' ? 'JP' : 'EN';
  const autoSku = (!params.sku && params.set_code && params.card_number)
    ? generateSku({ language: lang, setCode: params.set_code, cardNumber: params.card_number })
    : null;

  const result = await db
    .insertInto('card_catalog')
    .values({
      game: params.game,
      sku: params.sku ?? autoSku ?? null,
      card_name: params.card_name,
      set_name: params.set_name,
      set_code: params.set_code ?? null,
      card_number: params.card_number ?? null,
      language: params.language,
      rarity: params.rarity ?? null,
      variant: params.variant ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return result.id;
}

export async function getEmptyCatalogEntries(userId: string) {
  const result = await sql<{
    id: string;
    game: string;
    sku: string | null;
    card_name: string;
    set_name: string;
    set_code: string | null;
    card_number: string | null;
    language: string;
    rarity: string | null;
    variant: string | null;
    created_at: string;
  }>`
    SELECT
      cc.id,
      cc.game,
      cc.sku,
      cc.card_name,
      cc.set_name,
      cc.set_code,
      cc.card_number,
      cc.language,
      cc.rarity,
      cc.variant,
      cc.created_at
    FROM card_catalog cc
    WHERE NOT EXISTS (
      SELECT 1 FROM card_instances ci
      WHERE ci.catalog_id = cc.id
        AND ci.user_id = ${userId}
        AND ci.deleted_at IS NULL
    )
    ORDER BY cc.sku NULLS LAST, cc.card_name
  `.execute(db);
  return result.rows;
}

export async function searchCatalog(params: {
  card_name?: string;
  set_name?: string;
  card_number?: string;
  language?: string;
  limit?: number;
}): Promise<Array<{ id: string; sku: string | null; card_name: string; set_name: string; card_number: string | null; language: string }>> {
  const { card_name, set_name, card_number, language, limit = 10 } = params;
  if (!card_name && !set_name && !card_number) return [];

  const rows = await sql<{ id: string; sku: string | null; card_name: string; set_name: string; card_number: string | null; language: string }>`
    SELECT id, sku, card_name, set_name, card_number, language
    FROM card_catalog
    WHERE game = 'pokemon'
      ${card_name ? sql`AND card_name ILIKE ${'%' + card_name + '%'}` : sql``}
      ${set_name  ? sql`AND set_name  ILIKE ${'%' + set_name  + '%'}` : sql``}
      ${card_number ? sql`AND card_number = ${card_number.split('/')[0].trim().replace(/^0+/, '').padStart(3, '0')}` : sql``}
      ${language  ? sql`AND language = ${language.toUpperCase()}` : sql``}
    ORDER BY card_name, set_name
    LIMIT ${limit}
  `.execute(db);

  return rows.rows;
}

export async function deleteCatalogCard(id: string) {
  // Unlink any card instances pointing to this catalog entry
  await sql`
    UPDATE card_instances SET catalog_id = NULL WHERE catalog_id = ${id}
  `.execute(db);
  await db.deleteFrom('card_catalog').where('id', '=', id).execute();
}

export async function updateCatalogCard(id: string, fields: {
  sku?: string;
  card_name?: string;
  set_name?: string;
  set_code?: string;
  card_number?: string;
  rarity?: string | null;
  variant?: string | null;
  language?: string;
}) {
  await db
    .updateTable('card_catalog')
    .set({ ...fields, updated_at: new Date() })
    .where('id', '=', id)
    .execute();
}
