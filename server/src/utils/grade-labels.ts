/**
 * Canonical grade label maps for each grading company.
 * Keys are numeric grades (as strings to support half-grades like 9.5).
 * normalizeGradeLabel() is the single entry point used by the AI scanner.
 */

// ── PSA ───────────────────────────────────────────────────────────────────────
const PSA_LABELS: Record<string, string> = {
  '10':  'GEM MINT 10',
  '9':   'MINT 9',
  '8':   'NEAR MINT-MINT 8',
  '7':   'NEAR MINT 7',
  '6':   'EXCELLENT-MINT 6',
  '5':   'EXCELLENT 5',
  '4':   'VERY GOOD-EXCELLENT 4',
  '3':   'VERY GOOD 3',
  '2':   'GOOD 2',
  '1.5': 'FAIR 1.5',
  '1':   'POOR 1',
};

// ── BGS (Beckett) ─────────────────────────────────────────────────────────────
const BGS_LABELS: Record<string, string> = {
  '10':  'PRISTINE 10',
  '9.5': 'GEM MINT 9.5',
  '9':   'MINT 9',
  '8.5': 'NEAR MINT-MINT+ 8.5',
  '8':   'NEAR MINT-MINT 8',
  '7.5': 'NEAR MINT+ 7.5',
  '7':   'NEAR MINT 7',
  '6.5': 'EXCELLENT-MINT+ 6.5',
  '6':   'EXCELLENT-MINT 6',
  '5.5': 'EXCELLENT+ 5.5',
  '5':   'EXCELLENT 5',
  '4.5': 'VERY GOOD-EXCELLENT+ 4.5',
  '4':   'VERY GOOD-EXCELLENT 4',
  '3.5': 'VERY GOOD+ 3.5',
  '3':   'VERY GOOD 3',
  '2.5': 'GOOD+ 2.5',
  '2':   'GOOD 2',
  '1.5': 'FAIR 1.5',
  '1':   'POOR 1',
};

// ── CGC ───────────────────────────────────────────────────────────────────────
// Grade 10 has two tiers: Pristine (perfect) > Gem Mint. Default to Gem Mint.
// rawLabel hint of "pristine" selects the higher tier.
const CGC_LABELS: Record<string, string> = {
  '10':  'GEM MINT 10',
  '9.5': 'MINT+ 9.5',
  '9':   'MINT 9',
  '8.5': 'NEAR MINT/MINT+ 8.5',
  '8':   'NEAR MINT/MINT 8',
  '7.5': 'NEAR MINT+ 7.5',
  '7':   'NEAR MINT 7',
  '6.5': 'FINE/NEAR MINT+ 6.5',
  '6':   'FINE/NEAR MINT 6',
  '5.5': 'FINE+ 5.5',
  '5':   'FINE 5',
  '4.5': 'VERY GOOD/FINE+ 4.5',
  '4':   'VERY GOOD/FINE 4',
  '3.5': 'VERY GOOD+ 3.5',
  '3':   'VERY GOOD 3',
  '2.5': 'GOOD+ 2.5',
  '2':   'GOOD 2',
  '1.5': 'FAIR 1.5',
  '1':   'POOR 1',
};

// ── SGC ───────────────────────────────────────────────────────────────────────
const SGC_LABELS: Record<string, string> = {
  '10':  'GEM MINT 10',
  '9.5': 'MINT+ 9.5',
  '9':   'MINT 9',
  '8.5': 'NM-MT+ 8.5',
  '8':   'NM-MT 8',
  '7.5': 'NM+ 7.5',
  '7':   'NM 7',
  '6.5': 'EX-NM+ 6.5',
  '6':   'EX-NM 6',
  '5.5': 'EX+ 5.5',
  '5':   'EX 5',
  '4.5': 'VG-EX+ 4.5',
  '4':   'VG-EX 4',
  '3.5': 'VG+ 3.5',
  '3':   'VG 3',
  '2.5': 'GOOD+ 2.5',
  '2':   'GOOD 2',
  '1.5': 'FAIR 1.5',
  '1':   'POOR 1',
};

// ── HGA ───────────────────────────────────────────────────────────────────────
const HGA_LABELS: Record<string, string> = {
  '10':  'GEM MINT 10',
  '9.5': 'GEM MINT+ 9.5',
  '9':   'MINT 9',
  '8.5': 'NEAR MINT-MINT+ 8.5',
  '8':   'NEAR MINT-MINT 8',
  '7.5': 'NEAR MINT+ 7.5',
  '7':   'NEAR MINT 7',
  '6':   'EXCELLENT-MINT 6',
  '5':   'EXCELLENT 5',
  '4':   'VERY GOOD-EXCELLENT 4',
  '3':   'VERY GOOD 3',
  '2':   'GOOD 2',
  '1':   'POOR 1',
};

// ── ACE ───────────────────────────────────────────────────────────────────────
const ACE_LABELS: Record<string, string> = {
  '10':  'GEM MINT 10',
  '9.5': 'MINT+ 9.5',
  '9':   'MINT 9',
  '8.5': 'NEAR MINT+ 8.5',
  '8':   'NEAR MINT 8',
  '7':   'NEAR MINT 7',
  '6':   'EXCELLENT 6',
  '5':   'VERY GOOD 5',
  '4':   'GOOD 4',
  '3':   'FAIR 3',
  '2':   'POOR 2',
  '1':   'POOR 1',
};

// ── ARS (Japanese) ────────────────────────────────────────────────────────────
// ARS uses their own prefix format: ARS10+, ARS10, ARS 9, etc.
const ARS_LABELS: Record<string, string> = {
  '10+': 'ARS10+',
  '10':  'ARS10',
  '9':   'ARS 9',
  '8':   'ARS 8',
  '7':   'ARS 7',
  '6':   'ARS 6',
  '5':   'ARS 5',
};

const COMPANY_MAPS: Record<string, Record<string, string>> = {
  PSA: PSA_LABELS,
  BGS: BGS_LABELS,
  CGC: CGC_LABELS,
  SGC: SGC_LABELS,
  HGA: HGA_LABELS,
  ACE: ACE_LABELS,
  ARS: ARS_LABELS,
};

/**
 * Normalize a grade label to the canonical form for a given company.
 * @param company  Grading company code
 * @param grade    Numeric grade (e.g. 10, 9.5)
 * @param rawLabel Optional raw label from AI/image — used for hints (e.g. "Pristine", "OC", "Black Label")
 */
export function normalizeGradeLabel(company: string, grade: number, rawLabel?: string): string {
  const map = COMPANY_MAPS[company];
  if (!map) return rawLabel ?? String(grade);

  const key = String(grade);
  const raw = (rawLabel ?? '').toUpperCase();

  // Company-specific special cases
  if (company === 'PSA') {
    const base = map[key] ?? `PSA ${grade}`;
    return raw.includes('OC') ? `${base} OC` : base;
  }

  if (company === 'CGC' && grade === 10) {
    return raw.includes('PRISTINE') ? '10 Pristine' : 'GEM MINT 10';
  }

  if (company === 'BGS' && grade === 10) {
    return raw.includes('BLACK') ? 'PRISTINE 10 BLACK LABEL' : 'PRISTINE 10';
  }

  if (company === 'ARS') {
    if (raw.includes('+') || raw.includes('10+')) return 'ARS10+';
    return map[key] ?? `ARS ${grade}`;
  }

  return map[key] ?? `${company} ${grade}`;
}
