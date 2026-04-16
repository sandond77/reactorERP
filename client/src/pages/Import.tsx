import React, { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, Download, FileText, Loader2, CheckCircle, XCircle, Sparkles, AlertTriangle, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

// ─── Types ────────────────────────────────────────────────────────────────────

type ImportType = 'graded' | 'raw_purchase' | 'bulk_sale' | 'expenses';

interface ImportPreview {
  id: string;
  original_filename: string;
  columns: string[];
  total_rows: number;
  preview_rows: Record<string, string>[];
  detected_mapping: Record<string, string>;
  detected_type: ImportType | 'unknown';
  detected_confidence: 'high' | 'medium' | 'low';
  detected_reasoning: string;
  import_type: string;
}

interface ImportRecord {
  id: string;
  import_type: string;
  filename: string;
  status: string;
  row_count: number;
  imported_count: number;
  error_count: number;
  created_at: string;
}

interface ImportResult {
  imported_count: number;
  error_count: number;
  errors?: { row: number; message: string }[];
}

// ─── Config ───────────────────────────────────────────────────────────────────

const IMPORT_TYPES: { key: ImportType; label: string }[] = [
  { key: 'graded',       label: 'Graded Cards' },
  { key: 'raw_purchase', label: 'Raw Purchases' },
  { key: 'bulk_sale',    label: 'Bulk Sales' },
  { key: 'expenses',     label: 'Expenses' },
];

// All fields the system can accept — used to populate mapping dropdowns.
// Organized by category for readability in the UI.
const ALL_TARGET_FIELDS: { group: string; fields: string[] }[] = [
  { group: 'Card',     fields: ['card_name', 'set_name', 'card_number', 'card_game', 'language', 'condition', 'notes'] },
  { group: 'Graded',   fields: ['cert_number', 'grade', 'company', 'grading_cost'] },
  { group: 'Purchase', fields: ['purchase_cost', 'cost', 'quantity', 'currency', 'purchased_at', 'order_number', 'source', 'type'] },
  { group: 'Sale',     fields: ['sold_at', 'sale_price', 'after_fees', 'platform_fees', 'shipping_cost', 'platform', 'unique_id', 'listing_url'] },
  { group: 'Listing',  fields: ['is_listed', 'list_price', 'listed_at'] },
  { group: 'Expense',  fields: ['description', 'amount', 'date', 'link'] },
  { group: 'Bulk Sale',fields: ['identifier'] },
];

const CONFIDENCE_COLORS: Record<string, string> = {
  high:   'text-green-400',
  medium: 'text-yellow-400',
  low:    'text-orange-400',
};

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

// ─── Upload zone ──────────────────────────────────────────────────────────────

function UploadZone({ onFile }: { onFile: (file: File) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    onFile(file);
  }

  return (
    <div
      className="border-2 border-dashed border-zinc-700 rounded-xl p-12 text-center cursor-pointer hover:border-indigo-500 transition-colors"
      onClick={() => fileRef.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
      }}
    >
      <Upload size={28} className="mx-auto text-zinc-600 mb-3" />
      <p className="text-sm font-medium text-zinc-300">Click or drag to upload</p>
      <p className="text-xs text-zinc-500 mt-1">CSV, Excel (.xlsx, .xls) — any format, any columns</p>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx,.xls,.ods"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
    </div>
  );
}

// ─── Main flow ────────────────────────────────────────────────────────────────

function ImportFlow() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importType, setImportType] = useState<ImportType>('graded');
  const [result, setResult] = useState<ImportResult | null>(null);

  const uploadMut = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append('file', f);
      return api.post('/import/upload', fd).then((r) => r.data.data as ImportPreview);
    },
    onSuccess: (data) => {
      setPreview(data);
      setMapping(data.detected_mapping ?? {});
      const detected = data.detected_type;
      if (detected && detected !== 'unknown' && IMPORT_TYPES.some((t) => t.key === detected)) {
        setImportType(detected as ImportType);
      }
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Failed to parse file'),
  });

  const executeMut = useMutation({
    mutationFn: async () => {
      if (!preview || !file) return;
      await api.post(`/import/${preview.id}/mapping`, { mapping, import_type: importType });
      const fd = new FormData();
      fd.append('file', file);
      return api.post(`/import/${preview.id}/execute`, fd).then((r) => r.data.data as ImportResult);
    },
    onSuccess: (res) => {
      if (!res) return;
      setResult(res);
      setPreview(null);
      setFile(null);
      qc.invalidateQueries({ queryKey: ['imports'] });
      if (res.error_count > 0) {
        toast(`Imported ${res.imported_count}, ${res.error_count} errors`, { icon: '⚠️' });
      } else {
        toast.success(`Imported ${res.imported_count} rows`);
      }
    },
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Import failed'),
  });

  function handleFile(f: File) {
    setFile(f);
    setResult(null);
    uploadMut.mutate(f);
  }

  function reset(deletePending = true) {
    if (deletePending && preview?.id) {
      api.delete(`/import/${preview.id}`).catch(() => {});
      qc.invalidateQueries({ queryKey: ['imports'] });
    }
    setFile(null);
    setPreview(null);
    setMapping({});
    setResult(null);
    uploadMut.reset();
    executeMut.reset();
  }


  // ── Upload state
  if (uploadMut.isPending) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 py-8">
          <Loader2 size={24} className="text-indigo-400 animate-spin" />
          <p className="text-sm text-zinc-400">Analyzing file with AI…</p>
        </div>
      </Card>
    );
  }

  // ── Initial upload
  if (!preview && !result) {
    return (
      <Card>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-300 font-medium">Smart Import</p>
              <p className="text-sm text-zinc-500 mt-0.5">Upload any CSV or Excel file — AI will detect what it is and map the columns automatically.</p>
            </div>
            <div className="flex gap-2 shrink-0">
              {IMPORT_TYPES.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => downloadTemplate(key)}
                  className="text-xs text-zinc-500 hover:text-indigo-400 transition-colors flex items-center gap-1"
                  title={`Download ${label} template`}
                >
                  <Download size={11} />
                  {label}
                </button>
              ))}
            </div>
          </div>
          <UploadZone onFile={handleFile} />
        </div>
      </Card>
    );
  }

  // ── Preview + mapping
  if (preview) {
    const confidence = preview.detected_confidence;
    const detectedLabel = IMPORT_TYPES.find((t) => t.key === preview.detected_type)?.label ?? preview.detected_type;

    return (
      <div className="space-y-4">
        {/* AI detection banner */}
        <Card>
          <div className="flex items-start gap-3">
            <Sparkles size={16} className="text-indigo-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-zinc-100">
                  Detected: <span className="text-indigo-400">{detectedLabel}</span>
                </span>
                <span className={`text-xs font-medium ${CONFIDENCE_COLORS[confidence] ?? 'text-zinc-400'}`}>
                  {confidence} confidence
                </span>
                {confidence !== 'high' && (
                  <AlertTriangle size={12} className="text-yellow-400" />
                )}
              </div>
              <p className="text-xs text-zinc-500 mt-0.5">{preview.detected_reasoning}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-zinc-500">Override:</span>
              <select
                value={importType}
                onChange={(e) => setImportType(e.target.value as ImportType)}
                className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-300 focus:outline-none focus:border-indigo-500"
              >
                {IMPORT_TYPES.map(({ key, label }) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
          </div>
        </Card>

        {/* File info + column mapping */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileText size={15} className="text-indigo-400" />
              <span className="text-sm font-medium text-zinc-100">{preview.original_filename}</span>
              <span className="text-xs text-zinc-500">{preview.total_rows} rows · {preview.columns.length} columns</span>
            </div>
            <button onClick={reset} className="text-xs text-zinc-500 hover:text-zinc-300">Cancel</button>
          </div>

          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-3">Column mapping</h3>
          <div className="grid grid-cols-2 gap-2.5">
            {preview.columns.map((col) => (
              <div key={col} className="flex items-center gap-2">
                <span className="text-xs text-zinc-400 truncate w-28 shrink-0" title={col}>{col}</span>
                <span className="text-zinc-700 text-xs">→</span>
                <select
                  value={mapping[col] ?? ''}
                  onChange={(e) => setMapping((m) => ({ ...m, [col]: e.target.value }))}
                  className={`flex-1 text-xs bg-zinc-800 border rounded px-2 py-1 text-zinc-300 focus:outline-none focus:border-indigo-500 ${
                    mapping[col] ? 'border-indigo-500/40' : 'border-zinc-700'
                  }`}
                >
                  <option value="">Skip</option>
                  {ALL_TARGET_FIELDS.map(({ group, fields }) => (
                    <optgroup key={group} label={group}>
                      {fields.map((f) => <option key={f} value={f}>{f}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <p className="text-xs text-zinc-600 mt-3">
            {Object.values(mapping).filter(Boolean).length} of {preview.columns.length} columns mapped
            {Object.values(mapping).filter(Boolean).length < preview.columns.length && ' — unmapped columns will be skipped'}
          </p>
        </Card>

        {/* Data preview */}
        <Card>
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-3">Data preview (first 5 rows)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800">
                  {preview.columns.slice(0, 8).map((col) => (
                    <th key={col} className="py-1.5 px-2 text-left text-zinc-500 font-medium whitespace-nowrap">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {preview.preview_rows.slice(0, 5).map((row, i) => (
                  <tr key={i}>
                    {preview.columns.slice(0, 8).map((col) => (
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
          <Button onClick={() => executeMut.mutate()} disabled={executeMut.isPending}>
            {executeMut.isPending && <Loader2 size={14} className="animate-spin mr-1.5" />}
            Import {preview.total_rows} rows
          </Button>
        </div>
      </div>
    );
  }

  // ── Result
  if (result) {
    return (
      <Card>
        <div className="flex items-start gap-3">
          {result.error_count === 0
            ? <CheckCircle size={20} className="text-emerald-400 mt-0.5 shrink-0" />
            : <XCircle size={20} className="text-amber-400 mt-0.5 shrink-0" />
          }
          <div className="flex-1 space-y-1">
            <p className="text-sm text-zinc-100 font-medium">
              Import complete — {result.imported_count} imported{result.error_count > 0 ? `, ${result.error_count} failed` : ''}
            </p>
            {result.errors && result.errors.length > 0 && (
              <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                {result.errors.map((e) => (
                  <p key={e.row} className="text-xs text-red-400">Row {e.row}: {e.message}</p>
                ))}
              </div>
            )}
          </div>
          <button onClick={reset} className="text-xs text-zinc-500 hover:text-zinc-300 shrink-0">Import another</button>
        </div>
      </Card>
    );
  }

  return null;
}

// ─── Import History ───────────────────────────────────────────────────────────

function ImportHistory() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<ImportRecord[]>({
    queryKey: ['imports'],
    queryFn: () => api.get('/import').then((r) => r.data.data ?? r.data),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/import/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['imports'] }),
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Delete failed'),
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
              <th className="py-2 px-4 w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {data.map((rec) => (
              <tr key={rec.id} className="hover:bg-zinc-800/40 group">
                <td className="py-2 px-4 text-zinc-300 truncate max-w-[200px]">{rec.filename}</td>
                <td className="py-2 px-4 text-zinc-500 text-xs">{rec.import_type}</td>
                <td className="py-2 px-4">{statusBadge(rec.status)}</td>
                <td className="py-2 px-4 text-right text-zinc-500 text-xs">
                  {rec.imported_count ?? 0}
                  {(rec.error_count ?? 0) > 0 && <span className="text-amber-400 ml-1">({rec.error_count} err)</span>}
                </td>
                <td className="py-2 px-4 text-right text-zinc-500 text-xs">{fmtDate(rec.created_at)}</td>
                <td className="py-2 px-4">
                  {rec.status === 'pending' && (
                    <button
                      onClick={() => deleteMut.mutate(rec.id)}
                      disabled={deleteMut.isPending}
                      className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all"
                      title="Delete pending import"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </td>
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
  return (
    <div className="p-6 space-y-6 max-w-3xl h-full overflow-y-auto">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">Import</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Upload any CSV or Excel file — AI will detect the format and map columns automatically.</p>
      </div>
      <ImportFlow />
      <ImportHistory />
    </div>
  );
}
