import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { sql } from 'kysely';
import { env } from '../config/env';
import { db } from '../config/database';
import { lookupSetCode, generatePartNumber } from '../utils/set-codes';
import { normalizeGradeLabel } from '../utils/grade-labels';
import { createRawPurchase } from './raw-purchases.service';
import { createCard } from './cards.service';

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
    const card = await createCard(userId, {
      raw_purchase_id: raw_purchase_id as string,
      catalog_id: (catalog_id as string) ?? null,
      card_name_override: (card_name_override as string) ?? null,
      set_name_override: (set_name_override as string) ?? null,
      card_number_override: (card_number_override as string) ?? null,
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
    return { success: true, id: card.id };
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

  throw new Error(`Unknown tool: ${toolName}`);
}

export async function chatWithAgent(
  userId: string,
  messages: AgentChatMessage[]
): Promise<string> {
  const summary = await getUserInventorySummary(userId);

  const systemPrompt = `You are Reactor AI, an assistant for a trading card inventory management system.
You help users manage their Pokemon and trading card inventory, track grading submissions, analyze P&L, and provide card market insights.
You can read inventory data AND write to the system using the tools provided.

When the user asks to add, log, or create a purchase or intake record, use the create_raw_purchase tool.
If they provide card details, also use add_card_to_purchase to attach the card.
Use lookup_catalog to find the correct catalog_id before adding a card when possible.

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

  const apiMessages: Anthropic.MessageParam[] = messages.map((m) => ({ role: m.role, content: m.content }));

  // Agentic loop — run until end_turn or no more tool calls
  for (let i = 0; i < 5; i++) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      thinking: THINKING,
      system: systemPrompt,
      tools: AGENT_TOOLS,
      messages: apiMessages,
    });

    if (response.stop_reason === 'end_turn') {
      return response.content.find((b) => b.type === 'text')?.text ?? 'I was unable to process your request.';
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
