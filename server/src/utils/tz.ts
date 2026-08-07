// Timezone helpers for building "today" / "this year" boundaries in the
// caller's local timezone.
//
// Railway runs the server in UTC, so `new Date().setHours(0,0,0,0)` on the
// server = midnight UTC, which cuts off up to 8 hours of a west-coast user's
// local day. Any endpoint that reads "today" from the client's perspective
// must resolve midnight in the user's IANA timezone, then convert back to
// UTC for DB filtering.

/**
 * Offset (in minutes) between `tz` and UTC at `date`. Positive = ahead of
 * UTC (e.g. Asia/Tokyo = +540), negative = behind (e.g. America/Los_Angeles
 * standard time = -480, daylight time = -420). Handles DST because the
 * offset is computed for the specific instant, not the timezone as a whole.
 */
export function getTimezoneOffsetMinutes(tz: string, date: Date = new Date()): number {
  // sv-SE always gives ISO-8601 date/time formatting without ambiguity.
  const utcStr = date.toLocaleString('sv-SE', { timeZone: 'UTC' });
  const tzStr = date.toLocaleString('sv-SE', { timeZone: tz });
  return (new Date(tzStr).getTime() - new Date(utcStr).getTime()) / 60000;
}

/**
 * Midnight of the caller's local day, expressed as a UTC Date suitable for
 * `sold_at >= X` filters. Example: PST at Aug 6 19:00 → returns Aug 6
 * 08:00 UTC (midnight PST).
 */
export function localMidnightUtc(tz: string, now: Date = new Date()): Date {
  // The Y-M-D that the user currently sees on their wall clock.
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const offsetMinutes = getTimezoneOffsetMinutes(tz, now);
  // Anchor "local midnight" as if it were a UTC time, then subtract the
  // offset to get the actual UTC instant. Works for DST since the offset is
  // resolved for `now` (close enough to midnight for the same offset window;
  // DST transitions land at 2am local, not midnight).
  const anchor = new Date(`${ymd}T00:00:00Z`);
  return new Date(anchor.getTime() - offsetMinutes * 60000);
}

/**
 * Midnight of Jan 1 of the caller's local year, expressed as UTC. Used for
 * "This Year" summary buckets so year rollover happens at local midnight,
 * not UTC midnight (which is up to 16 hours off depending on user's tz).
 */
export function localYearStartUtc(tz: string, now: Date = new Date()): Date {
  const yearStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric',
  }).format(now);
  const offsetMinutes = getTimezoneOffsetMinutes(tz, now);
  const anchor = new Date(`${yearStr}-01-01T00:00:00Z`);
  return new Date(anchor.getTime() - offsetMinutes * 60000);
}

/**
 * Validate an IANA tz string and fall back to UTC on garbage input so a bad
 * client value never explodes the request. Intl.DateTimeFormat throws
 * `RangeError` on invalid timezones; we swallow to a UTC default.
 */
export function safeTz(tz: string | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/**
 * The 4-digit year on the caller's wall clock. Used for ID/label generation
 * that embeds a year (e.g. purchase_id "2026R117", trade "2026T045") so a
 * user creating at 11pm PST on Dec 31 doesn't get next year's suffix.
 */
export function localYear(tz: string, now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric',
  }).format(now));
}

/**
 * The caller's wall-clock date as YYYY-MM-DD. Convenience when a helper
 * needs to compare against or embed a local date string.
 */
export function localYmd(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}
