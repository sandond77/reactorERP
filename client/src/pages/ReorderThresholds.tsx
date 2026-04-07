import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X, BellOff, EyeOff, RotateCcw } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import toast from 'react-hot-toast';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BulkCardRow {
  catalog_id: string;
  card_name: string;
  set_name: string | null;
  card_number: string | null;
  sku: string | null;
  threshold_id: string | null;
  min_quantity: number | null;
  is_ignored: boolean | null;
  muted_until: string | null;
  to_grade_quantity: number;
  inbound_quantity: number;
}

// ── Inline min qty cell ───────────────────────────────────────────────────────

function MinQtyCell({ row }: { row: BulkCardRow }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(row.min_quantity != null ? String(row.min_quantity) : '');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bulk-cards-thresholds'] });
    qc.invalidateQueries({ queryKey: ['reorder-alerts'] });
  };

  const saveMutation = useMutation({
    mutationFn: (min_quantity: number) =>
      api.post('/reorder/thresholds', { catalog_id: row.catalog_id, min_quantity }),
    onSuccess: () => { invalidate(); setEditing(false); },
    onError: () => toast.error('Failed to save'),
  });

  const clearMutation = useMutation({
    mutationFn: () => api.delete(`/reorder/thresholds/${row.threshold_id}`),
    onSuccess: () => { invalidate(); setVal(''); setEditing(false); },
    onError: () => toast.error('Failed to clear'),
  });

  const parsed = parseInt(val, 10);

  if (!editing) {
    return (
      <button
        onClick={() => { setVal(row.min_quantity != null ? String(row.min_quantity) : ''); setEditing(true); }}
        className="text-sm text-left w-full"
      >
        {row.min_quantity != null
          ? <span className="text-zinc-300 tabular-nums">{row.min_quantity}</span>
          : <span className="text-zinc-600 italic">—</span>}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        type="number"
        min={1}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && parsed >= 1) saveMutation.mutate(parsed);
          if (e.key === 'Escape') setEditing(false);
        }}
        className="w-14 text-xs bg-zinc-800 border border-zinc-600 rounded px-1.5 py-0.5 text-zinc-200 focus:outline-none"
      />
      <button onClick={() => { if (parsed >= 1) saveMutation.mutate(parsed); }} disabled={!val || parsed < 1} className="text-emerald-400 hover:text-emerald-300 disabled:opacity-30">
        <Check size={12} />
      </button>
      {row.threshold_id
        ? <button onClick={() => clearMutation.mutate()} className="text-zinc-600 hover:text-red-400" title="Clear threshold"><X size={12} /></button>
        : <button onClick={() => setEditing(false)} className="text-zinc-600 hover:text-zinc-400"><X size={12} /></button>}
    </div>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ row }: { row: BulkCardRow }) {
  if (!row.threshold_id) return <span className="text-zinc-700 text-xs">—</span>;
  if (row.is_ignored) return <span className="text-[10px] text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">Ignored</span>;
  if (row.muted_until && new Date(row.muted_until) > new Date()) {
    const d = new Date(row.muted_until).toLocaleDateString();
    return <span className="text-[10px] text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">Muted until {d}</span>;
  }
  return <span className="text-[10px] text-emerald-600 bg-emerald-900/20 px-2 py-0.5 rounded-full">Active</span>;
}

// ── Action buttons ────────────────────────────────────────────────────────────

function ActionButtons({ row }: { row: BulkCardRow }) {
  const qc = useQueryClient();
  if (!row.threshold_id) return null;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bulk-cards-thresholds'] });
    qc.invalidateQueries({ queryKey: ['reorder-alerts'] });
  };

  const mute = useMutation({
    mutationFn: () => api.post(`/reorder/thresholds/${row.threshold_id}/mute`),
    onSuccess: () => { invalidate(); toast.success('Muted for 30 days'); },
  });
  const ignore = useMutation({
    mutationFn: () => api.post(`/reorder/thresholds/${row.threshold_id}/ignore`),
    onSuccess: () => { invalidate(); toast.success('Ignored permanently'); },
  });
  const reset = useMutation({
    mutationFn: () => api.post(`/reorder/thresholds/${row.threshold_id}/reset`),
    onSuccess: () => { invalidate(); toast.success('Alert reset'); },
  });

  const isMuted = !!row.muted_until && new Date(row.muted_until) > new Date();
  const isSilenced = row.is_ignored || isMuted;

  return (
    <div className="flex items-center gap-2">
      {isSilenced ? (
        <button onClick={() => reset.mutate()} title="Re-enable alert" className="text-zinc-500 hover:text-zinc-300 transition-colors">
          <RotateCcw size={13} />
        </button>
      ) : (
        <>
          <button onClick={() => mute.mutate()} title="Mute for 30 days" className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <BellOff size={13} />
          </button>
          <button onClick={() => ignore.mutate()} title="Ignore permanently" className="text-zinc-500 hover:text-amber-400 transition-colors">
            <EyeOff size={13} />
          </button>
        </>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ReorderThresholds() {
  const { data, isLoading } = useQuery<{ data: BulkCardRow[] }>({
    queryKey: ['bulk-cards-thresholds'],
    queryFn: () => api.get('/reorder/bulk-cards-with-thresholds').then((r) => r.data),
  });

  const rows = data?.data ?? [];

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-zinc-100">Reorder Alerts</h1>
        <p className="text-xs text-zinc-500 mt-0.5">
          Set minimum stock levels for bulk cards. Alerts trigger when the combined "to grade" + inbound quantity falls below the threshold. Click any Min Qty cell to edit.
        </p>
      </div>

      <div className="rounded-lg border border-zinc-800 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900">
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium whitespace-nowrap min-w-[120px]">Part Number</th>
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium whitespace-nowrap min-w-[160px]">Card Name</th>
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium whitespace-nowrap min-w-[140px]">Set</th>
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium whitespace-nowrap min-w-[80px]">Card #</th>
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium whitespace-nowrap min-w-[90px]">Min Qty</th>
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium whitespace-nowrap min-w-[120px]">Status</th>
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium whitespace-nowrap min-w-[80px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-600 text-xs">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-600 text-xs">No bulk cards in inventory.</td></tr>
            ) : (
              rows.map((row) => (
                <tr key={row.catalog_id} className={cn('border-t border-zinc-800/60 hover:bg-zinc-900/40 transition-colors', row.is_ignored && 'opacity-50')}>
                  <td className="px-4 py-2.5 text-xs font-mono text-zinc-400 whitespace-nowrap">{row.sku ?? '—'}</td>
                  <td className="px-4 py-2.5 text-zinc-200 whitespace-nowrap">{row.card_name}</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-500 whitespace-nowrap">{row.set_name ?? '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-zinc-500 whitespace-nowrap">{row.card_number ?? '—'}</td>
                  <td className="px-4 py-2.5"><MinQtyCell row={row} /></td>
                  <td className="px-4 py-2.5 whitespace-nowrap"><StatusBadge row={row} /></td>
                  <td className="px-4 py-2.5"><ActionButtons row={row} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
