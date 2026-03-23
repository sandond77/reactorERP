import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { sql } from 'kysely';
import { env } from '../config/env';
import { db } from '../config/database';
import { lookupSetCode, generatePartNumber } from '../utils/set-codes';
import { normalizeGradeLabel } from '../utils/grade-labels';

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
  // 1. Check our own catalog first
  const catalogResults = await db
    .selectFrom('card_catalog')
    .selectAll()
    .where('game', '=', game)
    .where((eb) =>
      eb.or([
        eb('card_name', 'ilike', `%${query}%`),
        eb('set_name', 'ilike', `%${query}%`),
        eb('card_number', 'ilike', `%${query}%`),
      ])
    )
    .limit(10)
    .execute();

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
    const row = await db.selectFrom('card_catalog').select(['id', 'card_name']).where('sku', '=', sku).executeTakeFirst();
    return { ...s, sku, catalog_id: row?.id, catalog_exists: !!row, catalog_card_name: row?.card_name ?? undefined };
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
      const base = await lookupCardInfo(cardInfo.card_name, game);
      const raw = base.length > 0 ? base : [{ ...cardInfo, source: 'ai_generated' as const }];
      results.suggestions = await enrichWithSku(raw);
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
          const base = await lookupCardInfo(cardInfo.card_name, game);
          const raw = base.length > 0 ? base : [{ ...cardInfo, source: 'ai_generated' as const }];
          results.suggestions = await enrichWithSku(raw);
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

export async function chatWithAgent(
  userId: string,
  messages: AgentChatMessage[]
): Promise<string> {
  // Fetch a summary of user's inventory for context
  const summary = await getUserInventorySummary(userId);

  const systemPrompt = `You are Reactor AI, an assistant for a trading card inventory management system.
You help users manage their Pokemon and trading card inventory, track grading submissions, analyze P&L, and provide card market insights.

Current user inventory summary:
${JSON.stringify(summary, null, 2)}

Formatting rules — follow these strictly:
- Never use markdown (no **, no *, no #, no bullet points with dashes)
- Never use emojis
- When presenting options or a list of capabilities, use plain numbered lists like:
  1. Inventory questions
  2. P&L analysis
  3. Grading recommendations
- Keep responses short and direct
- When discussing money, format as USD or JPY as appropriate`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    thinking: THINKING,
    system: systemPrompt,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  return response.content.find((b) => b.type === 'text')?.text ?? 'I was unable to process your request.';
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
