import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X, BellOff, EyeOff, RotateCcw, ExternalLink, Plus, Trash2, Loader2 } from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { api } from '../lib/api';
import { cn, formatCurrency } from '../lib/utils';
import toast from 'react-hot-toast';

// ── Shared helpers ────────────────────────────────────────────────────────────

function isMuted(muted_until: string | null) {
  return !!muted_until && new Date(muted_until) > new Date();
}

function AlertStatusBadge({ is_ignored, muted_until }: { is_ignored: boolean | null; muted_until: string | null }) {
  if (is_ignored) return <span className="text-[10px] text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">Ignored</span>;
  if (isMuted(muted_until)) {
    const d = new Date(muted_until!).toLocaleDateString();
    return <span className="text-[10px] text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">Muted until {d}</span>;
  }
  return <span className="text-[10px] text-emerald-600 bg-emerald-900/20 px-2 py-0.5 rounded-full">Active</span>;
}

// ── Reorder tab ───────────────────────────────────────────────────────────────

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

function MinQtyCell({ row }: { row: BulkCardRow }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(row.min_quantity != null ? String(row.min_quantity) : '');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bulk-cards-thresholds'] });
    qc.invalidateQueries({ queryKey: ['reorder-alerts'] });
  };

  const saveMutation = useMutation({
    mutationFn: (min_quantity: number) => api.post('/reorder/thresholds', { catalog_id: row.catalog_id, min_quantity }),
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
      <button onClick={() => { setVal(row.min_quantity != null ? String(row.min_quantity) : ''); setEditing(true); }} className="text-sm text-left w-full">
        {row.min_quantity != null
          ? <span className="text-zinc-300 tabular-nums">{row.min_quantity}</span>
          : <span className="text-zinc-600 italic">—</span>}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus type="number" min={1} value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && parsed >= 1) saveMutation.mutate(parsed);
          if (e.key === 'Escape') setEditing(false);
        }}
        className="w-14 text-xs bg-zinc-800 border border-zinc-600 rounded px-1.5 py-0.5 text-zinc-200 focus:outline-none"
      />
      <button onClick={() => { if (parsed >= 1) saveMutation.mutate(parsed); }} disabled={!val || parsed < 1} className="text-emerald-400 hover:text-emerald-300 disabled:opacity-30"><Check size={12} /></button>
      {row.threshold_id
        ? <button onClick={() => clearMutation.mutate()} className="text-zinc-600 hover:text-red-400" title="Clear"><X size={12} /></button>
        : <button onClick={() => setEditing(false)} className="text-zinc-600 hover:text-zinc-400"><X size={12} /></button>}
    </div>
  );
}

function ReorderActionButtons({ row }: { row: BulkCardRow }) {
  const qc = useQueryClient();
  if (!row.threshold_id) return null;
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bulk-cards-thresholds'] });
    qc.invalidateQueries({ queryKey: ['reorder-alerts'] });
  };
  const mute   = useMutation({ mutationFn: () => api.post(`/reorder/thresholds/${row.threshold_id}/mute`),   onSuccess: () => { invalidate(); toast.success('Muted 30 days'); } });
  const ignore = useMutation({ mutationFn: () => api.post(`/reorder/thresholds/${row.threshold_id}/ignore`), onSuccess: () => { invalidate(); toast.success('Ignored'); } });
  const reset  = useMutation({ mutationFn: () => api.post(`/reorder/thresholds/${row.threshold_id}/reset`),  onSuccess: () => { invalidate(); toast.success('Reset'); } });
  const silenced = row.is_ignored || isMuted(row.muted_until);
  return (
    <div className="flex items-center gap-2">
      {silenced ? (
        <button onClick={() => reset.mutate()} title="Re-enable" className="text-zinc-500 hover:text-zinc-300"><RotateCcw size={13} /></button>
      ) : (
        <>
          <button onClick={() => mute.mutate()}   title="Mute 30 days"       className="text-zinc-500 hover:text-zinc-300"><BellOff size={13} /></button>
          <button onClick={() => ignore.mutate()} title="Ignore permanently" className="text-zinc-500 hover:text-amber-400"><EyeOff size={13} /></button>
        </>
      )}
    </div>
  );
}

function AddReorderModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selected, setSelected] = useState<CatalogResult | null>(null);
  const [minQty, setMinQty] = useState('1');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: searchData, isFetching } = useQuery<{ data: CatalogResult[] }>({
    queryKey: ['catalog-search-reorder', debouncedSearch],
    queryFn: () => api.get('/catalog/search', { params: { q: debouncedSearch, limit: 20 } }).then(r => r.data),
    enabled: debouncedSearch.length >= 1,
  });
  const results = searchData?.data ?? [];

  const saveMutation = useMutation({
    mutationFn: () => api.post('/reorder/thresholds', { catalog_id: selected!.id, min_quantity: parseInt(minQty, 10) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bulk-cards-thresholds'] });
      qc.invalidateQueries({ queryKey: ['reorder-alerts'] });
      toast.success('Reorder alert added');
      onClose();
      setSearch(''); setSelected(null); setMinQty('1');
    },
    onError: () => toast.error('Failed to add'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Add Reorder Alert" className="max-w-xl">
      {!selected ? (
        <>
          <div className="relative">
            <Input label="Card Name or Part Number" placeholder="Search…"
              value={search} onChange={e => setSearch(e.target.value)} autoFocus autoComplete="off" />
            {isFetching && <Loader2 size={13} className="absolute right-3 top-[30px] animate-spin text-zinc-500" />}
          </div>
          {debouncedSearch.length >= 1 && (
            results.length > 0 ? (
              <div className="rounded-lg border border-zinc-700 overflow-hidden mt-3 max-h-72 overflow-y-auto">
                {results.map(r => (
                  <button key={r.id} type="button" onClick={() => setSelected(r)}
                    className="w-full text-left px-4 py-3 hover:bg-zinc-800 border-b border-zinc-700/40 last:border-0 flex items-center justify-between gap-3 transition-colors">
                    <span className="text-sm text-zinc-200 truncate">{r.card_name}</span>
                    <span className="shrink-0 text-xs text-zinc-500 tabular-nums text-right">
                      {r.sku && <span className="font-mono mr-2">{r.sku}</span>}
                      {r.set_name}
                      {r.card_number && <span className="ml-1 text-zinc-600">#{r.card_number}</span>}
                    </span>
                  </button>
                ))}
              </div>
            ) : !isFetching ? (
              <p className="text-xs text-zinc-500 px-1 mt-3">No cards found.</p>
            ) : null
          )}
        </>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/50 px-4 py-3">
            <p className="text-sm font-medium text-zinc-100">{selected.card_name}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{selected.set_name}{selected.card_number ? ` · #${selected.card_number}` : ''}</p>
            <button type="button" onClick={() => setSelected(null)} className="text-xs text-indigo-400 hover:text-indigo-300 mt-1">Change</button>
          </div>
          <Input label="Min Quantity" type="number" min="1" step="1"
            value={minQty} onChange={e => setMinQty(e.target.value)} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200">Cancel</button>
            <button type="button" disabled={!minQty || parseInt(minQty, 10) < 1 || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
              className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors">
              {saveMutation.isPending ? 'Saving…' : 'Add Alert'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ReorderTab() {
  const [showAdd, setShowAdd] = useState(false);
  const { data, isLoading } = useQuery<{ data: BulkCardRow[] }>({
    queryKey: ['bulk-cards-thresholds'],
    queryFn: () => api.get('/reorder/bulk-cards-with-thresholds').then((r) => r.data),
  });
  const rows = data?.data ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-zinc-500">
          Set minimum stock levels for bulk cards. Alerts trigger when combined in-hand (to grade) + inbound quantity falls below the threshold. Click any Min Qty cell to edit.
        </p>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition-colors shrink-0 ml-4">
          <Plus size={13} /> Add Card
        </button>
      </div>
      <div className="rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900">
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium whitespace-nowrap min-w-[120px]">Part #</th>
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium whitespace-nowrap min-w-[160px]">Card Name</th>
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium whitespace-nowrap min-w-[140px]">Set</th>
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium whitespace-nowrap min-w-[70px]">Card #</th>
              <th className="text-right text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium whitespace-nowrap min-w-[70px]">Inbound</th>
              <th className="text-right text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium whitespace-nowrap min-w-[70px]">To Grade</th>
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium whitespace-nowrap min-w-[80px]">Min Qty</th>
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium whitespace-nowrap min-w-[120px]">Status</th>
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium whitespace-nowrap min-w-[70px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-zinc-600 text-xs">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-zinc-600 text-xs">No bulk cards in inventory.</td></tr>
            ) : rows.map((row) => (
              <tr key={row.catalog_id} className={cn('border-t border-zinc-800/60 hover:bg-zinc-900/40 transition-colors', row.is_ignored && 'opacity-50')}>
                <td className="px-4 py-2.5 text-xs font-mono text-zinc-400 whitespace-nowrap">{row.sku ?? '—'}</td>
                <td className="px-4 py-2.5 text-zinc-200 whitespace-nowrap">{row.card_name}</td>
                <td className="px-4 py-2.5 text-xs text-zinc-500 whitespace-nowrap">{row.set_name ?? '—'}</td>
                <td className="px-4 py-2.5 text-xs text-zinc-500 whitespace-nowrap">{row.card_number ?? '—'}</td>
                <td className="px-4 py-2.5 text-sm text-zinc-400 text-right tabular-nums">{row.inbound_quantity}</td>
                <td className="px-4 py-2.5 text-sm text-zinc-400 text-right tabular-nums">{row.to_grade_quantity}</td>
                <td className="px-4 py-2.5"><MinQtyCell row={row} /></td>
                <td className="px-4 py-2.5 whitespace-nowrap"><AlertStatusBadge is_ignored={row.is_ignored} muted_until={row.muted_until} /></td>
                <td className="px-4 py-2.5"><ReorderActionButtons row={row} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AddReorderModal open={showAdd} onClose={() => setShowAdd(false)} />
    </div>
  );
}

// ── eBay stale listings tab ───────────────────────────────────────────────────

interface StaleEbayRow {
  id: string;
  card_name: string | null;
  set_name: string | null;
  sku: string | null;
  card_number: string | null;
  list_price: number;
  listed_at: string | null;
  ebay_listing_url: string | null;
  days_listed: number;
  is_ignored: boolean;
  muted_until: string | null;
}

function EbayActionButtons({ row }: { row: StaleEbayRow }) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['alerts-stale-ebay'] });
    qc.invalidateQueries({ queryKey: ['stale-ebay-listings'] });
  };
  const mute   = useMutation({ mutationFn: () => api.post('/alerts/mute',   { entity_type: 'ebay_listing', entity_id: row.id }), onSuccess: () => { invalidate(); toast.success('Muted 30 days'); } });
  const ignore = useMutation({ mutationFn: () => api.post('/alerts/ignore', { entity_type: 'ebay_listing', entity_id: row.id }), onSuccess: () => { invalidate(); toast.success('Ignored'); } });
  const reset  = useMutation({ mutationFn: () => api.post('/alerts/reset',  { entity_type: 'ebay_listing', entity_id: row.id }), onSuccess: () => { invalidate(); toast.success('Reset'); } });
  const silenced = row.is_ignored || isMuted(row.muted_until);
  return (
    <div className="flex items-center gap-2">
      {silenced ? (
        <button onClick={() => reset.mutate()} title="Re-enable" className="text-zinc-500 hover:text-zinc-300"><RotateCcw size={13} /></button>
      ) : (
        <>
          <button onClick={() => mute.mutate()}   title="Mute 30 days"       className="text-zinc-500 hover:text-zinc-300"><BellOff size={13} /></button>
          <button onClick={() => ignore.mutate()} title="Ignore permanently" className="text-zinc-500 hover:text-amber-400"><EyeOff size={13} /></button>
        </>
      )}
    </div>
  );
}

const PAGE_SIZE = 15;

function Pagination({ page, totalPages, total, onChange }: { page: number; totalPages: number; total: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-t border-zinc-800 text-xs text-zinc-500">
      <span>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}</span>
      <div className="flex items-center gap-1">
        <button onClick={() => onChange(page - 1)} disabled={page === 1} className="px-2 py-1 rounded disabled:opacity-30 hover:text-zinc-300 transition-colors">←</button>
        <span className="px-2">{page} / {totalPages}</span>
        <button onClick={() => onChange(page + 1)} disabled={page === totalPages} className="px-2 py-1 rounded disabled:opacity-30 hover:text-zinc-300 transition-colors">→</button>
      </div>
    </div>
  );
}

function EbayListingsTab() {
  const [days, setDays] = useState(30);
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery<{ data: StaleEbayRow[] }>({
    queryKey: ['alerts-stale-ebay', days],
    queryFn: () => api.get('/alerts/stale-ebay', { params: { days } }).then((r) => r.data),
  });
  const allRows = data?.data ?? [];
  const totalPages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
  const rows = allRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-zinc-500">eBay listings that have been active for longer than the selected threshold. Mute or ignore to suppress dashboard alerts.</p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">Unsold for</span>
          {[14, 30, 60, 90].map((d) => (
            <button key={d} onClick={() => { setDays(d); setPage(1); }} className={cn('px-2.5 py-1 rounded text-xs font-medium transition-colors', days === d ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-zinc-300')}>
              {d}d
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-zinc-800">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-[30%]" />
            <col className="w-[35%]" />
            <col className="w-[12%]" />
            <col className="w-[10%]" />
            <col className="w-[13%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900">
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium">Card Name</th>
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium">Set</th>
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium">Card #</th>
              <th className="text-right text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium">Days</th>
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-600 text-xs">Loading…</td></tr>
            ) : allRows.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-600 text-xs">No stale listings for this threshold.</td></tr>
            ) : rows.map((row) => (
              <tr key={row.id} className={cn('border-t border-zinc-800/60 hover:bg-zinc-900/40 transition-colors', row.is_ignored && 'opacity-40')}>
                <td className="px-4 py-2.5">
                  {row.ebay_listing_url ? (
                    <a href={row.ebay_listing_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 transition-colors">
                      {row.card_name ?? '—'} <ExternalLink size={11} className="shrink-0 opacity-60" />
                    </a>
                  ) : (
                    <span className="text-zinc-200">{row.card_name ?? '—'}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs text-zinc-500">{row.set_name ?? '—'}</td>
                <td className="px-4 py-2.5 text-xs text-zinc-500">{row.card_number ?? '—'}</td>
                <td className={cn('px-4 py-2.5 text-right tabular-nums font-medium', row.days_listed >= 90 ? 'text-red-400' : row.days_listed >= 60 ? 'text-orange-400' : 'text-yellow-500')}>{row.days_listed}d</td>
                <td className="px-4 py-2.5"><EbayActionButtons row={row} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} totalPages={totalPages} total={allRows.length} onChange={setPage} />
      </div>
    </div>
  );
}

// ── Card Show stale inventory tab ─────────────────────────────────────────────

interface StaleCardShowRow {
  id: string;
  card_name: string | null;
  set_name: string | null;
  sku: string | null;
  card_number: string | null;
  quantity: number;
  purchase_cost: number;
  card_show_added_at: string | null;
  days_held: number;
  is_ignored: boolean;
  muted_until: string | null;
}

function CardShowActionButtons({ row }: { row: StaleCardShowRow }) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['alerts-stale-card-show'] });
    qc.invalidateQueries({ queryKey: ['stale-card-show'] });
  };
  const mute   = useMutation({ mutationFn: () => api.post('/alerts/mute',   { entity_type: 'card_show', entity_id: row.id }), onSuccess: () => { invalidate(); toast.success('Muted 30 days'); } });
  const ignore = useMutation({ mutationFn: () => api.post('/alerts/ignore', { entity_type: 'card_show', entity_id: row.id }), onSuccess: () => { invalidate(); toast.success('Ignored'); } });
  const reset  = useMutation({ mutationFn: () => api.post('/alerts/reset',  { entity_type: 'card_show', entity_id: row.id }), onSuccess: () => { invalidate(); toast.success('Reset'); } });
  const silenced = row.is_ignored || isMuted(row.muted_until);
  return (
    <div className="flex items-center gap-2">
      {silenced ? (
        <button onClick={() => reset.mutate()} title="Re-enable" className="text-zinc-500 hover:text-zinc-300"><RotateCcw size={13} /></button>
      ) : (
        <>
          <button onClick={() => mute.mutate()}   title="Mute 30 days"       className="text-zinc-500 hover:text-zinc-300"><BellOff size={13} /></button>
          <button onClick={() => ignore.mutate()} title="Ignore permanently" className="text-zinc-500 hover:text-amber-400"><EyeOff size={13} /></button>
        </>
      )}
    </div>
  );
}

function CardShowTab() {
  const [days, setDays] = useState(30);
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery<{ data: StaleCardShowRow[] }>({
    queryKey: ['alerts-stale-card-show', days],
    queryFn: () => api.get('/alerts/stale-card-show', { params: { days } }).then((r) => r.data),
  });
  const allRows = data?.data ?? [];
  const totalPages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
  const rows = allRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-zinc-500">Card show inventory that has been unsold past the selected threshold. Mute or ignore to suppress dashboard alerts.</p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">Unsold for</span>
          {[14, 30, 60, 90].map((d) => (
            <button key={d} onClick={() => { setDays(d); setPage(1); }} className={cn('px-2.5 py-1 rounded text-xs font-medium transition-colors', days === d ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-zinc-300')}>
              {d}d
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-lg border border-zinc-800">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-[28%]" />
            <col className="w-[32%]" />
            <col className="w-[12%]" />
            <col className="w-[8%]" />
            <col className="w-[9%]" />
            <col className="w-[11%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900">
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium">Card Name</th>
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium">Set</th>
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium">Card #</th>
              <th className="text-right text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium">Qty</th>
              <th className="text-right text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium">Days</th>
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-600 text-xs">Loading…</td></tr>
            ) : allRows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-600 text-xs">No stale card show inventory for this threshold.</td></tr>
            ) : rows.map((row) => (
              <tr key={row.id} className={cn('border-t border-zinc-800/60 hover:bg-zinc-900/40 transition-colors', row.is_ignored && 'opacity-40')}>
                <td className="px-4 py-2.5 text-zinc-200">{row.card_name ?? '—'}</td>
                <td className="px-4 py-2.5 text-xs text-zinc-500">{row.set_name ?? '—'}</td>
                <td className="px-4 py-2.5 text-xs text-zinc-500">{row.card_number ?? '—'}</td>
                <td className="px-4 py-2.5 text-zinc-400 text-right tabular-nums">{row.quantity}</td>
                <td className={cn('px-4 py-2.5 text-right tabular-nums font-medium', row.days_held >= 90 ? 'text-red-400' : row.days_held >= 60 ? 'text-orange-400' : 'text-yellow-500')}>{row.days_held}d</td>
                <td className="px-4 py-2.5"><CardShowActionButtons row={row} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page} totalPages={totalPages} total={allRows.length} onChange={setPage} />
      </div>
    </div>
  );
}

// ── Grade More tab ────────────────────────────────────────────────────────────

interface WatchlistRow {
  threshold_id: string;
  catalog_id: string;
  card_name: string;
  set_name: string | null;
  card_number: string | null;
  sku: string | null;
  company: string;
  grade: number | null;
  grade_label: string | null;
  min_quantity: number;
  is_ignored: boolean;
  muted_until: string | null;
  unsold_graded: number;
  in_grading: number;
}

interface CatalogResult {
  id: string;
  sku: string | null;
  card_name: string;
  set_name: string;
  card_number: string | null;
}

const GRADING_COMPANIES = ['PSA', 'BGS', 'CGC', 'SGC', 'HGA', 'ACE', 'ARS', 'OTHER'] as const;

function formatGrade(grade: number | null, gradeLabel: string | null): string {
  if (grade != null) {
    const g = parseFloat(String(grade));
    return g % 1 === 0 ? String(Math.floor(g)) : String(g);
  }
  return gradeLabel ?? '—';
}

function AddGradeMoreModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selected, setSelected] = useState<CatalogResult | null>(null);
  const [company, setCompany] = useState('PSA');
  const [grade, setGrade] = useState('');
  const [minQty, setMinQty] = useState('1');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: searchData, isFetching } = useQuery<{ data: CatalogResult[] }>({
    queryKey: ['catalog-search-grademore', debouncedSearch],
    queryFn: () => api.get('/catalog/search', { params: { q: debouncedSearch, limit: 20 } }).then(r => r.data),
    enabled: debouncedSearch.length >= 1,
  });
  const results = searchData?.data ?? [];

  const saveMutation = useMutation({
    mutationFn: () => api.post('/grade-more/thresholds', {
      catalog_id: selected!.id,
      company,
      grade: grade ? parseFloat(grade) : null,
      grade_label: null,
      min_quantity: parseInt(minQty, 10),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['grade-more-thresholds'] });
      qc.invalidateQueries({ queryKey: ['grade-more-alerts'] });
      toast.success('Added to watchlist');
      onClose();
      setSearch(''); setSelected(null); setGrade(''); setMinQty('1'); setCompany('PSA');
    },
    onError: () => toast.error('Failed to add'),
  });

  const canSave = selected && grade && parseInt(minQty, 10) >= 1;

  return (
    <Modal open={open} onClose={onClose} title="Add Card to Watch" className="max-w-xl">
      {!selected ? (
        <>
          <div className="relative">
            <Input
              label="Card Name or Part Number"
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
              autoComplete="off"
            />
            {isFetching && <Loader2 size={13} className="absolute right-3 top-[30px] animate-spin text-zinc-500" />}
          </div>
          {debouncedSearch.length >= 1 && (
            results.length > 0 ? (
              <div className="rounded-lg border border-zinc-700 overflow-hidden mt-3 max-h-72 overflow-y-auto">
                {results.map(r => (
                  <button key={r.id} type="button"
                    onClick={() => setSelected(r)}
                    className="w-full text-left px-4 py-3 hover:bg-zinc-800 border-b border-zinc-700/40 last:border-0 flex items-center justify-between gap-3 transition-colors">
                    <span className="text-sm text-zinc-200 truncate">{r.card_name}</span>
                    <span className="shrink-0 text-xs text-zinc-500 tabular-nums text-right">
                      {r.sku && <span className="font-mono mr-2">{r.sku}</span>}
                      {r.set_name}
                      {r.card_number && <span className="ml-1 text-zinc-600">#{r.card_number}</span>}
                    </span>
                  </button>
                ))}
              </div>
            ) : !isFetching ? (
              <p className="text-xs text-zinc-500 px-1 mt-3">No cards found.</p>
            ) : null
          )}
        </>
      ) : (
        <>
          <button type="button" onClick={() => { setSelected(null); setGrade(''); }}
            className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 mb-4 transition-colors">
            <span>←</span> Back
          </button>
          <p className="text-sm text-zinc-200 font-medium mb-1">{selected.card_name}</p>
          <p className="text-xs text-zinc-500 mb-5">
            {selected.sku && <span className="font-mono mr-2">{selected.sku}</span>}
            {selected.set_name}
            {selected.card_number && <span className="ml-1">#{selected.card_number}</span>}
          </p>
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div>
              <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide block mb-1">Grader</label>
              <select value={company} onChange={e => setCompany(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors">
                {GRADING_COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <Input label="Grade" type="number" min={1} max={10} step={0.5} value={grade}
              onChange={e => setGrade(e.target.value)} placeholder="e.g. 10" autoFocus />
            <Input label="Min Qty" type="number" min={1} value={minQty}
              onChange={e => setMinQty(e.target.value)} />
          </div>
          <div className="flex justify-end">
            <button onClick={() => saveMutation.mutate()} disabled={!canSave || saveMutation.isPending}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-sm rounded-lg transition-colors">
              Add to Watchlist
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function WatchlistMinQtyCell({ row }: { row: WatchlistRow }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(row.min_quantity));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['grade-more-thresholds'] });
    qc.invalidateQueries({ queryKey: ['grade-more-alerts'] });
  };

  const saveMutation = useMutation({
    mutationFn: (min_quantity: number) => api.post('/grade-more/thresholds', {
      catalog_id: row.catalog_id,
      company: row.company,
      grade: row.grade != null ? parseFloat(String(row.grade)) : null,
      grade_label: row.grade_label,
      min_quantity,
    }),
    onSuccess: () => { invalidate(); setEditing(false); },
    onError: () => toast.error('Failed to save'),
  });

  const parsed = parseInt(val, 10);

  if (!editing) {
    return (
      <button onClick={() => { setVal(String(row.min_quantity)); setEditing(true); }} className="text-sm text-left w-full">
        <span className="text-zinc-300 tabular-nums">{row.min_quantity}</span>
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus type="number" min={1} value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && parsed >= 1) saveMutation.mutate(parsed);
          if (e.key === 'Escape') setEditing(false);
        }}
        className="w-14 text-xs bg-zinc-800 border border-zinc-600 rounded px-1.5 py-0.5 text-zinc-200 focus:outline-none"
      />
      <button onClick={() => { if (parsed >= 1) saveMutation.mutate(parsed); }} disabled={!val || parsed < 1} className="text-emerald-400 hover:text-emerald-300 disabled:opacity-30"><Check size={12} /></button>
      <button onClick={() => setEditing(false)} className="text-zinc-600 hover:text-zinc-400"><X size={12} /></button>
    </div>
  );
}

function WatchlistActionButtons({ row }: { row: WatchlistRow }) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['grade-more-thresholds'] });
    qc.invalidateQueries({ queryKey: ['grade-more-alerts'] });
  };
  const mute   = useMutation({ mutationFn: () => api.post(`/grade-more/${row.threshold_id}/mute`),   onSuccess: () => { invalidate(); toast.success('Muted 30 days'); } });
  const ignore = useMutation({ mutationFn: () => api.post(`/grade-more/${row.threshold_id}/ignore`), onSuccess: () => { invalidate(); toast.success('Ignored'); } });
  const reset  = useMutation({ mutationFn: () => api.post(`/grade-more/${row.threshold_id}/reset`),  onSuccess: () => { invalidate(); toast.success('Reset'); } });
  const remove = useMutation({ mutationFn: () => api.delete(`/grade-more/${row.threshold_id}`),      onSuccess: () => { invalidate(); toast.success('Removed'); } });
  const silenced = row.is_ignored || isMuted(row.muted_until);
  return (
    <div className="flex items-center gap-2">
      {silenced ? (
        <button onClick={() => reset.mutate()} title="Re-enable" className="text-zinc-500 hover:text-zinc-300"><RotateCcw size={13} /></button>
      ) : (
        <>
          <button onClick={() => mute.mutate()}   title="Mute 30 days"       className="text-zinc-500 hover:text-zinc-300"><BellOff size={13} /></button>
          <button onClick={() => ignore.mutate()} title="Ignore permanently" className="text-zinc-500 hover:text-amber-400"><EyeOff size={13} /></button>
        </>
      )}
      <button onClick={() => remove.mutate()} title="Remove from watchlist" className="text-zinc-600 hover:text-red-400"><Trash2 size={13} /></button>
    </div>
  );
}

function GradeMoreTab() {
  const [showAdd, setShowAdd] = useState(false);
  const { data, isLoading } = useQuery<{ data: WatchlistRow[] }>({
    queryKey: ['grade-more-thresholds'],
    queryFn: () => api.get('/grade-more/thresholds').then((r) => r.data),
  });
  const rows = data?.data ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-zinc-500">
          Cards you're monitoring for grading stock. Alerts trigger when unsold graded + in grading falls below the threshold.
        </p>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition-colors shrink-0 ml-4">
          <Plus size={13} /> Add Card
        </button>
      </div>
      <div className="rounded-lg border border-zinc-800 overflow-hidden">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col className="w-[10%]" />
            <col className="w-[26%]" />
            <col className="w-[13%]" />
            <col className="w-[5%]" />
            <col className="w-[5%]" />
            <col className="w-[5%]" />
            <col className="w-[6%]" />
            <col className="w-[7%]" />
            <col className="w-[7%]" />
            <col className="w-[9%]" />
            <col className="w-[7%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900">
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium">Part #</th>
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium">Card Name</th>
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium">Set</th>
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium">Card #</th>
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium">Grader</th>
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium">Grade</th>
              <th className="text-right text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium">Unsold</th>
              <th className="text-right text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium">In Grading</th>
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium">Min Qty</th>
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium">Status</th>
              <th className="text-left text-[10px] text-zinc-500 uppercase tracking-widest px-4 py-2.5 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-zinc-600 text-xs">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-zinc-600 text-xs">No cards on watchlist. Click Add Card to start monitoring.</td></tr>
            ) : rows.map((row) => (
              <tr key={row.threshold_id} className={cn('border-t border-zinc-800/60 hover:bg-zinc-900/40 transition-colors', row.is_ignored && 'opacity-50')}>
                <td className="px-4 py-2.5 text-xs font-mono text-zinc-400">{row.sku ?? '—'}</td>
                <td className="px-4 py-2.5 text-zinc-200">{row.card_name}</td>
                <td className="px-4 py-2.5 text-xs text-zinc-500 truncate">{row.set_name ?? '—'}</td>
                <td className="px-4 py-2.5 text-xs text-zinc-500">{row.card_number ?? '—'}</td>
                <td className="px-4 py-2.5 text-xs text-zinc-400 font-medium">{row.company}</td>
                <td className="px-4 py-2.5 text-xs text-zinc-300 tabular-nums">{formatGrade(row.grade, row.grade_label)}</td>
                <td className={cn('px-4 py-2.5 text-sm text-right tabular-nums font-medium', row.unsold_graded === 0 ? 'text-red-400' : 'text-amber-400')}>{row.unsold_graded}</td>
                <td className="px-4 py-2.5 text-sm text-blue-400 text-right tabular-nums">{row.in_grading}</td>
                <td className="px-4 py-2.5"><WatchlistMinQtyCell row={row} /></td>
                <td className="px-4 py-2.5"><AlertStatusBadge is_ignored={row.is_ignored} muted_until={row.muted_until} /></td>
                <td className="px-4 py-2.5"><WatchlistActionButtons row={row} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AddGradeMoreModal open={showAdd} onClose={() => setShowAdd(false)} />
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Tab = 'reorder' | 'grade_more' | 'ebay' | 'card_show';

export function ReorderThresholds() {
  const urlTab = (new URLSearchParams(window.location.search).get('tab') as Tab) || 'reorder';
  const [tab, setTab] = useState<Tab>(urlTab);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'reorder',    label: 'Reorder Alerts' },
    { key: 'grade_more', label: 'Grade More' },
    { key: 'ebay',       label: 'eBay Listings Review' },
    { key: 'card_show',  label: 'Card Show Review' },
  ];

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-zinc-100">Alerts</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-800/50 rounded-lg p-1 mb-6 w-fit">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
              tab === key ? 'bg-zinc-700 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'reorder'    && <ReorderTab />}
      {tab === 'grade_more' && <GradeMoreTab />}
      {tab === 'ebay'       && <EbayListingsTab />}
      {tab === 'card_show'  && <CardShowTab />}
    </div>
  );
}
