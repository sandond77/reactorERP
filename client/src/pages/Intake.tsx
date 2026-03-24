import { useState, useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { formatCurrency, formatDate } from '../lib/utils';
import { ColHeader, useColWidths, colMinWidth } from '../components/ui/TableHeader';
import { loadFilters, saveFilters } from '../lib/filter-store';
import toast from 'react-hot-toast';
import type { PurchaseRow, PurchaseType, PurchaseStatus } from './raw/types';
import { STATUS_COLORS, TYPE_COLORS } from './raw/types';

// ── Add/Edit Purchase Modal ───────────────────────────────────────────────────

function PurchaseForm({
  initial,
  onSave,
  onClose,
}: {
  initial?: Partial<PurchaseRow>;
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    type:          (initial?.type ?? 'raw') as PurchaseType,
    source:        initial?.source ?? '',
    order_number:  initial?.order_number ?? '',
    language:      initial?.language ?? 'JP',
    card_name:     initial?.card_name ?? '',
    set_name:      initial?.set_name ?? '',
    card_number:   initial?.card_number ?? '',
    total_cost_yen: initial?.total_cost_yen ? String(initial.total_cost_yen) : '',
    fx_rate:       initial?.fx_rate ? String(initial.fx_rate) : '',
    total_cost_usd: initial?.total_cost_usd ? String(initial.total_cost_usd / 100) : '',
    card_count:    initial?.card_count ? String(initial.card_count) : '1',
    status:        (initial?.status ?? 'ordered') as PurchaseStatus,
    purchased_at:  initial?.purchased_at ? initial.purchased_at.slice(0, 10) : '',
    received_at:   initial?.received_at  ? initial.received_at.slice(0, 10)  : '',
    reserved:      initial?.reserved ?? false,
    notes:         initial?.notes ?? '',
  });

  // Auto-compute USD from yen + fx rate
  useEffect(() => {
    const yen  = parseFloat(form.total_cost_yen);
    const rate = parseFloat(form.fx_rate);
    if (!isNaN(yen) && !isNaN(rate) && rate > 0) {
      setForm((f) => ({ ...f, total_cost_usd: (yen / rate).toFixed(2) }));
    }
  }, [form.total_cost_yen, form.fx_rate]);

  function set(k: string, v: unknown) { setForm((f) => ({ ...f, [k]: v })); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const usd = parseFloat(form.total_cost_usd);
    onSave({
      type:           form.type,
      source:         form.source || undefined,
      order_number:   form.order_number || undefined,
      language:       form.language,
      card_name:      form.card_name || undefined,
      set_name:       form.set_name  || undefined,
      card_number:    form.card_number || undefined,
      total_cost_yen: form.total_cost_yen ? parseInt(form.total_cost_yen) : undefined,
      fx_rate:        form.fx_rate ? parseFloat(form.fx_rate) : undefined,
      total_cost_usd: !isNaN(usd) ? Math.round(usd * 100) : undefined,
      card_count:     parseInt(form.card_count) || 1,
      status:         form.status,
      purchased_at:   form.purchased_at || undefined,
      received_at:    form.received_at  || undefined,
      reserved:       form.reserved,
      notes:          form.notes || undefined,
    });
  }

  const inp   = 'w-full px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500';
  const label = 'block text-xs text-zinc-400 mb-1';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>Type</label>
          <select value={form.type} onChange={(e) => set('type', e.target.value)} className={inp}>
            <option value="raw">Raw</option>
            <option value="bulk">Bulk</option>
          </select>
        </div>
        <div>
          <label className={label}>Status</label>
          <select value={form.status} onChange={(e) => set('status', e.target.value)} className={inp}>
            <option value="ordered">Ordered</option>
            <option value="received">Received</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>Source</label>
          <input value={form.source} onChange={(e) => set('source', e.target.value)} placeholder="Buyee, Yahoo Auctions…" className={inp} />
        </div>
        <div>
          <label className={label}>Order #</label>
          <input value={form.order_number} onChange={(e) => set('order_number', e.target.value)} className={inp} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className={label}>Card Name</label>
          <input value={form.card_name} onChange={(e) => set('card_name', e.target.value)} placeholder="Shining Mew" className={inp} />
        </div>
        <div>
          <label className={label}>Set Name</label>
          <input value={form.set_name} onChange={(e) => set('set_name', e.target.value)} placeholder="Corocoro Comics" className={inp} />
        </div>
        <div>
          <label className={label}>Card #</label>
          <input value={form.card_number} onChange={(e) => set('card_number', e.target.value)} placeholder="151" className={inp} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>Language</label>
          <select value={form.language} onChange={(e) => set('language', e.target.value)} className={inp}>
            <option value="JP">JP</option>
            <option value="EN">EN</option>
          </select>
        </div>
        <div>
          <label className={label}># of Cards</label>
          <input type="number" min="1" value={form.card_count} onChange={(e) => set('card_count', e.target.value)} className={inp} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className={label}>Total Cost (¥)</label>
          <input type="number" value={form.total_cost_yen} onChange={(e) => set('total_cost_yen', e.target.value)} placeholder="11800" className={inp} />
        </div>
        <div>
          <label className={label}>¥ → USD Rate</label>
          <input type="number" step="0.0001" value={form.fx_rate} onChange={(e) => set('fx_rate', e.target.value)} placeholder="147" className={inp} />
        </div>
        <div>
          <label className={label}>Total Cost (USD)</label>
          <input type="number" step="0.01" value={form.total_cost_usd} onChange={(e) => set('total_cost_usd', e.target.value)} placeholder="80.27" className={inp} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>Date Purchased</label>
          <input type="date" value={form.purchased_at} onChange={(e) => set('purchased_at', e.target.value)} className={inp} />
        </div>
        <div>
          <label className={label}>Receive Date</label>
          <input type="date" value={form.received_at} onChange={(e) => set('received_at', e.target.value)} className={inp} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="reserved" checked={form.reserved} onChange={(e) => set('reserved', e.target.checked)}
          className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 accent-indigo-500" />
        <label htmlFor="reserved" className="text-xs text-zinc-400">Reserved</label>
      </div>
      <div>
        <label className={label}>Notes</label>
        <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className={inp} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button type="submit" size="sm">Save</Button>
      </div>
    </form>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const INTAKE_FILTER_DEFAULTS = {
  search:  '',
  fStatus: null as PurchaseStatus | null,
  fType:   null as PurchaseType | null,
};

export function Intake() {
  const qc   = useQueryClient();
  const saved = loadFilters('intake', INTAKE_FILTER_DEFAULTS);
  const [page, setPage]                   = useState(1);
  const [search, setSearch]               = useState(saved.search);
  const [debouncedSearch, setDebounced]   = useState(saved.search);
  const [fStatus, setFStatus]             = useState<PurchaseStatus | null>(saved.fStatus);
  const [fType, setFType]                 = useState<PurchaseType | null>(saved.fType);
  const [addOpen, setAddOpen]             = useState(false);
  const [editRow, setEditRow]             = useState<PurchaseRow | null>(null);

  const MINS = {
    pid:     colMinWidth('ID',         true, false),
    type:    colMinWidth('Type',       true, false),
    card:    colMinWidth('Card',       true, false),
    source:  colMinWidth('Source',     true, false),
    order:   colMinWidth('Order #',    true, false),
    lang:    colMinWidth('Lang',       true, false),
    cards:   colMinWidth('Cards',      true, false),
    cost:    colMinWidth('Cost (USD)', true, false),
    avg:     colMinWidth('Avg/Card',   true, false),
    status:  colMinWidth('Status',     true, false),
    bought:  colMinWidth('Purchased',  true, false),
    inspect: colMinWidth('Inspected',  true, false),
  };
  const { rz, totalWidth } = useColWidths({
    pid:     Math.max(MINS.pid,     110),
    type:    Math.max(MINS.type,     80),
    card:    Math.max(MINS.card,    280),
    source:  Math.max(MINS.source,  120),
    order:   Math.max(MINS.order,   140),
    lang:    Math.max(MINS.lang,     70),
    cards:   Math.max(MINS.cards,    70),
    cost:    Math.max(MINS.cost,    110),
    avg:     Math.max(MINS.avg,     100),
    status:  Math.max(MINS.status,  100),
    bought:  Math.max(MINS.bought,  110),
    inspect: Math.max(MINS.inspect, 110),
  });

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    saveFilters('intake', { search, fStatus, fType });
  }, [search, fStatus, fType]);

  const params = {
    page,
    pageSize: 50,
    search:   debouncedSearch || undefined,
    status:   fStatus ?? undefined,
    type:     fType ?? undefined,
  };

  const { data, isLoading } = useQuery<{ data: PurchaseRow[]; total: number; totalPages: number }>({
    queryKey: ['raw-purchases', params],
    queryFn:  () => api.get('/raw-purchases', { params }).then((r) => r.data),
  });

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/raw-purchases', body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['raw-purchases'] }); setAddOpen(false); toast.success('Purchase added'); },
    onError: () => toast.error('Failed to add purchase'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patch(`/raw-purchases/${id}`, body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['raw-purchases'] }); setEditRow(null); toast.success('Updated'); },
    onError: () => toast.error('Failed to update'),
  });

  const hasActiveFilters = !!debouncedSearch || fStatus !== null || fType !== null;
  function clearFilters() { setSearch(''); setFStatus(null); setFType(null); setPage(1); }

  const sh = { sortCol: null, sortDir: 'asc' as const, onSort: () => {} };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-100">Intake</h1>
        <div className="flex items-center gap-3">
          {hasActiveFilters && (
            <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
              <X size={12} /> Clear filters
            </button>
          )}
          <div className="flex gap-1">
            {(['raw', 'bulk'] as PurchaseType[]).map((t) => (
              <button key={t} onClick={() => { setFType((p) => p === t ? null : t); setPage(1); }}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors capitalize ${fType === t ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                {t}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {(['ordered', 'received'] as PurchaseStatus[]).map((s) => (
              <button key={s} onClick={() => { setFStatus((p) => p === s ? null : s); setPage(1); }}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors capitalize ${fStatus === s ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                {s}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56 px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
          />
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus size={14} /> Add Purchase
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">Loading…</div>
        ) : (
          <table className="text-xs whitespace-nowrap border-collapse" style={{ tableLayout: 'fixed', width: totalWidth + 'px' }}>
            <thead className="sticky top-0 bg-zinc-950 z-10">
              <tr className="border-b border-zinc-700 text-zinc-300 uppercase tracking-wide">
                <ColHeader label="ID"         col="purchase_id"    {...sh} {...rz('pid')}     minWidth={MINS.pid} />
                <ColHeader label="Type"       col="type"           {...sh} {...rz('type')}    minWidth={MINS.type} />
                <ColHeader label="Card"       col="card_name"      {...sh} {...rz('card')}    minWidth={MINS.card} />
                <ColHeader label="Source"     col="source"         {...sh} {...rz('source')}  minWidth={MINS.source} />
                <ColHeader label="Order #"    col="order_number"   {...sh} {...rz('order')}   minWidth={MINS.order} />
                <ColHeader label="Lang"       col="language"       {...sh} {...rz('lang')}    minWidth={MINS.lang} />
                <ColHeader label="Cards"      col="card_count"     {...sh} {...rz('cards')}   minWidth={MINS.cards} align="right" />
                <ColHeader label="Cost (USD)" col="total_cost_usd" {...sh} {...rz('cost')}    minWidth={MINS.cost} align="right" />
                <ColHeader label="Avg/Card"   col="avg_cost_usd"   {...sh} {...rz('avg')}     minWidth={MINS.avg} align="right" />
                <ColHeader label="Status"     col="status"         {...sh} {...rz('status')}  minWidth={MINS.status} />
                <ColHeader label="Purchased"  col="purchased_at"   {...sh} {...rz('bought')}  minWidth={MINS.bought} />
                <ColHeader label="Inspected"  col="inspected_count" {...sh} {...rz('inspect')} minWidth={MINS.inspect} align="right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {!data?.data.length ? (
                <tr><td colSpan={12} className="px-4 py-10 text-center text-zinc-500">No purchases yet.</td></tr>
              ) : data.data.map((row) => (
                <tr key={row.id}
                  className="hover:bg-zinc-800/25 cursor-pointer transition-colors"
                  onClick={() => setEditRow(row)}>
                  <td className="px-4 py-2 font-mono text-indigo-300">{row.purchase_id}</td>
                  <td className="px-4 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium capitalize ${TYPE_COLORS[row.type]}`}>{row.type}</span>
                  </td>
                  <td className="px-4 py-2">
                    <p className="text-zinc-200 truncate">{row.card_name ?? '—'}</p>
                    {row.set_name && <p className="text-[10px] text-zinc-500">{row.set_name}{row.card_number ? ` · #${row.card_number}` : ''}</p>}
                  </td>
                  <td className="px-4 py-2 text-zinc-400">{row.source ?? '—'}</td>
                  <td className="px-4 py-2 text-zinc-400 font-mono text-[10px]">{row.order_number ?? '—'}</td>
                  <td className="px-4 py-2 text-zinc-400">{row.language}</td>
                  <td className="px-4 py-2 text-right text-zinc-300">{row.card_count}</td>
                  <td className="px-4 py-2 text-right text-zinc-300">{row.total_cost_usd ? formatCurrency(row.total_cost_usd, 'USD') : '—'}</td>
                  <td className="px-4 py-2 text-right text-zinc-400">{row.avg_cost_usd ? formatCurrency(row.avg_cost_usd, 'USD') : '—'}</td>
                  <td className="px-4 py-2">
                    <span className={`capitalize font-medium ${STATUS_COLORS[row.status]}`}>{row.status}</span>
                  </td>
                  <td className="px-4 py-2 text-zinc-500">{formatDate(row.purchased_at)}</td>
                  <td className="px-4 py-2 text-right">
                    <span className={row.inspected_count > 0 ? 'text-emerald-400' : 'text-zinc-600'}>
                      {row.inspected_count}/{row.card_count}
                    </span>
                    {row.sell_raw_count > 0 && <span className="ml-1 text-zinc-500 text-[10px]">{row.sell_raw_count}R</span>}
                    {row.grade_count > 0 && <span className="ml-1 text-zinc-500 text-[10px]">{row.grade_count}G</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {data && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-zinc-800 text-xs text-zinc-500">
          <span>{data.total} purchase{data.total !== 1 ? 's' : ''}</span>
          <div className="flex items-center gap-2">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}
              className="px-2 py-1 rounded bg-zinc-800 disabled:opacity-30 hover:bg-zinc-700">Prev</button>
            <span>Page {page}</span>
            <button disabled={page >= (data.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}
              className="px-2 py-1 rounded bg-zinc-800 disabled:opacity-30 hover:bg-zinc-700">Next</button>
          </div>
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Purchase">
        <PurchaseForm onSave={(body) => createMut.mutate(body)} onClose={() => setAddOpen(false)} />
      </Modal>

      <Modal open={!!editRow} onClose={() => setEditRow(null)} title="Edit Purchase">
        {editRow && (
          <PurchaseForm
            initial={editRow}
            onSave={(body) => updateMut.mutate({ id: editRow.id, body })}
            onClose={() => setEditRow(null)}
          />
        )}
      </Modal>
    </div>
  );
}
