import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, PackageCheck, Plus, X, Upload } from 'lucide-react';
import { api } from '../lib/api';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { formatDate } from '../lib/utils';
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
}

interface BatchItem {
  id: string;
  card_instance_id: string;
  line_item_num: number;
  card_name: string | null;
  set_name: string | null;
  card_number: string | null;
  quantity: number;
  expected_grade: number | null;
  purchase_cost: number;
  currency: string;
  catalog_id: string | null;
  sku: string | null;
}

interface BatchDetail extends Batch {
  items: BatchItem[];
}

type ReturnRow = {
  batch_item_id: string;
  grade: string;
  cert_number: string;
  card_name_override?: string;
  csv_grade_label?: string;  // label from CSV (e.g. "NEAR MINT-MINT"), overrides computed label
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function gradeLabel(company: string, grade: number): string {
  const co = company.toUpperCase();
  if (co === 'PSA') {
    const map: Record<number, string> = {
      10: 'GEM MT', 9: 'MINT', 8: 'NM-MT', 7: 'NM', 6: 'EX-MT',
      5: 'EX', 4: 'VG-EX', 3: 'VG', 2: 'GOOD', 1.5: 'FAIR', 1: 'POOR',
    };
    return map[grade] ?? `PSA ${grade}`;
  }
  if (co === 'BGS') {
    const map: Record<number, string> = {
      10: 'PRISTINE', 9.5: 'GEM MINT', 9: 'MINT+', 8.5: 'NM-MT+',
      8: 'NM-MT', 7.5: 'NM+', 7: 'NM', 6.5: 'EX-MT+', 6: 'EX-MT',
      5.5: 'EX+', 5: 'EX', 4.5: 'VG-EX+', 4: 'VG-EX', 3.5: 'VG+',
      3: 'VG', 2.5: 'GOOD+', 2: 'GOOD', 1.5: 'FAIR', 1: 'POOR',
    };
    return map[grade] ?? `BGS ${grade}`;
  }
  if (co === 'CGC') {
    const map: Record<number, string> = {
      10: 'PRISTINE', 9.5: 'GEM MINT', 9: 'MINT+', 8.5: 'NM-MT+',
      8: 'NM-MT', 7.5: 'NM+', 7: 'NM', 6.5: 'EX-MT+', 6: 'EX-MT',
      5.5: 'EX+', 5: 'EX', 4.5: 'VG-EX+', 4: 'VG-EX', 3.5: 'VG+',
      3: 'VG', 2.5: 'GOOD+', 2: 'GOOD', 1.5: 'FAIR', 1: 'POOR',
    };
    return map[grade] ?? `CGC ${grade}`;
  }
  if (co === 'SGC') {
    const map: Record<number, string> = {
      10: 'PRISTINE', 9.5: 'MINT+', 9: 'MINT', 8.5: 'NM-MT+',
      8: 'NM-MT', 7.5: 'NM+', 7: 'NM', 6.5: 'EX-MT+', 6: 'EX-MT',
      5.5: 'EX+', 5: 'EX', 4.5: 'VG-EX+', 4: 'VG-EX', 3.5: 'VG+',
      3: 'VG', 2.5: 'GOOD+', 2: 'GOOD', 1.5: 'FAIR', 1: 'POOR', 0.5: 'AUTHENTIC',
    };
    return map[grade] ?? `SGC ${grade}`;
  }
  if (co === 'HGA') {
    const map: Record<number, string> = {
      10: 'GEM MINT', 9: 'MINT', 8: 'NEAR MINT', 7: 'EXCELLENT',
      6: 'FINE', 5: 'VERY GOOD', 4: 'GOOD', 3: 'FAIR', 2: 'POOR',
    };
    return map[grade] ?? `HGA ${grade}`;
  }
  return String(grade);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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
                    <p className="text-[10px] text-zinc-500 font-mono mt-0.5">{b.batch_id}</p>
                  </div>
                  <div className="text-right text-xs text-zinc-400 shrink-0">
                    <p>{b.company} · {b.tier}</p>
                    <p className="text-zinc-600">{b.item_count} card{b.item_count !== 1 ? 's' : ''}</p>
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
  const [rows, setRows] = useState<ReturnRow[]>(() =>
    batch.items.map((item) => ({
      batch_item_id: item.id,
      grade: '',
      cert_number: '',
    }))
  );
  const [reviewing, setReviewing] = useState(false);

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

      let matched = 0;

      setRows((prev) => prev.map((row, idx) => {
        const item = batch.items[idx];

        // Match by line item number first, then by card name
        let csvRow = colLine !== -1
          ? dataRows.find((r) => parseInt(r[colLine] ?? '') === item.line_item_num)
          : undefined;

        if (!csvRow && colSubj !== -1 && item.card_name) {
          const name = item.card_name.toLowerCase();
          csvRow = dataRows.find((r) => {
            const subj = (r[colSubj] ?? '').toLowerCase();
            return subj.includes(name) || name.includes(subj);
          });
        }

        if (!csvRow) return row;
        matched++;

        let grade = row.grade;

        let csv_grade_label = row.csv_grade_label;

        // Grade column — may be plain number or "NEAR MINT-MINT 8"
        if (colGrade !== -1 && csvRow[colGrade]) {
          const { grade: g, label } = parseGradeStr(csvRow[colGrade]);
          if (g !== null) grade = String(g);
          if (label) csv_grade_label = label;
        }

        // Grade description column as fallback for grade number
        if (!grade && colDesc !== -1 && csvRow[colDesc]) {
          const { grade: g, label } = parseGradeStr(csvRow[colDesc]);
          if (g !== null) grade = String(g);
          if (label && !csv_grade_label) csv_grade_label = label;
        }

        const cert_number = colCert !== -1 ? (csvRow[colCert] ?? row.cert_number) : row.cert_number;
        const card_name_override = colSubj !== -1 && csvRow[colSubj] ? csvRow[colSubj] : row.card_name_override;

        return { ...row, grade, cert_number, card_name_override, csv_grade_label };
      }));

      toast.success(`Matched ${matched} of ${batch.items.length} line items from CSV`);
    };
    reader.readAsText(file);
  }

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

  function updateRow(idx: number, field: keyof ReturnRow, value: string) {
    setRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  }

  function handleReview(e: React.FormEvent) {
    e.preventDefault();
    const missingGrade = rows.filter((r) => !r.grade || isNaN(parseFloat(r.grade)));
    if (missingGrade.length) {
      toast.error(`${missingGrade.length} item${missingGrade.length > 1 ? 's' : ''} missing a grade`);
      return;
    }
    const missingCert = rows.filter((r) => !r.cert_number.trim());
    if (missingCert.length) {
      toast.error(`${missingCert.length} item${missingCert.length > 1 ? 's' : ''} missing a cert #`);
      return;
    }
    setReviewing(true);
  }

  function handleConfirm() {
    processReturn.mutate({
      returned_at: returnedAt || undefined,
      items: rows.map((row) => {
        const g = parseFloat(row.grade);
        const lbl = row.csv_grade_label || gradeLabel(batch.company, g);
        return {
          batch_item_id: row.batch_item_id,
          grade: g,
          grade_label: lbl ? `${lbl} ${g}` : String(g),
          cert_number: row.cert_number,
          card_name_override: row.card_name_override ?? undefined,
        };
      }),
    });
  }

  const totalCards = batch.items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
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
                <th className="px-4 py-2 text-left font-medium w-8">#</th>
                <th className="px-4 py-2 text-left font-medium">Cert #</th>
                <th className="px-4 py-2 text-left font-medium">Grade</th>
                <th className="px-4 py-2 text-right font-medium">Exp. Grade</th>
                <th className="px-4 py-2 text-left font-medium">Card</th>
                <th className="px-4 py-2 text-left font-medium">Set</th>
                <th className="px-4 py-2 text-left font-medium">Card #</th>
                <th className="px-4 py-2 text-right font-medium">Qty</th>
                <th className="px-4 py-2 text-left font-medium">Label</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {batch.items.map((item, idx) => (
                <tr key={item.id} className="hover:bg-zinc-800/20">
                  <td className="px-4 py-2 text-zinc-500 text-[10px] font-mono">{item.line_item_num}</td>
                  <td className="px-4 py-2">
                    <input
                      type="text"
                      placeholder="Required"
                      value={rows[idx]?.cert_number ?? ''}
                      onChange={(e) => updateRow(idx, 'cert_number', e.target.value)}
                      className={`w-28 px-2 py-1 text-xs bg-zinc-900 border rounded text-zinc-100 focus:outline-none focus:border-indigo-500 ${rows[idx]?.cert_number ? 'border-zinc-700' : 'border-zinc-600'}`}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      step="0.5"
                      min="1"
                      max="10"
                      placeholder="10"
                      value={rows[idx]?.grade ?? ''}
                      onChange={(e) => updateRow(idx, 'grade', e.target.value)}
                      className={`w-20 px-2 py-1 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100 focus:outline-none focus:border-indigo-500 ${noSpinner}`}
                    />
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-600">{item.expected_grade ?? '—'}</td>
                  <td className="px-4 py-2">
                    <input
                      type="text"
                      value={rows[idx]?.card_name_override ?? item.card_name ?? ''}
                      onChange={(e) => setRows((prev) => {
                        const next = [...prev];
                        next[idx] = { ...next[idx], card_name_override: e.target.value };
                        return next;
                      })}
                      className="w-full min-w-32 px-2 py-1 text-xs bg-transparent border border-transparent hover:border-zinc-700 focus:border-indigo-500 focus:bg-zinc-900 rounded text-zinc-200 font-medium focus:outline-none transition-colors"
                    />
                  </td>
                  <td className="px-4 py-2 text-zinc-500">{item.set_name ?? '—'}</td>
                  <td className="px-4 py-2 text-zinc-500">{item.card_number ? `#${item.card_number}` : '—'}</td>
                  <td className="px-4 py-2 text-right text-zinc-300">{item.quantity}</td>
                  <td className="px-4 py-2 text-zinc-500">
                    {rows[idx]?.grade && !isNaN(parseFloat(rows[idx].grade))
                      ? (() => {
                          const g = parseFloat(rows[idx].grade);
                          const lbl = rows[idx].csv_grade_label || gradeLabel(batch.company, g);
                          return lbl ? `${lbl} ${g}` : String(g);
                        })()
                      : <span className="text-zinc-700">—</span>}
                  </td>
                </tr>
              ))}
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
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
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
                    <th className="px-4 py-2 text-left font-medium w-6">#</th>
                    <th className="px-4 py-2 text-left font-medium">Cert #</th>
                    <th className="px-4 py-2 text-left font-medium">Grade</th>
                    <th className="px-4 py-2 text-left font-medium">Label</th>
                    <th className="px-4 py-2 text-left font-medium">Card</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50">
                  {batch.items.map((item, idx) => {
                    const row = rows[idx];
                    const grade = parseFloat(row.grade);
                    return (
                      <tr key={item.id} className="hover:bg-zinc-800/20">
                        <td className="px-4 py-2.5 text-zinc-600 font-mono text-[10px]">{item.line_item_num}</td>
                        <td className="px-4 py-2.5 text-zinc-400 font-mono">{row.cert_number}</td>
                        <td className="px-4 py-2.5">
                          <span className="text-emerald-400 font-semibold">{grade}</span>
                        </td>
                        <td className="px-4 py-2.5 text-zinc-400">{(() => { const lbl = row.csv_grade_label || gradeLabel(batch.company, grade); return lbl ? `${lbl} ${grade}` : String(grade); })()}</td>
                        <td className="px-4 py-2.5">
                          <p className="text-zinc-200 font-medium">{row.card_name_override ?? item.card_name ?? '—'}</p>
                          {item.set_name && <p className="text-[10px] text-zinc-600">{item.set_name}{item.card_number ? ` · #${item.card_number}` : ''}</p>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between px-5 py-4 border-t border-zinc-800">
              <p className="text-xs text-zinc-500">{batch.items.length} card{batch.items.length !== 1 ? 's' : ''} · returned {returnedAt}</p>
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

// ── Main Component ────────────────────────────────────────────────────────────

export function SubReturns() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectOpen, setSelectOpen] = useState(false);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [confirmRevertId, setConfirmRevertId] = useState<string | null>(null);
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
    onError:    () => toast.error('Failed to revert return'),
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

  const submitted = data?.filter((b) => b.status === 'submitted') ?? [];
  const returned  = data?.filter((b) => b.status === 'returned') ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-100">Sub Returns</h1>
        <Button size="sm" onClick={() => setSelectOpen(true)}>
          <Plus size={14} />
          Record Return
        </Button>
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
                <th className="px-4 py-2 text-right font-medium">Cards</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Submitted</th>
                <th className="w-48" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {returned.map((batch) => (
                <tr key={batch.id} className="hover:bg-zinc-800/25 transition-colors">
                  <td className="px-4 py-2.5">
                    <p className="text-zinc-100 font-medium">{batch.name ?? batch.batch_id}</p>
                    <p className="text-[10px] text-zinc-600 font-mono">{batch.batch_id}</p>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-300">{batch.company}</td>
                  <td className="px-4 py-2.5 text-zinc-400">{batch.tier}</td>
                  <td className="px-4 py-2.5 text-right text-zinc-300">{batch.item_count}</td>
                  <td className="px-4 py-2.5">
                    <Badge className={BATCH_STATUS_COLORS[batch.status] ?? 'bg-zinc-700/50 text-zinc-400'}>
                      {batch.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500">{formatDate(batch.submitted_at)}</td>
                  <td className="px-4 py-2.5 text-right">
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
    </div>
  );
}
