import { describe, it, expect, vi, beforeEach } from 'vitest';

const { messagesCreate } = vi.hoisted(() => ({ messagesCreate: vi.fn() }));
vi.mock('./client', () => ({
  anthropic: { messages: { create: messagesCreate } },
}));

import {
  parseAiReturnMatches,
  suggestReturnMatches,
  type UnmatchedBatchItem,
  type UnusedCandidate,
} from './return-matching.service';

// ─── Tier 1: pure parsing / dedupe ───────────────────────────────────────

describe('parseAiReturnMatches', () => {
  it('extracts a clean array', () => {
    const raw = JSON.stringify([
      { batch_item_id: 'bi-1', csv_index: 4, confidence: 'strong', reasoning: 'exact name and #' },
      { batch_item_id: 'bi-2', csv_index: 7, confidence: 'good',   reasoning: 'name matches' },
    ]);
    const out = parseAiReturnMatches(raw);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ batch_item_id: 'bi-1', csv_index: 4, confidence: 'strong', reasoning: 'exact name and #' });
  });

  it('finds the array inside prose', () => {
    const raw = `Here are the matches you asked for:\n[{"batch_item_id":"bi-1","csv_index":0,"confidence":"weak","reasoning":"only guess"}]\nhope this helps`;
    const out = parseAiReturnMatches(raw);
    expect(out).toEqual([{ batch_item_id: 'bi-1', csv_index: 0, confidence: 'weak', reasoning: 'only guess' }]);
  });

  it('normalises invalid confidence values to weak', () => {
    const raw = JSON.stringify([
      { batch_item_id: 'bi-1', csv_index: 3, confidence: 'certain', reasoning: 'x' },
    ]);
    const out = parseAiReturnMatches(raw);
    expect(out[0].confidence).toBe('weak');
  });

  it('drops entries missing batch_item_id or csv_index', () => {
    const raw = JSON.stringify([
      { batch_item_id: '', csv_index: 3, confidence: 'good' },
      { batch_item_id: 'bi-1', csv_index: 'NaN', confidence: 'good' },
      { batch_item_id: 'bi-2', csv_index: 5, confidence: 'good', reasoning: 'ok' },
    ]);
    const out = parseAiReturnMatches(raw);
    expect(out).toHaveLength(1);
    expect(out[0].batch_item_id).toBe('bi-2');
  });

  it('returns [] on malformed JSON without throwing', () => {
    expect(parseAiReturnMatches('not json')).toEqual([]);
    expect(parseAiReturnMatches('[{unquoted}]')).toEqual([]);
    expect(parseAiReturnMatches('')).toEqual([]);
  });

  it('returns [] when the top-level shape is not an array', () => {
    // Wrong shape — object instead of array. Silently ignored, never crashes.
    // A malformed array-shape would throw the JSON.parse into the catch; a
    // valid-JSON object never even reaches the array iteration.
    expect(parseAiReturnMatches('{"matches":[]}')).toEqual([]);
  });
});

// ─── Tier 2: mocked Anthropic client ─────────────────────────────────────

const anyItem = (id: string, overrides: Partial<UnmatchedBatchItem> = {}): UnmatchedBatchItem => ({
  batch_item_id: id,
  card_name: 'Card ' + id,
  set_name: 'Set',
  card_number: '001',
  language: 'EN',
  expected_grade: 10,
  line_item_num: 1,
  ...overrides,
});
const anyCand = (idx: number, overrides: Partial<UnusedCandidate> = {}): UnusedCandidate => ({
  csv_index: idx,
  subject: 'candidate ' + idx,
  cert: '10000000' + idx,
  grade: 10,
  ...overrides,
});

describe('suggestReturnMatches', () => {
  beforeEach(() => {
    messagesCreate.mockReset();
  });

  it('short-circuits when either side is empty (no API call)', async () => {
    const empty = await suggestReturnMatches({ batch_items: [], candidates: [anyCand(0)] });
    expect(empty).toEqual([]);
    const empty2 = await suggestReturnMatches({ batch_items: [anyItem('a')], candidates: [] });
    expect(empty2).toEqual([]);
    expect(messagesCreate).not.toHaveBeenCalled();
  });

  it('uses Haiku 4.5 (text-only, cheap for matching)', async () => {
    messagesCreate.mockResolvedValue({ content: [{ type: 'text', text: '[]' }] });
    await suggestReturnMatches({ batch_items: [anyItem('a')], candidates: [anyCand(0)] });
    expect(messagesCreate.mock.calls[0][0].model).toBe('claude-haiku-4-5-20251001');
  });

  it('marks system prompt as ephemeral-cached and keeps it byte-stable across calls', async () => {
    messagesCreate.mockResolvedValue({ content: [{ type: 'text', text: '[]' }] });
    await suggestReturnMatches({ batch_items: [anyItem('a')], candidates: [anyCand(0)] });
    await suggestReturnMatches({ batch_items: [anyItem('b')], candidates: [anyCand(0)] });
    const s1 = messagesCreate.mock.calls[0][0].system[0];
    const s2 = messagesCreate.mock.calls[1][0].system[0];
    expect(s1.cache_control).toEqual({ type: 'ephemeral' });
    expect(s1.text).toBe(s2.text);
    expect(s1.text).toContain('Match rules');
  });

  it('deduplicates: same batch_item_id in two matches, higher-confidence wins', async () => {
    // Model returns two matches for the same batch item — this shouldn't
    // happen per the prompt, but the greedy dedupe guarantees uniqueness so
    // one weak dupe can't overwrite a strong one downstream.
    messagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify([
        { batch_item_id: 'a', csv_index: 5, confidence: 'weak',   reasoning: 'maybe' },
        { batch_item_id: 'a', csv_index: 0, confidence: 'strong', reasoning: 'exact' },
      ]) }],
    });
    const out = await suggestReturnMatches({
      batch_items: [anyItem('a')],
      candidates: [anyCand(0), anyCand(5)],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ batch_item_id: 'a', csv_index: 0, confidence: 'strong' });
  });

  it('deduplicates: same csv_index across two matches also enforces uniqueness', async () => {
    messagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify([
        { batch_item_id: 'a', csv_index: 3, confidence: 'good',   reasoning: 'ok' },
        { batch_item_id: 'b', csv_index: 3, confidence: 'strong', reasoning: 'exact' },
      ]) }],
    });
    const out = await suggestReturnMatches({
      batch_items: [anyItem('a'), anyItem('b')],
      candidates: [anyCand(3)],
    });
    expect(out).toHaveLength(1);
    expect(out[0].batch_item_id).toBe('b');
  });

  it('gracefully returns [] when the model outputs unparseable text', async () => {
    messagesCreate.mockResolvedValue({ content: [{ type: 'text', text: 'sorry, I could not find any' }] });
    const out = await suggestReturnMatches({
      batch_items: [anyItem('a')],
      candidates: [anyCand(0)],
    });
    expect(out).toEqual([]);
  });

  it('includes the payload as a user turn (not stuffed into the system)', async () => {
    // If the payload lived in the system block, every batch would bust the
    // cache. This test freezes the contract: system is prompt-only, user
    // turn carries the data.
    messagesCreate.mockResolvedValue({ content: [{ type: 'text', text: '[]' }] });
    await suggestReturnMatches({
      batch_items: [anyItem('a', { card_name: 'Charizard' })],
      candidates: [anyCand(0, { subject: 'Charizard Base Set' })],
    });
    const call = messagesCreate.mock.calls[0][0];
    expect(call.system[0].text).not.toContain('Charizard');
    expect(call.messages[0].content).toContain('Charizard');
  });
});
