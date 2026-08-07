import { describe, it, expect } from 'vitest';
import {
  getTimezoneOffsetMinutes,
  localMidnightUtc,
  localYearStartUtc,
  safeTz,
  localYear,
  localYmd,
} from './tz';

describe('safeTz', () => {
  it('passes valid IANA names through', () => {
    expect(safeTz('America/Los_Angeles')).toBe('America/Los_Angeles');
    expect(safeTz('Asia/Tokyo')).toBe('Asia/Tokyo');
    expect(safeTz('UTC')).toBe('UTC');
  });

  it('falls back to UTC on undefined', () => {
    expect(safeTz(undefined)).toBe('UTC');
  });

  it('falls back to UTC on empty string', () => {
    expect(safeTz('')).toBe('UTC');
  });

  it('falls back to UTC on garbage input', () => {
    expect(safeTz('Not/A/Real/Zone')).toBe('UTC');
    expect(safeTz('foo bar')).toBe('UTC');
  });
});

describe('getTimezoneOffsetMinutes', () => {
  it('returns 0 for UTC', () => {
    expect(getTimezoneOffsetMinutes('UTC', new Date('2026-06-15T12:00:00Z'))).toBe(0);
  });

  it('returns -420 for LA in June (PDT = UTC-7)', () => {
    // 2026-06-15 is squarely inside daylight time.
    expect(getTimezoneOffsetMinutes('America/Los_Angeles', new Date('2026-06-15T12:00:00Z'))).toBe(-420);
  });

  it('returns -480 for LA in January (PST = UTC-8)', () => {
    expect(getTimezoneOffsetMinutes('America/Los_Angeles', new Date('2026-01-15T12:00:00Z'))).toBe(-480);
  });

  it('returns +540 for Tokyo year-round (no DST)', () => {
    expect(getTimezoneOffsetMinutes('Asia/Tokyo', new Date('2026-01-15T12:00:00Z'))).toBe(540);
    expect(getTimezoneOffsetMinutes('Asia/Tokyo', new Date('2026-07-15T12:00:00Z'))).toBe(540);
  });
});

describe('localMidnightUtc', () => {
  it('resolves LA local midnight during PDT', () => {
    // Aug 6 19:00 PDT = Aug 7 02:00 UTC. LA midnight for that instant
    // is Aug 6 00:00 PDT = Aug 6 07:00 UTC.
    const now = new Date('2026-08-07T02:00:00Z');
    const result = localMidnightUtc('America/Los_Angeles', now);
    expect(result.toISOString()).toBe('2026-08-06T07:00:00.000Z');
  });

  it('resolves LA local midnight during PST', () => {
    // Jan 15 19:00 PST = Jan 16 03:00 UTC. LA midnight = Jan 15 08:00 UTC.
    const now = new Date('2026-01-16T03:00:00Z');
    const result = localMidnightUtc('America/Los_Angeles', now);
    expect(result.toISOString()).toBe('2026-01-15T08:00:00.000Z');
  });

  it('resolves Tokyo local midnight', () => {
    // Aug 6 15:00 UTC = Aug 7 00:00 JST — user is already in the next day.
    // Local midnight = Aug 7 00:00 JST = Aug 6 15:00 UTC.
    const now = new Date('2026-08-06T16:00:00Z');
    const result = localMidnightUtc('Asia/Tokyo', now);
    expect(result.toISOString()).toBe('2026-08-06T15:00:00.000Z');
  });

  it('is a no-op for UTC', () => {
    const now = new Date('2026-08-06T14:30:00Z');
    const result = localMidnightUtc('UTC', now);
    expect(result.toISOString()).toBe('2026-08-06T00:00:00.000Z');
  });

  it('handles year-boundary near local midnight', () => {
    // Dec 31 23:30 PST = Jan 1 07:30 UTC. LA midnight = Dec 31 00:00 PST
    // = Dec 31 08:00 UTC (still same day locally, so "today" hasn't rolled).
    const now = new Date('2027-01-01T07:30:00Z');
    const result = localMidnightUtc('America/Los_Angeles', now);
    expect(result.toISOString()).toBe('2026-12-31T08:00:00.000Z');
  });
});

describe('localYearStartUtc', () => {
  it('returns Jan 1 midnight PST for LA in Feb', () => {
    // Feb 15 12:00 UTC — LA is still in PST. Jan 1 midnight PST = Jan 1 08:00 UTC.
    const now = new Date('2026-02-15T12:00:00Z');
    const result = localYearStartUtc('America/Los_Angeles', now);
    expect(result.toISOString()).toBe('2026-01-01T08:00:00.000Z');
  });

  it('returns previous year Jan 1 when caller is late in previous year', () => {
    // Dec 31 23:30 PST 2026 = Jan 1 07:30 UTC 2027. Local year is still 2026.
    const now = new Date('2027-01-01T07:30:00Z');
    const result = localYearStartUtc('America/Los_Angeles', now);
    expect(result.toISOString()).toBe('2026-01-01T08:00:00.000Z');
  });

  it('returns Jan 1 UTC for UTC caller', () => {
    const now = new Date('2026-08-06T14:30:00Z');
    const result = localYearStartUtc('UTC', now);
    expect(result.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns Jan 1 JST for Tokyo caller', () => {
    // Jan 15 12:00 UTC — Tokyo is Jan 15 21:00. Jan 1 midnight JST = Dec 31 15:00 UTC.
    const now = new Date('2026-01-15T12:00:00Z');
    const result = localYearStartUtc('Asia/Tokyo', now);
    expect(result.toISOString()).toBe('2025-12-31T15:00:00.000Z');
  });
});

describe('localYear', () => {
  it('returns current wall-clock year in LA', () => {
    // Late 2026 UTC but still 2026 in LA.
    expect(localYear('America/Los_Angeles', new Date('2026-08-06T20:00:00Z'))).toBe(2026);
  });

  it('returns previous year on Dec 31 evening PST when UTC has rolled over', () => {
    // Dec 31 23:30 PST 2026 = Jan 1 07:30 UTC 2027.
    // The user still writes "2026" on paper, so a purchase_id should say 2026.
    expect(localYear('America/Los_Angeles', new Date('2027-01-01T07:30:00Z'))).toBe(2026);
  });

  it('returns next year in Tokyo when UTC is still Dec 31', () => {
    // Dec 31 16:00 UTC = Jan 1 01:00 JST — Tokyo already rolled over.
    expect(localYear('Asia/Tokyo', new Date('2026-12-31T16:00:00Z'))).toBe(2027);
  });

  it('returns UTC year for UTC caller', () => {
    expect(localYear('UTC', new Date('2026-06-15T12:00:00Z'))).toBe(2026);
  });
});

describe('localYmd', () => {
  it('returns YYYY-MM-DD in caller tz', () => {
    // Aug 6 19:00 PDT = Aug 7 02:00 UTC.
    expect(localYmd('America/Los_Angeles', new Date('2026-08-07T02:00:00Z'))).toBe('2026-08-06');
  });

  it('returns UTC date for UTC caller', () => {
    expect(localYmd('UTC', new Date('2026-08-07T02:00:00Z'))).toBe('2026-08-07');
  });

  it('handles Tokyo rollover', () => {
    // Aug 6 15:30 UTC = Aug 7 00:30 JST.
    expect(localYmd('Asia/Tokyo', new Date('2026-08-06T15:30:00Z'))).toBe('2026-08-07');
  });
});
