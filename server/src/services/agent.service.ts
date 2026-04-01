import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { sql } from 'kysely';
import { env } from '../config/env';
import { db } from '../config/database';
import { lookupSetCode, generatePartNumber } from '../utils/set-codes';
import { auditContext } from '../utils/audit-context';
import { normalizeGradeLabel } from '../utils/grade-labels';
import { createRawPurchase } from './raw-purchases.service';
import { createCard, updateCard, transitionCardStatus, softDeleteCard } from './cards.service';
import { recordSale } from './sales.service';
import { createExpense } from './expenses.service';
import * as gradingService from './grading-submissions.service';
import * as listingsService from './listings.service';
import * as tradesService from './trades.service';
import * as locationsService from './locations.service';

const THINKING: Anthropic.ThinkingConfigParam = { type: 'adaptive' };

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 3 });

// ── TCGdex API ───────────────────────────────────────────────


// ── Receipt parsing ──────────────────────────────────────────

export interface ParsedReceiptData {
  type: 'purchase' | 'sale';
  cards: Array<{
    card_name?: string;
    set_name?: string;
    card_number?: string;
    quantity?: number;
    cost?: number;
    currency?: string;
    unique_id?: string;
    grade?: string | number;
    condition?: string;
  }>;
  total?: number;
  currency?: string;
  order_number?: string;
  date?: string;
  platform?: string;
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
}

export async function parseReceiptImage(
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp',
  hint?: 'purchase' | 'sale'
): Promise<ParsedReceiptData> {
  const systemPrompt = `You are an expert at parsing trading card receipts, invoices, and order confirmations.
Extract structured data from images of purchase receipts (eBay, Whatnot, card shows, etc.) and sale confirmations.
Always respond with valid JSON matching the requested schema. Be precise with prices — extract exact amounts shown.
For card names, preserve the full official name. For PSA/BGS cert numbers, extract them exactly.`;

  const userPrompt = `Parse this ${hint ?? 'trading card'} receipt image and extract all card and transaction data.

Return a JSON object with this exact structure:
{
  "type": "purchase" | "sale",
  "cards": [
    {
      "card_name": "string or null",
      "set_name": "string or null",
      "card_number": "string or null",
      "quantity": number or null,
      "cost": number (in dollars, e.g. 12.99) or null,
      "currency": "USD" | "JPY" | "YEN" or null,
      "unique_id": "string (eBay item #, cert #, etc.) or null",
      "grade": "string or number (PSA 10, BGS 9.5, etc.) or null",
      "condition": "NM | LP | MP | HP | DMG or null"
    }
  ],
  "total": number or null,
  "currency": "USD" | "JPY" | "YEN",
  "order_number": "string or null",
  "date": "YYYY-MM-DD or null",
  "platform": "ebay | card_show | facebook | other or null",
  "confidence": "high" | "medium" | "low",
  "notes": "any important caveats or null"
}

Only return the JSON object, no other text.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: imageBase64 },
          },
          { type: 'text', text: userPrompt },
        ],
      },
    ],
  });

  const text = response.content.find((b) => b.type === 'text')?.text ?? '{}';

  try {
    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    return JSON.parse(cleaned) as ParsedReceiptData;
  } catch {
    return {
      type: hint ?? 'purchase',
      cards: [],
      confidence: 'low',
      notes: 'Failed to parse response from AI',
    };
  }
}

// ── Card info lookup (auto-fill) ─────────────────────────────

export interface CardInfoResult {
  card_name: string;
  set_name: string;
  set_code?: string;
  card_number?: string;
  rarity?: string;
  language: string;
  image_url?: string;
  image_url_hi?: string;
  external_id?: string;
  game: string;
  variants?: string[];
  source: 'database' | 'tcgdex' | 'ai_generated';
  sku?: string;
  catalog_id?: string;
  catalog_exists?: boolean;
  catalog_card_name?: string;
  normalized_label?: string;
}

export async function lookupCardInfo(
  query: string,
  game: string = 'pokemon'
): Promise<CardInfoResult[]> {
  // 1. Check our own catalog first — word-split fuzzy: each word must match at least one field
  const words = query.trim().split(/\s+/).filter(Boolean);
  let catalogQuery = db
    .selectFrom('card_catalog')
    .selectAll()
    .where('game', '=', game);

  for (const word of words) {
    const term = `%${word}%`;
    catalogQuery = catalogQuery.where((eb) =>
      eb.or([
        eb('card_name', 'ilike', term),
        eb('set_name', 'ilike', term),
        eb('card_number', 'ilike', term),
      ])
    );
  }

  const catalogResults = await catalogQuery.limit(10).execute();

  if (catalogResults.length > 0) {
    return catalogResults.map((c) => ({
      card_name: c.card_name,
      set_name: c.set_name,
      set_code: c.set_code ?? undefined,
      card_number: c.card_number ?? undefined,
      rarity: c.rarity ?? undefined,
      language: c.language,
      image_url: c.image_url ?? undefined,
      image_url_hi: c.image_url_hi ?? undefined,
      external_id: c.external_id ?? undefined,
      game: c.game,
      source: 'database' as const,
    }));
  }

  // 2. Fall back to Claude for fuzzy lookup
  return lookupCardInfoWithAI(query, game);
}

async function lookupCardInfoWithAI(query: string, game: string): Promise<CardInfoResult[]> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: `You are a trading card expert. The input may be a PSA/grading label, card name, or partial description. Parse it and return normalized card info.

Input: "${query}"
Game: ${game}

Return ONLY a JSON array (no markdown):
[{
  "card_name": "just the card name, e.g. 'Charizard'",
  "set_name": "set name, e.g. 'Basic'",
  "set_code": "internal set code or null, e.g. 'BS1', 'SV11W', 'XY-20TH'",
  "card_number": "card number zero-padded to 3 digits, e.g. '006'",
  "rarity": "rarity or null, e.g. 'Holo'",
  "language": "EN or JP",
  "game": "${game}",
  "normalized_label": "full normalized identifier in format: '{YEAR} POKEMON {LANGUAGE} {SET_CODE}-{SET_NAME} {NUMBER} {CARD NAME} {RARITY}' e.g. '2024 POKEMON JAPANESE SV11W-WHITE FLARE 136 SCRAGGY ART RARE'. Use POKEMON not P.M., zero-pad card numbers, exclude grade and cert."
}]

If you cannot identify the card, return [].`,
      },
    ],
  });

  const text = response.content.find((b) => b.type === 'text')?.text ?? '[]';
  try {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    const json = start !== -1 && end !== -1 ? text.slice(start, end + 1) : '[]';
    const results = JSON.parse(json) as CardInfoResult[];
    return results.map((r) => ({ ...r, source: 'ai_generated' as const }));
  } catch {
    return [];
  }
}

// ── Automation: suggest card data from intake form partial input ──

async function enrichWithSku(suggestions: CardInfoResult[]): Promise<CardInfoResult[]> {
  return Promise.all(suggestions.map(async (s) => {
    if (!s.card_number) return { ...s, catalog_exists: false };
    const lang = (s.language === 'JP' ? 'JP' : 'EN') as 'EN' | 'JP';
    // Try set_code first, then fall back to looking up set_name
    const rawCode = s.set_code ?? s.set_name;
    if (!rawCode) return { ...s, catalog_exists: false };
    const setCode = lookupSetCode(lang, rawCode) ?? lookupSetCode(lang, s.set_name ?? '') ?? rawCode;
    const sku = generatePartNumber(lang, setCode, s.card_number);
    let row = await db.selectFrom('card_catalog').select(['id', 'card_name', 'sku']).where('sku', '=', sku).executeTakeFirst();
    // Fallback 1: fuzzy match by card_name + card_number (AI may return wrong set code)
    if (!row && s.card_name && s.card_number) {
      const cardNum = s.card_number.replace(/\/.*$/, '').replace(/^0+/, '');
      row = await db.selectFrom('card_catalog')
        .select(['id', 'card_name', 'sku'])
        .where('card_name', 'ilike', `%${s.card_name}%`)
        .where('card_number', 'ilike', `%${cardNum}%`)
        .where('language', '=', lang)
        .limit(1)
        .executeTakeFirst() ?? undefined;
    }
    // Fallback 2: fuzzy match by card_name + set_name (AI may return wrong card number, e.g. AR variant)
    if (!row && s.card_name && s.set_name) {
      const setWords = s.set_name.split(/\s+/).filter(w => w.length > 3);
      let q = db.selectFrom('card_catalog')
        .select(['id', 'card_name', 'sku'])
        .where('card_name', 'ilike', `%${s.card_name}%`)
        .where('language', '=', lang);
      for (const word of setWords) {
        q = q.where('set_name', 'ilike', `%${word}%`);
      }
      // If rarity available, prefer matching rarity
      if (s.rarity) {
        const withRarity = await q.where('rarity', 'ilike', `%${s.rarity}%`).limit(1).executeTakeFirst();
        row = withRarity ?? await q.limit(1).executeTakeFirst() ?? undefined;
      } else {
        row = await q.limit(1).executeTakeFirst() ?? undefined;
      }
    }
    if (!row) return { ...s, sku, catalog_exists: false };
    // Use the established card name from an existing inventory entry for this SKU
    const established = await db
      .selectFrom('card_instances')
      .select('card_name_override')
      .where('catalog_id', '=', row.id)
      .where('card_name_override', 'is not', null)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    const catalog_card_name = established?.card_name_override ?? row.card_name ?? undefined;
    const resolvedSku = row.sku ?? sku;
    return { ...s, sku: resolvedSku, catalog_id: row.id, catalog_exists: true, catalog_card_name };
  }));
}

export interface AutoFillResult {
  suggestions: CardInfoResult[];
  parsed_grade?: { company: string; grade: number; grade_label?: string } | null;
  parsed_condition?: string | null;
  parsed_cert?: string | null;
  parsed_label?: string | null;
}

export async function autoFillCardData(input: {
  partial_name?: string;
  cert_number?: string;
  game?: string;
  image_base64?: string;
  image_media_type?: 'image/jpeg' | 'image/png' | 'image/webp';
}): Promise<AutoFillResult> {
  const game = input.game ?? 'pokemon';
  const results: AutoFillResult = { suggestions: [] };

  // If we have a card image, use vision to extract card info
  if (input.image_base64 && input.image_media_type) {
    const vision = await extractCardInfoFromImage(input.image_base64, input.image_media_type, game);
    if (vision) {
      const { grading_company, grade, grade_label, cert_number, psa_label, ...cardInfo } = vision;
      // Use vision data directly — do NOT search catalog by name as it may match wrong entries
      results.suggestions = await enrichWithSku([{ ...cardInfo, source: 'ai_generated' as const }]);
      if (grading_company && grade != null) {
        results.parsed_grade = { company: grading_company, grade, grade_label: normalizeGradeLabel(grading_company, grade, grade_label) };
      }
      if (cert_number) results.parsed_cert = cert_number;
      if (psa_label) results.parsed_label = stripGradeFromLabel(psa_label, grade_label, grade, cert_number);
      return results;
    }
  }

  // Text-based lookup (or image URL → vision)
  if (input.partial_name) {
    const isUrl = /^https?:\/\//i.test(input.partial_name.trim());
    if (isUrl) {
      try {
        const resp = await axios.get(input.partial_name.trim(), { responseType: 'arraybuffer', timeout: 10000 });
        const contentType = (resp.headers['content-type'] as string) ?? 'image/jpeg';
        const mimeType = contentType.split(';')[0].trim() as 'image/jpeg' | 'image/png' | 'image/webp';
        const buffer = Buffer.from(resp.data);
        const vision = await extractCardInfoFromImage(buffer.toString('base64'), mimeType, game);
        if (vision) {
          const { grading_company, grade, grade_label, cert_number, psa_label, ...cardInfo } = vision;
          // Use vision data directly — do NOT search catalog by name as it may match wrong entries
          results.suggestions = await enrichWithSku([{ ...cardInfo, source: 'ai_generated' as const }]);
          if (grading_company && grade != null) {
            results.parsed_grade = { company: grading_company, grade, grade_label: normalizeGradeLabel(grading_company, grade, grade_label) };
          }
          if (cert_number) results.parsed_cert = cert_number;
          if (psa_label) results.parsed_label = stripGradeFromLabel(psa_label, grade_label, grade, cert_number);
          return results;
        }
      } catch { /* fall through to text lookup */ }
    }
    const suggestions = await lookupCardInfo(input.partial_name, game);
    results.suggestions = await enrichWithSku(suggestions);
    results.parsed_grade = parseLabelGrade(input.partial_name);
  }

  // Parse cert number for grade info (PSA certs are numeric)
  if (input.cert_number) {
    results.parsed_grade = parseCertNumber(input.cert_number);
  }

  return results;
}

interface ImageExtractionResult extends Omit<CardInfoResult, 'source'> {
  grading_company?: string;
  grade?: number;
  grade_label?: string;
  cert_number?: string;
  psa_label?: string;
}

async function extractCardInfoFromImage(
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp',
  game: string
): Promise<ImageExtractionResult | null> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 768,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: imageBase64 },
          },
          {
            type: 'text',
            text: `This image may be a graded trading card slab (PSA, BGS, CGC, etc.) or a raw card.

Extract all visible information. Return ONLY this JSON (no markdown):
{
  "psa_label": "normalized card identifier in format: '{YEAR} POKEMON {LANGUAGE} {SET_CODE}-{SET_NAME} {NUMBER} {CARD NAME} {RARITY}' — e.g. '2024 POKEMON JAPANESE SV8a-TERASTAL FEST ex 093 UMBREON EX' or '1996 POKEMON JAPANESE BS1-BASIC 006 CHARIZARD HOLO'. Use POKEMON (not P.M.), spell out JAPANESE/ENGLISH, zero-pad card numbers to 3 digits. Exclude grade and cert.",
  "card_name": "card name only, e.g. 'Charizard'",
  "set_name": "set name, e.g. 'Basic'",
  "set_code": "internal set code if known, e.g. 'BS1' or 'XY-20TH' or null",
  "card_number": "card number only, e.g. '006' or '034/087'",
  "rarity": "rarity if visible, e.g. 'Holo' or '1st Edition'",
  "language": "EN | JP | KR",
  "game": "${game}",
  "grading_company": "PSA | BGS | CGC | SGC | HGA | ACE | ARS | null",
  "grade": 10,
  "grade_label": "grade label text, e.g. 'GEM MT' or 'EXCELLENT-MINT'",
  "cert_number": "cert number if visible, e.g. '26354848'"
}

If not a card image, return null.`,
          },
        ],
      },
    ],
  });

  const text = response.content.find((b) => b.type === 'text')?.text ?? 'null';
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const json = start !== -1 && end !== -1 ? text.slice(start, end + 1) : text.trim();
    if (json === 'null') return null;
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function stripGradeFromLabel(label: string, gradeLabel?: string, grade?: number, cert?: string): string {
  let s = label.trim();
  if (cert) s = s.replace(new RegExp(`\\s*${cert}\\s*$`), '').trim();
  if (grade != null) s = s.replace(new RegExp(`\\s+${grade}\\s*$`), '').trim();
  if (gradeLabel) s = s.replace(new RegExp(`\\s+${gradeLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '').trim();
  return s;
}


function parseLabelGrade(label: string): { company: string; grade: number; grade_label?: string } | null {
  const COMPANIES = ['PSA', 'BGS', 'CGC', 'SGC', 'HGA', 'ACE', 'ARS'];
  const upper = label.toUpperCase();
  for (const co of COMPANIES) {
    const match = new RegExp(`${co}\\s*(\\d+(?:\\.\\d+)?)`).exec(upper);
    if (match) {
      const grade = Number(match[1]);
      return { company: co, grade, grade_label: normalizeGradeLabel(co, grade, label) };
    }
  }
  return null;
}

function parseCertNumber(cert: string): { company: string; grade: number } | null {
  // PSA certs are typically 8-9 digit numbers
  // BGS certs typically start with a letter prefix
  // This is a simple heuristic — real grading company APIs exist for full lookup
  const trimmed = cert.trim();
  if (/^\d{8,9}$/.test(trimmed)) {
    return { company: 'PSA', grade: 0 }; // grade unknown from cert alone
  }
  return null;
}

// ── Inventory chat / Q&A ─────────────────────────────────────

export interface AgentChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Quick Haiku call to classify whether the message is on-topic before burning Sonnet
async function isCardRelated(message: string, conversationContext?: string): Promise<boolean> {
  try {
    const contextBlock = conversationContext
      ? `\n\nConversation context (prior messages summary):\n${conversationContext}\n`
      : '';
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16,
      messages: [{
        role: 'user',
        content: `You are a classifier. Answer only YES or NO.

Is this message related to trading cards, card inventory management, card grading, card purchases, card sales, or related business expenses? If there is conversation context showing this is a follow-up to an ongoing card-related task, answer YES.${contextBlock}
Message: "${message.slice(0, 300)}"`,
      }],
    });
    const text = response.content.find((b) => b.type === 'text')?.text?.trim().toUpperCase() ?? '';
    return text.startsWith('YES');
  } catch {
    // Fail open — if pre-screen errors, let the message through
    return true;
  }
}

const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'create_raw_purchase',
    description: 'Create a new raw purchase / intake record. Use this when the user wants to log a new card purchase or bulk purchase.',
    input_schema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', enum: ['raw', 'bulk'], description: 'Purchase type: raw (individual cards) or bulk (lot/bundle)' },
        source: { type: 'string', description: 'Where purchased from, e.g. eBay, Mercari, card show' },
        order_number: { type: 'string', description: 'Order or transaction ID from the platform' },
        language: { type: 'string', enum: ['JP', 'EN', 'KR'], description: 'Card language (default JP)' },
        card_name: { type: 'string', description: 'Card name (for single-card purchases)' },
        set_name: { type: 'string', description: 'Set name' },
        card_number: { type: 'string', description: 'Card number' },
        total_cost_yen: { type: 'number', description: 'Total cost in Japanese Yen' },
        fx_rate: { type: 'number', description: 'JPY to USD exchange rate used' },
        total_cost_usd: { type: 'number', description: 'Total cost in USD' },
        card_count: { type: 'number', description: 'Number of cards in this purchase' },
        status: { type: 'string', enum: ['ordered', 'in_transit', 'received', 'needs_inspection'], description: 'Current status (default: ordered)' },
        purchased_at: { type: 'string', description: 'Purchase date in YYYY-MM-DD format' },
        notes: { type: 'string', description: 'Any additional notes' },
      },
      required: ['type'],
    },
  },
  {
    name: 'add_card_to_purchase',
    description: 'Add a card instance to an existing raw purchase. Use this after create_raw_purchase to attach individual card details.',
    input_schema: {
      type: 'object' as const,
      properties: {
        raw_purchase_id: { type: 'string', description: 'The internal UUID of the raw purchase (from create_raw_purchase result)' },
        catalog_id: { type: 'string', description: 'Card catalog ID if known' },
        card_name_override: { type: 'string', description: 'Display name chosen by the user. Use this when the user wants a specific name (e.g. full PSA label) instead of the catalog short name. Leave empty if user accepts the catalog name.' },
        set_name_override: { type: 'string', description: 'Set name override' },
        card_number_override: { type: 'string', description: 'Card number override' },
        quantity: { type: 'number', description: 'Number of copies' },
        purchase_cost: { type: 'number', description: 'Cost per card in cents (e.g. 1000 = $10.00)' },
        currency: { type: 'string', enum: ['USD', 'JPY'], description: 'Currency for purchase_cost' },
        condition: { type: 'string', enum: ['NM', 'LP', 'MP', 'HP', 'DMG'], description: 'Card condition — required, must come from user' },
        decision: { type: 'string', enum: ['grade', 'sell_raw'], description: 'Intent for this card: grade (send to grading) or sell_raw (sell as-is) — required, must come from user' },
        language: { type: 'string', enum: ['JP', 'EN', 'KR'], description: 'Card language' },
        notes: { type: 'string', description: 'Notes about this specific card' },
      },
      required: ['raw_purchase_id', 'condition', 'decision'],
    },
  },
  {
    name: 'add_graded_card',
    description: 'Log a pre-graded slab (PSA, BGS, CGC, etc.) directly into inventory. Use this when the user has a graded card with a cert number and grade — NOT the raw workflow.',
    input_schema: {
      type: 'object' as const,
      properties: {
        card_name_override: { type: 'string', description: 'Display name for the card (e.g. full PSA label or short name chosen by user)' },
        catalog_id: { type: 'string', description: 'Catalog ID if known (from lookup_catalog)' },
        set_name_override: { type: 'string', description: 'Set name if no catalog match' },
        card_number_override: { type: 'string', description: 'Card number if no catalog match' },
        language: { type: 'string', enum: ['JP', 'EN', 'KR'], description: 'Card language' },
        slab_company: { type: 'string', enum: ['PSA', 'BGS', 'CGC', 'SGC', 'HGA', 'ACE', 'ARS', 'OTHER'], description: 'Grading company — required' },
        slab_grade: { type: 'number', description: 'Numeric grade (e.g. 9, 9.5, 10) — required' },
        slab_grade_label: { type: 'string', description: 'Raw label text from the slab (e.g. MINT, GEM MINT). Optional — the system will normalize it to the canonical label for the grading company automatically.' },
        slab_cert_number: { type: 'string', description: 'Certification number from the slab label — required' },
        purchase_cost: { type: 'number', description: 'Purchase cost in cents (e.g. 50000 = $500.00) — required' },
        currency: { type: 'string', enum: ['USD', 'JPY'], description: 'Currency' },
        source: { type: 'string', description: 'Where purchased from' },
        purchased_at: { type: 'string', description: 'Purchase date YYYY-MM-DD' },
        notes: { type: 'string', description: 'Any notes' },
      },
      required: ['slab_company', 'slab_grade', 'slab_cert_number', 'purchase_cost'],
    },
  },
  {
    name: 'lookup_catalog',
    description: 'Search the card catalog to find a catalog_id for a card before adding it to a purchase.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Card name, set name, or card number to search for' },
        language: { type: 'string', enum: ['JP', 'EN', 'KR'], description: 'Filter by language' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_inventory',
    description: 'Search the user\'s card inventory. Use this to find card_instance_ids before recording sales, updating cards, or submitting to grading.',
    input_schema: {
      type: 'object' as const,
      properties: {
        search: { type: 'string', description: 'Search term matching card name, set name, or cert number' },
        status: { type: 'string', description: 'Filter by status: purchased_raw, inspected, grading_submitted, graded, raw_for_sale, sold' },
        limit: { type: 'number', description: 'Max results to return (default 10, max 20)' },
      },
    },
  },
  {
    name: 'record_sale',
    description: 'Record a sale for a card. Use list_inventory first to find the card_instance_id. Sale price and fees are in dollars (e.g. 150.00).',
    input_schema: {
      type: 'object' as const,
      properties: {
        card_instance_id: { type: 'string', description: 'UUID of the card instance being sold (from list_inventory)' },
        platform: { type: 'string', enum: ['ebay', 'tcgplayer', 'card_show', 'facebook', 'instagram', 'local', 'other'], description: 'Platform where it was sold' },
        sale_price: { type: 'number', description: 'Sale price in dollars (e.g. 150.00)' },
        platform_fees: { type: 'number', description: 'Platform/seller fees in dollars' },
        shipping_cost: { type: 'number', description: 'Shipping cost in dollars' },
        currency: { type: 'string', enum: ['USD', 'JPY'], description: 'Currency (default USD)' },
        sold_at: { type: 'string', description: 'Sale date in YYYY-MM-DD format (default today)' },
        unique_id: { type: 'string', description: 'Order number or transaction ID from the platform' },
      },
      required: ['card_instance_id', 'platform', 'sale_price'],
    },
  },
  {
    name: 'update_card',
    description: 'Update a card\'s decision, condition, or notes. Also use this to transition status (e.g. mark as inspected, raw_for_sale). Use list_inventory first to find the card_instance_id.',
    input_schema: {
      type: 'object' as const,
      properties: {
        card_instance_id: { type: 'string', description: 'UUID of the card instance (from list_inventory)' },
        status: { type: 'string', enum: ['purchased_raw', 'inspected', 'grading_submitted', 'graded', 'raw_for_sale', 'lost_damaged'], description: 'New status to transition to' },
        decision: { type: 'string', enum: ['grade', 'sell_raw'], description: 'Intent: grade or sell raw' },
        condition: { type: 'string', enum: ['NM', 'LP', 'MP', 'HP', 'DMG'], description: 'Card condition (required for inspection)' },
        notes: { type: 'string', description: 'Notes about the card' },
      },
      required: ['card_instance_id'],
    },
  },
  {
    name: 'delete_card',
    description: 'Permanently (soft) delete a card instance added in error. Always confirm with the user before deleting. Use list_inventory to find the card_instance_id.',
    input_schema: {
      type: 'object' as const,
      properties: {
        card_instance_id: { type: 'string', description: 'UUID of the card instance to delete' },
      },
      required: ['card_instance_id'],
    },
  },
  {
    name: 'submit_to_grading',
    description: 'Add a card to a grading batch. If no batch_id is provided, a new batch is created. Use list_inventory first to find the card_instance_id.',
    input_schema: {
      type: 'object' as const,
      properties: {
        card_instance_id: { type: 'string', description: 'UUID of the card instance to submit (from list_inventory)' },
        batch_id: { type: 'string', description: 'UUID of an existing grading batch to add to (optional — omit to create a new batch)' },
        company: { type: 'string', enum: ['PSA', 'BGS', 'CGC', 'SGC', 'HGA', 'ACE', 'ARS', 'OTHER'], description: 'Grading company (required if creating a new batch)' },
        tier: { type: 'string', description: 'Grading tier/service level, e.g. "Regular", "Economy", "Bulk" (required if creating a new batch)' },
        grading_cost: { type: 'number', description: 'Cost per card in dollars for this batch (optional)' },
      },
      required: ['card_instance_id'],
    },
  },
  {
    name: 'record_expense',
    description: 'Log a business expense such as shipping, grading fees, supplies, or card show costs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        description: { type: 'string', description: 'What the expense was for' },
        type: { type: 'string', description: 'Expense type: Shipping, Grading, Supplies, Card Show, Food, Travel, Other' },
        amount: { type: 'number', description: 'Amount in dollars (e.g. 12.99)' },
        currency: { type: 'string', enum: ['USD', 'JPY'], description: 'Currency (default USD)' },
        date: { type: 'string', description: 'Expense date in YYYY-MM-DD format (default today)' },
        order_number: { type: 'string', description: 'Order or reference number if applicable' },
      },
      required: ['description', 'type', 'amount'],
    },
  },
  // ── Grading batch management ─────────────────────────────────────────────
  {
    name: 'list_grading_batches',
    description: 'List grading batches to find an existing batch_id. Use before submit_to_grading or process_grading_return.',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['pending', 'submitted', 'returned', 'cancelled'], description: 'Filter by batch status (optional)' },
      },
    },
  },
  {
    name: 'update_grading_batch',
    description: 'Update a grading batch status (e.g. mark as submitted after mailing cards, or update submission number). Use list_grading_batches to find the batch_id.',
    input_schema: {
      type: 'object' as const,
      properties: {
        batch_id: { type: 'string', description: 'UUID of the grading batch' },
        status: { type: 'string', enum: ['pending', 'submitted', 'returned', 'cancelled'], description: 'New status for the batch' },
        submission_number: { type: 'string', description: 'Submission/tracking number from the grading company' },
        notes: { type: 'string', description: 'Notes to add to the batch' },
      },
      required: ['batch_id'],
    },
  },
  {
    name: 'process_grading_return',
    description: 'Process graded cards returned from PSA/BGS/CGC. Records grades and cert numbers for each card in the batch. Use list_grading_batches to find the batch_id and the batch items.',
    input_schema: {
      type: 'object' as const,
      properties: {
        batch_id: { type: 'string', description: 'UUID of the grading batch being returned' },
        returned_at: { type: 'string', description: 'Date cards were returned YYYY-MM-DD (default today)' },
        items: {
          type: 'array',
          description: 'Grading results for each card in the batch',
          items: {
            type: 'object',
            properties: {
              batch_item_id: { type: 'string', description: 'UUID of the batch item (from list_grading_batches)' },
              grade: { type: 'number', description: 'Numeric grade (e.g. 9, 9.5, 10)' },
              cert_number: { type: 'string', description: 'Certification number on the slab' },
              grade_label: { type: 'string', description: 'Raw label text from the slab. Optional — normalized automatically by the system.' },
              card_name_override: { type: 'string', description: 'Updated card name (e.g. full PSA label) — optional' },
            },
            required: ['batch_item_id', 'grade'],
          },
        },
      },
      required: ['batch_id', 'items'],
    },
  },
  // ── Listings management ───────────────────────────────────────────────────
  {
    name: 'list_listings',
    description: 'List active listings to find listing_ids. Use before update_listing or cancel_listing.',
    input_schema: {
      type: 'object' as const,
      properties: {
        search: { type: 'string', description: 'Search by card name or set' },
        limit: { type: 'number', description: 'Max results (default 10, max 20)' },
      },
    },
  },
  {
    name: 'create_listing',
    description: 'Create a listing for a card to sell it on a platform. Use list_inventory to find the card_instance_id first.',
    input_schema: {
      type: 'object' as const,
      properties: {
        card_instance_id: { type: 'string', description: 'UUID of the card being listed (from list_inventory)' },
        platform: { type: 'string', enum: ['ebay', 'tcgplayer', 'card_show', 'facebook', 'instagram', 'local', 'other'], description: 'Platform where it will be listed' },
        list_price: { type: 'number', description: 'Listing price in dollars (e.g. 150.00)' },
        currency: { type: 'string', enum: ['USD', 'JPY'], description: 'Currency (default USD)' },
        listing_url: { type: 'string', description: 'URL to the listing (e.g. eBay listing URL)' },
        listed_at: { type: 'string', description: 'Date listed YYYY-MM-DD (default today)' },
      },
      required: ['card_instance_id', 'platform', 'list_price'],
    },
  },
  {
    name: 'update_listing',
    description: 'Update a listing price, platform, or URL. Use list_listings to find the listing_id.',
    input_schema: {
      type: 'object' as const,
      properties: {
        listing_id: { type: 'string', description: 'UUID of the listing to update (from list_listings)' },
        list_price: { type: 'number', description: 'New price in dollars' },
        platform: { type: 'string', enum: ['ebay', 'tcgplayer', 'card_show', 'facebook', 'instagram', 'local', 'other'], description: 'New platform' },
        listing_url: { type: 'string', description: 'Updated listing URL' },
      },
      required: ['listing_id'],
    },
  },
  {
    name: 'cancel_listing',
    description: 'Cancel an active listing (e.g. if it sold elsewhere or you changed your mind). Use list_listings to find the listing_id.',
    input_schema: {
      type: 'object' as const,
      properties: {
        listing_id: { type: 'string', description: 'UUID of the listing to cancel (from list_listings)' },
      },
      required: ['listing_id'],
    },
  },
  // ── Trades ────────────────────────────────────────────────────────────────
  {
    name: 'record_trade',
    description: 'Record a trade — cards going out and cards coming in. Supports cash adjustments. Use list_inventory to find outgoing card_instance_ids.',
    input_schema: {
      type: 'object' as const,
      properties: {
        outgoing: {
          type: 'array',
          description: 'Cards you are giving away in the trade',
          items: {
            type: 'object',
            properties: {
              card_instance_id: { type: 'string', description: 'UUID of the card being traded out (from list_inventory)' },
              sale_price: { type: 'number', description: 'Agreed trade value for this card in dollars' },
              currency: { type: 'string', enum: ['USD', 'JPY'], description: 'Currency (default USD)' },
            },
            required: ['card_instance_id', 'sale_price'],
          },
        },
        incoming: {
          type: 'array',
          description: 'Cards you are receiving in the trade',
          items: {
            type: 'object',
            properties: {
              card_name: { type: 'string', description: 'Card name' },
              set_name: { type: 'string', description: 'Set name' },
              condition: { type: 'string', enum: ['NM', 'LP', 'MP', 'HP', 'DMG'], description: 'Card condition (for raw cards)' },
              decision: { type: 'string', enum: ['sell_raw', 'grade'], description: 'Intent for this card' },
              purchase_cost: { type: 'number', description: 'Trade credit value in dollars' },
              currency: { type: 'string', enum: ['USD', 'JPY'], description: 'Currency (default USD)' },
              language: { type: 'string', enum: ['JP', 'EN', 'KR'], description: 'Card language (default EN)' },
              slab_company: { type: 'string', enum: ['PSA', 'BGS', 'CGC', 'SGC', 'HGA', 'ACE', 'ARS', 'OTHER'], description: 'Grading company if incoming card is a graded slab' },
              slab_grade: { type: 'number', description: 'Grade if incoming card is a graded slab' },
              slab_cert_number: { type: 'string', description: 'Cert number if incoming card is a graded slab' },
            },
            required: ['card_name', 'purchase_cost'],
          },
        },
        trade_date: { type: 'string', description: 'Trade date YYYY-MM-DD (default today)' },
        person: { type: 'string', description: 'Name of the person you traded with' },
        cash_from_customer: { type: 'number', description: 'Cash the customer gave you in dollars (positive = you received cash)' },
        cash_to_customer: { type: 'number', description: 'Cash you gave the customer in dollars' },
        trade_percent: { type: 'number', description: 'Trade credit percentage (default 80 = 80%)' },
        notes: { type: 'string', description: 'Notes about the trade' },
      },
      required: ['outgoing', 'incoming'],
    },
  },
  // ── Locations ─────────────────────────────────────────────────────────────
  {
    name: 'list_locations',
    description: 'List storage locations to find location_ids for assigning cards.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'assign_card_to_location',
    description: 'Assign a card to a storage location (e.g. a binder, box, or card show display). Use list_locations to find the location_id and list_inventory for card_instance_id.',
    input_schema: {
      type: 'object' as const,
      properties: {
        card_instance_id: { type: 'string', description: 'UUID of the card to assign (from list_inventory)' },
        location_id: { type: 'string', description: 'UUID of the location (from list_locations). Omit or set null to unassign.' },
      },
      required: ['card_instance_id'],
    },
  },
];

async function executeAgentTool(userId: string, toolName: string, toolInput: Record<string, unknown>): Promise<unknown> {
  if (toolName === 'create_raw_purchase') {
    const input = toolInput as unknown as Parameters<typeof createRawPurchase>[1];
    const result = await createRawPurchase(userId, input);
    return { success: true, id: result.id, purchase_id: result.purchase_id };
  }

  if (toolName === 'add_card_to_purchase') {
    const { raw_purchase_id, catalog_id, card_name_override, set_name_override, card_number_override,
            quantity, purchase_cost, currency, condition, decision, language, notes } = toolInput as Record<string, unknown>;

    // Auto-enrich: if no catalog_id, try to find catalog match for proper sku/part number
    let resolvedCatalogId = (catalog_id as string) ?? null;
    let resolvedCardName = (card_name_override as string) ?? null;
    let resolvedSetName = (set_name_override as string) ?? null;
    let resolvedCardNumber = (card_number_override as string) ?? null;

    const userProvidedName = resolvedCardName; // preserve what the user explicitly chose
    if (!resolvedCatalogId && resolvedCardName) {
      try {
        const searchTerm = [resolvedCardName, resolvedSetName, resolvedCardNumber].filter(Boolean).join(' ');
        const enriched = await autoFillCardData({ partial_name: searchTerm, game: 'pokemon' });
        const best = enriched.suggestions?.[0];
        if (best?.catalog_id) {
          resolvedCatalogId = best.catalog_id;
          // Keep user's explicit name as override; only clear fallback search terms
          resolvedCardName = userProvidedName; // may be null if user accepted catalog name
          resolvedSetName = null;
          resolvedCardNumber = null;
        }
      } catch { /* enrichment failure is non-fatal */ }
    }

    const card = await createCard(userId, {
      raw_purchase_id: raw_purchase_id as string,
      catalog_id: resolvedCatalogId,
      card_name_override: resolvedCardName,
      set_name_override: resolvedSetName,
      card_number_override: resolvedCardNumber,
      quantity: (quantity as number) ?? 1,
      purchase_cost: (purchase_cost as number) ?? 0,
      currency: ((currency as string) ?? 'JPY') as 'USD' | 'JPY',
      condition: (condition as string) ?? null,
      decision: (decision as string) ?? null,
      language: ((language as string) ?? 'JP') as 'JP' | 'EN' | 'KR',
      notes: (notes as string) ?? null,
      status: 'purchased_raw',
      purchase_type: 'raw',
      card_game: 'pokemon',
    });
    return { success: true, id: card.id, catalog_matched: !!resolvedCatalogId };
  }

  if (toolName === 'add_graded_card') {
    const { card_name_override, catalog_id, set_name_override, card_number_override, language,
            slab_company, slab_grade, slab_grade_label, slab_cert_number,
            purchase_cost, currency, source, purchased_at, notes } = toolInput as Record<string, unknown>;

    // Try catalog enrichment if no catalog_id provided
    let resolvedCatalogId = (catalog_id as string) ?? null;
    let resolvedCardName = (card_name_override as string) ?? null;
    if (!resolvedCatalogId && resolvedCardName) {
      try {
        const enriched = await autoFillCardData({ partial_name: resolvedCardName, game: 'pokemon' });
        const best = enriched.suggestions?.[0];
        if (best?.catalog_id) { resolvedCatalogId = best.catalog_id; }
      } catch { /* non-fatal */ }
    }

    // Always normalize grade label using canonical maps — never trust raw AI label
    const normalizedGradeLabel = normalizeGradeLabel(
      slab_company as string,
      slab_grade as number,
      slab_grade_label as string | undefined,
    );

    const card = await createCard(userId, {
      catalog_id: resolvedCatalogId,
      card_name_override: resolvedCardName,
      set_name_override: (set_name_override as string) ?? null,
      card_number_override: (card_number_override as string) ?? null,
      language: ((language as string) ?? 'JP') as 'JP' | 'EN' | 'KR',
      purchase_cost: (purchase_cost as number) ?? 0,
      currency: ((currency as string) ?? 'USD') as 'USD' | 'JPY',
      quantity: 1,
      purchase_type: 'pre_graded',
      card_game: 'pokemon',
      notes: (notes as string) ?? null,
      purchased_at: (purchased_at as string) ?? null,
    } as any, {
      company: slab_company as string,
      grade: slab_grade as number,
      grade_label: normalizedGradeLabel,
      cert_number: (slab_cert_number as string) ?? undefined,
      additional_cost: 0,
    });
    return { success: true, id: card.id, catalog_matched: !!resolvedCatalogId };
  }

  if (toolName === 'lookup_catalog') {
    const { query, language } = toolInput as { query: string; language?: string };
    const q = db.selectFrom('card_catalog').select(['id', 'card_name', 'set_name', 'card_number', 'sku', 'language'])
      .where((eb) => eb.or([
        eb('card_name', 'ilike', `%${query}%`),
        eb('set_name', 'ilike', `%${query}%`),
        eb('card_number', 'ilike', `%${query}%`),
      ]));
    const rows = language
      ? await q.where('language', '=', language).limit(5).execute()
      : await q.limit(5).execute();
    return rows;
  }

  if (toolName === 'list_inventory') {
    const { search, status, limit: rawLimit } = toolInput as { search?: string; status?: string; limit?: number };
    const limit = Math.min(rawLimit ?? 10, 20);
    let q = db
      .selectFrom('card_instances as ci')
      .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
      .leftJoin('slab_details as sd', 'sd.card_instance_id', 'ci.id')
      .leftJoin('raw_purchases as rp', 'rp.id', 'ci.raw_purchase_id')
      .leftJoin('locations as loc', 'loc.id', 'ci.location_id')
      .select([
        'ci.id',
        sql<string>`COALESCE(ci.card_name_override, cc.card_name)`.as('card_name'),
        sql<string>`COALESCE(ci.set_name_override, cc.set_name)`.as('set_name'),
        'cc.sku as part_number',
        'ci.status',
        'ci.condition',
        'ci.decision',
        'ci.quantity',
        'ci.purchase_cost',
        'ci.currency',
        'ci.purchase_type',
        'rp.purchase_id as purchase_label',
        'sd.grade',
        'sd.company as grading_company',
        'sd.cert_number',
        'sd.grading_cost',
        'loc.name as location_name',
        sql<boolean>`EXISTS(SELECT 1 FROM listings l WHERE l.card_instance_id = ci.id AND l.listing_status = 'active')`.as('is_listed'),
      ])
      .where('ci.user_id', '=', userId);
    if (status) q = q.where('ci.status', '=', status as any);
    if (search) {
      const term = `%${search}%`;
      q = q.where((eb) => eb.or([
        eb(sql<string>`COALESCE(ci.card_name_override, cc.card_name)`, 'ilike', term),
        eb(sql<string>`COALESCE(ci.set_name_override, cc.set_name)`, 'ilike', term),
        eb(sql<string>`sd.cert_number::text`, 'ilike', term),
        eb(sql<string>`rp.purchase_id`, 'ilike', term),
      ]));
    }
    const rows = await q.limit(limit).execute();
    return rows.map((r) => ({
      ...r,
      purchase_cost_usd: r.purchase_cost ? (r.purchase_cost / 100).toFixed(2) : null,
      grading_cost_usd: r.grading_cost ? (r.grading_cost / 100).toFixed(2) : null,
      total_cost_usd: r.purchase_cost ? ((r.purchase_cost + (r.grading_cost ?? 0)) / 100).toFixed(2) : null,
    }));
  }

  if (toolName === 'record_sale') {
    const { card_instance_id, platform, sale_price, platform_fees, shipping_cost, currency, sold_at, unique_id } =
      toolInput as { card_instance_id: string; platform: string; sale_price: number; platform_fees?: number; shipping_cost?: number; currency?: string; sold_at?: string; unique_id?: string };
    const sale = await recordSale(userId, {
      card_instance_id,
      platform: platform as any,
      sale_price: Math.round(sale_price * 100),
      platform_fees: platform_fees ? Math.round(platform_fees * 100) : 0,
      shipping_cost: shipping_cost ? Math.round(shipping_cost * 100) : 0,
      currency: currency ?? 'USD',
      sold_at: sold_at ? new Date(sold_at) : new Date(),
      unique_id: unique_id ?? undefined,
    });
    return { success: true, sale_id: sale.id, net_proceeds_usd: ((sale.net_proceeds ?? 0) / 100).toFixed(2) };
  }

  if (toolName === 'update_card') {
    const { card_instance_id, status, decision, condition, notes } =
      toolInput as { card_instance_id: string; status?: string; decision?: string; condition?: string; notes?: string };
    if (status) {
      await transitionCardStatus(userId, card_instance_id, status as any);
    }
    if (decision !== undefined || condition !== undefined || notes !== undefined) {
      await updateCard(userId, card_instance_id, {
        ...(decision !== undefined && { decision }),
        ...(condition !== undefined && { condition }),
        ...(notes !== undefined && { notes }),
      });
    }
    return { success: true };
  }

  if (toolName === 'delete_card') {
    const { card_instance_id } = toolInput as { card_instance_id: string };
    await softDeleteCard(userId, card_instance_id, 'agent');
    return { success: true };
  }

  if (toolName === 'submit_to_grading') {
    const { card_instance_id, batch_id, company, tier, grading_cost } =
      toolInput as { card_instance_id: string; batch_id?: string; company?: string; tier?: string; grading_cost?: number };
    let resolvedBatchId = batch_id;
    if (!resolvedBatchId) {
      if (!company || !tier) throw new Error('company and tier are required when creating a new grading batch');
      const batch = await gradingService.createBatch(userId, {
        company,
        tier,
        grading_cost: grading_cost ? Math.round(grading_cost * 100) : 0,
      });
      resolvedBatchId = batch.id;
    }
    await gradingService.addItem(userId, resolvedBatchId, { card_instance_id });
    return { success: true, batch_id: resolvedBatchId };
  }

  if (toolName === 'record_expense') {
    const { description, type, amount, currency, date, order_number } =
      toolInput as { description: string; type: string; amount: number; currency?: string; date?: string; order_number?: string };
    const expense = await createExpense(userId, {
      description,
      type,
      amount: Math.round(amount * 100),
      currency: currency ?? 'USD',
      date: date ? new Date(date) : new Date(),
      order_number: order_number ?? undefined,
    });
    return { success: true, expense_id: expense.expense_id };
  }

  if (toolName === 'list_grading_batches') {
    const { status } = toolInput as { status?: string };
    const batches = await gradingService.listBatches(userId);
    const filtered = status ? batches.filter((b: any) => b.status === status) : batches;
    return filtered.map((b: any) => ({
      id: b.id,
      batch_id: b.batch_id,
      company: b.company,
      tier: b.tier,
      status: b.status,
      submission_number: b.submission_number,
      submitted_at: b.submitted_at,
      grading_cost: b.grading_cost,
      item_count: b.item_count,
      items: b.items?.map((item: any) => ({
        id: item.id,
        card_name: item.card_name,
        cert_number: item.cert_number,
        grade: item.grade,
        status: item.status,
      })),
    }));
  }

  if (toolName === 'update_grading_batch') {
    const { batch_id, status, submission_number, notes } =
      toolInput as { batch_id: string; status?: string; submission_number?: string; notes?: string };
    const result = await gradingService.updateBatch(userId, batch_id, {
      ...(status && { status }),
      ...(submission_number !== undefined && { submission_number }),
      ...(notes && { notes }),
    });
    return { success: true, batch_id, status: result?.status };
  }

  if (toolName === 'process_grading_return') {
    const { batch_id, returned_at, items } =
      toolInput as { batch_id: string; returned_at?: string; items: Array<{ batch_item_id: string; grade: number; cert_number?: string; grade_label?: string; card_name_override?: string }> };
    const batch = await db.selectFrom('grading_batches').select('company').where('id', '=', batch_id).executeTakeFirst();
    const company = batch?.company ?? 'PSA';
    const result = await gradingService.processReturn(userId, batch_id, {
      returned_at,
      items: items.map((item) => ({
        batch_item_id: item.batch_item_id,
        grade: item.grade,
        cert_number: item.cert_number,
        grade_label: normalizeGradeLabel(company, item.grade, item.grade_label),
        card_name_override: item.card_name_override,
      })),
    });
    return { success: true, batch_id, status: result?.status, returned_count: items.length };
  }

  if (toolName === 'list_listings') {
    const { search, limit: rawLimit } = toolInput as { search?: string; limit?: number };
    const limit = Math.min(rawLimit ?? 10, 20);
    let q = db
      .selectFrom('listings as l')
      .innerJoin('card_instances as ci', 'ci.id', 'l.card_instance_id')
      .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
      .leftJoin('slab_details as sd', 'sd.card_instance_id', 'ci.id')
      .select([
        'l.id as listing_id',
        sql<string>`COALESCE(ci.card_name_override, cc.card_name)`.as('card_name'),
        sql<string>`COALESCE(ci.set_name_override, cc.set_name)`.as('set_name'),
        'l.platform',
        'l.list_price',
        'l.currency',
        'l.listing_status',
        'l.ebay_listing_url',
        'l.listed_at',
        'sd.company as grading_company',
        'sd.grade',
        'sd.cert_number',
        'ci.condition',
      ])
      .where('l.user_id', '=', userId)
      .where('l.listing_status', '=', 'active');
    if (search) {
      q = q.where(sql<string>`COALESCE(ci.card_name_override, cc.card_name)`, 'ilike', `%${search}%`);
    }
    const rows = await q.limit(limit).execute();
    return rows.map((r) => ({
      ...r,
      list_price_usd: r.list_price ? (r.list_price / 100).toFixed(2) : null,
    }));
  }

  if (toolName === 'create_listing') {
    const { card_instance_id, platform, list_price, currency, listing_url, listed_at } =
      toolInput as { card_instance_id: string; platform: string; list_price: number; currency?: string; listing_url?: string; listed_at?: string };
    const listing = await listingsService.createListing(userId, {
      card_instance_id,
      platform: platform as any,
      list_price: Math.round(list_price * 100),
      currency: currency ?? 'USD',
      ebay_listing_url: listing_url ?? null,
      listed_at: listed_at ? new Date(listed_at) : new Date(),
      listing_status: 'active',
    } as any);
    return { success: true, listing_id: listing.id };
  }

  if (toolName === 'update_listing') {
    const { listing_id, list_price, platform, listing_url } =
      toolInput as { listing_id: string; list_price?: number; platform?: string; listing_url?: string };
    await listingsService.updateListing(userId, listing_id, {
      ...(list_price !== undefined && { list_price: Math.round(list_price * 100) }),
      ...(platform !== undefined && { platform: platform as any }),
      ...(listing_url !== undefined && { ebay_listing_url: listing_url }),
    });
    return { success: true, listing_id };
  }

  if (toolName === 'cancel_listing') {
    const { listing_id } = toolInput as { listing_id: string };
    await listingsService.cancelListing(userId, listing_id);
    return { success: true, listing_id };
  }

  if (toolName === 'record_trade') {
    const { outgoing, incoming, trade_date, person, cash_from_customer, cash_to_customer, trade_percent, notes } =
      toolInput as {
        outgoing: Array<{ card_instance_id: string; sale_price: number; currency?: string }>;
        incoming: Array<{ card_name: string; set_name?: string; condition?: string; decision?: string; purchase_cost: number; currency?: string; language?: string; slab_company?: string; slab_grade?: number; slab_cert_number?: string }>;
        trade_date?: string; person?: string; cash_from_customer?: number; cash_to_customer?: number; trade_percent?: number; notes?: string;
      };
    const trade = await tradesService.createTrade(userId, {
      outgoing: outgoing.map((o) => ({
        card_instance_id: o.card_instance_id,
        sale_price: Math.round(o.sale_price * 100),
        currency: o.currency ?? 'USD',
      })),
      incoming: incoming.map((i) => ({
        card_name_override: i.card_name,
        set_name_override: i.set_name,
        condition: i.condition,
        decision: (i.decision ?? 'sell_raw') as 'sell_raw' | 'grade',
        purchase_cost_cents: Math.round(i.purchase_cost * 100),
        currency: i.currency ?? 'USD',
        language: (i.language ?? 'EN') as string,
        slab_company: i.slab_company,
        slab_grade: i.slab_grade,
        slab_cert_number: i.slab_cert_number,
      })),
      trade_date,
      person,
      cash_from_customer_cents: cash_from_customer ? Math.round(cash_from_customer * 100) : 0,
      cash_to_customer_cents: cash_to_customer ? Math.round(cash_to_customer * 100) : 0,
      trade_percent: trade_percent ?? 80,
      notes,
    });
    return { success: true, trade_id: trade.id };
  }

  if (toolName === 'list_locations') {
    const locations = await locationsService.listLocations(userId);
    return locations.map((l: any) => ({
      id: l.id,
      name: l.name,
      card_type: l.card_type,
      is_card_show: l.is_card_show,
      is_container: l.is_container,
      parent_id: l.parent_id,
      notes: l.notes,
    }));
  }

  if (toolName === 'assign_card_to_location') {
    const { card_instance_id, location_id } = toolInput as { card_instance_id: string; location_id?: string };
    await locationsService.assignLocation(userId, card_instance_id, location_id ?? null);
    return { success: true };
  }

  throw new Error(`Unknown tool: ${toolName}`);
}

export interface AgentImage {
  base64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
}

// Persist images across multi-turn conversations (image sent in turn 1, card created in turn 2+)
const pendingImages = new Map<string, AgentImage[]>();

async function saveImageToCards(userId: string, cardIds: string[], images: AgentImage[]) {
  if (!images.length) return;
  try {
    const dir = path.join(__dirname, '../../../uploads/card-images', userId);
    fs.mkdirSync(dir, { recursive: true });
    for (const cardId of cardIds) {
      // Save front from first image, back from second if present
      const sides: Array<'front' | 'back'> = ['front', 'back'];
      for (let i = 0; i < Math.min(images.length, 2); i++) {
        const image = images[i];
        const ext = image.mediaType === 'image/png' ? 'png' : 'jpg';
        const filename = `${cardId}-${sides[i]}.${ext}`;
        fs.writeFileSync(path.join(dir, filename), Buffer.from(image.base64, 'base64'));
        const url = `/uploads/card-images/${userId}/${filename}`;
        const field = sides[i] === 'front' ? 'image_front_url' : 'image_back_url';
        await db.updateTable('card_instances').set({ [field]: url } as any)
          .where('id', '=', cardId).where('user_id', '=', userId).execute();
      }
    }
  } catch { /* image save failure is non-fatal */ }
}

export async function chatWithAgent(
  userId: string,
  messages: AgentChatMessage[],
  images?: AgentImage[],
  spreadsheetText?: string,
): Promise<{ reply: string; mutated: string[] }> {
  // Store new images for this user; fall back to any images from a previous turn in this conversation
  if (images?.length) pendingImages.set(userId, images);
  const sessionImages = pendingImages.get(userId);
  const hasImages = !!sessionImages?.length;

  // Pre-screen + inventory summary in parallel to avoid sequential round trips
  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
  const shouldPreScreen = !hasImages && !!lastUserMessage && lastUserMessage.content.trim().length > 10;

  // For follow-ups, build a short context string from prior messages so the screener can judge correctly
  const priorMessages = messages.slice(0, -1); // everything except the last user message
  const conversationContext = priorMessages.length > 0
    ? priorMessages.slice(-4).map(m => `${m.role}: ${m.content.slice(0, 100)}`).join('\n')
    : undefined;

  const [onTopic, summary] = await Promise.all([
    shouldPreScreen ? isCardRelated(lastUserMessage!.content, conversationContext) : Promise.resolve(true),
    getUserInventorySummary(userId),
  ]);

  if (!onTopic) {
    return { reply: 'I can only help with trading card inventory, purchases, sales, grading, and expenses. Please ask something related to your card collection or business.', mutated: [] };
  }

  const now = new Date();
  const currentDate = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const currentYear = now.getFullYear();

  const systemPrompt = `You are Reactor AI, a trading card inventory management expert for Reactor — a full ERP system for Pokemon card dealers. You have deep knowledge of every workflow in the system and can perform anything a user can do manually.

TODAY'S DATE: ${currentDate} (year ${currentYear}). Use this when interpreting relative dates like "today", "yesterday", or partial dates like "4/1" (= April 1, ${currentYear}).

SCOPE: Trading cards, card inventory, purchases, grading, sales, listings, trades, expenses, locations. Refuse anything outside this domain.

=== DOMAIN MODEL ===

Every card traces back to a purchase. Two inventory types:
- RAW cards: quantity-based, grouped into purchase lots (purchase_id = RP-YYYY-NNN). Go through inspection before routing.
- GRADED slabs: item-based (1 card = 1 record). Each has a cert number, grade, grading company. Can be purchased pre-graded or graded in-house.

Card Status State Machine:
  purchased_raw → inspected → grading_submitted → graded → sold
                            → raw_for_sale → sold
  Any status → lost_damaged (terminal)

Rules:
- Cannot sell a card that is purchased_raw or grading_submitted
- Cannot submit to grading without inspection first (status must be inspected, decision must be grade)
- Cannot create a listing for a card already listed (409 conflict)
- Graded cards (status=graded) can be listed or sold directly — no inspection needed
- Pre-graded purchases (purchase_type=pre_graded) skip the raw workflow entirely
- lost_damaged is a terminal state — cannot be reversed

Cost Basis:
- Raw card: purchase_cost (per card in the lot)
- Graded card: purchase_cost + grading_cost (from slab_details)
- Profit = sale_price − platform_fees − shipping_cost − total_cost_basis
- For eBay sales: net = sale_price − platform_fees − shipping_cost
- For non-eBay (card show, local, etc.): net = sale_price (no fee deduction)

Condition grades: NM (Near Mint), LP (Lightly Played), MP (Moderately Played), HP (Heavily Played), DMG (Damaged)
Decisions at inspection: sell_raw (list/sell as-is) or grade (send to grading company)

Grading workflow:
1. Inspect card (update_card: status=inspected, condition, decision=grade)
2. Submit to batch (submit_to_grading — creates batch if none exists)
3. Mail cards, then mark batch submitted (update_grading_batch: status=submitted, add submission_number)
4. When cards return: process_grading_return (use list_grading_batches to get item IDs)
5. Cards become graded slabs ready to list/sell

Trade workflow:
- Outgoing cards are sold at agreed trade value (updates status to sold)
- Incoming cards are new raw or graded cards added at trade credit value
- Cash adjustments: cash_from_customer (customer pays extra cash), cash_to_customer (you give cash)
- trade_percent: credit given as % of market value (default 80%)

Listing vs Sale:
- Listing = intent to sell at a price on a platform (active until sold or cancelled)
- Sale = completed transaction with actual sale price, fees, date
- A card can be listed and then sold — the sale closes the listing
- A card can also be sold directly without a prior listing (agent chat, card show, etc.)

=== AVAILABLE TOOLS ===

READ tools (use freely, no confirmation needed):
- list_inventory: search by card name, set, cert#, purchase label, or status. Returns id, card_name, status, condition, decision, cost, location, listing status, grading info.
- lookup_catalog: find catalog entries by name/set/number. Use before adding cards to get catalog_id and part number.
- list_grading_batches: list batches. Returns batch details + item list with item IDs (needed for process_grading_return).
- list_listings: list active listings with listing_id, card, price, platform.
- list_locations: list all storage locations.

WRITE tools (collect required data before calling):
- create_raw_purchase: start a new raw purchase lot
- add_card_to_purchase: add a card line to a raw purchase
- add_graded_card: log a pre-graded slab directly (PSA/BGS/CGC/etc.)
- update_card: transition status, set condition/decision (inspection), update notes
- delete_card: soft-delete a card added in error. Always confirm with the user (show card name + ID) before calling this tool.
- submit_to_grading: add card to a grading batch (creates batch if no batch_id given)
- update_grading_batch: change batch status, add submission number/notes
- process_grading_return: record grades+certs when cards return from grader
- record_sale: record a completed sale
- create_listing: list a card for sale on a platform
- update_listing: change price, platform, or URL on a listing
- cancel_listing: cancel an active listing
- record_trade: record a trade (cards out + cards in + cash adjustment)
- assign_card_to_location: assign card to a storage location
- record_expense: log a business expense

=== REQUIRED FIELDS BY WORKFLOW ===

Graded slab intake (add_graded_card):
  Required: grading company, grade (number), cert number, purchase cost, currency
  Display name: always construct card_name_override in PSA label format — all caps, order: YEAR POKEMON LANGUAGE SET_NAME CARD_NUMBER CARD_NAME EDITION. E.g. "2009 POKEMON JAPANESE SOULSILVER COLLECTION 029 LUGIA LEGEND-HOLO 1ST EDITION". Never ask the user.
  Optional: purchase date, source/where bought

Raw card purchase (create_raw_purchase + add_card_to_purchase):
  Required: card name, purchase cost, currency, condition (NM/LP/MP/HP/DMG), decision (sell_raw or grade)
  Optional: purchase date, source, order number, language (default JP for Pokemon)

Inspection (update_card: status=inspected + condition + decision):
  Required: which card (list_inventory with status=purchased_raw), condition, decision
  Note: if user says "grade it" → decision=grade; "sell raw" or "list it" → decision=sell_raw

Grading submission (submit_to_grading):
  Required: which card (must be status=inspected AND decision=grade), grading company, tier
  Optional: grading_cost per card (dollars), existing batch_id (use list_grading_batches)

Grading return (process_grading_return):
  Required: batch_id + item IDs (from list_grading_batches), grade per item, cert number per item
  Optional: grade label (e.g. GEM MT), card name override (updated PSA label), return date

Sale (record_sale):
  Required: which card, platform, sale price
  Optional: platform_fees, shipping_cost, order/transaction ID, sale date

Listing (create_listing):
  Required: which card, platform, list price
  Optional: listing URL, date

Trade (record_trade):
  Required: outgoing card IDs + trade value per card, incoming card names + trade credit + condition + decision
  Optional: person name, cash_from_customer, cash_to_customer, trade_percent (default 80), date, notes

Location (assign_card_to_location):
  Required: card (list_inventory), location (list_locations)

Expense (record_expense):
  Required: description, type (Shipping/Grading/Supplies/Card Show/Food/Travel/Other), amount

=== WORKFLOW SEQUENCES ===

Inspect a card:
  list_inventory(status=purchased_raw) → update_card(status=inspected, condition, decision)

Submit to grading:
  list_inventory(status=inspected, decision=grade) → submit_to_grading → [later] update_grading_batch(status=submitted, submission_number)

Process grading return:
  list_grading_batches(status=submitted) → process_grading_return(batch_id, items with grade+cert)

Sell a graded card:
  list_inventory(status=graded) → record_sale  [OR]  create_listing → [later] record_sale

Sell a raw card:
  list_inventory(status=raw_for_sale OR inspected+decision=sell_raw) → record_sale

Record a card show trade-in:
  list_inventory(outgoing cards) → record_trade(outgoing, incoming, cash adjustments)

Find cards needing attention:
  list_inventory(status=purchased_raw) → show what needs inspection
  list_inventory(status=inspected, decision=grade) → show what's ready for grading submission

=== BEHAVIOR RULES ===

1. Always list_inventory FIRST before any write action on a specific card. Never guess an ID.
2. Collect ALL required fields in a single message before calling any write tool.
3. For grading returns: always call list_grading_batches first to get item IDs — do not ask user for UUIDs.
4. For trades: always call list_inventory for outgoing card IDs before record_trade.
5. For listings/sales: always confirm the card with list_inventory even if user gave a name — duplicate names exist.
6. Never guess condition, decision, platform, or price. Always get from user.
7. When a card could be multiple results (same name, different copies), list them and ask which one.
8. After any write: report what was created, the ID(s), and a one-line summary.

GRADED vs RAW: If image shows PSA/BGS/CGC/SGC label with cert number and grade → add_graded_card. Never use raw workflow for slabs.

Display name rule: Always set card_name_override to the full PSA label format — all caps, exact field order: YEAR POKEMON LANGUAGE SET_NAME CARD_NUMBER CARD_NAME EDITION. Example: "2009 POKEMON JAPANESE SOULSILVER COLLECTION 029 LUGIA LEGEND-HOLO 1ST EDITION". Rules: set name comes before card number and card name; no "#" prefix on card number; spell out "1ST EDITION" fully (not "1ST ED."); no abbreviations for set name. Never ask the user what format to use. This matches what the sub return workflow imports.

Image handling:
- Card photo: extract name, set, number, language, cert/grade if visible. Ask for missing required fields in one message.
- Receipt/invoice: extract all data, show summary, confirm before creating records.

Spreadsheet handling:
- Spreadsheet data appears in <spreadsheet> tags. Parse columns from the header row.
- Confirm your interpretation of the data (columns, row count) before performing any bulk operations.
- For bulk card additions or sales, process row by row using the appropriate tools. Report progress as you go.

Formatting:
- No markdown (no **, no *, no #, no dashes for lists)
- No emojis
- Numbered lists only: 1. Item  2. Item
- Short and direct. Money as $X.XX or ¥X as appropriate.
- When showing card lists, include: name, status, condition, grade/cert if graded, cost basis.

Current inventory summary:
${JSON.stringify(summary, null, 2)}`;

  const apiMessages: Anthropic.MessageParam[] = messages.map((m, i) => {
    const isLastUser = i === messages.length - 1 && m.role === 'user';
    // Attach images and/or spreadsheet text to the last user message
    if (isLastUser && (hasImages || spreadsheetText)) {
      const contentBlocks: Anthropic.ContentBlockParam[] = [];
      if (hasImages) {
        sessionImages!.forEach((img) => {
          contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } });
        });
      }
      let textContent = m.content || (hasImages ? 'Please analyze these.' : '');
      if (spreadsheetText) {
        textContent = (textContent ? textContent + '\n\n' : '') + `<spreadsheet>\n${spreadsheetText}\n</spreadsheet>`;
      }
      contentBlocks.push({ type: 'text', text: textContent });
      return { role: 'user', content: contentBlocks };
    }
    return { role: m.role, content: m.content };
  });

  // Track card IDs created this session so we can attach the image after the loop
  const createdCardIds: string[] = [];
  // Track which resource types were mutated so client can invalidate caches
  const mutatedResources = new Set<string>();

  // Agentic loop — run until end_turn or no more tool calls
  for (let i = 0; i < 8; i++) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemPrompt,
      tools: AGENT_TOOLS,
      messages: apiMessages,
    });

    if (response.stop_reason === 'end_turn') {
      const text = response.content.find((b) => b.type === 'text')?.text ?? 'I was unable to process your request.';
      // Save uploaded images to any cards created this session, then clear the pending store
      if (createdCardIds.length > 0 && sessionImages?.length) {
        await saveImageToCards(userId, createdCardIds, sessionImages);
        pendingImages.delete(userId);
      }
      return { reply: text, mutated: [...mutatedResources] };
    }

    if (response.stop_reason === 'tool_use') {
      // Add assistant turn with all content blocks
      apiMessages.push({ role: 'assistant', content: response.content });

      // Execute each tool call and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        try {
          const result = await auditContext.run({ actor: 'agent' }, () => executeAgentTool(userId, block.name, block.input as Record<string, unknown>));
          // Track any card instance IDs created
          if ((block.name === 'add_card_to_purchase' || block.name === 'add_graded_card') && typeof result === 'object' && result !== null && 'id' in result) {
            createdCardIds.push(result.id as string);
          }
          // Track mutated resources for client cache invalidation
          const TOOL_RESOURCE_MAP: Record<string, string[]> = {
            create_raw_purchase: ['raw_purchases'],
            add_card_to_purchase: ['raw_purchases', 'cards'],
            add_graded_card: ['slabs', 'cards'],
            record_sale: ['sales', 'slabs', 'cards'],
            update_card: ['cards', 'slabs'],
            submit_to_grading: ['grading', 'cards'],
            update_grading_batch: ['grading'],
            process_grading_return: ['grading', 'slabs', 'cards'],
            create_listing: ['listings', 'slabs', 'cards'],
            update_listing: ['listings'],
            cancel_listing: ['listings', 'slabs', 'cards'],
            record_trade: ['trades', 'cards', 'slabs', 'sales'],
            assign_card_to_location: ['cards', 'slabs'],
            record_expense: ['expenses'],
            delete_card: ['cards'],
          };
          (TOOL_RESOURCE_MAP[block.name] ?? []).forEach((r) => mutatedResources.add(r));
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${msg}`, is_error: true });
        }
      }

      apiMessages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Unexpected stop reason — return whatever text we have
    return { reply: response.content.find((b) => b.type === 'text')?.text ?? 'I was unable to process your request.', mutated: [...mutatedResources] };
  }

  return { reply: 'I was unable to complete the request within the allowed steps.', mutated: [...mutatedResources] };
}

async function getUserInventorySummary(userId: string) {
  const statusCounts = await db
    .selectFrom('card_instances')
    .select([
      'status',
      sql<number>`COUNT(*)::int`.as('count'),
      sql<number>`SUM(purchase_cost)::int`.as('total_cost'),
    ])
    .where('user_id', '=', userId)
    .groupBy('status')
    .execute();

  const recentSales = await db
    .selectFrom('sales')
    .select([
      sql<number>`COUNT(*)::int`.as('count'),
      sql<number>`SUM(net_proceeds)::int`.as('total_net'),
      sql<number>`SUM(net_proceeds - COALESCE(total_cost_basis, 0))::int`.as('total_profit'),
    ])
    .where('user_id', '=', userId)
    .where('sold_at', '>=', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))
    .executeTakeFirst();

  return { inventory_by_status: statusCounts, last_30_days_sales: recentSales };
}

// ── Expense receipt parsing ───────────────────────────────────────────────────

export interface ParsedExpenseData {
  date?: string;        // YYYY-MM-DD
  description?: string;
  type?: string;        // one of the known expense types if recognizable
  amount?: number;      // in dollars
  currency?: string;
  order_number?: string;
  link?: string;
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
}

export async function parseExpenseImage(
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
): Promise<ParsedExpenseData> {
  const prompt = `Parse this expense receipt or invoice image and extract the expense details.

Known expense types (use one if it matches, otherwise suggest a short label):
Shipping, Grading, Supplies, Card Show, Food, Travel, Other

Return a JSON object:
{
  "date": "YYYY-MM-DD or null",
  "description": "concise description of what was purchased (max 80 chars)",
  "type": "best matching type from the list above, or a short custom label",
  "amount": number in dollars (e.g. 12.99) or null,
  "currency": "USD" or "JPY" or null,
  "order_number": "order/reference/confirmation number or null",
  "link": null,
  "confidence": "high" | "medium" | "low",
  "notes": "any caveats or null"
}

Only return the JSON object, no other text.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: prompt },
      ],
    }],
  });

  const text = response.content.find((b) => b.type === 'text')?.text ?? '{}';
  const json = text.match(/\{[\s\S]*\}/)?.[0] ?? '{}';
  return JSON.parse(json) as ParsedExpenseData;
}

// ── Card image scanning ───────────────────────────────────────

export interface ScannedCardData {
  card_name: string | null;
  set_name: string | null;
  card_number: string | null;
  cert_number: string | null;
  grade: string | null;
  company: string | null;
  condition: string | null;
  confidence: 'high' | 'medium' | 'low';
  notes: string | null;
}

export async function scanCardImage(
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
): Promise<ScannedCardData> {
  const prompt = `Analyze this trading card image and extract all visible information.

Return a JSON object:
{
  "card_name": "full card name or null",
  "set_name": "set/expansion name or null",
  "card_number": "card number (e.g. '4/102') or null",
  "cert_number": "PSA/BGS/CGC certification number if visible on label or null",
  "grade": "numeric grade if graded (e.g. '9', '9.5', '10') or null",
  "company": "grading company if graded (PSA, BGS, CGC, SGC, etc.) or null",
  "condition": "raw card condition if ungraded (NM, LP, MP, HP, DMG) or null",
  "confidence": "high" | "medium" | "low",
  "notes": "any relevant observations or null"
}

Only return the JSON object, no other text.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: prompt },
      ],
    }],
  });

  const text = response.content.find((b) => b.type === 'text')?.text ?? '{}';
  const json = text.match(/\{[\s\S]*\}/)?.[0] ?? '{}';
  return JSON.parse(json) as ScannedCardData;
}
