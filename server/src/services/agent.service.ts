import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { sql } from 'kysely';
import { env } from '../config/env';
import { db } from '../config/database';
import { lookupSetCode, generatePartNumber } from '../utils/set-codes';
import { normalizeGradeLabel } from '../utils/grade-labels';
import { createRawPurchase } from './raw-purchases.service';
import { createCard, updateCard, transitionCardStatus } from './cards.service';
import { recordSale } from './sales.service';
import { createExpense } from './expenses.service';
import * as gradingService from './grading-submissions.service';

const THINKING: Anthropic.ThinkingConfigParam = { type: 'adaptive' };

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

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
async function isCardRelated(message: string): Promise<boolean> {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16,
      messages: [{
        role: 'user',
        content: `You are a classifier. Answer only YES or NO.

Is this message about trading cards, card inventory management, card grading, card purchases, card sales, or related business expenses?

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
        card_name_override: { type: 'string', description: 'Card name (if not using catalog_id)' },
        set_name_override: { type: 'string', description: 'Set name override' },
        card_number_override: { type: 'string', description: 'Card number override' },
        quantity: { type: 'number', description: 'Number of copies' },
        purchase_cost: { type: 'number', description: 'Cost per card in cents (e.g. 1000 = $10.00)' },
        currency: { type: 'string', enum: ['USD', 'JPY'], description: 'Currency for purchase_cost' },
        condition: { type: 'string', description: 'Card condition: NM, LP, MP, HP, DMG' },
        language: { type: 'string', enum: ['JP', 'EN', 'KR'], description: 'Card language' },
        notes: { type: 'string', description: 'Notes about this specific card' },
      },
      required: ['raw_purchase_id'],
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
];

async function executeAgentTool(userId: string, toolName: string, toolInput: Record<string, unknown>): Promise<unknown> {
  if (toolName === 'create_raw_purchase') {
    const input = toolInput as unknown as Parameters<typeof createRawPurchase>[1];
    const result = await createRawPurchase(userId, input);
    return { success: true, id: result.id, purchase_id: result.purchase_id };
  }

  if (toolName === 'add_card_to_purchase') {
    const { raw_purchase_id, catalog_id, card_name_override, set_name_override, card_number_override,
            quantity, purchase_cost, currency, condition, language, notes } = toolInput as Record<string, unknown>;

    // Auto-enrich: if no catalog_id, try to find catalog match for proper sku/part number
    let resolvedCatalogId = (catalog_id as string) ?? null;
    let resolvedCardName = (card_name_override as string) ?? null;
    let resolvedSetName = (set_name_override as string) ?? null;
    let resolvedCardNumber = (card_number_override as string) ?? null;

    if (!resolvedCatalogId && resolvedCardName) {
      try {
        const searchTerm = [resolvedCardName, resolvedSetName, resolvedCardNumber].filter(Boolean).join(' ');
        const enriched = await autoFillCardData({ partial_name: searchTerm, game: 'pokemon' });
        const best = enriched.suggestions?.[0];
        if (best?.catalog_id) {
          resolvedCatalogId = best.catalog_id;
          // Use established catalog name if available, otherwise keep agent's name
          resolvedCardName = best.catalog_card_name ?? best.card_name ?? resolvedCardName;
          resolvedSetName = best.set_name ?? resolvedSetName;
          resolvedCardNumber = best.card_number ?? resolvedCardNumber;
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
      language: ((language as string) ?? 'JP') as 'JP' | 'EN' | 'KR',
      notes: (notes as string) ?? null,
      status: 'purchased_raw',
      purchase_type: 'raw',
      card_game: 'pokemon',
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
      .select([
        'ci.id',
        sql<string>`COALESCE(ci.card_name_override, cc.card_name)`.as('card_name'),
        sql<string>`COALESCE(ci.set_name_override, cc.set_name)`.as('set_name'),
        'ci.status',
        'ci.condition',
        'ci.decision',
        'ci.quantity',
        'ci.purchase_cost',
        'ci.currency',
        'ci.raw_purchase_id',
        'sd.grade',
        'sd.company as grading_company',
        'sd.cert_number',
      ])
      .where('ci.user_id', '=', userId)
      .where('ci.deleted_at', 'is', null);
    if (status) q = q.where('ci.status', '=', status as any);
    if (search) {
      const term = `%${search}%`;
      q = q.where((eb) => eb.or([
        eb(sql<string>`COALESCE(ci.card_name_override, cc.card_name)`, 'ilike', term),
        eb(sql<string>`COALESCE(ci.set_name_override, cc.set_name)`, 'ilike', term),
        eb(sql<string>`sd.cert_number`, 'ilike', term),
      ]));
    }
    const rows = await q.limit(limit).execute();
    return rows.map((r) => ({
      ...r,
      purchase_cost_usd: r.purchase_cost ? (r.purchase_cost / 100).toFixed(2) : null,
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

  throw new Error(`Unknown tool: ${toolName}`);
}

export interface AgentImage {
  base64: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
}

async function saveImageToCards(userId: string, cardIds: string[], image: AgentImage) {
  try {
    const dir = path.join(__dirname, '../../../uploads/card-images', userId);
    fs.mkdirSync(dir, { recursive: true });
    const ext = image.mediaType === 'image/png' ? 'png' : 'jpg';
    const buffer = Buffer.from(image.base64, 'base64');
    for (const cardId of cardIds) {
      const filename = `${cardId}-front.${ext}`;
      fs.writeFileSync(path.join(dir, filename), buffer);
      const url = `/uploads/card-images/${userId}/${filename}`;
      await db.updateTable('card_instances').set({ image_front_url: url })
        .where('id', '=', cardId).where('user_id', '=', userId).execute();
    }
  } catch { /* image save failure is non-fatal */ }
}

export async function chatWithAgent(
  userId: string,
  messages: AgentChatMessage[],
  image?: AgentImage
): Promise<string> {
  // Pre-screen + inventory summary in parallel to avoid sequential round trips
  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
  const shouldPreScreen = !image && !!lastUserMessage && lastUserMessage.content.trim().length > 10;

  const [onTopic, summary] = await Promise.all([
    shouldPreScreen ? isCardRelated(lastUserMessage!.content) : Promise.resolve(true),
    getUserInventorySummary(userId),
  ]);

  if (!onTopic) {
    return 'I can only help with trading card inventory, purchases, sales, grading, and expenses. Please ask something related to your card collection or business.';
  }

  const systemPrompt = `You are Reactor AI, an assistant exclusively for trading card inventory management.

STRICT SCOPE: You ONLY answer questions and perform actions related to trading cards, card inventory, grading submissions, card sales, card purchases, and related business expenses. If asked about anything else, refuse and redirect.

You can read inventory data AND write to the system using the tools provided:
- list_inventory: find cards in the user's inventory (do this first before any action on a specific card)
- create_raw_purchase + add_card_to_purchase: log new card purchases
- record_sale: record a card sale (requires card_instance_id from list_inventory)
- update_card: change status, condition, decision, or notes on a card
- submit_to_grading: add a card to a grading batch (create batch if needed)
- record_expense: log a business expense
- lookup_catalog: find catalog entries before adding cards

Workflow guidance:
- To record a sale: first use list_inventory to find the card, then record_sale with the card_instance_id
- To submit to grading: first use list_inventory to find the card, then submit_to_grading
- Card condition (NM/LP/MP/HP/DMG) must come from the user — never assume it
- When the user provides partial info, ask specifically for what is missing before acting

Image handling:
- If given a card image: extract card name, set, card number, language, and any grade/cert info visible
- Then ask the user for any missing purchase details: cost, purchase date, source/platform, condition (if raw), order number
- Ask all missing questions in one message, not one at a time
- Do not create any record until you have at minimum: card name and purchase cost
- If given a receipt or invoice image: extract all visible transaction data, summarize what you found, ask the user to confirm before creating records

After completing any write action, always report back:
- What was created/updated
- The internal ID(s) assigned (e.g. purchase ID, card ID, sale ID, expense ID)
- A one-line summary of what was recorded

Current inventory summary:
${JSON.stringify(summary, null, 2)}

Formatting rules:
- No markdown (no **, no *, no #, no dashes for lists)
- No emojis
- Numbered lists only: 1. Item 2. Item
- Short and direct responses
- Money as USD or JPY as appropriate`;

  const apiMessages: Anthropic.MessageParam[] = messages.map((m, i) => {
    // Attach image to the last user message
    if (image && i === messages.length - 1 && m.role === 'user') {
      return {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
          { type: 'text', text: m.content || 'Please analyze this image.' },
        ],
      };
    }
    return { role: m.role, content: m.content };
  });

  // Track card IDs created this session so we can attach the image after the loop
  const createdCardIds: string[] = [];

  // Agentic loop — run until end_turn or no more tool calls
  for (let i = 0; i < 5; i++) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      tools: AGENT_TOOLS,
      messages: apiMessages,
    });

    if (response.stop_reason === 'end_turn') {
      const text = response.content.find((b) => b.type === 'text')?.text ?? 'I was unable to process your request.';
      // Save the uploaded image to any cards created this session
      if (image && createdCardIds.length > 0) {
        await saveImageToCards(userId, createdCardIds, image);
      }
      return text;
    }

    if (response.stop_reason === 'tool_use') {
      // Add assistant turn with all content blocks
      apiMessages.push({ role: 'assistant', content: response.content });

      // Execute each tool call and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        try {
          const result = await executeAgentTool(userId, block.name, block.input as Record<string, unknown>);
          // Track any card instance IDs created
          if (block.name === 'add_card_to_purchase' && typeof result === 'object' && result !== null && 'id' in result) {
            createdCardIds.push(result.id as string);
          }
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
    return response.content.find((b) => b.type === 'text')?.text ?? 'I was unable to process your request.';
  }

  return 'I was unable to complete the request within the allowed steps.';
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
    .where('deleted_at', 'is', null)
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
