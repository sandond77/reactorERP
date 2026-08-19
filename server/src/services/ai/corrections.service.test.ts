import { describe, it, expect } from 'vitest';
// Import from the pure module — the .service file pulls in db config, which
// would trip env validation in the test process.
import { diffFields } from './corrections.diff';

describe('diffFields', () => {
  it('returns [] when model and final are identical', () => {
    const same = { card_name: 'Charizard', set_name: 'Basic' };
    expect(diffFields(same, { ...same })).toEqual([]);
  });

  it('returns only fields whose values changed', () => {
    const model = { card_name: 'Charizard', set_name: 'Basic', card_number: '004' };
    const final = { card_name: 'Charizard', set_name: 'Base Set', card_number: '004' };
    expect(diffFields(model, final)).toEqual(['set_name']);
  });

  it('treats null / undefined / empty-string as equivalent (no false positive)', () => {
    // AI often returns null; user leaves the field blank in the form. That's
    // agreement, not a correction — otherwise every skipped optional field
    // would look like an edit.
    const model = { rarity: null, variant: null, notes: undefined };
    const final = { rarity: '', variant: undefined, notes: null };
    expect(diffFields(model, final)).toEqual([]);
  });

  it('flags added fields on the final side (user filled in what AI missed)', () => {
    const model = { card_name: 'Mew', rarity: null };
    const final = { card_name: 'Mew', rarity: 'Holo' };
    expect(diffFields(model, final)).toEqual(['rarity']);
  });

  it('flags removed fields on the final side (user cleared what AI over-filled)', () => {
    const model = { card_name: 'Mew', rarity: 'Holo' };
    const final = { card_name: 'Mew', rarity: '' };
    expect(diffFields(model, final)).toEqual(['rarity']);
  });

  it('deep-equals nested objects via JSON stringify', () => {
    const model = { grade: { company: 'PSA', value: 10 } };
    const final = { grade: { company: 'PSA', value: 10 } };
    expect(diffFields(model, final)).toEqual([]);

    const changed = { grade: { company: 'PSA', value: 9 } };
    expect(diffFields(model, changed)).toEqual(['grade']);
  });

  it('returns sorted field names for deterministic clustering', () => {
    // The curation script groups by field name; deterministic ordering means
    // two corrections with the same changed fields hash the same regardless
    // of which order the JSON keys came out in.
    const model = { a: 1, b: 1, c: 1 };
    const final = { c: 2, b: 2, a: 2 };
    expect(diffFields(model, final)).toEqual(['a', 'b', 'c']);
  });

  it('returns [] safely on non-object inputs (guards against schema drift)', () => {
    expect(diffFields(null, null)).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(diffFields('string' as any, 'string' as any)).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(diffFields({ a: 1 }, null as any)).toEqual([]);
  });
});
