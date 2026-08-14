import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, PackageCheck, Plus, X, Upload, Lock, LockOpen, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { formatDate, formatCurrency } from '../lib/utils';
import toast from 'react-hot-toast';

const BATCH_STATUS_COLORS: Record<string, string> = {
  pending:   'bg-zinc-700/50 text-zinc-400',
  submitted: 'bg-amber-500/20 text-amber-300',
  returned:  'bg-green-500/20 text-green-300',
  cancelled: 'bg-zinc-700/50 text-zinc-400',
};

const noSpinner = '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Batch {
  id: string;
  batch_id: string;
  name: string | null;
  company: string;
  tier: string;
  submitted_at: string | null;
  grading_cost: number;
  status: string;
  notes: string | null;
  created_at: string;
  item_count: number;
  total_qty: number;
}

interface BatchItem {
  id: string;
  card_instance_id: string;
  line_item_num: number;
  card_name: string | null;
  set_name: string | null;
  card_number: string | null;
  language: string | null;
  quantity: number;
  expected_grade: number | null;
  purchase_cost: number;
  currency: string;
  catalog_id: string | null;
  sku: string | null;
  raw_purchase_label: string | null;
}

interface BatchDetail extends Batch {
  items: BatchItem[];
}

// One physical slab = one slot. A sub line of qty=3 produces 3 slots.
type Disposition = 'graded' | 'not_graded' | 'lost' | 'not_submitted';

type Slot = {
  // Stable identity within the form
  key: string;
  batch_item_id: string;
  copy_index: number;
  // Filled from CSV or user input
  cert_number: string;
  grade: string;
  csv_grade_label?: string;
  card_name_override?: string;
  // What happened to this physical card
  disposition: Disposition;
  // Match metadata for display
  match_score?: number;
  match_confidence?: 'strong' | 'good' | 'weak' | 'none';
  matched_csv_index?: number;
  // AI-assist provenance. When the deterministic scorer punts and the user
  // clicks "AI assist", the fill for these slots comes from the return-matching
  // subagent instead. Rendered with a Sparkles badge + AI reasoning tooltip.
  ai_matched?: boolean;
  ai_reasoning?: string;
  // CSV-import lock state. cert# and grade come from PSA's CSV as the
  // authoritative values; until override=true, those inputs are read-only
  // so a user can't accidentally (or intentionally) retype them.
  from_csv: boolean;
  override: boolean;
};

const DISPOSITION_LABELS: Record<Disposition, string> = {
  graded:        'Graded',
  not_graded:    'Not graded',
  lost:          'Lost',
  not_submitted: 'Not submitted',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// Mirrors server/src/utils/grade-labels.ts — keep in sync. Returns the LABEL
// PART only (no grade number suffix), except ARS which uses grade-inclusive
// strings ("ARS10", "ARS 9"); handleConfirm detects that and skips re-appending.
function gradeLabel(company: string, grade: number): string {
  const co = company.toUpperCase();
  if (co === 'PSA') {
    const map: Record<number, string> = {
      10:  'GEM MINT',
      9.5: 'MINT+',
      9:   'MINT',
      8.5: 'NM-MT+',
      8:   'NEAR MINT-MINT',
      7.5: 'NM+',
      7:   'NEAR MINT',
      6.5: 'EX-MT+',
      6:   'EXCELLENT-MINT',
      5.5: 'EX+',
      5:   'EXCELLENT',
      4.5: 'VG-EX+',
      4:   'VERY GOOD-EXCELLENT',
      3.5: 'VG+',
      3:   'VERY GOOD',
      2.5: 'GOOD+',
      2:   'GOOD',
      1.5: 'FAIR',
      1:   'POOR',
    };
    return map[grade] ?? '';
  }
  if (co === 'BGS') {
    const map: Record<number, string> = {
      10:  'PRISTINE',
      9.5: 'GEM MINT',
      9:   'MINT',
      8.5: 'NEAR MINT-MINT+',
      8:   'NEAR MINT-MINT',
      7.5: 'NEAR MINT+',
      7:   'NEAR MINT',
      6.5: 'EXCELLENT-MINT+',
      6:   'EXCELLENT-MINT',
      5.5: 'EXCELLENT+',
      5:   'EXCELLENT',
      4.5: 'VERY GOOD-EXCELLENT+',
      4:   'VERY GOOD-EXCELLENT',
      3.5: 'VERY GOOD+',
      3:   'VERY GOOD',
      2.5: 'GOOD+',
      2:   'GOOD',
      1.5: 'FAIR',
      1:   'POOR',
    };
    return map[grade] ?? '';
  }
  if (co === 'CGC') {
    const map: Record<number, string> = {
      10:  'GEM MINT',
      9.5: 'MINT+',
      9:   'MINT',
      8.5: 'NEAR MINT/MINT+',
      8:   'NEAR MINT/MINT',
      7.5: 'NEAR MINT+',
      7:   'NEAR MINT',
      6.5: 'FINE/NEAR MINT+',
      6:   'FINE/NEAR MINT',
      5.5: 'FINE+',
      5:   'FINE',
      4.5: 'VERY GOOD/FINE+',
      4:   'VERY GOOD/FINE',
      3.5: 'VERY GOOD+',
      3:   'VERY GOOD',
      2.5: 'GOOD+',
      2:   'GOOD',
      1.5: 'FAIR',
      1:   'POOR',
    };
    return map[grade] ?? '';
  }
  if (co === 'ARS') {
    // ARS labels are grade-inclusive — return the canonical full string.
    if (grade === 10) return 'ARS10';
    const intGrade = Math.floor(grade);
    if ([5, 6, 7, 8, 9].includes(intGrade)) return `ARS ${intGrade}`;
    return '';
  }
  return '';
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Per-company, per-grade canonical label strings (full forms as they appear
// on slabs / in return CSVs). The first entry is the preferred default; any
// alternates are accepted so a CSV-imported label that uses a short form
// like "NM-MT" still finds itself in the dropdown.
// Verified per company against published grading scales + sample slab labels.
//   PSA  — no 9.5; CSV uses long forms ("NEAR MINT-MINT 8"); slab uses short
//          ("NM-MT 8"). Both included so either matches.
//   BGS  — full half-grades. 10 Pristine has Black Label (perfect subgrades)
//          + Gold Label variants.
//   CGC  — 2024 rebrand consolidated old "Gem Mint 9.5" → new "Gem Mint 10".
//          Both old (Perfect 10, Gem Mint 9.5) and new (Pristine 10, Gem Mint
//          10, Mint+ 9.5) forms are included so legacy slabs map cleanly.
//   ARS  — numeric-only labels (no descriptive words). The "label" is just
//          the grade number; dropdown stays empty so the UI shows grade only.
// Mirrors server/src/utils/grade-labels.ts (the canonical dashboard labels).
// Long forms ("NEAR MINT-MINT", not "NM-MT") keep returns aligned with the
// Grade Distribution chart and existing slab_details rows.
// CGC has two valid 10 labels (Pristine top tier; Gem Mint = old 9.5 promoted).
// ARS uses numeric-only labels — no dropdown.
const COMPANY_LABEL_MAP: Record<string, Record<number, string[]>> = {
  PSA: {
    10:  ['GEM MINT'],
    9.5: ['MINT+'],
    9:   ['MINT'],
    8.5: ['NM-MT+'],
    8:   ['NEAR MINT-MINT'],
    7.5: ['NM+'],
    7:   ['NEAR MINT'],
    6.5: ['EX-MT+'],
    6:   ['EXCELLENT-MINT'],
    5.5: ['EX+'],
    5:   ['EXCELLENT'],
    4.5: ['VG-EX+'],
    4:   ['VERY GOOD-EXCELLENT'],
    3.5: ['VG+'],
    3:   ['VERY GOOD'],
    2.5: ['GOOD+'],
    2:   ['GOOD'],
    1.5: ['FAIR'],
    1:   ['POOR'],
  },
  BGS: {
    10:  ['PRISTINE'],
    9.5: ['GEM MINT'],
    9:   ['MINT'],
    8.5: ['NEAR MINT-MINT+'],
    8:   ['NEAR MINT-MINT'],
    7.5: ['NEAR MINT+'],
    7:   ['NEAR MINT'],
    6.5: ['EXCELLENT-MINT+'],
    6:   ['EXCELLENT-MINT'],
    5.5: ['EXCELLENT+'],
    5:   ['EXCELLENT'],
    4.5: ['VERY GOOD-EXCELLENT+'],
    4:   ['VERY GOOD-EXCELLENT'],
    3.5: ['VERY GOOD+'],
    3:   ['VERY GOOD'],
    2.5: ['GOOD+'],
    2:   ['GOOD'],
    1.5: ['FAIR'],
    1:   ['POOR'],
  },
  CGC: {
    10:  ['GEM MINT', 'PRISTINE'],
    9.5: ['MINT+'],
    9:   ['MINT'],
    8.5: ['NEAR MINT/MINT+'],
    8:   ['NEAR MINT/MINT'],
    7.5: ['NEAR MINT+'],
    7:   ['NEAR MINT'],
    6.5: ['FINE/NEAR MINT+'],
    6:   ['FINE/NEAR MINT'],
    5.5: ['FINE+'],
    5:   ['FINE'],
    4.5: ['VERY GOOD/FINE+'],
    4:   ['VERY GOOD/FINE'],
    3.5: ['VERY GOOD+'],
    3:   ['VERY GOOD'],
    2.5: ['GOOD+'],
    2:   ['GOOD'],
    1.5: ['FAIR'],
    1:   ['POOR'],
  },
  ARS: {},
};

function labelOptionsForGrade(company: string, grade: number): string[] {
  const co = company.toUpperCase();
  const map = COMPANY_LABEL_MAP[co];
  return map?.[grade] ?? [];
}

function companyHasLabels(company: string): boolean {
  const map = COMPANY_LABEL_MAP[company.toUpperCase()];
  return !!map && Object.keys(map).length > 0;
}

// ── CSV parsing ───────────────────────────────────────────────────────────────

function parseCsv(text: string): string[][] {
  const result: string[][] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (c === ',' && !inQ) {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    cells.push(cur.trim());
    result.push(cells);
  }
  return result;
}

function findCol(headers: string[], ...candidates: string[]): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const nh = headers.map(norm);
  for (const c of candidates) {
    const i = nh.indexOf(norm(c));
    if (i !== -1) return i;
  }
  // partial match fallback
  for (const c of candidates) {
    const nc = norm(c);
    const i = nh.findIndex(h => h.includes(nc) || nc.includes(h));
    if (i !== -1) return i;
  }
  return -1;
}

// Handles "GEM MT 10", "MINT 9", or plain "10" / "9.5"
function parseGradeStr(s: string): { grade: number | null; label: string } {
  const clean = s.trim();
  const numOnly = parseFloat(clean);
  if (!isNaN(numOnly) && String(numOnly) === clean) return { grade: numOnly, label: '' };
  const m = clean.match(/^(.*?)\s+(\d+(?:\.\d+)?)$/);
  if (m) return { grade: parseFloat(m[2]), label: m[1].trim() };
  return { grade: null, label: clean };
}

// ── Match scoring ─────────────────────────────────────────────────────────────

type CsvCandidate = {
  csv_index: number;
  cert: string;
  grade: number | null;
  grade_label?: string;
  subject: string;
  set_name?: string;
  card_number?: string;
  language?: string;
  line_num?: number;
};

function normalizeCardNum(s: string): string {
  return s.replace(/[^0-9a-z]/gi, '').toLowerCase();
}

function inferLangFromText(s: string): 'JP' | 'EN' | undefined {
  if (!s) return undefined;
  if (/japanese|\bjp\b|\bjpn\b/i.test(s)) return 'JP';
  return undefined; // don't force EN; only flag when clearly JP
}

// Pull the first 4-digit year (1980-2039) from a string.
function extractYear(s: string): string | undefined {
  if (!s) return undefined;
  const m = s.match(/\b(19[89]\d|20[0-3]\d)\b/);
  return m?.[1];
}

// Pull a plausible card # from a PSA description. Year is the first digit run
// and we skip past it; the next short digit run is almost always the card #.
function extractCardNumFromText(s: string): string | undefined {
  if (!s) return undefined;
  const matches = Array.from(s.matchAll(/\b(\d{1,4})\b/g));
  for (const m of matches) {
    const n = parseInt(m[1]);
    if (n >= 1980 && n <= 2039) continue; // skip the year
    return m[1];
  }
  return undefined;
}

const TOKEN_STOPWORDS = new Set([
  'pokemon','japanese','english','promo','holo','holofoil','foil',
  'card','cards','the','of','and','set','series','edition',
  'mint','near','gem','excellent','good','fair','poor','fine','authentic',
]);

function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
     .split(/[^a-z0-9]+/)
     .filter((t) => t.length >= 3 && !TOKEN_STOPWORDS.has(t))
  );
}

// Score breakdown (max ~10.5, can go negative on card# mismatch):
//   name substring  4   |  name jaccard  up to 2
//   card #          3   |  card # mismatch  -3
//   year            1
//   set tokens      up to 1.5
//   language        1
//   line position   1
function scoreMatch(item: BatchItem, c: CsvCandidate): number {
  let s = 0;

  // ── Card name (substring 4, else token Jaccard up to 2) ─────────────────
  if (item.card_name && c.subject) {
    const a = item.card_name.toLowerCase();
    const b = c.subject.toLowerCase();
    if (b.includes(a) || a.includes(b)) {
      s += 4;
    } else {
      const aT = tokenize(item.card_name);
      const bT = tokenize(c.subject);
      if (aT.size && bT.size) {
        const inter = [...aT].filter((t) => bT.has(t)).length;
        const union = new Set([...aT, ...bT]).size;
        const jacc = inter / union;
        if (jacc >= 0.5) s += 2;
        else if (jacc >= 0.25) s += 1;
      }
    }
  }

  // ── Card # (extract from subject if no column; mismatch is a deal-breaker) ─
  const candCardNum = c.card_number || extractCardNumFromText(c.subject);
  if (item.card_number && candCardNum) {
    const a = normalizeCardNum(item.card_number);
    const b = normalizeCardNum(candCardNum);
    if (a && b) {
      if (a === b || a.endsWith(b) || b.endsWith(a)) s += 3;
      else s -= 3;
    }
  }

  // ── Year (extracted from either side) ────────────────────────────────────
  const itemYear = extractYear(item.card_name ?? '');
  const candYear = extractYear(c.subject);
  if (itemYear && candYear && itemYear === candYear) s += 1;

  // ── Set token overlap (item set_name vs subject tokens) ─────────────────
  if (item.set_name) {
    const setT = tokenize(item.set_name);
    if (setT.size) {
      const subT = tokenize(c.subject);
      const hits = [...setT].filter((t) => subT.has(t)).length;
      if (hits >= 2) s += 1.5;
      else if (hits === 1) s += 0.75;
    }
  }

  // ── Language (1) ─────────────────────────────────────────────────────────
  const itemLang = (item.language ?? '').toLowerCase();
  const candLang = (c.language ?? inferLangFromText(c.subject) ?? '').toLowerCase();
  if (itemLang && candLang) {
    const itemIsJP = itemLang.startsWith('jp') || itemLang === 'ja';
    const candIsJP = candLang.startsWith('jp') || candLang === 'ja';
    if (itemIsJP === candIsJP) s += 1;
  }

  // ── Position via line number (1) — only fires if CSV has a Line column ──
  if (c.line_num != null && c.line_num === item.line_item_num) s += 1;

  return s;
}

function confidenceFor(score: number): 'strong' | 'good' | 'weak' | 'none' {
  if (score >= 8) return 'strong';
  if (score >= 5) return 'good';
  if (score >= 2) return 'weak';
  return 'none';
}

// ── Select Batch Modal ─────────────────────────────────────────────────────────

function SelectBatchModal({
  batches,
  onSelect,
  onClose,
}: {
  batches: Batch[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl w-full max-w-lg p-0 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-100">Select Submission to Return</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X size={15} />
          </button>
        </div>

        {batches.length === 0 ? (
          <div className="px-5 py-10 text-center text-zinc-500 text-sm">
            No submitted batches awaiting return.
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800/60 max-h-80 overflow-y-auto">
            {batches.map((b) => (
              <li key={b.id}>
                <button
                  onClick={() => onSelect(b.id)}
                  className="w-full flex items-center gap-4 px-5 py-3.5 text-left hover:bg-zinc-800/50 transition-colors"
                >
                  <div className="flex-1">
                    <p className="text-sm font-medium text-zinc-100">{b.name ?? b.batch_id}</p>
                    <p className="text-[10px] text-zinc-500 font-mono mt-0.5">
                      {b.batch_id}
                      {b.submitted_at && <span className="text-zinc-600"> · sub {formatDate(b.submitted_at)}</span>}
                    </p>
                  </div>
                  <div className="text-right text-xs text-zinc-400 shrink-0">
                    <p>{b.company} · {b.tier}</p>
                    <p className="text-zinc-600">{b.total_qty} card{b.total_qty !== 1 ? 's' : ''} · {b.item_count} line{b.item_count !== 1 ? 's' : ''}</p>
                  </div>
                  <Badge className={BATCH_STATUS_COLORS['submitted']}>submitted</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Return Form ───────────────────────────────────────────────────────────────

function ReturnForm({ batch, onBack }: { batch: BatchDetail; onBack: () => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [returnedAt, setReturnedAt] = useState(todayIso());

  // Expand each sub-line of quantity N into N slots (one per physical slab).
  const [slots, setSlots] = useState<Slot[]>(() =>
    batch.items.flatMap((item) =>
      Array.from({ length: item.quantity }, (_, i) => ({
        key: `${item.id}-${i}`,
        batch_item_id: item.id,
        copy_index: i,
        cert_number: '',
        grade: '',
        disposition: 'graded' as Disposition,
        from_csv: false,
        override: false,
      }))
    )
  );
  const [reviewing, setReviewing] = useState(false);
  // Kept in state after CSV upload so the "AI assist" button can send unused
  // candidates back to the server for the return-matching subagent to
  // reconsider. Empty until a CSV is uploaded.
  const [csvCandidates, setCsvCandidates] = useState<CsvCandidate[]>([]);

  // Lookup helpers
  const itemById = new Map(batch.items.map((it) => [it.id, it]));

  function handleCsvUpload(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCsv(text);
      if (parsed.length < 2) { toast.error('CSV appears empty'); return; }

      const headers  = parsed[0];
      const dataRows = parsed.slice(1);

      const colLine  = findCol(headers, 'Line', 'Line #', '#', 'Item #', 'Order Line', 'Line Item', 'Ln');
      const colCert  = findCol(headers, 'Cert #', 'Cert#', 'Certificate #', 'PSA Cert', 'Cert Number', 'Certification', 'Cert');
      const colGrade = findCol(headers, 'Grade', 'PSA Grade', 'Numeric Grade', 'Final Grade', 'Grd');
      const colDesc  = findCol(headers, 'Grade Description', 'Qualifier', 'Grade Label', 'Label', 'Description');
      const colSubj  = findCol(headers, 'Subject', 'Card Name', 'Card', 'Name', 'Description', 'Item Description');
      const colSet   = findCol(headers, 'Set', 'Set Name', 'Brand', 'Series');
      const colCard  = findCol(headers, 'Card Number', 'Card #', 'Card No', 'No', 'Number');
      const colLang  = findCol(headers, 'Language', 'Lang');

      // Build candidate list from CSV rows
      const candidates: CsvCandidate[] = dataRows.map((r, csv_index) => {
        let grade: number | null = null;
        let grade_label: string | undefined;
        if (colGrade !== -1 && r[colGrade]) {
          const p = parseGradeStr(r[colGrade]);
          grade = p.grade;
          if (p.label) grade_label = p.label;
        }
        if (grade === null && colDesc !== -1 && r[colDesc]) {
          const p = parseGradeStr(r[colDesc]);
          grade = p.grade;
          if (p.label && !grade_label) grade_label = p.label;
        }
        return {
          csv_index,
          cert:        colCert !== -1 ? (r[colCert] ?? '') : '',
          grade,
          grade_label,
          subject:     colSubj !== -1 ? (r[colSubj] ?? '') : '',
          set_name:    colSet  !== -1 ? r[colSet]  : undefined,
          card_number: colCard !== -1 ? r[colCard] : undefined,
          language:    colLang !== -1 ? r[colLang] : undefined,
          line_num:    colLine !== -1 ? parseInt(r[colLine] ?? '') || undefined : undefined,
        };
      });

      // Stash the parsed candidates for the AI-assist follow-up. They're
      // discarded from the deterministic scorer once it's done, but the AI
      // needs both sides of the pool to reconsider unmatched slots.
      setCsvCandidates(candidates);

      // Score every (slot, candidate) pair, then greedily assign by score desc.
      const pairs: Array<{ slotIdx: number; candIdx: number; score: number }> = [];
      slots.forEach((slot, slotIdx) => {
        const item = itemById.get(slot.batch_item_id);
        if (!item) return;
        candidates.forEach((c, candIdx) => {
          const s = scoreMatch(item, c);
          if (s > 0) pairs.push({ slotIdx, candIdx, score: s });
        });
      });
      pairs.sort((a, b) => b.score - a.score);

      const usedSlots  = new Set<number>();
      const usedCands  = new Set<number>();
      const assignment = new Map<number, { candIdx: number; score: number }>();
      for (const p of pairs) {
        if (usedSlots.has(p.slotIdx) || usedCands.has(p.candIdx)) continue;
        if (p.score < 2) continue;  // below this, leave unassigned
        usedSlots.add(p.slotIdx);
        usedCands.add(p.candIdx);
        assignment.set(p.slotIdx, { candIdx: p.candIdx, score: p.score });
      }

      setSlots((prev) =>
        prev.map((slot, slotIdx) => {
          const a = assignment.get(slotIdx);
          if (!a) {
            return {
              ...slot,
              match_score: undefined,
              match_confidence: undefined,
              matched_csv_index: undefined,
              ai_matched: false,
              ai_reasoning: undefined,
              from_csv: false,
              override: false,
            };
          }
          const c = candidates[a.candIdx];
          return {
            ...slot,
            cert_number:        c.cert || slot.cert_number,
            grade:              c.grade !== null ? String(c.grade) : slot.grade,
            csv_grade_label:    c.grade_label ?? slot.csv_grade_label,
            card_name_override: c.subject || slot.card_name_override,
            match_score:        a.score,
            match_confidence:   confidenceFor(a.score),
            matched_csv_index:  c.csv_index,
            ai_matched:         false,
            ai_reasoning:       undefined,
            // CSV is now the authoritative source for cert # and grade.
            // Override resets to false — user must opt in to edit again.
            from_csv: true,
            override: false,
          };
        })
      );

      const strongCount = Array.from(assignment.values()).filter((a) => a.score >= 7).length;
      toast.success(`Matched ${assignment.size}/${slots.length} slabs (${strongCount} strong)`);
    };
    reader.readAsText(file);
  }

  const aiSuggestMatches = useMutation({
    mutationFn: async () => {
      // Send only slots the deterministic scorer left unresolved (weak or
      // none) and CSV rows nothing is pointing at. Keeps model tokens
      // scoped to what needs help.
      const takenCsvIndices = new Set(
        slots.filter((s) => s.matched_csv_index != null && s.match_confidence !== 'weak')
             .map((s) => s.matched_csv_index),
      );
      const unmatchedSlots = slots
        .map((s, idx) => ({ s, idx }))
        .filter(({ s }) => !s.match_confidence || s.match_confidence === 'weak' || s.match_confidence === 'none');
      const unmatchedBatchItems = unmatchedSlots.map(({ s }) => {
        const it = itemById.get(s.batch_item_id)!;
        return {
          batch_item_id: it.id,
          card_name: it.card_name,
          set_name: it.set_name,
          card_number: it.card_number,
          language: it.language,
          expected_grade: it.expected_grade,
          line_item_num: it.line_item_num,
        };
      });
      const unusedCandidates = csvCandidates
        .filter((c) => !takenCsvIndices.has(c.csv_index))
        .map((c) => ({
          csv_index:   c.csv_index,
          subject:     c.subject,
          cert:        c.cert,
          grade:       c.grade,
          grade_label: c.grade_label,
          card_number: c.card_number,
          set_name:    c.set_name,
          language:    c.language,
          line_num:    c.line_num,
        }));
      if (unmatchedBatchItems.length === 0) {
        toast.success('Nothing left for AI to match');
        return { data: [] as Array<{ batch_item_id: string; csv_index: number; confidence: 'strong' | 'good' | 'weak'; reasoning: string }> };
      }
      if (unusedCandidates.length === 0) {
        toast.error('No unused CSV rows left for AI to consider');
        return { data: [] };
      }
      return api.post(`/grading-subs/${batch.id}/ai-suggest-matches`, {
        batch_items: unmatchedBatchItems,
        candidates:  unusedCandidates,
      }).then((r) => r.data);
    },
    onSuccess: (result) => {
      const matches: Array<{ batch_item_id: string; csv_index: number; confidence: 'strong' | 'good' | 'weak'; reasoning: string }> = result?.data ?? [];
      if (matches.length === 0) {
        toast('AI found no confident matches');
        return;
      }
      const candByIndex = new Map(csvCandidates.map((c) => [c.csv_index, c]));
      // AI can return multiple matches for the same slot only in pathological
      // cases (the server dedupes greedily); handle by first-wins here too.
      const perSlot = new Map<string, typeof matches[0]>();
      for (const m of matches) if (!perSlot.has(m.batch_item_id)) perSlot.set(m.batch_item_id, m);

      setSlots((prev) =>
        prev.map((slot) => {
          const m = perSlot.get(slot.batch_item_id);
          if (!m) return slot;
          const c = candByIndex.get(m.csv_index);
          if (!c) return slot;
          return {
            ...slot,
            cert_number:        c.cert || slot.cert_number,
            grade:              c.grade !== null ? String(c.grade) : slot.grade,
            csv_grade_label:    c.grade_label ?? slot.csv_grade_label,
            card_name_override: c.subject || slot.card_name_override,
            match_score:        undefined,  // no numeric score from AI
            match_confidence:   m.confidence,
            matched_csv_index:  c.csv_index,
            ai_matched:         true,
            ai_reasoning:       m.reasoning,
            from_csv:           true,
            override:           false,
          };
        }),
      );
      toast.success(`AI filled ${matches.length} slab${matches.length === 1 ? '' : 's'}`);
    },
    onError: (err: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (err as any)?.response?.data?.error ?? 'AI assist failed';
      toast.error(msg);
    },
  });

  const processReturn = useMutation({
    mutationFn: (payload: object) => api.post(`/grading-subs/${batch.id}/return`, payload).then((r) => r.data),
    onSuccess: () => {
      toast.success('Return processed');
      qc.invalidateQueries({ queryKey: ['grading-subs'] });
      onBack();
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any) => toast.error(err?.response?.data?.error ?? 'Failed to process return'),
  });

  function updateSlot(idx: number, patch: Partial<Slot>) {
    setSlots((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  // Remap a slot to a different batch_item_id (keeps cert/grade, moves the slab
  // under a different sub-line). Used to fix mis-assignments without re-uploading.
  function remapSlot(idx: number, newBatchItemId: string) {
    setSlots((prev) => {
      const next = [...prev];
      // Pick the lowest unused copy_index for this batch_item_id
      const used = new Set(next.filter((_, i) => i !== idx && _.batch_item_id === newBatchItemId).map((s) => s.copy_index));
      let copyIdx = 0;
      while (used.has(copyIdx)) copyIdx++;
      next[idx] = {
        ...next[idx],
        batch_item_id: newBatchItemId,
        copy_index: copyIdx,
        key: `${newBatchItemId}-${copyIdx}-${Date.now()}`,
      };
      return next;
    });
  }

  function ignoreSlot(idx: number) {
    setSlots((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleReview(e: React.FormEvent) {
    e.preventDefault();
    if (slots.length === 0) {
      toast.error('No slabs to process — add at least one or cancel');
      return;
    }
    const graded = slots.filter((s) => s.disposition === 'graded');
    const missingGrade = graded.filter((s) => !s.grade || isNaN(parseFloat(s.grade)));
    if (missingGrade.length) {
      toast.error(`${missingGrade.length} graded slab${missingGrade.length > 1 ? 's' : ''} missing a grade`);
      return;
    }
    const missingCert = graded.filter((s) => !s.cert_number.trim());
    if (missingCert.length) {
      toast.error(`${missingCert.length} graded slab${missingCert.length > 1 ? 's' : ''} missing a cert #`);
      return;
    }
    setReviewing(true);
  }

  function handleConfirm() {
    processReturn.mutate({
      returned_at: returnedAt || undefined,
      items: slots.map((slot) => {
        if (slot.disposition !== 'graded') {
          return {
            batch_item_id: slot.batch_item_id,
            grade: 0,
            disposition: slot.disposition,
            card_name_override: slot.card_name_override ?? undefined,
          };
        }
        const g = parseFloat(slot.grade);
        const lbl = slot.csv_grade_label || gradeLabel(batch.company, g);
        // ARS labels are grade-inclusive ("ARS10", "ARS 9"); don't re-append.
        const gStr = String(g);
        const final = !lbl
          ? gStr
          : new RegExp(`(^|\\s)${gStr.replace('.', '\\.')}\\+?$`).test(lbl)
            ? lbl
            : `${lbl} ${gStr}`;
        return {
          batch_item_id: slot.batch_item_id,
          grade: g,
          grade_label: final,
          cert_number: slot.cert_number,
          card_name_override: slot.card_name_override ?? undefined,
          disposition: 'graded' as const,
        };
      }),
    });
  }

  const totalCards = batch.items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 lg:gap-0 px-6 py-4 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-zinc-100">{batch.name ?? batch.batch_id}</h1>
            {batch.name && <p className="text-[10px] text-zinc-600 font-mono">{batch.batch_id}</p>}
          </div>
          <span className="text-sm text-zinc-400">{batch.company} · {batch.tier}</span>
          <Badge className={BATCH_STATUS_COLORS[batch.status] ?? 'bg-zinc-700/50 text-zinc-400'}>
            {batch.status}
          </Badge>
        </div>
      </div>

      <div className="flex items-center gap-6 px-6 py-3 border-b border-zinc-800 text-xs text-zinc-400">
        <span>Company: <span className="text-zinc-200">{batch.company}</span></span>
        <span>Tier: <span className="text-zinc-200">{batch.tier}</span></span>
        <span>Cards: <span className="text-zinc-200">{totalCards}</span></span>
        {batch.submitted_at && (
          <span>Submitted: <span className="text-zinc-300">{formatDate(batch.submitted_at)}</span></span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 transition-colors border border-zinc-700"
          >
            <Upload size={12} />
            Upload PSA CSV
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCsvUpload(f); e.target.value = ''; }}
          />
          <button
            type="button"
            onClick={() => aiSuggestMatches.mutate()}
            disabled={aiSuggestMatches.isPending || csvCandidates.length === 0}
            title={csvCandidates.length === 0 ? 'Upload a PSA CSV first' : 'Ask AI to match remaining slabs'}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs bg-violet-600/20 text-violet-200 hover:bg-violet-600/30 hover:text-violet-100 transition-colors border border-violet-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Sparkles size={12} />
            {aiSuggestMatches.isPending ? 'Thinking…' : 'AI assist'}
          </button>
          <label className="text-zinc-400 text-xs">Returned Date</label>
          <input
            type="date"
            value={returnedAt}
            onChange={(e) => setReturnedAt(e.target.value)}
            className="px-2 py-1 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100 focus:outline-none focus:border-indigo-500 [color-scheme:dark]"
          />
        </div>
      </div>

      <form onSubmit={handleReview} className="flex flex-col flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-zinc-950 z-10">
              <tr className="border-b border-zinc-700 text-zinc-400 uppercase tracking-wide text-[10px]">
                <th className="px-2 py-2 text-left  font-medium w-10">Line</th>
                <th className="px-3 py-2 text-left  font-medium min-w-[325px]">Card</th>
                <th className="px-2 py-2 text-left  font-medium">ID</th>
                <th className="px-2 py-2 text-right font-medium">Cost</th>
                <th className="px-2 py-2 text-right font-medium">Exp</th>
                <th className="px-1 py-2 text-center font-medium w-6" title="Override CSV — unlock cert # and grade for editing" />
                <th className="px-2 py-2 text-left  font-medium">Cert #</th>
                <th className="px-2 py-2 text-left  font-medium">Grade</th>
                <th className="px-2 py-2 text-left  font-medium">Label</th>
                <th className="px-2 py-2 text-left  font-medium">Match</th>
                <th className="px-2 py-2 text-left  font-medium min-w-[155px]">Remap</th>
                <th className="px-2 py-2 text-left  font-medium">Disposition</th>
                <th className="px-2 py-2 text-center font-medium w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {slots.map((slot, idx) => {
                const item = itemById.get(slot.batch_item_id);
                if (!item) return null;
                const conf = slot.match_confidence;
                const confDot =
                  conf === 'strong' ? 'bg-emerald-500' :
                  conf === 'good'   ? 'bg-lime-500'    :
                  conf === 'weak'   ? 'bg-amber-500'   :
                                      'bg-zinc-600';
                const confLabel = slot.ai_matched
                  ? `AI · ${conf ?? 'weak'}${slot.ai_reasoning ? ` — ${slot.ai_reasoning}` : ''}`
                  : conf === 'strong' ? `Strong (${slot.match_score?.toFixed(1)})` :
                    conf === 'good'   ? `Good (${slot.match_score?.toFixed(1)})`   :
                    conf === 'weak'   ? `Weak (${slot.match_score?.toFixed(1)})`   :
                                        'Manual';
                const isGraded = slot.disposition === 'graded';
                const dispDot =
                  slot.disposition === 'graded'        ? 'bg-emerald-500' :
                  slot.disposition === 'not_graded'    ? 'bg-sky-500'     :
                  slot.disposition === 'lost'          ? 'bg-red-500'     :
                                                         'bg-zinc-500';
                return (
                  <tr key={slot.key} className={`hover:bg-zinc-800/20 align-top ${!isGraded ? 'opacity-70' : ''}`}>
                    <td className="px-2 py-2 text-zinc-500 text-[10px] font-mono">
                      {item.line_item_num}
                      {item.quantity > 1 && <span className="text-zinc-700">·{slot.copy_index + 1}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <textarea
                        rows={2}
                        value={slot.card_name_override ?? item.card_name ?? ''}
                        onChange={(e) => updateSlot(idx, { card_name_override: e.target.value })}
                        style={{ fieldSizing: 'content' } as React.CSSProperties}
                        className="w-full px-2 py-1 text-xs bg-transparent border border-transparent hover:border-zinc-700 focus:border-indigo-500 focus:bg-zinc-900 rounded text-zinc-200 font-medium focus:outline-none transition-colors resize-none whitespace-normal break-words leading-snug overflow-hidden"
                      />
                      <p className="text-[10px] text-zinc-600 px-2 break-words">
                        {item.set_name ?? '—'}{item.card_number ? ` · #${item.card_number}` : ''}
                      </p>
                    </td>
                    <td className="px-2 py-2 text-zinc-500 font-mono text-[10px] whitespace-nowrap">
                      {item.raw_purchase_label ?? '—'}
                    </td>
                    <td className="px-2 py-2 text-right text-zinc-400 whitespace-nowrap">
                      {formatCurrency(item.purchase_cost, item.currency)}
                    </td>
                    <td className="px-2 py-2 text-right text-zinc-500">
                      {item.expected_grade ?? '—'}
                    </td>
                    <td className="px-1 py-2 text-center">
                      {slot.from_csv && (
                        <button
                          type="button"
                          onClick={() => updateSlot(idx, { override: !slot.override })}
                          title={slot.override ? 'Re-lock CSV values' : 'Override CSV — unlock cert # and grade'}
                          className={`transition-colors ${slot.override ? 'text-amber-400 hover:text-amber-300' : 'text-zinc-500 hover:text-zinc-300'}`}
                        >
                          {slot.override ? <LockOpen size={12} /> : <Lock size={12} />}
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="text"
                        placeholder={isGraded ? 'Required' : '—'}
                        disabled={!isGraded || (slot.from_csv && !slot.override)}
                        readOnly={slot.from_csv && !slot.override}
                        value={slot.cert_number}
                        onChange={(e) => updateSlot(idx, { cert_number: e.target.value })}
                        className={`w-24 px-2 py-1 text-xs bg-zinc-900 border rounded text-zinc-100 focus:outline-none focus:border-indigo-500 disabled:opacity-40 read-only:bg-zinc-900/50 read-only:text-zinc-400 read-only:cursor-not-allowed ${slot.cert_number ? 'border-zinc-700' : 'border-zinc-600'}`}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        step="0.5"
                        min="1"
                        max="10"
                        placeholder={isGraded ? '10' : '—'}
                        disabled={!isGraded || (slot.from_csv && !slot.override)}
                        readOnly={slot.from_csv && !slot.override}
                        value={slot.grade}
                        onChange={(e) => updateSlot(idx, { grade: e.target.value })}
                        className={`w-14 px-2 py-1 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100 focus:outline-none focus:border-indigo-500 disabled:opacity-40 read-only:bg-zinc-900/50 read-only:text-zinc-400 read-only:cursor-not-allowed ${noSpinner}`}
                      />
                    </td>
                    <td className="px-2 py-2">
                      {(() => {
                        if (!isGraded) return <span className="text-zinc-700 text-[11px]">—</span>;
                        const g = parseFloat(slot.grade);
                        const validGrade = slot.grade && !isNaN(g);
                        const hasLabels = companyHasLabels(batch.company);
                        // Companies without descriptive labels (e.g. ARS) just
                        // show the grade as plaintext.
                        if (!hasLabels) {
                          return <span className="text-zinc-500 text-[11px]">{validGrade ? g : <span className="text-zinc-700">—</span>}</span>;
                        }
                        const options = validGrade ? labelOptionsForGrade(batch.company, g) : [];
                        // Preserve any existing label even if it's not in the
                        // canonical list (custom CSV imports, qualifiers, etc).
                        const current = slot.csv_grade_label ?? '';
                        const allOptions = current && !options.includes(current)
                          ? [...options, current]
                          : options;
                        const locked = slot.from_csv && !slot.override;
                        return (
                          <select
                            disabled={locked || !validGrade}
                            value={current}
                            onChange={(e) => updateSlot(idx, { csv_grade_label: e.target.value })}
                            className="px-2 py-1 text-[11px] bg-zinc-900 border border-zinc-700 rounded text-zinc-300 focus:outline-none focus:border-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <option value="">{validGrade ? `(auto: ${gradeLabel(batch.company, g)})` : '—'}</option>
                            {allOptions.map((lbl) => (
                              <option key={lbl} value={lbl}>{lbl}</option>
                            ))}
                          </select>
                        );
                      })()}
                    </td>
                    <td className="px-2 py-2">
                      <div
                        className="flex items-center gap-1.5 text-[10px] text-zinc-500 whitespace-nowrap"
                        title={slot.ai_matched && slot.ai_reasoning ? slot.ai_reasoning : undefined}
                      >
                        {slot.ai_matched
                          ? <Sparkles size={11} className="text-violet-300 shrink-0" />
                          : <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${confDot}`} />}
                        <span className={slot.ai_matched ? 'text-violet-300' : undefined}>{confLabel}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      {(() => {
                        const selected = batch.items.find((bi) => bi.id === slot.batch_item_id);
                        const selectedParts = selected
                          ? [
                              selected.card_name ?? '(unnamed)',
                              selected.set_name,
                              selected.card_number ? `#${selected.card_number}` : null,
                            ].filter(Boolean)
                          : [];
                        const selectedLabel = selected
                          ? `#${selected.line_item_num} ${selectedParts.join(' — ')}`
                          : '—';
                        return (
                          <div className="relative">
                            <div className="px-1.5 py-1 pr-5 text-[11px] bg-zinc-900 border border-zinc-700 rounded text-zinc-300 whitespace-normal break-words min-h-[26px]">
                              {selectedLabel}
                            </div>
                            <span className="pointer-events-none absolute right-1.5 top-1.5 text-zinc-500 text-[9px]">▾</span>
                            <select
                              value={slot.batch_item_id}
                              onChange={(e) => remapSlot(idx, e.target.value)}
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer focus:outline-none"
                              aria-label="Remap to batch item"
                            >
                              {batch.items.map((bi) => {
                                const parts = [
                                  bi.card_name ?? '(unnamed)',
                                  bi.set_name,
                                  bi.card_number ? `#${bi.card_number}` : null,
                                ].filter(Boolean);
                                return (
                                  <option key={bi.id} value={bi.id}>
                                    #{bi.line_item_num} {parts.join(' — ')}
                                  </option>
                                );
                              })}
                            </select>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dispDot}`} />
                        <select
                          value={slot.disposition}
                          onChange={(e) => updateSlot(idx, { disposition: e.target.value as Disposition })}
                          className="px-1.5 py-1 text-[11px] bg-zinc-900 border border-zinc-700 rounded text-zinc-300 focus:outline-none focus:border-indigo-500"
                        >
                          {(Object.keys(DISPOSITION_LABELS) as Disposition[]).map((d) => (
                            <option key={d} value={d}>{DISPOSITION_LABELS[d]}</option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => ignoreSlot(idx)}
                        title="Ignore this slot — drop from return (source stays at PSA)"
                        className="text-zinc-600 hover:text-red-400 transition-colors"
                      >
                        <X size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* pr-40 keeps the button clear of the fixed AI Agent button (bottom-5 right-5) */}
        <div className="px-6 py-4 pr-40 border-t border-zinc-800 flex justify-end">
          <Button type="submit">
            <PackageCheck size={14} />
            Review &amp; Process
          </Button>
        </div>
      </form>

      {/* Review modal */}
      {reviewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setReviewing(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-6xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <h2 className="text-sm font-semibold text-zinc-100">Review Return — {batch.company} · {batch.batch_id}</h2>
              <button onClick={() => setReviewing(false)} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                <X size={15} />
              </button>
            </div>

            <div className="overflow-y-auto max-h-[60vh]">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-zinc-900">
                  <tr className="border-b border-zinc-800 text-zinc-500 uppercase tracking-wide text-[10px]">
                    <th className="px-4 py-2 text-left  font-medium w-12">Line</th>
                    <th className="px-4 py-2 text-left  font-medium">Card</th>
                    <th className="px-4 py-2 text-left  font-medium">ID</th>
                    <th className="px-4 py-2 text-right font-medium">Cost</th>
                    <th className="px-4 py-2 text-right font-medium">Exp</th>
                    <th className="px-4 py-2 text-left  font-medium">Cert #</th>
                    <th className="px-4 py-2 text-left  font-medium">Grade</th>
                    <th className="px-4 py-2 text-left  font-medium">Label</th>
                    <th className="px-4 py-2 text-left  font-medium">Disposition</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {slots.map((slot) => {
                    const item = itemById.get(slot.batch_item_id);
                    if (!item) return null;
                    const isGraded = slot.disposition === 'graded';
                    const grade = parseFloat(slot.grade);
                    const dispColor =
                      slot.disposition === 'graded'        ? 'text-emerald-400' :
                      slot.disposition === 'not_graded'    ? 'text-sky-400'     :
                      slot.disposition === 'lost'          ? 'text-red-400'     :
                                                             'text-zinc-400';
                    return (
                      <tr key={slot.key} className={`hover:bg-zinc-800/20 ${!isGraded ? 'opacity-70' : ''}`}>
                        <td className="px-4 py-2.5 text-zinc-600 font-mono text-[10px]">
                          {item.line_item_num}
                          {item.quantity > 1 && <span className="text-zinc-700">·{slot.copy_index + 1}</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <p className="text-zinc-200 font-medium">{slot.card_name_override ?? item.card_name ?? '—'}</p>
                          {item.set_name && <p className="text-[10px] text-zinc-600">{item.set_name}{item.card_number ? ` · #${item.card_number}` : ''}</p>}
                        </td>
                        <td className="px-4 py-2.5 text-zinc-500 font-mono text-[10px]">
                          {item.raw_purchase_label ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right text-zinc-400">
                          {formatCurrency(item.purchase_cost, item.currency)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-zinc-500">
                          {item.expected_grade ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-zinc-400 font-mono">
                          {isGraded ? slot.cert_number : '—'}
                        </td>
                        <td className="px-4 py-2.5">
                          {isGraded ? <span className="text-emerald-400 font-semibold">{grade}</span> : <span className="text-zinc-600">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-zinc-400">
                          {isGraded ? (() => { const lbl = slot.csv_grade_label || gradeLabel(batch.company, grade); return lbl ? `${lbl} ${grade}` : String(grade); })() : '—'}
                        </td>
                        <td className={`px-4 py-2.5 text-[11px] font-medium ${dispColor}`}>
                          {DISPOSITION_LABELS[slot.disposition]}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between px-5 py-4 border-t border-zinc-800">
              <p className="text-xs text-zinc-500">
                {(['graded', 'not_graded', 'lost', 'not_submitted'] as Disposition[])
                  .map((d) => `${slots.filter((s) => s.disposition === d).length} ${DISPOSITION_LABELS[d].toLowerCase()}`)
                  .join(' · ')} · returned {returnedAt}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setReviewing(false)}>Edit</Button>
                <Button size="sm" disabled={processReturn.isPending} onClick={handleConfirm}>
                  <PackageCheck size={13} />
                  {processReturn.isPending ? 'Processing…' : 'Confirm Return'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── View Return Modal ─────────────────────────────────────────────────────────

interface ReturnedSlab {
  id: string;
  cert_number: number | null;
  grade: number | null;
  grade_label: string | null;
  company: string;
  card_instance_id: string;
  card_name: string;
  set_name: string | null;
  card_number: string | null;
  inspection_condition: string | null;
  inspection_note: string | null;
  raw_purchase_label: string | null;
  expected_grade: number | null;
}

interface ReturnedSlabsResponse {
  batch: {
    id: string;
    batch_id: string;
    name: string | null;
    company: string;
    tier: string;
    status: string;
    submitted_at: string | null;
  };
  slabs: ReturnedSlab[];
}

function ViewReturnModal({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const { data, isLoading } = useQuery<ReturnedSlabsResponse>({
    queryKey: ['returned-slabs', batchId],
    queryFn:  () => api.get(`/grading-subs/${batchId}/returned-slabs`).then((r) => r.data),
  });

  // Build grade distribution — descending grade, with counts and percentages
  // across only graded slabs (cert_number !== null && grade !== null).
  const slabs = data?.slabs ?? [];
  const graded = slabs.filter((s) => s.grade != null);
  const total  = graded.length;
  const buckets = new Map<number, number>();
  for (const s of graded) {
    if (s.grade == null) continue;
    buckets.set(s.grade, (buckets.get(s.grade) ?? 0) + 1);
  }
  const summary = Array.from(buckets.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([grade, count]) => ({
      grade,
      count,
      pct: total > 0 ? (count / total) * 100 : 0,
    }));

  const batch = data?.batch;
  const title = batch ? `${batch.company} · ${batch.batch_id}` : 'Return';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-6xl overflow-hidden mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">View Return — {title}</h2>
            {batch?.name && <p className="text-[10px] text-zinc-500 mt-0.5">{batch.name}</p>}
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X size={15} />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">Loading…</div>
        ) : (
          <div className="flex max-h-[70vh]">
            {/* Slab list */}
            <div className="flex-1 overflow-y-auto border-r border-zinc-800">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-zinc-900">
                  <tr className="border-b border-zinc-800 text-zinc-500 uppercase tracking-wide text-[10px]">
                    <th className="px-4 py-2 text-left   font-medium">Card</th>
                    <th className="px-4 py-2 text-left   font-medium">Cert #</th>
                    <th className="px-4 py-2 text-left   font-medium">Grade</th>
                    <th className="px-4 py-2 text-left   font-medium">Label</th>
                    <th className="px-4 py-2 text-left   font-medium">Raw ID</th>
                    <th className="px-4 py-2 text-right  font-medium">Expected Grade</th>
                    <th className="px-4 py-2 text-left   font-medium">Condition</th>
                    <th className="px-4 py-2 text-left   font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {slabs.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-zinc-600 text-xs">
                        No slabs returned for this batch.
                      </td>
                    </tr>
                  ) : slabs.map((s) => {
                    const beatExpected = s.grade != null && s.expected_grade != null && s.grade > s.expected_grade;
                    const missedExpected = s.grade != null && s.expected_grade != null && s.grade < s.expected_grade;
                    const expColor = beatExpected ? 'text-emerald-400' : missedExpected ? 'text-red-400' : 'text-zinc-500';
                    return (
                      <tr key={s.id} className="hover:bg-zinc-800/20">
                        <td className="px-4 py-2.5">
                          <p className="text-zinc-200 font-medium">{s.card_name}</p>
                          {s.set_name && <p className="text-[10px] text-zinc-600">{s.set_name}{s.card_number ? ` · #${s.card_number}` : ''}</p>}
                        </td>
                        <td className="px-4 py-2.5 text-zinc-400 font-mono">{s.cert_number ?? '—'}</td>
                        <td className="px-4 py-2.5">
                          {s.grade != null
                            ? <span className="text-emerald-400 font-semibold">{s.grade}</span>
                            : <span className="text-zinc-600">—</span>}
                        </td>
                        <td className="px-4 py-2.5 text-zinc-400">{s.grade_label ?? '—'}</td>
                        <td className="px-4 py-2.5 text-zinc-500 font-mono text-[10px]">{s.raw_purchase_label ?? '—'}</td>
                        <td className={`px-4 py-2.5 text-right ${expColor}`}>{s.expected_grade ?? '—'}</td>
                        <td className="px-4 py-2.5 text-zinc-400 uppercase text-[11px]">{s.inspection_condition ?? '—'}</td>
                        <td className="px-4 py-2.5 text-zinc-500 text-[11px] max-w-[280px] whitespace-normal break-words">
                          {s.inspection_note ?? '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Grade summary panel */}
            <div className="w-64 p-5 shrink-0">
              <h3 className="text-[10px] uppercase tracking-wide text-zinc-500 font-medium mb-3">Grade Summary</h3>
              {summary.length === 0 ? (
                <p className="text-xs text-zinc-600">No graded slabs.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-zinc-500 border-b border-zinc-800">
                      <th className="text-left  py-1.5 font-medium">Grade</th>
                      <th className="text-right py-1.5 font-medium">Count</th>
                      <th className="text-right py-1.5 font-medium">%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {summary.map((row) => (
                      <tr key={row.grade}>
                        <td className="py-1.5 text-emerald-400 font-semibold">{row.grade}</td>
                        <td className="py-1.5 text-right text-zinc-300">{row.count}</td>
                        <td className="py-1.5 text-right text-zinc-500">{row.pct.toFixed(2)}%</td>
                      </tr>
                    ))}
                    <tr className="border-t border-zinc-700">
                      <td className="py-1.5 text-zinc-400 font-medium">Total</td>
                      <td className="py-1.5 text-right text-zinc-200 font-medium">{total}</td>
                      <td className="py-1.5 text-right text-zinc-400">100.00%</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-800">
          <p className="text-[11px] text-zinc-500">{slabs.length} slab{slabs.length !== 1 ? 's' : ''} · {total} graded</p>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function SubReturns() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectOpen, setSelectOpen] = useState(false);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [confirmRevertId, setConfirmRevertId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<Batch[]>({
    queryKey: ['grading-subs'],
    queryFn:  () => api.get('/grading-subs').then((r) => r.data),
  });

  const revertMut = useMutation({
    mutationFn: (id: string) => api.post(`/grading-subs/${id}/revert-return`).then((r) => r.data),
    onMutate:   (id) => setRevertingId(id),
    onSuccess:  () => {
      toast.success('Return reverted — batch back to submitted');
      qc.invalidateQueries({ queryKey: ['grading-subs'] });
      setConfirmRevertId(null);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError:    (err: any) => toast.error(err?.response?.data?.error ?? 'Failed to revert return'),
    onSettled:  () => setRevertingId(null),
  });

  const { data: batchDetail, isLoading: detailLoading } = useQuery<BatchDetail>({
    queryKey: ['grading-sub-detail', selectedId],
    queryFn:  () => api.get(`/grading-subs/${selectedId}`).then((r) => r.data),
    enabled:  !!selectedId,
  });

  // Show return form when a batch is selected
  if (selectedId) {
    if (detailLoading || !batchDetail) {
      return <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">Loading…</div>;
    }
    return <ReturnForm batch={batchDetail} onBack={() => setSelectedId(null)} />;
  }

  // Earliest-submitted first — when returns come back from the grader they
  // come back in submission order, so the oldest sub is almost always the
  // one being returned next.
  const submitted = (data?.filter((b) => b.status === 'submitted') ?? [])
    .slice()
    .sort((a, b) => {
      const aT = a.submitted_at ? new Date(a.submitted_at).getTime() : Infinity;
      const bT = b.submitted_at ? new Date(b.submitted_at).getTime() : Infinity;
      return aT - bT;
    });
  const returned  = data?.filter((b) => b.status === 'returned') ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 lg:gap-0 px-6 py-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-100">Sub Returns</h1>
        <div className="flex w-full lg:w-auto justify-end">
          <Button size="sm" onClick={() => setSelectOpen(true)}>
            <Plus size={14} />
            Record Return
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">Loading…</div>
        ) : returned.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3 text-zinc-500 text-sm">
            <p>No returned subs yet.</p>
            <Button size="sm" variant="ghost" onClick={() => setSelectOpen(true)}>
              <Plus size={13} /> Record your first return
            </Button>
          </div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-zinc-950 z-10">
              <tr className="border-b border-zinc-700 text-zinc-400 uppercase tracking-wide text-[10px]">
                <th className="px-4 py-2 text-left font-medium">Batch</th>
                <th className="px-4 py-2 text-left font-medium">Company</th>
                <th className="px-4 py-2 text-left font-medium">Tier</th>
                <th className="px-4 py-2 text-right font-medium">Line Items</th>
                <th className="px-4 py-2 text-right font-medium">Total Cards</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Submitted</th>
                <th className="w-48" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {returned.map((batch) => (
                <tr
                  key={batch.id}
                  onClick={() => confirmRevertId !== batch.id && setViewingId(batch.id)}
                  className="hover:bg-zinc-800/25 transition-colors cursor-pointer"
                >
                  <td className="px-4 py-2.5">
                    <p className="text-zinc-100 font-medium">{batch.name ?? batch.batch_id}</p>
                    <p className="text-[10px] text-zinc-600 font-mono">{batch.batch_id}</p>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-300">{batch.company}</td>
                  <td className="px-4 py-2.5 text-zinc-400">{batch.tier}</td>
                  <td className="px-4 py-2.5 text-right text-zinc-300">{batch.item_count}</td>
                  <td className="px-4 py-2.5 text-right text-zinc-300">{batch.total_qty}</td>
                  <td className="px-4 py-2.5">
                    <Badge className={BATCH_STATUS_COLORS[batch.status] ?? 'bg-zinc-700/50 text-zinc-400'}>
                      {batch.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500">{formatDate(batch.submitted_at)}</td>
                  <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                    {confirmRevertId === batch.id ? (
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-[10px] text-zinc-400">Undo return &amp; restore raw cards?</span>
                        <button
                          onClick={() => setConfirmRevertId(null)}
                          className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                        >Cancel</button>
                        <button
                          onClick={() => revertMut.mutate(batch.id)}
                          disabled={revertingId === batch.id}
                          className="text-[10px] font-medium text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50"
                        >{revertingId === batch.id ? 'Reverting…' : 'Confirm Revert'}</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmRevertId(batch.id)}
                        className="text-[10px] text-zinc-600 hover:text-amber-400 transition-colors"
                      >Revert Return</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectOpen && (
        <SelectBatchModal
          batches={submitted}
          onSelect={(id) => { setSelectOpen(false); setSelectedId(id); }}
          onClose={() => setSelectOpen(false)}
        />
      )}

      {viewingId && (
        <ViewReturnModal batchId={viewingId} onClose={() => setViewingId(null)} />
      )}
    </div>
  );
}
