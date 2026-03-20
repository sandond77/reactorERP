import axios from 'axios';
import { sql } from 'kysely';
import { db } from '../config/database';

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
  language: string;    // 'EN' or 'JP'
  setCode: string;     // TCGdex set ID, preserved casing (e.g. 'base1', 'SV1a')
  cardNumber: string;  // TCGdex localId (e.g. '4', '080', '234')
  rarity?: string | null;
  variant?: string | null;
}): string {
  // Normalize language
  const lang = params.language.toUpperCase() === 'JPN' ? 'JP' : params.language.toUpperCase();

  // Pad card number to 3 digits (strip any /total suffix like "025/165" → "025")
  const rawNum = params.cardNumber.split('/')[0].trim();
  const paddedNum = rawNum.replace(/[^0-9]/g, '').padStart(3, '0') || rawNum;

  const parts: string[] = ['PKMN', lang, params.setCode, paddedNum];

  const rarityCode = params.rarity ? RARITY_CODE[params.rarity] ?? null : null;
  if (rarityCode) parts.push(rarityCode);

  const variantCode = params.variant ? VARIANT_CODE[params.variant] ?? null : null;
  if (variantCode) parts.push(variantCode);

  return parts.join('-');
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

// Find or fetch from TCGdex — used during matching when catalog entry may not exist yet
export async function findOrFetchCard(params: {
  setCode: string;
  cardNumber: string;
  cardName: string;
  language: 'EN' | 'JP';
  rarity?: string | null;
}): Promise<string | null> {
  // 1. Check catalog first
  const existing = await findCatalogByKey(params.setCode, params.cardNumber, params.language);
  if (existing) {
    // Update rarity if we now know it and catalog didn't have it
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

  // 2. Fetch from TCGdex
  const lang = params.language === 'JP' ? 'ja' : 'en';
  const rawNum = params.cardNumber.split('/')[0].trim();
  const paddedNum = rawNum.replace(/[^0-9]/g, '').padStart(3, '0') || rawNum;

  // Try to fetch full card detail
  const cardId = `${params.setCode}-${paddedNum}`;
  const detail = await fetchCardDetail(cardId, lang);
  if (!detail?.id) return null;

  const rarity = params.rarity ?? detail.rarity ?? null;
  const catalogId = await upsertCatalogCard({
    externalId: detail.id,
    setCode: params.setCode,
    setName: detail.set?.name ?? params.setCode,
    cardNumber: detail.localId ?? paddedNum,
    cardName: detail.name ?? params.cardName,
    language: params.language,
    rarity,
    imageUrl: detail.image ?? null,
  });

  return catalogId;
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
    language: string;
    company: string;
    grade: number | null;
    grade_label: string | null;
    qty: number;
    total_cost: number;
    avg_cost: number;
    qty_listed: number;
    qty_sold: number;
    catalog_id: string | null;
  }>`
    SELECT
      cc.sku,
      COALESCE(cc.card_name, ci.card_name_override)   AS card_name,
      COALESCE(cc.set_name,  ci.set_name_override)    AS set_name,
      cc.set_code,
      COALESCE(cc.card_number, ci.card_number_override) AS card_number,
      cc.rarity,
      COALESCE(cc.language, ci.language)              AS language,
      sd.company,
      sd.grade,
      sd.grade_label,
      COUNT(*)::int                                   AS qty,
      SUM(ci.purchase_cost + COALESCE(gs.grading_fee, 0))::int AS total_cost,
      AVG(ci.purchase_cost + COALESCE(gs.grading_fee, 0))::int AS avg_cost,
      COUNT(*) FILTER (WHERE l.id IS NOT NULL)::int   AS qty_listed,
      COUNT(*) FILTER (WHERE ci.status = 'sold')::int AS qty_sold,
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
    LEFT JOIN LATERAL (
      SELECT grading_fee FROM grading_submissions
      WHERE card_instance_id = ci.id
      ORDER BY created_at DESC LIMIT 1
    ) gs ON true
    WHERE ci.user_id = ${userId}
      AND ci.deleted_at IS NULL
      AND ci.status != 'sold'
    GROUP BY
      cc.sku, cc.card_name, ci.card_name_override,
      cc.set_name, ci.set_name_override,
      cc.set_code, cc.card_number, ci.card_number_override,
      cc.rarity, cc.language, ci.language,
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
