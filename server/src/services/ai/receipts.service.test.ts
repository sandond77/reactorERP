import { describe, it, expect, vi, beforeEach } from 'vitest';

const { messagesCreate } = vi.hoisted(() => ({ messagesCreate: vi.fn() }));
vi.mock('./client', () => ({
  anthropic: { messages: { create: messagesCreate } },
}));

import { parseExpenseImage, parseExpenseResponse } from './receipts.service';

// ─── Tier 1: pure parsing ────────────────────────────────────────────────

describe('parseExpenseResponse', () => {
  it('parses a well-formed JSON body', () => {
    const raw = JSON.stringify({
      date: '2026-08-06',
      description: 'PSA regular tier submission',
      type: 'Grading',
      amount: 300,
      currency: 'USD',
      order_number: 'PSA-8765',
      link: null,
      confidence: 'high',
      notes: null,
    });
    const out = parseExpenseResponse(raw);
    expect(out.type).toBe('Grading');
    expect(out.amount).toBe(300);
    expect(out.order_number).toBe('PSA-8765');
  });

  it('slices the JSON out of prose-wrapped output', () => {
    const raw = 'Here is the expense:\n{"type":"Shipping","amount":8.5,"confidence":"medium"}\nHope that helps.';
    const out = parseExpenseResponse(raw);
    expect(out.type).toBe('Shipping');
    expect(out.amount).toBe(8.5);
    expect(out.confidence).toBe('medium');
  });

  it('returns a low-confidence stub on malformed JSON instead of throwing', () => {
    // Regression: the pre-refactor version blew up with an uncaught
    // SyntaxError when the model surfaced non-JSON, which surfaced to the
    // user as an opaque 500. Now the parse errors are contained.
    const out = parseExpenseResponse('sorry, I cannot read this receipt');
    expect(out.confidence).toBe('low');
    expect(out.notes).toContain('Failed to parse');
  });

  it('returns a low-confidence stub on an empty body', () => {
    const out = parseExpenseResponse('');
    expect(out.confidence).toBe('low');
  });
});

// ─── Tier 2: mocked Anthropic client ─────────────────────────────────────

describe('parseExpenseImage', () => {
  beforeEach(() => {
    messagesCreate.mockReset();
  });

  function respondWith(json: object) {
    messagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify(json) }],
    });
  }

  it('uses claude-sonnet-4-6 (not Opus 4.7 — Sonnet is the receipt sweet spot)', async () => {
    respondWith({ type: 'Shipping', amount: 4.5, confidence: 'high' });
    await parseExpenseImage('imgbase64', 'image/jpeg');
    expect(messagesCreate).toHaveBeenCalledOnce();
    const call = messagesCreate.mock.calls[0][0];
    expect(call.model).toBe('claude-sonnet-4-6');
  });

  it('attaches cache_control: ephemeral to the system block (cache-hit contract)', async () => {
    respondWith({ confidence: 'high' });
    await parseExpenseImage('imgbase64', 'image/jpeg');
    const call = messagesCreate.mock.calls[0][0];
    // System is an array of typed blocks — first (and only) block carries the cache marker.
    expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(typeof call.system[0].text).toBe('string');
    expect(call.system[0].text).toContain('expense');
  });

  it('keeps the system prompt byte-identical across calls (the cache-key invariant)', async () => {
    respondWith({ confidence: 'high' });
    await parseExpenseImage('imgA', 'image/jpeg');
    await parseExpenseImage('imgB', 'image/png');
    const promptA = messagesCreate.mock.calls[0][0].system[0].text;
    const promptB = messagesCreate.mock.calls[1][0].system[0].text;
    expect(promptA).toBe(promptB);
  });

  it('passes the image bytes and media type through unchanged', async () => {
    respondWith({ confidence: 'high' });
    await parseExpenseImage('deadbeef', 'image/png');
    const call = messagesCreate.mock.calls[0][0];
    const userContent = call.messages[0].content;
    const imageBlock = userContent.find((b: { type: string }) => b.type === 'image');
    expect(imageBlock.source).toEqual({ type: 'base64', media_type: 'image/png', data: 'deadbeef' });
  });

  it('parses the model response through the shared parser', async () => {
    respondWith({
      date: '2026-08-06',
      description: 'Card Show table',
      type: 'Card Show',
      amount: 175,
      currency: 'USD',
      confidence: 'high',
    });
    const out = await parseExpenseImage('img', 'image/jpeg');
    expect(out.type).toBe('Card Show');
    expect(out.amount).toBe(175);
    expect(out.date).toBe('2026-08-06');
  });

  it('handles no-text-block responses without throwing', async () => {
    messagesCreate.mockResolvedValue({ content: [] });
    const out = await parseExpenseImage('img', 'image/jpeg');
    // No text block → parseExpenseResponse gets '{}' → valid empty object,
    // NOT a "low confidence" stub. Confidence is undefined here.
    expect(out.confidence).toBeUndefined();
  });
});
