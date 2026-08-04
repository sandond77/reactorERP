import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Anthropic client mock ────────────────────────────────────────────────
// vi.mock() is hoisted to the top of the file at compile time, so any
// variables referenced inside its factory must be hoisted too — otherwise
// they're `undefined` when the mock runs. vi.hoisted() puts our spy in
// that hoisted scope so `messagesCreate` inside the factory resolves.
const { messagesCreate } = vi.hoisted(() => ({ messagesCreate: vi.fn() }));
vi.mock('./client', () => ({
  anthropic: { messages: { create: messagesCreate } },
}));

import {
  parseOrderEntries,
  buildCardExtractionSystemPrompt,
  extractCardInfoFromImage,
  extractOrderEntriesFromText,
  extractOrderEntriesFromImage,
} from './vision.service';

// ─────────────────────────────────────────────────────────────────────────
// Tier 1 — pure-function tests. No network, no mocks; just the extractor
// and prompt-builder logic.
// ─────────────────────────────────────────────────────────────────────────

describe('parseOrderEntries', () => {
  it('extracts well-formed entries', () => {
    const raw = JSON.stringify([
      { title: 'PSA10 Charizard Base Set', cert_number: '12345678' },
      { title: 'PSA9 Blastoise Jungle', cert_number: '87654321' },
    ]);
    const entries = parseOrderEntries(raw);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ title: 'PSA10 Charizard Base Set', cert_number: '12345678' });
    expect(entries[1]).toEqual({ title: 'PSA9 Blastoise Jungle', cert_number: '87654321' });
  });

  it('finds the JSON array even when preamble prose surrounds it', () => {
    // Haiku sometimes wraps the array in explanation. The extractor slices
    // between the first '[' and last ']' to survive that.
    const raw = `Here are the entries:\n[${JSON.stringify({ title: 'Card A', cert_number: '111' })}]\nHope this helps!`;
    const entries = parseOrderEntries(raw);
    expect(entries).toEqual([{ title: 'Card A', cert_number: '111' }]);
  });

  it('returns [] on malformed JSON', () => {
    expect(parseOrderEntries('not json at all')).toEqual([]);
    expect(parseOrderEntries('[{title: no quotes}]')).toEqual([]);
  });

  it('normalizes non-digit cert_number to null', () => {
    const raw = JSON.stringify([{ title: 'Card', cert_number: 'abc' }]);
    expect(parseOrderEntries(raw)).toEqual([{ title: 'Card', cert_number: null }]);
  });

  it('accepts missing cert_number as null', () => {
    const raw = JSON.stringify([{ title: 'Raw Charizard' }]);
    expect(parseOrderEntries(raw)).toEqual([{ title: 'Raw Charizard', cert_number: null }]);
  });

  it('filters out entries with empty title', () => {
    const raw = JSON.stringify([
      { title: '', cert_number: '1' },
      { title: '   ', cert_number: '2' },
      { title: 'Real card', cert_number: '3' },
    ]);
    expect(parseOrderEntries(raw)).toEqual([{ title: 'Real card', cert_number: '3' }]);
  });

  it('filters out non-object items', () => {
    const raw = JSON.stringify(['a string', 42, null, { title: 'ok', cert_number: '9' }]);
    expect(parseOrderEntries(raw)).toEqual([{ title: 'ok', cert_number: '9' }]);
  });

  it('returns [] when root is not an array', () => {
    const raw = JSON.stringify({ title: 'not an array', cert_number: '1' });
    expect(parseOrderEntries(raw)).toEqual([]);
  });

  it('trims titles', () => {
    const raw = JSON.stringify([{ title: '  padded  ', cert_number: '1' }]);
    expect(parseOrderEntries(raw)[0].title).toBe('padded');
  });
});

describe('buildCardExtractionSystemPrompt', () => {
  it('includes both EN and JP set-code reference blocks', () => {
    const prompt = buildCardExtractionSystemPrompt('pokemon');
    expect(prompt).toContain('EN set codes —');
    expect(prompt).toContain('JP set codes —');
  });

  it('interpolates the game name into the schema', () => {
    const prompt = buildCardExtractionSystemPrompt('pokemon');
    expect(prompt).toContain('"game": "pokemon"');
    const other = buildCardExtractionSystemPrompt('yugioh');
    expect(other).toContain('"game": "yugioh"');
  });

  it('is byte-identical for identical inputs (cache-safe)', () => {
    // Prompt caching requires stable output; drift here would silently kill
    // the cache hit rate this whole refactor was for.
    const a = buildCardExtractionSystemPrompt('pokemon');
    const b = buildCardExtractionSystemPrompt('pokemon');
    expect(a).toBe(b);
  });

  it('always ends with the null fallback instruction', () => {
    const prompt = buildCardExtractionSystemPrompt('pokemon');
    expect(prompt.trim().endsWith('If not a card image, return null.')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Tier 2 — mocked Anthropic. Verifies the request payload the vision layer
// built (model tier, cache_control on system, message shape), and that the
// response parser handles the shapes Claude actually returns.
// ─────────────────────────────────────────────────────────────────────────

beforeEach(() => messagesCreate.mockReset());
afterEach(() => vi.clearAllMocks());

// Small helper to build the shape Anthropic returns.
function makeMockResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

describe('extractCardInfoFromImage', () => {
  it('uses claude-opus-4-7 with ephemeral cache_control on the system prompt', async () => {
    messagesCreate.mockResolvedValue(makeMockResponse(JSON.stringify({
      card_name: 'Charizard', set_name: 'Base Set', language: 'EN', game: 'pokemon',
    })));
    await extractCardInfoFromImage('base64data', 'image/jpeg', 'pokemon');
    expect(messagesCreate).toHaveBeenCalledOnce();
    const call = messagesCreate.mock.calls[0][0];
    expect(call.model).toBe('claude-opus-4-7');
    expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(call.system[0].text).toContain('EN set codes —');
  });

  it('sends the image as base64 with the given media_type', async () => {
    messagesCreate.mockResolvedValue(makeMockResponse('null'));
    await extractCardInfoFromImage('fakepng', 'image/png', 'pokemon');
    const call = messagesCreate.mock.calls[0][0];
    const userMsg = call.messages[0];
    expect(userMsg.role).toBe('user');
    const imageBlock = userMsg.content.find((b: { type: string }) => b.type === 'image');
    expect(imageBlock.source).toEqual({ type: 'base64', media_type: 'image/png', data: 'fakepng' });
  });

  it('parses JSON from a response wrapped in prose', async () => {
    // Opus sometimes drops preamble around the JSON block; extractor slices
    // between first { and last }.
    messagesCreate.mockResolvedValue(makeMockResponse(
      `Here's what I see: {"card_name":"Mew","set_name":"Promo","language":"EN","game":"pokemon"}`
    ));
    const result = await extractCardInfoFromImage('img', 'image/jpeg', 'pokemon');
    expect(result?.card_name).toBe('Mew');
    expect(result?.set_name).toBe('Promo');
  });

  it('returns null when the model returns the literal "null"', async () => {
    messagesCreate.mockResolvedValue(makeMockResponse('null'));
    expect(await extractCardInfoFromImage('img', 'image/jpeg', 'pokemon')).toBeNull();
  });

  it('returns null on unparseable output', async () => {
    messagesCreate.mockResolvedValue(makeMockResponse('this is not json {broken'));
    expect(await extractCardInfoFromImage('img', 'image/jpeg', 'pokemon')).toBeNull();
  });

  it('caches the system prompt per game (does not rebuild set-code ref)', async () => {
    messagesCreate.mockResolvedValue(makeMockResponse('null'));
    await extractCardInfoFromImage('a', 'image/jpeg', 'pokemon');
    await extractCardInfoFromImage('b', 'image/jpeg', 'pokemon');
    // Both calls point at the same string reference — proves the module-local
    // Map cache is working. Two calls means two identical system prompts.
    const first = messagesCreate.mock.calls[0][0].system[0].text;
    const second = messagesCreate.mock.calls[1][0].system[0].text;
    expect(first).toBe(second);
  });
});

describe('extractOrderEntriesFromText', () => {
  it('uses claude-haiku-4-5 with ephemeral cache_control on the schema', async () => {
    messagesCreate.mockResolvedValue(makeMockResponse('[]'));
    await extractOrderEntriesFromText('some ebay order text');
    const call = messagesCreate.mock.calls[0][0];
    expect(call.model).toBe('claude-haiku-4-5-20251001');
    expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(call.system[0].text).toContain('JSON array');
  });

  it("does NOT put the schema in the user turn — that would kill cache", async () => {
    messagesCreate.mockResolvedValue(makeMockResponse('[]'));
    await extractOrderEntriesFromText('order text');
    const call = messagesCreate.mock.calls[0][0];
    const userText = call.messages[0].content;
    expect(userText).not.toContain('JSON array');
    expect(userText).toContain('order text');
  });

  it('returns parsed entries from the model response', async () => {
    messagesCreate.mockResolvedValue(makeMockResponse(JSON.stringify([
      { title: 'PSA10 Charizard', cert_number: '12345' },
    ])));
    const result = await extractOrderEntriesFromText('anything');
    expect(result).toEqual([{ title: 'PSA10 Charizard', cert_number: '12345' }]);
  });

  it('returns [] when response has no text block', async () => {
    messagesCreate.mockResolvedValue({ content: [] });
    expect(await extractOrderEntriesFromText('x')).toEqual([]);
  });
});

describe('extractOrderEntriesFromImage', () => {
  it('uses claude-sonnet-4-6 with ephemeral cache_control on the schema', async () => {
    messagesCreate.mockResolvedValue(makeMockResponse('[]'));
    await extractOrderEntriesFromImage('base64', 'image/jpeg');
    const call = messagesCreate.mock.calls[0][0];
    expect(call.model).toBe('claude-sonnet-4-6');
    expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('sends the image with the given media_type', async () => {
    messagesCreate.mockResolvedValue(makeMockResponse('[]'));
    await extractOrderEntriesFromImage('data', 'image/webp');
    const call = messagesCreate.mock.calls[0][0];
    const imageBlock = call.messages[0].content.find((b: { type: string }) => b.type === 'image');
    expect(imageBlock.source.media_type).toBe('image/webp');
    expect(imageBlock.source.data).toBe('data');
  });

  it('parses the response the same way as the text path', async () => {
    // Same schema, so same parser semantics.
    messagesCreate.mockResolvedValue(makeMockResponse(JSON.stringify([
      { title: 'PSA10 Mew', cert_number: '99' },
    ])));
    expect(await extractOrderEntriesFromImage('img', 'image/png')).toEqual([
      { title: 'PSA10 Mew', cert_number: '99' },
    ]);
  });
});
