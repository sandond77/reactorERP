// ────────────────────────────────────────────────────────────────────────────
// Sale-by-text subagent — one-shot natural-language sale parser.
//
// Turns a user-typed or voice-dictated one-liner ("sold Charizard 10 to John
// for 200 at yesterday's show") into a `{ card_query, price, buyer, ... }`
// structure. The endpoint pairs this parse with an inventory search on
// `card_query` and returns candidate slabs, so the client can render a single
// confirm modal (or a picker when multiple candidates match).
//
// Design choices:
//   - Model: Haiku 4.5 (`claude-haiku-4-5-20251001`). Text parsing with a
//     stable schema is exactly what Haiku is priced for; ~60× cheaper than
//     Sonnet, and misses are corrected in the confirm modal anyway.
//   - Cache: system prompt at top-level with `cache_control: ephemeral`.
//     Every parse call shares the block, so after the first call in a 5-min
//     window the ~600-token system prompt is a cache read for pennies.
//   - No conversation — one message in, JSON out. Ambiguity survives to the
//     confirm modal, where the user resolves it in a single tap.
//   - Deliberately NOT a tool-use flow: the chat agent does that; this is
//     the fast path that avoids the tool loop entirely.
// ────────────────────────────────────────────────────────────────────────────

import { anthropic } from './client';

export interface ParsedSaleData {
  // Free-form query the server will feed into inventory search. Should be
  // specific enough to disambiguate (name + grade or cert number is ideal),
  // but bare card names are fine — the confirm modal handles multiple matches.
  card_query?: string;
  // Grading company mentioned in the sentence, if any (PSA, BGS, CGC, SGC).
  // Used to narrow the candidate list when the parser knows it.
  company?: string;
  // Numeric grade if mentioned (10, 9.5, 8). Used to disambiguate when the
  // user has multiple copies at different grades.
  grade?: number;
  // Cert number if the user dictated it. Overrides card_query when present —
  // cert numbers are globally unique per company.
  cert_number?: string;
  // Sale price in dollars (not cents). Client converts on submit.
  price?: number;
  // Copies sold. Defaults to 1; only relevant for raw multi-qty lots.
  quantity?: number;
  // Buyer name / handle if mentioned. Stored in the sale's unique_id_2 field.
  buyer?: string;
  // Platform inferred from context ("at the show" → card_show, "on eBay" →
  // ebay). Defaults to card_show since that's the dominant use case for
  // this flow (booth clerks entering sales in real time).
  platform?: 'card_show' | 'ebay' | 'tcgplayer' | 'facebook' | 'instagram' | 'local' | 'other';
  // "yesterday", "today", "friday", ISO date, etc. → resolved to YYYY-MM-DD by
  // the model. Nullable — server defaults to today if omitted.
  sold_at?: string;
  // How confident the parser is that it got the fields right. Client can
  // steer UI (yellow warning strip on low confidence).
  confidence: 'high' | 'medium' | 'low';
  // Parse-time caveats, e.g. "price was ambiguous, guessed $200". Not the
  // sale's notes field.
  notes?: string;
}

const SALE_PARSE_SYSTEM_PROMPT = `You are a fast, accurate parser for a trading-card seller's spoken/typed sale entries.

INPUT: one short sentence describing a sale that just happened. Examples:
  "sold Charizard PSA 10 to John for 200"
  "moved the BGS 9.5 pikachu for 45 cash"
  "3 raw commons to alex for 5"
  "cert 12345678 gone for 800"
  "just sold blastoise 10 at the show for 250"
  "did the gengar reverse holo for 15 eBay"

OUTPUT: return ONLY a JSON object matching the schema below. No markdown, no prose, no code fences.

Schema:
{
  "card_query": "search string for inventory lookup (name plus grade/set/company hints) — omit only if cert_number is provided",
  "company":    "PSA | BGS | CGC | SGC | ARS | ACE | HGA | OTHER — only if explicitly said",
  "grade":      number if a grade like 10, 9.5, 8 was said, else omit,
  "cert_number":"digits-only cert number if the user said one, else omit",
  "price":      number in dollars (e.g. 200 not 20000). Required unless the sentence has no price.,
  "quantity":   integer, default 1. Only >1 for raw commons or bulk lots.,
  "buyer":      "buyer name/handle if mentioned, else omit",
  "platform":   "card_show | ebay | tcgplayer | facebook | instagram | local | other — default card_show for booth-context sentences",
  "sold_at":    "YYYY-MM-DD if 'yesterday', 'today', 'friday' etc. said — resolve using the current date the caller will pass. Omit if not mentioned.",
  "confidence": "high | medium | low based on how well the sentence parsed",
  "notes":      "parser caveats only (e.g. 'buyer was unclear, guessed \\"John\\"'). Do NOT put the sale sentence back in here."
}

RULES:
- If the user said a cert number, put it in cert_number AND still include card_query with any card-name hints.
- Grade "10" after a card name almost always means the numeric grade — not the price and not the quantity. Only treat a solo "10" as quantity when the sentence is clearly a bulk-lot phrasing ("10 raw commons").
- Default platform to card_show unless the sentence explicitly mentions eBay / TCGplayer / Facebook / Instagram / a website — that's this flow's dominant use case.
- Return valid JSON on ONE line. No fences, no commentary.`;

export async function parseSaleFromText(text: string, todayISO: string): Promise<ParsedSaleData> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Empty input');

  // Cap input size — a one-liner should never exceed ~300 chars. Reject
  // ridiculously long input so a paste of chat history doesn't blow the
  // budget or confuse the parser.
  if (trimmed.length > 500) {
    throw new Error('Input too long — keep it to one sentence describing one sale');
  }

  const resp = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    system: [
      {
        type: 'text',
        text: SALE_PARSE_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Today's date: ${todayISO}\n\nParse this sale sentence:\n"${trimmed}"`,
      },
    ],
  });

  // Anthropic's response is `content: ContentBlock[]`. We want the first text
  // block; everything else (tool_use, thinking) is unexpected here.
  const first = resp.content.find((b) => b.type === 'text');
  if (!first || first.type !== 'text') throw new Error('Parser returned no text');
  const raw = first.text.trim();

  // Strip accidental fences even though the prompt forbids them — models
  // occasionally slip when the schema is complex.
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Parser returned invalid JSON: ${cleaned.slice(0, 200)}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Parser returned non-object JSON');
  }

  const p = parsed as Record<string, unknown>;
  const confidence = p.confidence === 'high' || p.confidence === 'medium' || p.confidence === 'low'
    ? p.confidence
    : 'medium';

  return {
    card_query: typeof p.card_query === 'string' && p.card_query.trim() ? p.card_query.trim() : undefined,
    company: typeof p.company === 'string' && p.company.trim() ? p.company.trim().toUpperCase() : undefined,
    grade: typeof p.grade === 'number' ? p.grade : undefined,
    cert_number: typeof p.cert_number === 'string' && /^\d+$/.test(p.cert_number.trim())
      ? p.cert_number.trim()
      : undefined,
    price: typeof p.price === 'number' && p.price > 0 ? p.price : undefined,
    quantity: typeof p.quantity === 'number' && p.quantity >= 1 ? Math.floor(p.quantity) : 1,
    buyer: typeof p.buyer === 'string' && p.buyer.trim() ? p.buyer.trim() : undefined,
    platform: p.platform === 'card_show' || p.platform === 'ebay' || p.platform === 'tcgplayer'
      || p.platform === 'facebook' || p.platform === 'instagram' || p.platform === 'local' || p.platform === 'other'
      ? p.platform
      : 'card_show',
    sold_at: typeof p.sold_at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.sold_at)
      ? p.sold_at
      : undefined,
    confidence,
    notes: typeof p.notes === 'string' && p.notes.trim() ? p.notes.trim() : undefined,
  };
}
