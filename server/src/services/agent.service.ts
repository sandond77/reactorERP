import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { sql } from 'kysely';
import { env } from '../config/env';
import { db } from '../config/database';

const THINKING: Anthropic.ThinkingConfigParam = { type: 'adaptive' };

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

// ── TCGdex API ───────────────────────────────────────────────

interface TCGdexCard {
  id: string;
  localId: string;
  name: string;
  image?: string;
  rarity?: string;
  category?: string;
  set: { id: string; name: string };
}

async function searchTCGdexCards(query: string, lang: string = 'en'): Promise<TCGdexCard[]> {
  try {
    const response = await axios.get(`https://api.tcgdex.net/v2/${lang}/cards`, {
      params: { name: query },
      timeout: 5000,
    });
    const data = response.data;
    return Array.isArray(data) ? data.slice(0, 10) : [];
  } catch {
    return [];
  }
}

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
    model: 'claude-opus-4-6',
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

  // 2. For Pokemon, hit TCGdex
  if (game === 'pokemon') {
    const apiResults = await searchTCGdexCards(query);
    if (apiResults.length > 0) {
      // Cache results in our catalog
      for (const card of apiResults.slice(0, 5)) {
        await db
          .insertInto('card_catalog')
          .values({
            game: 'pokemon',
            set_name: card.set.name,
            set_code: card.set.id,
            card_name: card.name,
            card_number: card.localId,
            variant: null,
            rarity: card.rarity ?? null,
            language: 'EN',
            image_url: card.image ? `${card.image}/low.png` : null,
            image_url_hi: card.image ? `${card.image}/high.png` : null,
            external_id: card.id,
          })
          .onConflict((oc) => oc.doNothing())
          .execute()
          .catch(() => {}); // silently fail — catalog is optional
      }

      return apiResults.map((card: TCGdexCard) => ({
        card_name: card.name,
        set_name: card.set.name,
        set_code: card.set.id,
        card_number: card.localId,
        rarity: card.rarity,
        language: 'EN',
        image_url: card.image ? `${card.image}/low.png` : undefined,
        image_url_hi: card.image ? `${card.image}/high.png` : undefined,
        external_id: card.id,
        game: 'pokemon',
        source: 'tcgdex' as const,
      }));
    }
  }

  // 3. Fall back to Claude for fuzzy lookup / other games
  return lookupCardInfoWithAI(query, game);
}

async function lookupCardInfoWithAI(query: string, game: string): Promise<CardInfoResult[]> {
  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    thinking: THINKING,
    messages: [
      {
        role: 'user',
        content: `You are a trading card expert. Look up card info for: "${query}" (game: ${game}).

Return a JSON array of up to 5 matching cards:
[{
  "card_name": "exact official name",
  "set_name": "set name",
  "set_code": "set code or null",
  "card_number": "card number in set or null",
  "rarity": "rarity or null",
  "language": "EN",
  "game": "${game}",
  "variants": ["list of known variants or empty array"]
}]

Only return the JSON array. If unknown, return [].`,
      },
    ],
  });

  const text = response.content.find((b) => b.type === 'text')?.text ?? '[]';
  try {
    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    const results = JSON.parse(cleaned) as CardInfoResult[];
    return results.map((r) => ({ ...r, source: 'ai_generated' as const }));
  } catch {
    return [];
  }
}

// ── Automation: suggest card data from intake form partial input ──

export interface AutoFillResult {
  suggestions: CardInfoResult[];
  parsed_grade?: { company: string; grade: number } | null;
  parsed_condition?: string | null;
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
    const visionResult = await extractCardInfoFromImage(
      input.image_base64,
      input.image_media_type,
      game
    );
    if (visionResult) {
      const apiResults = await lookupCardInfo(visionResult.card_name, game);
      results.suggestions = apiResults.length > 0
        ? apiResults
        : [{ ...visionResult, source: 'ai_generated' }];
      return results;
    }
  }

  // Text-based lookup
  if (input.partial_name) {
    results.suggestions = await lookupCardInfo(input.partial_name, game);
  }

  // Parse cert number for grade info (PSA certs are numeric)
  if (input.cert_number) {
    results.parsed_grade = parseCertNumber(input.cert_number);
  }

  return results;
}

async function extractCardInfoFromImage(
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp',
  game: string
): Promise<Omit<CardInfoResult, 'source'> | null> {
  const response = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 512,
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
            text: `This is a ${game} trading card image. Extract the card information.

Return JSON:
{
  "card_name": "exact name on card",
  "set_name": "set name if visible",
  "card_number": "card number if visible (e.g. 025/165)",
  "rarity": "rarity if visible",
  "language": "EN | JP | KR | etc",
  "game": "${game}"
}

Only return JSON, no other text. If not a card image, return null.`,
          },
        ],
      },
    ],
  });

  const text = response.content.find((b) => b.type === 'text')?.text ?? 'null';
  try {
    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    if (cleaned === 'null') return null;
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
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
    model: 'claude-opus-4-6',
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
