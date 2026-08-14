// ────────────────────────────────────────────────────────────────────────────
// Receipts subagent — expense-receipt OCR.
//
// One responsibility: take a photo of an expense receipt (shipping label,
// grading invoice, card-show table fee, restaurant tab on a hobby trip, etc.)
// and return the fields needed to prefill a `record_expense`:
// { date, description, type, amount, currency, order_number, ... }.
//
// Design choices worth noting:
//   - Model: Sonnet 4.6 vision. Expense receipts are structurally simple text
//     images. Opus is overkill (~5× the cost) and Haiku loses too often on
//     handwritten or low-contrast prints. Sonnet is the sweet spot.
//   - Cache: system prompt is a top-level constant with `cache_control:
//     ephemeral`. Every receipt scan shares the same prompt, so after the
//     first call in a 5-min window the ~350-token system block is a cache
//     read for pennies. Moving the prompt into the user turn (as the pre-
//     refactor implementation had it) would kill the cache — the user turn
//     always contains the image, so its cache key changes every call.
// ────────────────────────────────────────────────────────────────────────────

import { anthropic } from './client';

export interface ParsedExpenseData {
  date?: string;
  description?: string;
  type?: string;
  amount?: number;
  currency?: string;
  order_number?: string;
  link?: string;
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
}

const EXPENSE_RECEIPT_SYSTEM_PROMPT = `You are an expert at parsing expense receipts, invoices, and order confirmations for a trading-card business.

Extract structured expense data from the receipt image and return ONLY a JSON object matching the schema below. No markdown, no prose, no code fences.

Known expense types (use one if it matches, otherwise suggest a short custom label):
Shipping, Grading, Supplies, Card Show, Food, Travel, Other

For order_number: extract ANY reference identifier on the receipt — Order #, Ordr#, ORDR#, Order ID, Confirmation #, Transaction #, Receipt #, Check #, Ticket #, Invoice #, Reference #, or similar. Do NOT leave this null if any such number appears on the receipt.

Return this exact JSON shape:
{
  "date": "YYYY-MM-DD or null",
  "description": "concise description of what was purchased (max 80 chars)",
  "type": "best matching type from the list above, or a short custom label",
  "amount": number in dollars (e.g. 12.99) or null,
  "currency": "USD" or "JPY" or null,
  "order_number": "any order/reference/confirmation/ticket number, or null if truly none",
  "link": null,
  "confidence": "high" | "medium" | "low",
  "notes": "any caveats or null"
}`;

const EXPENSE_RECEIPT_USER_PROMPT =
  'Parse this receipt per the schema above and return only the JSON object.';

export function parseExpenseResponse(raw: string): ParsedExpenseData {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) {
    return { confidence: 'low', notes: 'Failed to parse model response' };
  }
  try {
    return JSON.parse(raw.slice(start, end + 1)) as ParsedExpenseData;
  } catch {
    return { confidence: 'low', notes: 'Failed to parse model response' };
  }
}

export async function parseExpenseImage(
  imageBase64: string,
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp',
): Promise<ParsedExpenseData> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: [
      { type: 'text', text: EXPENSE_RECEIPT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: EXPENSE_RECEIPT_USER_PROMPT },
        ],
      },
    ],
  });

  const text = response.content.find((b) => b.type === 'text')?.text ?? '{}';
  return parseExpenseResponse(text);
}
