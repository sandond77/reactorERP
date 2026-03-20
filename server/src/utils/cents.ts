/** Convert a dollar/yen string like "12.99" or "1299" to integer cents */
export function toCents(value: string | number): number {
  if (typeof value === 'number') return Math.round(value);
  const parsed = parseFloat(value.replace(/[^0-9.]/g, ''));
  if (isNaN(parsed)) return 0;
  // If the value looks like it already has decimals (e.g. "12.99"), multiply
  return value.includes('.') ? Math.round(parsed * 100) : Math.round(parsed);
}

/** Format integer cents as a decimal string: 1299 → "12.99" */
export function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}
