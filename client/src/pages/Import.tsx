import React, { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, Download, FileText, Loader2, CheckCircle, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

// ─── Types ────────────────────────────────────────────────────────────────────

type ImportType = 'graded' | 'raw_purchase' | 'bulk_sale';

interface ImportPreview {
  id: string;
  detected_mapping: Record<string, string>;
  preview_rows: Record<string, string>[];
  total_rows: number;
  original_filename: string;
  columns: string[];
}

interface ImportRecord {
  id: string;
  import_type: string;
  original_filename: string;
  status: string;
  total_rows: number;
  imported: number;
  errors: number;
  created_at: string;
}

interface ImportResult {
  imported: number;
  errors: number;
  error_rows?: { row: number; error: string }[];
}

// ─── Config per type ──────────────────────────────────────────────────────────

const IMPORT_TYPES: { key: ImportType; label: string; description: string }[] = [
  { key: 'graded', label: 'Graded Cards', description: 'Slabs coming back from PSA, BGS, CGC, etc.' },
  { key: 'raw_purchase', label: 'Raw Purchases', description: 'Raw or bulk cards purchased from any source' },
  { key: 'bulk_sale', label: 'Bulk Sales', description: 'Sales of graded slabs or raw cards' },
];

const TARGET_FIELDS: Record<ImportType, string[]> = {
  graded: ['card_name', 'set_name', 'card_number', 'cert_number', 'grade', 'company', 'purchase_cost', 'grading_cost', 'currency', 'purchased_at', 'order_number', 'notes'],
  raw_purchase: ['card_name', 'set_name', 'card_number', 'condition', 'quantity', 'cost', 'currency', 'order_number', 'source', 'purchased_at', 'language', 'type', 'notes'],
  bulk_sale: ['identifier', 'sale_price', 'platform', 'platform_fees', 'shipping_cost', 'currency', 'sold_at', 'unique_id'],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function downloadTemplate(type: ImportType) {
  const res = await api.get(`/import/template/${type}`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${type}-template.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusBadge(status: string) {
  if (status === 'completed') return <span className="text-xs text-emerald-400">Completed</span>;
  if (status === 'completed_with_errors') return <span className="text-xs text-amber-400">With errors</span>;
  if (status === 'failed') return <span className="text-xs text-red-400">Failed</span>;
  return <span className="text-xs text-zinc-500">{status}</span>;
}

// ─── ImportFlow ───────────────────────────────────────────────────────────────

function ImportFlow({ importType }: { importType: ImportType }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ImportResult | null>(null);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('import_type', importType);
      return api.post('/import/upload', fd).then((r) => r.data.data);
    },
    onSuccess: (data: ImportPreview) => {
      setPreview(data);
      setResult(null);
      setMapping(data.detected_mapping ?? {});
      toast.success(`Parsed ${data.total_rows} rows`);
    },
    onError: () => toast.error('Failed to parse CSV'),
  });

  const executeMutation = useMutation({
    mutationFn: async () => {
      if (!preview || !fileRef.current?.files?.[0]) return;
      await api.post(`/import/${preview.id}/mapping`, { mapping });
      const fd = new FormData();
      fd.append('file', fileRef.current.files[0]);
      return api.post(`/import/${preview.id}/execute`, fd).then((r) => r.data.data);
    },
    onSuccess: (res: ImportResult | undefined) => {
      if (!res) return;
      setResult(res);
      setPreview(null);
      setMapping({});
      if (fileRef.current) fileRef.current.value = '';
      qc.invalidateQueries({ queryKey: ['imports'] });
      if (res.errors > 0) {
        toast(`Imported ${res.imported}, ${res.errors} errors`, { icon: '⚠️' });
      } else {
        toast.success(`Imported ${res.imported} rows`);
      }
    },
    onError: () => toast.error('Import failed'),
  });

  const reset = () => {
    setPreview(null);
    setMapping({});
    setResult(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const fields = TARGET_FIELDS[importType];

  return (
    <div className="space-y-4">
      {/* Template download + upload zone */}
      {!preview && !result && (
        <Card>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-zinc-400">Upload a CSV file to import records.</p>
              <button
                onClick={() => downloadTemplate(importType)}
                className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                <Download size={13} />
                Download template
              </button>
            </div>

            <div
              className="border-2 border-dashed border-zinc-700 rounded-xl p-10 text-center cursor-pointer hover:border-indigo-500 transition-colors"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) {
                  const dt = new DataTransfer();
                  dt.items.add(file);
                  if (fileRef.current) fileRef.current.files = dt.files;
                  uploadMutation.mutate(file);
                }
              }}
            >
              {uploadMutation.isPending ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 size={24} className="text-indigo-400 animate-spin" />
                  <p className="text-sm text-zinc-400">Parsing CSV…</p>
                </div>
              ) : (
                <>
                  <Upload size={24} className="mx-auto text-zinc-600 mb-2" />
                  <p className="text-sm text-zinc-300">Click or drag to upload a CSV</p>
                  <p className="text-xs text-zinc-600 mt-1">Max 50 MB</p>
                </>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadMutation.mutate(file);
              }}
            />
          </div>
        </Card>
      )}

      {/* Column mapping + preview */}
      {preview && (
        <>
          <Card>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FileText size={15} className="text-indigo-400" />
                <span className="text-sm font-medium text-zinc-100">{preview.original_filename}</span>
                <span className="text-xs text-zinc-500">{preview.total_rows} rows</span>
              </div>
              <button onClick={reset} className="text-xs text-zinc-500 hover:text-zinc-300">Cancel</button>
            </div>

            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-3">Map columns</h3>
            <div className="grid grid-cols-2 gap-2.5">
              {preview.columns.map((col) => (
                <div key={col} className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500 truncate w-28 shrink-0" title={col}>{col}</span>
                  <span className="text-zinc-700">→</span>
                  <select
                    value={mapping[col] ?? ''}
                    onChange={(e) => setMapping((m) => ({ ...m, [col]: e.target.value }))}
                    className="flex-1 text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-300 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">Skip</option>
                    {fields.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-3">Preview (first 5 rows)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-800">
                    {preview.columns.slice(0, 7).map((col) => (
                      <th key={col} className="py-1.5 px-2 text-left text-zinc-500 font-medium">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {preview.preview_rows.slice(0, 5).map((row, i) => (
                    <tr key={i}>
                      {preview.columns.slice(0, 7).map((col) => (
                        <td key={col} className="py-1.5 px-2 text-zinc-400 max-w-[120px] truncate">{row[col] ?? '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={reset}>Cancel</Button>
            <Button onClick={() => executeMutation.mutate()} disabled={executeMutation.isPending}>
              {executeMutation.isPending && <Loader2 size={14} className="animate-spin" />}
              Import {preview.total_rows} rows
            </Button>
          </div>
        </>
      )}

      {/* Result */}
      {result && (
        <Card>
          <div className="flex items-start gap-3">
            {result.errors === 0 ? (
              <CheckCircle size={20} className="text-emerald-400 mt-0.5 shrink-0" />
            ) : (
              <XCircle size={20} className="text-amber-400 mt-0.5 shrink-0" />
            )}
            <div className="flex-1 space-y-1">
              <p className="text-sm text-zinc-100 font-medium">
                Import complete — {result.imported} imported{result.errors > 0 ? `, ${result.errors} failed` : ''}
              </p>
              {result.error_rows && result.error_rows.length > 0 && (
                <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                  {result.error_rows.map((e) => (
                    <p key={e.row} className="text-xs text-red-400">Row {e.row}: {e.error}</p>
                  ))}
                </div>
              )}
            </div>
            <button onClick={reset} className="text-xs text-zinc-500 hover:text-zinc-300 shrink-0">Import another</button>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── ImportHistory ────────────────────────────────────────────────────────────

function ImportHistory() {
  const { data, isLoading } = useQuery<ImportRecord[]>({
    queryKey: ['imports'],
    queryFn: () => api.get('/import').then((r) => r.data.data ?? r.data),
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 size={18} className="text-zinc-600 animate-spin" /></div>;
  if (!data || data.length === 0) return null;

  return (
    <div>
      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide mb-3">Import History</h2>
      <Card className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="py-2 px-4 text-left text-xs text-zinc-500 font-medium">File</th>
              <th className="py-2 px-4 text-left text-xs text-zinc-500 font-medium">Type</th>
              <th className="py-2 px-4 text-left text-xs text-zinc-500 font-medium">Status</th>
              <th className="py-2 px-4 text-right text-xs text-zinc-500 font-medium">Rows</th>
              <th className="py-2 px-4 text-right text-xs text-zinc-500 font-medium">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {data.map((rec) => (
              <tr key={rec.id} className="hover:bg-zinc-800/40">
                <td className="py-2 px-4 text-zinc-300 truncate max-w-[200px]">{rec.original_filename}</td>
                <td className="py-2 px-4 text-zinc-500 text-xs">{rec.import_type}</td>
                <td className="py-2 px-4">{statusBadge(rec.status)}</td>
                <td className="py-2 px-4 text-right text-zinc-500 text-xs">
                  {rec.imported ?? 0}
                  {rec.errors > 0 && <span className="text-amber-400 ml-1">({rec.errors} err)</span>}
                </td>
                <td className="py-2 px-4 text-right text-zinc-500 text-xs">{fmtDate(rec.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function Import() {
  const [activeType, setActiveType] = useState<ImportType>('graded');

  return (
    <div className="p-6 space-y-6 max-w-3xl h-full overflow-y-auto">
      <h1 className="text-xl font-bold text-zinc-100">Import</h1>

      {/* Type tabs */}
      <div className="flex gap-2">
        {IMPORT_TYPES.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveType(key)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              activeType === key
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Description */}
      <p className="text-sm text-zinc-500 -mt-2">
        {IMPORT_TYPES.find((t) => t.key === activeType)?.description}
      </p>

      {/* Flow per type — key resets state when switching tabs */}
      <ImportFlow key={activeType} importType={activeType} />

      {/* History */}
      <ImportHistory />
    </div>
  );
}
