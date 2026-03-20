import { useState, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, FileText, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';

interface ImportPreview {
  id: string;
  detected_mapping: Record<string, string>;
  preview_rows: Record<string, string>[];
  total_rows: number;
  original_filename: string;
  columns: string[];
}

const TARGET_FIELDS = [
  'card_name', 'set_name', 'card_number', 'card_game', 'language',
  'purchase_cost', 'currency', 'condition', 'grade', 'grading_company',
  'cert_number', 'purchased_at', 'notes',
];

export function Import() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importType, setImportType] = useState('cards');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('csv', file);
      fd.append('import_type', importType);
      return api.post('/import/upload', fd).then((r) => r.data.data);
    },
    onSuccess: (data: ImportPreview) => {
      setPreview(data);
      setMapping(data.detected_mapping);
      toast.success(`Parsed ${data.total_rows} rows`);
    },
    onError: () => toast.error('Failed to parse CSV'),
  });

  const executeMutation = useMutation({
    mutationFn: async () => {
      if (!preview || !fileRef.current?.files?.[0]) return;
      // Save mapping first
      await api.put(`/import/${preview.id}/mapping`, { mapping });
      // Then execute with the file
      const fd = new FormData();
      fd.append('csv', fileRef.current.files[0]);
      return api.post(`/import/${preview.id}/execute`, fd).then((r) => r.data.data);
    },
    onSuccess: (result: any) => {
      toast.success(`Imported ${result?.imported ?? 0} cards`);
      if (result?.errors > 0) toast(`${result.errors} rows had errors`, { icon: '⚠️' });
      setPreview(null);
      setMapping({});
      qc.invalidateQueries({ queryKey: ['cards'] });
    },
    onError: () => toast.error('Import failed'),
  });

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <h1 className="text-xl font-bold text-zinc-100">Import CSV</h1>

      <Card>
        <div className="space-y-4">
          <Select
            label="Import Type"
            value={importType}
            onChange={(e) => setImportType(e.target.value)}
            className="w-48"
          >
            <option value="cards">Inventory Cards</option>
            <option value="sales">Sales History</option>
          </Select>

          <div
            className="border-2 border-dashed border-zinc-700 rounded-xl p-8 text-center cursor-pointer hover:border-indigo-500 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={24} className="mx-auto text-zinc-600 mb-2" />
            <p className="text-sm text-zinc-400">Click to upload a CSV file</p>
            <p className="text-xs text-zinc-600 mt-1">Exported from eBay, TCGPlayer, PSA, or custom spreadsheets</p>
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
          {uploadMutation.isPending && (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Loader2 size={14} className="animate-spin" /> Parsing CSV…
            </div>
          )}
        </div>
      </Card>

      {preview && (
        <>
          <Card>
            <div className="flex items-center gap-2 mb-4">
              <FileText size={16} className="text-indigo-400" />
              <h2 className="text-sm font-semibold text-zinc-100">{preview.original_filename}</h2>
              <span className="text-xs text-zinc-500">{preview.total_rows} rows detected</span>
            </div>
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-3">Column Mapping</h3>
            <div className="grid grid-cols-2 gap-3">
              {preview.columns.map((col) => (
                <div key={col} className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500 truncate w-28 shrink-0" title={col}>{col}</span>
                  <span className="text-zinc-600">→</span>
                  <select
                    value={mapping[col] ?? ''}
                    onChange={(e) => setMapping((m) => ({ ...m, [col]: e.target.value }))}
                    className="flex-1 text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-300 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">Skip</option>
                    {TARGET_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
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
                    {preview.columns.slice(0, 6).map((col) => (
                      <th key={col} className="py-1.5 px-2 text-left text-zinc-500 font-medium">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {preview.preview_rows.slice(0, 5).map((row, i) => (
                    <tr key={i}>
                      {preview.columns.slice(0, 6).map((col) => (
                        <td key={col} className="py-1.5 px-2 text-zinc-400 max-w-[120px] truncate">{row[col] ?? '—'}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => { setPreview(null); setMapping({}); }}>Cancel</Button>
            <Button onClick={() => executeMutation.mutate()} disabled={executeMutation.isPending}>
              {executeMutation.isPending && <Loader2 size={14} className="animate-spin" />}
              Import {preview.total_rows} Rows
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
