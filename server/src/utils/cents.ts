/** Convert a dollar amount (string or number) to integer cents. Always treats input as dollars. */
export function toCents(value: string | number): number {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^0-9.]/g, ''));
  if (isNaN(parsed)) return 0;
  return Math.round(parsed * 100);
}

/** Format integer cents as a decimal string: 1299 → "12.99" */
export function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}
