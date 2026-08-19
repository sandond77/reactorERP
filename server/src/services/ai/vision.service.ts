// ────────────────────────────────────────────────────────────────────────────
// Vision subagent — all image and unstructured-text extraction on the server.
//
// Two responsibilities:
//   1. Card OCR — Sonnet Vision reads a slab / raw card photo and returns a
//      canonical Reactor card identity (name, set, number, grade, cert, etc).
//      Callers: agent tool `add_graded_card` / `add_card_to_purchase` image
//      inputs, plus the standalone image extraction endpoint.
//   2. Order parsing — Haiku (text) or Sonnet Vision (image) reads an eBay
//      order-details dump and returns per-listing entries with title + optional
//      cert number. Callers: Combined Order → Paste List tab.
//
// Both flows share one Anthropic client and lean on `cache_control: ephemeral`
// so each stable system prompt is written to the ephemeral cache on the first
// call of a 5-minute window and read back on every subsequent call. That's the
// entire reason this file exists as its own module — each function's prompt is
// long and stable, so cache reads pay for 90% of the token bill after the
// first shot.
// ────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as path from 'path';
import { EN_SETS, JP_SETS } from '../../utils/set-codes';
import { anthropic } from './client';

// ── Corrections library ─────────────────────────────────────────────────────
// Rules and examples curated from real user corrections. Loaded once at
// module import time so they compile into the ephemeral-cached system prompt
// exactly the same way on every call — a fresh file read per request would
// bust the cache. Callers that want a live reload must restart the server.
// (Files change infrequently by design: entries only get added after human
// review of the curation script's report.)
function readLibraryBlock(filename: string): string {
  try {
    const p = path.join(__dirname, filename);
    const raw = fs.readFileSync(p, 'utf-8');
    // Strip the human-facing header (everything up to and including the first
    // horizontal rule) — those instructions are for maintainers, not for the
    // model. The prompt just needs the rule/example content below the rule.
    const idx = raw.indexOf('\n---\n');
    return idx === -1 ? raw.trim() : raw.slice(idx + 5).trim();
  } catch {
    return '';   // missing/unreadable file is non-fatal — model just runs on schema alone
  }
}
const VISION_RULES = readLibraryBlock('vision.rules.md');
const VISION_EXAMPLES = readLibraryBlock('vision.examples.md');

// Re-exported so agent.service.ts callers don't have to reach into the AI
// subdir for the shared shape.
export interface ImageCardExtractionResult {
  card_name: string;
  set_name: string;
  set_code?: string;
  card_number?: string;
  rarity?: string;
  language: string;
  game: string;
  grading_company?: string;
  grade?: number;
  grade_label?: string;
  cert_number?: string;
  psa_label?: string;
}

// ── Card OCR ────────────────────────────────────────────────────────────────

// Exported for tests — internal helper, prefer extractCardInfoFromImage from
// production code.
export function buildCardExtractionSystemPrompt(game: string): string {
  const enLines = EN_SETS.map((s) => `${s.code}: ${s.names[0]}`).join(', ');
  const jpLines = JP_SETS.map((s) => `${s.code}: ${s.names[0]}`).join(', ');
  return `This image may be a graded trading card slab (PSA, BGS, CGC, etc.) or a raw card.

Extract all visible information. Return ONLY this JSON (no markdown):
{
  "psa_label": "normalized card identifier in format: '{YEAR} POKEMON {LANGUAGE} {SET_CODE}-{SET_NAME} {NUMBER} {CARD NAME} {RARITY}' — e.g. '2024 POKEMON JAPANESE SV8a-TERASTAL FEST ex 093 UMBREON EX' or '1996 POKEMON JAPANESE BS1-BASIC 006 CHARIZARD HOLO'. Use POKEMON (not P.M.), spell out JAPANESE/ENGLISH, zero-pad card numbers to 3 digits. Exclude grade and cert.",
  "card_name": "OFFICIAL ENGLISH card name only — e.g. 'Charizard', 'Luxray ex', 'Mew'. Always translate from Japanese/Korean/etc. to the official English Pokemon name. Never return non-Latin script.",
  "set_name": "ENGLISH set name. For JP-exclusive sets use the established English transliteration (e.g. 'コロコロコミック' → 'Corocoro Comics', 'スカーレット&バイオレット ex スターターセット' → 'Scarlet & Violet ex Starter Set', '黒炎の支配者' → 'Ruler of the Black Flame'). Match the canonical English name from the set reference below when possible. Never return non-Latin script.",
  "set_code": "internal set code — match the set abbreviation or symbol visible on the card to the reference list below and return the exact code, e.g. 'SV8a' or 'SM1' or 'XY4' or null",
  "card_number": "card number only, e.g. '006' or '034/087'",
  "rarity": "rarity if visible in English, e.g. 'Holo' or '1st Edition'",
  "language": "EN | JP | KR — the language printed on the card itself, NOT the language of the returned card_name/set_name",
  "game": "${game}",
  "grading_company": "PSA | BGS | CGC | SGC | HGA | ACE | ARS | null",
  "grade": 10,
  "grade_label": "grade label text, e.g. 'GEM MT' or 'EXCELLENT-MINT'",
  "cert_number": "cert number if visible, e.g. '26354848'"
}

CRITICAL: card_name and set_name MUST be in English even when the card is Japanese, Korean, etc. The "language" field captures what's printed on the card; the names you return must always be Latin script for catalog matching.

Set code reference (canonical English names — match these exactly when the card's set is in the list):
EN set codes — ${enLines}
JP set codes — ${jpLines}
${VISION_RULES ? `\nCorrection rules from prior user feedback — apply these strictly:\n${VISION_RULES}\n` : ''}${VISION_EXAMPLES ? `\nReference examples:\n${VISION_EXAMPLES}\n` : ''}
If not a card image, return null.`;
}

// Cache the built prompt per game so we don't rebuild the ~2.5k-token
// set-code reference on every call. Different from the Anthropic prompt cache
// (which caches on their side across API calls); this is process-local memo.
const cardPromptCache = new Map<string, string>();

export async function extractCardInfoFromImage(
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp',
  game: string,
): Promise<ImageCardExtractionResult | null> {
  let systemPrompt = cardPromptCache.get(game);
  if (!systemPrompt) {
    systemPrompt = buildCardExtractionSystemPrompt(game);
    cardPromptCache.set(game, systemPrompt);
  }
  const response = await anthropic.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 768,
    system: [
      { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: 'Extract per the schema above. Return null if not a card.' },
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

// ── Order parsing (text + image) ────────────────────────────────────────────

export interface ParsedOrderEntry {
  title: string;
  cert_number: string | null;
}

// Stable across every call — moving into a top-level const means the ephemeral
// cache_control block can key off it without recomputing on each request.
const PARSE_ORDER_SCHEMA = `Return ONLY a JSON array (no prose) of extracted card listings.
Each entry is { "title": "<full listing title>", "cert_number": "<PSA/BGS/CGC cert number as digits only, or null>" }.
Skip anything that isn't a card listing (headers, ship-to addresses, tracking numbers, totals).
Title should preserve the exact listing name as written. Cert number appears only if visible in the entry.`;

// Exported for tests — internal helper, prefer extractOrderEntriesFromText /
// FromImage from production code.
export function parseOrderEntries(raw: string): ParsedOrderEntry[] {
  try {
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    const json = start !== -1 && end !== -1 ? raw.slice(start, end + 1) : raw.trim();
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is { title: unknown; cert_number?: unknown } => x && typeof x === 'object')
      .map((x) => ({
        title: typeof x.title === 'string' ? x.title.trim() : '',
        cert_number:
          typeof x.cert_number === 'string' && /^\d+$/.test(x.cert_number.trim())
            ? x.cert_number.trim()
            : null,
      }))
      .filter((e) => e.title.length > 0);
  } catch {
    return [];
  }
}

export async function extractOrderEntriesFromText(text: string): Promise<ParsedOrderEntry[]> {
  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4000,
    system: [
      { type: 'text', text: PARSE_ORDER_SCHEMA, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      { role: 'user', content: `Text to parse:\n\n${text}` },
    ],
  });
  const raw = res.content.find((b) => b.type === 'text')?.text ?? '[]';
  return parseOrderEntries(raw);
}

export async function extractOrderEntriesFromImage(
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp',
): Promise<ParsedOrderEntry[]> {
  const res = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: [
      { type: 'text', text: PARSE_ORDER_SCHEMA, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: 'Extract per the schema above.' },
        ],
      },
    ],
  });
  const raw = res.content.find((b) => b.type === 'text')?.text ?? '[]';
  return parseOrderEntries(raw);
}
