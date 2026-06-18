// Canonical grade-label library — MIRRORS server/src/utils/grade-labels.ts.
// Keep in sync. The server is the source of truth (it's used by the AI
// scanner / CSV importer); the client copy exists so forms can suggest the
// same canonical strings without a round trip.

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

// Canonical lookup for the (company, grade) pair. Falls back to "<company> <grade>"
// so the form still has SOMETHING when a new (company, grade) shows up here
// before the maps get updated.
export function getCanonicalLabel(company: string | null | undefined, grade: number | null | undefined): string {
  if (!company || grade == null || !Number.isFinite(grade)) return '';
  const co = company.toUpperCase();
  const map = COMPANY_MAPS[co];
  if (!map) return `${co} ${grade}`;
  return map[String(grade)] ?? `${co} ${grade}`;
}

// All canonical labels for a company — drives datalist <option> suggestions.
export function labelsForCompany(company: string | null | undefined): string[] {
  if (!company) return [];
  const map = COMPANY_MAPS[company.toUpperCase()];
  if (!map) return [];
  return Object.values(map);
}
