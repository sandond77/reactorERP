import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Plus, X, PackageCheck, Ban, ChevronDown } from 'lucide-react';
import { api } from '../lib/api';
import { AddPartModal } from '../components/catalog/AddPartModal';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { formatCurrency, formatDate } from '../lib/utils';
import { ColHeader, useColWidths, colMinWidth } from '../components/ui/TableHeader';
import { loadFilters, saveFilters } from '../lib/filter-store';
import toast from 'react-hot-toast';
import type { PurchaseRow, PurchaseType } from './raw/types';
import { STATUS_COLORS, TYPE_COLORS } from './raw/types';

// ── Add/Edit Purchase Form ────────────────────────────────────────────────────

interface CatalogMatch {
  id: string;
  sku: string | null;
  card_name: string;
  set_name: string;
  card_number: string | null;
  language: string;
}

function PartNumberField({
  form,
  catalogMatch,
  onSelect,
  onClear,
}: {
  form: { card_name: string; set_name: string; card_number: string; language: string };
  catalogMatch: CatalogMatch | null;
  catalogId: string | null;
  onSelect: (match: CatalogMatch) => void;
  onClear: () => void;
}) {
  const [results, setResults] = useState<CatalogMatch[]>([]);
  const [open, setOpen] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef2 = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasSearchTerms = !!(form.card_name || form.set_name || form.card_number);

  // Search using all three card fields whenever they change
  useEffect(() => {
    if (debounceRef2.current) clearTimeout(debounceRef2.current);
    if (!hasSearchTerms) { setResults([]); return; }
    debounceRef2.current = setTimeout(() => {
      const params: Record<string, string> = { language: form.language };
      if (form.card_name)   params.card_name   = form.card_name;
      if (form.set_name)    params.set_name    = form.set_name;
      if (form.card_number) params.card_number = form.card_number;
      api.get('/catalog/search', { params })
        .then((r) => setResults(r.data.data as CatalogMatch[]))
        .catch(() => setResults([]));
    }, 350);
    return () => { if (debounceRef2.current) clearTimeout(debounceRef2.current); };
  }, [form.card_name, form.set_name, form.card_number, form.language, hasSearchTerms]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const lbl = 'block text-xs text-zinc-400 mb-1';
  const inp = 'w-full px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500';

  if (!hasSearchTerms) return null;

  return (
    <div ref={containerRef}>
      <label className={lbl}>Part #</label>

      {catalogMatch ? (
        // Locked-in match
        <div className={`${inp} flex items-center gap-2 border-emerald-700/60`}>
          <span className="text-emerald-400 font-mono text-xs">{catalogMatch.sku ?? '—'}</span>
          <span className="text-zinc-600 text-[10px]">· {catalogMatch.set_name}</span>
          <button type="button" onClick={() => { onClear(); setOpen(true); }} className="ml-auto text-zinc-600 hover:text-zinc-400">
            <X size={12} />
          </button>
        </div>
      ) : (
        // Dropdown trigger
        <button type="button" onClick={() => setOpen((o) => !o)}
          className={`${inp} flex items-center justify-between text-left ${open ? 'border-indigo-500' : ''}`}>
          <span className="text-zinc-500 text-xs italic">
            {results.length > 0 ? `${results.length} match${results.length !== 1 ? 'es' : ''} — select one` : 'No match found'}
          </span>
          <ChevronDown size={13} className={`text-zinc-500 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
        </button>
      )}

      {/* Dropdown */}
      {open && !catalogMatch && (
        <div className="mt-1 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl overflow-hidden z-20 relative">
          {results.length > 0 ? (
            results.map((s) => (
              <button key={s.id} type="button"
                onClick={() => { onSelect(s); setOpen(false); }}
                className="w-full px-3 py-2 text-left flex items-center gap-3 hover:bg-zinc-800/60 transition-colors border-b border-zinc-800/50 last:border-0">
                <span className="font-mono text-xs text-indigo-300 shrink-0">{s.sku ?? '—'}</span>
                <span className="text-zinc-300 text-xs truncate">{s.card_name}</span>
                <span className="text-zinc-500 text-[10px] shrink-0 ml-auto">{s.set_name}{s.card_number ? ` · #${s.card_number}` : ''}</span>
              </button>
            ))
          ) : (
            <p className="px-3 py-2 text-xs text-zinc-500 italic">No catalog entries found</p>
          )}
          <button type="button"
            onClick={() => { setOpen(false); setShowAddModal(true); }}
            className="w-full px-3 py-2 text-left flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 hover:bg-zinc-800/40 transition-colors border-t border-zinc-700/60">
            <Plus size={11} /> Create new part #
          </button>
        </div>
      )}

      {showAddModal && (
        <AddPartModal
          prefill={{ card_name: form.card_name, set_name: form.set_name, card_number: form.card_number, language: form.language }}
          onClose={() => setShowAddModal(false)}
          onCreated={(part) => { onSelect(part); setShowAddModal(false); }}
        />
      )}
    </div>
  );
}

function PurchaseForm({
  initial,
  onSave,
  onClose,
  onDelete,
}: {
  initial?: Partial<PurchaseRow>;
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const [form, setForm] = useState({
    type:           (initial?.type ?? 'raw') as PurchaseType,
    source:         initial?.source ?? '',
    order_number:   initial?.order_number ?? '',
    language:       initial?.language ?? 'JP',
    card_name:      initial?.card_name ?? '',
    set_name:       initial?.set_name ?? '',
    card_number:    initial?.card_number ?? '',
    total_cost_yen: initial?.total_cost_yen ? String(initial.total_cost_yen) : '',
    fx_rate:        initial?.fx_rate ? String(initial.fx_rate) : '',
    total_cost_usd: initial?.total_cost_usd ? String(initial.total_cost_usd / 100) : '',
    card_count:     initial?.card_count ? String(initial.card_count) : '1',
    purchased_at:   initial?.purchased_at ? initial.purchased_at.slice(0, 10) : '',
    notes:          initial?.notes ?? '',
  });

  const [catalogMatch, setCatalogMatch] = useState<CatalogMatch | null>(null);
  const [catalogId, setCatalogId] = useState<string | null>(initial?.catalog_id ?? null);

  useEffect(() => {
    const yen  = parseFloat(form.total_cost_yen);
    const rate = parseFloat(form.fx_rate);
    if (!isNaN(yen) && !isNaN(rate) && rate > 0) {
      setForm((f) => ({ ...f, total_cost_usd: (yen / rate).toFixed(2) }));
    }
  }, [form.total_cost_yen, form.fx_rate]);

  function set(k: string, v: unknown) { setForm((f) => ({ ...f, [k]: v })); }

  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const e: Record<string, string> = {};
    if (!form.source)       e.source       = 'Required';
    if (!form.card_name)    e.card_name    = 'Required';
    if (!form.set_name)     e.set_name     = 'Required';
    if (!form.card_number)  e.card_number  = 'Required';
    if (!form.card_count || parseInt(form.card_count) < 1) e.card_count = 'Required';
    if (!form.purchased_at) e.purchased_at = 'Required';
    const hasYen = !!form.total_cost_yen && !!form.fx_rate;
    const hasUsd = !!form.total_cost_usd;
    if (!hasYen && !hasUsd) e.cost = '¥ + rate, or USD total is required';
    return e;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    const usd = parseFloat(form.total_cost_usd);
    onSave({
      type:           form.type,
      source:         form.source || undefined,
      order_number:   form.order_number || undefined,
      language:       form.language,
      card_name:      form.card_name || undefined,
      set_name:       form.set_name  || undefined,
      card_number:    form.card_number || undefined,
      catalog_id:     catalogId ?? undefined,
      total_cost_yen: form.total_cost_yen ? parseInt(form.total_cost_yen) : undefined,
      fx_rate:        form.fx_rate ? parseFloat(form.fx_rate) : undefined,
      total_cost_usd: !isNaN(usd) ? Math.round(usd * 100) : undefined,
      card_count:     parseInt(form.card_count) || 1,
      purchased_at:   form.purchased_at || undefined,
      notes:          form.notes || undefined,
    });
  }

  const inp   = 'w-full px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [color-scheme:dark]';
  const lbl   = 'block text-xs text-zinc-400 mb-1';
  const err   = (k: string) => errors[k] ? <span className="text-xs text-red-400 ml-1">{errors[k]}</span> : null;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Type</label>
          <select value={form.type} onChange={(e) => set('type', e.target.value)} className={inp}>
            <option value="raw">Raw</option>
            <option value="bulk">Bulk</option>
          </select>
        </div>
        <div>
          <label className={lbl}>Language</label>
          <select value={form.language} onChange={(e) => set('language', e.target.value)} className={inp}>
            <option value="JP">JP</option>
            <option value="EN">EN</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Source{err('source')}</label>
          <input value={form.source} onChange={(e) => { set('source', e.target.value); setErrors((p) => ({ ...p, source: '' })); }}
            placeholder="Buyee, Yahoo Auctions…"
            className={`${inp} ${errors.source ? 'border-red-500/60' : ''}`} />
        </div>
        <div>
          <label className={lbl}>Order #</label>
          <input value={form.order_number} onChange={(e) => set('order_number', e.target.value)} className={inp} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className={lbl}>Card Name{err('card_name')}</label>
          <input value={form.card_name} onChange={(e) => { set('card_name', e.target.value); setErrors((p) => ({ ...p, card_name: '' })); }}
            placeholder="Shining Mew"
            className={`${inp} ${errors.card_name ? 'border-red-500/60' : ''}`} />
        </div>
        <div>
          <label className={lbl}>Set Name{err('set_name')}</label>
          <input value={form.set_name} onChange={(e) => { set('set_name', e.target.value); setErrors((p) => ({ ...p, set_name: '' })); }}
            placeholder="Corocoro Comics"
            className={`${inp} ${errors.set_name ? 'border-red-500/60' : ''}`} />
        </div>
        <div>
          <label className={lbl}>Card #{err('card_number')}</label>
          <input value={form.card_number} onChange={(e) => { set('card_number', e.target.value); setErrors((p) => ({ ...p, card_number: '' })); }}
            placeholder="151"
            className={`${inp} ${errors.card_number ? 'border-red-500/60' : ''}`} />
        </div>
      </div>

      <PartNumberField
        form={form}
        catalogMatch={catalogMatch}
        catalogId={catalogId}
        onSelect={(m) => {
          setCatalogMatch(m);
          setCatalogId(m.id);
          setForm((prev) => ({
            ...prev,
            card_name:   m.card_name   || prev.card_name,
            set_name:    m.set_name    || prev.set_name,
            card_number: m.card_number || prev.card_number,
            language:    m.language    || prev.language,
          }));
          setErrors({});
        }}
        onClear={() => { setCatalogMatch(null); setCatalogId(null); }}
      />

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={lbl}># of Cards{err('card_count')}</label>
          <input type="number" min="1" value={form.card_count}
            onChange={(e) => { set('card_count', e.target.value); setErrors((p) => ({ ...p, card_count: '' })); }}
            className={`${inp} ${errors.card_count ? 'border-red-500/60' : ''}`} />
        </div>
        <div>
          <label className={lbl}>Date Purchased{err('purchased_at')}</label>
          <input type="date" value={form.purchased_at}
            onChange={(e) => { set('purchased_at', e.target.value); setErrors((p) => ({ ...p, purchased_at: '' })); }}
            className={`${inp} ${errors.purchased_at ? 'border-red-500/60' : ''}`} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className={lbl}>Total Cost (¥)</label>
          <input type="number" value={form.total_cost_yen}
            onChange={(e) => { set('total_cost_yen', e.target.value); setErrors((p) => ({ ...p, cost: '' })); }}
            placeholder="11800" className={`${inp} ${errors.cost ? 'border-red-500/60' : ''}`} />
        </div>
        <div>
          <label className={lbl}>¥ → USD Rate</label>
          <input type="number" step="0.0001" value={form.fx_rate}
            onChange={(e) => { set('fx_rate', e.target.value); setErrors((p) => ({ ...p, cost: '' })); }}
            placeholder="147" className={`${inp} ${errors.cost ? 'border-red-500/60' : ''}`} />
        </div>
        <div>
          <label className={lbl}>Total Cost (USD)</label>
          <input type="number" step="0.01" value={form.total_cost_usd}
            onChange={(e) => { set('total_cost_usd', e.target.value); setErrors((p) => ({ ...p, cost: '' })); }}
            placeholder="80.27" className={`${inp} ${errors.cost ? 'border-red-500/60' : ''}`} />
        </div>
      </div>
      {errors.cost && <p className="text-xs text-red-400">{errors.cost}</p>}

      <div>
        <label className={lbl}>Notes</label>
        <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className={inp} />
      </div>

      <div className="flex items-center justify-between pt-2">
        {onDelete && (
          <Button type="button" variant="ghost" size="sm" onClick={onDelete}
            className="text-red-500 hover:text-red-400">
            Delete
          </Button>
        )}
        <div className={`flex gap-2 ${onDelete ? '' : 'ml-auto'}`}>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm">Save</Button>
        </div>
      </div>
    </form>
  );
}

// ── Receive Modal ─────────────────────────────────────────────────────────────

function ReceiveModal({
  purchase,
  onSave,
  onClose,
}: {
  purchase: PurchaseRow;
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    order_number: purchase.order_number ?? '',
    received_at:  new Date().toISOString().slice(0, 10),
    card_count:   String(purchase.card_count),
  });

  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      order_number: form.order_number || undefined,
      received_at:  form.received_at,
      card_count:   parseInt(form.card_count) || purchase.card_count,
      status:       'received',
    });
  }

  const inp = 'w-full px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500';
  const lbl = 'block text-xs text-zinc-400 mb-1';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-xs text-zinc-400">
        Receiving <span className="text-zinc-200 font-medium">{purchase.purchase_id}</span>
        {purchase.card_name ? ` — ${purchase.card_name}` : ''}
      </p>

      <div>
        <label className={lbl}>Order # (confirm)</label>
        <input value={form.order_number} onChange={(e) => set('order_number', e.target.value)} className={inp} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Receive Date</label>
          <input type="date" value={form.received_at} onChange={(e) => set('received_at', e.target.value)} required className={inp} />
        </div>
        <div>
          <label className={lbl}>Quantity Received</label>
          <input type="number" min="1" value={form.card_count} onChange={(e) => set('card_count', e.target.value)} required className={inp} />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button type="submit" size="sm">Mark Received</Button>
      </div>
    </form>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const INTAKE_FILTER_DEFAULTS = {
  search:  '',
  fType:   null as PurchaseType | null,
};

export function Intake() {
  const qc    = useQueryClient();
  const saved = loadFilters('intake', INTAKE_FILTER_DEFAULTS);
  const [page, setPage]                 = useState(1);
  const [search, setSearch]             = useState(saved.search);
  const [debouncedSearch, setDebounced] = useState(saved.search);
  const [fType, setFType]               = useState<PurchaseType | null>(saved.fType);
  const [addOpen, setAddOpen]           = useState(false);
  const [editRow, setEditRow]           = useState<PurchaseRow | null>(null);
  const [receiveRow, setReceiveRow]     = useState<PurchaseRow | null>(null);
  const [cancelRow, setCancelRow]       = useState<PurchaseRow | null>(null);
  const [deleteRow, setDeleteRow]       = useState<PurchaseRow | null>(null);

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
    inspect:   colMinWidth('Inspected', true, false),
    actions: 80,
  };
  const { rz, totalWidth } = useColWidths({
    pid:       Math.max(MINS.pid,       110),
    type:      Math.max(MINS.type,       80),
    card:      Math.max(MINS.card,      280),
    source:    Math.max(MINS.source,    120),
    order:     Math.max(MINS.order,     140),
    lang:      Math.max(MINS.lang,       70),
    cards:     Math.max(MINS.cards,      70),
    cost:      Math.max(MINS.cost,      110),
    avg:       Math.max(MINS.avg,       100),
    status:    Math.max(MINS.status,    100),
    bought:    Math.max(MINS.bought,    120),
    inspect:   Math.max(MINS.inspect,    90),
    actions: MINS.actions,
  });

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    saveFilters('intake', { search, fType });
  }, [search, fType]);

  const params = {
    page,
    pageSize: 50,
    search:   debouncedSearch || undefined,
    status:   'ordered',
    type:     fType ?? undefined,
  };

  const { data, isLoading } = useQuery<{ data: PurchaseRow[]; total: number; totalPages: number }>({
    queryKey: ['raw-purchases', params],
    queryFn:  () => api.get('/raw-purchases', { params }).then((r) => r.data),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['raw-purchases'] });

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/raw-purchases', body).then((r) => r.data),
    onSuccess: () => { invalidate(); setAddOpen(false); toast.success('Purchase added'); },
    onError: () => toast.error('Failed to add purchase'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patch(`/raw-purchases/${id}`, body).then((r) => r.data),
    onSuccess: () => { invalidate(); setEditRow(null); setReceiveRow(null); toast.success('Updated'); },
    onError: () => toast.error('Failed to update'),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api.patch(`/raw-purchases/${id}`, { status: 'cancelled', received_at: null }),
    onSuccess: () => { invalidate(); setCancelRow(null); toast.success('Purchase cancelled'); },
    onError: () => toast.error('Failed to cancel'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/raw-purchases/${id}`),
    onSuccess: () => { invalidate(); setDeleteRow(null); toast.success('Purchase deleted'); },
    onError: () => toast.error('Failed to delete'),
  });

  const hasActiveFilters = !!debouncedSearch || fType !== null;
  function clearFilters() { setSearch(''); setFType(null); setPage(1); }

  const sh = { sortCol: null, sortDir: 'asc' as const, onSort: () => {} };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-100">Purchases</h1>
        <div className="flex items-center gap-3">
          {hasActiveFilters && (
            <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
              <X size={12} /> Clear filters
            </button>
          )}
          <div className="flex gap-1">
            <button onClick={() => { setFType(null); setPage(1); }}
              className={`px-3 py-1 text-xs rounded-md text-xs font-medium transition-colors ${fType === null ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
              All
            </button>
            {(['raw', 'bulk'] as PurchaseType[]).map((t) => (
              <button key={t} onClick={() => { setFType(t); setPage(1); }}
                className={`px-3 py-1 text-xs rounded-md text-xs font-medium transition-colors capitalize ${fType === t ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                {t}
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
                <ColHeader label="ID"         col="purchase_id"     {...sh} {...rz('pid')}     minWidth={MINS.pid} />
                <ColHeader label="Type"       col="type"            {...sh} {...rz('type')}    minWidth={MINS.type} />
                <ColHeader label="Card"       col="card_name"       {...sh} {...rz('card')}    minWidth={MINS.card} />
                <ColHeader label="Source"     col="source"          {...sh} {...rz('source')}  minWidth={MINS.source} />
                <ColHeader label="Order #"    col="order_number"    {...sh} {...rz('order')}   minWidth={MINS.order} />
                <ColHeader label="Lang"       col="language"        {...sh} {...rz('lang')}    minWidth={MINS.lang} />
                <ColHeader label="Cards"      col="card_count"      {...sh} {...rz('cards')}   minWidth={MINS.cards} align="right" />
                <ColHeader label="Cost (USD)" col="total_cost_usd"  {...sh} {...rz('cost')}    minWidth={MINS.cost} align="right" />
                <ColHeader label="Avg/Card"   col="avg_cost_usd"    {...sh} {...rz('avg')}     minWidth={MINS.avg} align="right" />
                <ColHeader label="Status"     col="status"          {...sh} {...rz('status')}  minWidth={MINS.status} />
                <ColHeader label="Purchased"  col="purchased_at"    {...sh} {...rz('bought')}  minWidth={MINS.bought} />
                <ColHeader label="Inspected"  col="inspected_count"  {...sh} {...rz('inspect')}   minWidth={MINS.inspect}   align="right" />
                <th style={{ width: MINS.actions }} />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {!data?.data.length ? (
                <tr><td colSpan={13} className="px-4 py-10 text-center text-zinc-500">No purchases yet.</td></tr>
              ) : data.data.map((row) => (
                <tr key={row.id}
                  className="hover:bg-zinc-800/25 transition-colors group cursor-pointer"
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
                  </td>
                  {/* Row actions */}
                  <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                    {row.status === 'ordered' && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setReceiveRow(row)}
                          title="Mark received"
                          className="p-1 rounded text-zinc-500 hover:text-emerald-400 hover:bg-zinc-800 transition-colors">
                          <PackageCheck size={14} />
                        </button>
                        <button
                          onClick={() => setCancelRow(row)}
                          title="Cancel"
                          className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors">
                          <Ban size={14} />
                        </button>
                      </div>
                    )}
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

      {/* Add */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Purchase">
        <PurchaseForm onSave={(body) => createMut.mutate(body)} onClose={() => setAddOpen(false)} />
      </Modal>

      {/* Edit */}
      <Modal open={!!editRow} onClose={() => setEditRow(null)} title="Edit Purchase">
        {editRow && (
          <PurchaseForm
            initial={editRow}
            onSave={(body) => updateMut.mutate({ id: editRow.id, body })}
            onClose={() => setEditRow(null)}
            onDelete={() => { setEditRow(null); setDeleteRow(editRow); }}
          />
        )}
      </Modal>

      {/* Receive */}
      <Modal open={!!receiveRow} onClose={() => setReceiveRow(null)} title="Receive Order">
        {receiveRow && (
          <ReceiveModal
            purchase={receiveRow}
            onSave={(body) => updateMut.mutate({ id: receiveRow.id, body })}
            onClose={() => setReceiveRow(null)}
          />
        )}
      </Modal>

      {/* Delete confirmation */}
      <Modal open={!!deleteRow} onClose={() => setDeleteRow(null)} title="Delete Purchase">
        {deleteRow && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-300">
              Delete <span className="font-medium text-zinc-100">{deleteRow.purchase_id}</span>
              {deleteRow.card_name ? ` — ${deleteRow.card_name}` : ''}?
            </p>
            <p className="text-xs text-zinc-500">This will permanently remove the purchase record and cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDeleteRow(null)}>Keep</Button>
              <Button size="sm" className="bg-red-600 hover:bg-red-500" onClick={() => deleteMut.mutate(deleteRow.id)}>
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Cancel confirmation */}
      <Modal open={!!cancelRow} onClose={() => setCancelRow(null)} title="Cancel Purchase">
        {cancelRow && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-300">
              Cancel <span className="font-medium text-zinc-100">{cancelRow.purchase_id}</span>
              {cancelRow.card_name ? ` — ${cancelRow.card_name}` : ''}?
            </p>
            <p className="text-xs text-zinc-500">This will void the receive date and quantity. The record will remain for reference.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setCancelRow(null)}>Keep</Button>
              <Button size="sm" className="bg-red-600 hover:bg-red-500" onClick={() => cancelMut.mutate(cancelRow.id)}>
                Cancel Purchase
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
