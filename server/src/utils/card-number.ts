// Pokemon card numbers are sometimes printed as "N/M" (N out of M-card set).
// The system canonicalizes on the numerator only — so the stored form lines up
// with what the catalog uses and lookups don't drift across entry points.
// Suffix letters / prefix letters / leading zeros are preserved because
// Pokemon numbering only uses "/" as the "X of Y" indicator.
//
//   "215/172"  -> "215"
//   "110a/100" -> "110a"
//   "001/183"  -> "001"
//   "T1"       -> "T1"
//   "SWSH001"  -> "SWSH001"
//   ""         -> ""
//   null       -> null
//   undefined  -> undefined
export function normalizeCardNumber(value: string | null | undefined): string | null | undefined {
  if (value === null || value === undefined) return value;
  return value.split('/')[0].trim();
}
