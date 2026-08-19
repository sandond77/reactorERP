// Pure diff helper used by both the correction-recording service (which
// writes to the DB) and its test. Kept in its own file with no side-effect
// imports so the test suite can exercise it without pulling in the whole
// database config path.

/**
 * Compute the set of top-level field names whose values differ between
 * model_output and final_output. Deep-equality via JSON stringify — good
 * enough at this scale, and it keeps the diff shallow so the curation
 * script clusters by field, not by nested-object-path (which would
 * fragment signal across near-identical shapes).
 *
 * null / undefined / empty-string are all treated as "field absent" so a
 * user leaving a field blank isn't flagged as a correction when the model
 * returned null for the same field.
 */
export function diffFields(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  final: any,
): string[] {
  if (!model || typeof model !== 'object') return [];
  if (!final || typeof final !== 'object') return [];
  const keys = new Set([...Object.keys(model), ...Object.keys(final)]);
  const changed: string[] = [];
  for (const k of keys) {
    const mv = model[k];
    const fv = final[k];
    const mn = mv == null || mv === '';
    const fn = fv == null || fv === '';
    if (mn && fn) continue;
    if (JSON.stringify(mv) !== JSON.stringify(fv)) changed.push(k);
  }
  return changed.sort();
}
