import { useState, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Loader2, Pencil, Trash2, ExternalLink, Download, ImagePlus, Sparkles } from 'lucide-react';
import { api, type PaginatedResult } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { formatCurrency, formatDate } from '../lib/utils';
import { loadFilters, saveFilters } from '../lib/filter-store';
import { ColHeader, useColWidths, colMinWidth } from '../components/ui/TableHeader';
import toast from 'react-hot-toast';

interface Expense {
  id: string;
  expense_id: string | null;
  date: string;
  description: string;
  type: string;
  amount: number;
  currency: string;
  link: string | null;
  order_number: string | null;
  receipt_url: string | null;
  created_at: string;
}

interface FilterOptions {
  types: string[];
  years: number[];
}

type SortDir = 'asc' | 'desc';

const EXPENSE_TYPES = [
  'Shipping',
  'Grading',
  'Supplies',
  'Card Show',
  'Food',
  'Travel',
  'Other',
];

// ── Add / Edit Modal ──────────────────────────────────────────────────────────

function ExpenseModal({
  expense,
  onClose,
}: {
  expense?: Expense;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isEdit = !!expense;

  const [date, setDate] = useState(expense?.date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState(expense?.description ?? '');
  const [type, setType] = useState(expense?.type ?? EXPENSE_TYPES[0]);
  const [amount, setAmount] = useState(expense ? (expense.amount / 100).toFixed(2) : '');
  const [currency, setCurrency] = useState(expense?.currency ?? 'USD');
  const [link, setLink] = useState(expense?.link ?? '');
  const [orderNumber, setOrderNumber] = useState(expense?.order_number ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(expense?.receipt_url ?? null);

  async function handleImageUpload(file: File) {
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    if (isEdit) return; // on edit, just queue the file — no auto-parse
    setParsing(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const res = await api.post('/expenses/parse-receipt', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const d = res.data.data;
      if (d.date)         setDate(d.date);
      if (d.description)  setDescription(d.description);
      if (d.type)         setType(EXPENSE_TYPES.includes(d.type) ? d.type : EXPENSE_TYPES[EXPENSE_TYPES.length - 1]);
      if (d.amount)       setAmount(String(d.amount));
      if (d.currency)     setCurrency(d.currency);
      if (d.order_number) setOrderNumber(d.order_number);
      toast.success('Receipt parsed — review and confirm');
    } catch {
      toast.error('Could not parse receipt');
    } finally {
      setParsing(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) { toast.error('Description is required'); return; }
    if (!amount) { toast.error('Amount is required'); return; }
    setSubmitting(true);
    try {
      const body = {
        date,
        description: description.trim(),
        type,
        amount,
        currency,
        link: link.trim() || undefined,
        order_number: orderNumber.trim() || undefined,
      };
      let savedId: string;
      if (isEdit) {
        await api.put(`/expenses/${expense.id}`, body);
        savedId = expense.id;
        toast.success('Expense updated');
      } else {
        const res = await api.post('/expenses', body);
        savedId = res.data.data.id;
        toast.success('Expense added');
      }
      // Upload receipt image if one was selected
      if (imageFile) {
        const fd = new FormData();
        fd.append('image', imageFile);
        await api.post(`/expenses/${savedId}/receipt`, fd).catch(() => {});
      }
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expense-filters'] });
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to save expense');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Receipt image upload */}
      <label className={`flex items-center gap-3 w-full rounded-xl border-2 border-dashed px-4 py-3 cursor-pointer transition-colors ${
        parsing ? 'border-indigo-500/50 bg-indigo-500/5' : 'border-zinc-700 hover:border-zinc-500 hover:bg-zinc-800/40'
      }`}>
        <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); }} />
        {parsing ? (
          <>
            <Loader2 size={16} className="animate-spin text-indigo-400 shrink-0" />
            <span className="text-xs text-indigo-300">Parsing receipt…</span>
          </>
        ) : imagePreview ? (
          <div className="flex items-center gap-3 w-full">
            <img src={imagePreview} alt="receipt" className="h-10 w-10 object-cover rounded-lg border border-zinc-700 shrink-0" />
            <span className="text-xs text-green-300">{isEdit ? 'Receipt attached' : 'Receipt parsed — fields pre-filled below'}</span>
            <span className="ml-auto text-xs text-zinc-500 hover:text-zinc-300">Change</span>
          </div>
        ) : (
          <>
            <ImagePlus size={16} className="text-zinc-500 shrink-0" />
            <span className="text-xs text-zinc-400">
              {isEdit ? 'Upload receipt image' : 'Upload receipt to auto-fill'} <span className="text-zinc-500">(optional)</span>
            </span>
          </>
        )}
      </label>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors [color-scheme:dark]" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}
            className="rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors">
            {EXPENSE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      <Input
        label="Description"
        placeholder="What was this expense for?"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        autoFocus={!isEdit}
      />

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Amount"
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          <option value="USD">USD</option>
          <option value="JPY">JPY</option>
        </Select>
      </div>

      <Input
        label="Link"
        type="url"
        placeholder="https://…"
        value={link}
        onChange={(e) => setLink(e.target.value)}
      />

      <Input
        label="Order #"
        placeholder="Order or reference number"
        value={orderNumber}
        onChange={(e) => setOrderNumber(e.target.value)}
      />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {isEdit ? 'Save Changes' : 'Add Expense'}
        </Button>
      </div>
    </form>
  );
}

// ── Action Modal (Edit / Delete) ──────────────────────────────────────────────

function ExpenseActionModal({ expense, onClose }: { expense: Expense; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'prompt' | 'edit' | 'delete'>('prompt');
  const [submitting, setSubmitting] = useState(false);

  async function handleDelete() {
    setSubmitting(true);
    try {
      await api.delete(`/expenses/${expense.id}`);
      toast.success('Expense deleted');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expense-filters'] });
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to delete expense');
    } finally { setSubmitting(false); }
  }

  if (mode === 'edit') return <ExpenseModal expense={expense} onClose={onClose} />;

  if (mode === 'delete') return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-300">Delete this expense?</p>
      <p className="text-xs text-zinc-500 font-medium">{expense.description} — {formatCurrency(expense.amount, expense.currency)}</p>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={() => setMode('prompt')}>Back</Button>
        <Button type="button" variant="danger" disabled={submitting} onClick={handleDelete}>
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          Delete
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500 truncate">{expense.description}</p>
      <button onClick={() => setMode('edit')}
        className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-200 transition-colors text-left">
        <Pencil size={15} className="text-zinc-400 shrink-0" />
        <div>
          <p className="font-medium">Edit Expense</p>
          <p className="text-xs text-zinc-500">Update any field</p>
        </div>
      </button>
      <button onClick={() => setMode('delete')}
        className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-zinc-800 hover:bg-red-900/40 text-sm text-zinc-200 hover:text-red-300 transition-colors text-left">
        <Trash2 size={15} className="text-zinc-400 shrink-0" />
        <div>
          <p className="font-medium">Delete Expense</p>
          <p className="text-xs text-zinc-500">Permanently remove this record</p>
        </div>
      </button>
    </div>
  );
}

// ── Export Modal ──────────────────────────────────────────────────────────────


function ExportModal({ allTypes, availableYears, onClose }: { allTypes: string[]; availableYears: number[]; onClose: () => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [format, setFormat] = useState<'csv' | 'pdf'>('csv');
  const [loading, setLoading] = useState(false);

  function applyYear(year: number) {
    setFrom(`${year}-01-01`);
    setTo(`${year}-12-31`);
  }

  function toggleType(t: string) {
    setSelectedTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);
  }

  async function handleExport() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ format });
      if (from) params.set('from', from);
      if (to)   params.set('to', to);
      if (selectedTypes.length) params.set('types', selectedTypes.join(','));

      const res = await api.get(`/expenses/export?${params}`, { responseType: 'blob' });
      const ext = format === 'pdf' ? 'pdf' : 'csv';
      const fileName = `expenses${from ? `_${from.slice(0,4)}` : ''}.${ext}`;
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url; a.download = fileName; a.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch {
      toast.error('Export failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Date range */}
      <div>
        <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">Date Range</p>
        <div className="flex gap-2 mb-2">
          {availableYears.map((y) => (
            <button key={y} type="button" onClick={() => applyYear(y)}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                from === `${y}-01-01` && to === `${y}-12-31`
                  ? 'bg-indigo-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}>{y}</button>
          ))}
          <button type="button" onClick={() => { setFrom(''); setTo(''); }}
            className="px-3 py-1 text-xs rounded-md font-medium bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors">
            All
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">From</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 [color-scheme:dark]" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-zinc-500">To</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 [color-scheme:dark]" />
          </div>
        </div>
      </div>

      {/* Types */}
      {allTypes.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Types</p>
            <button type="button" onClick={() => setSelectedTypes([])}
              className="text-xs text-zinc-500 hover:text-zinc-300">Clear</button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setSelectedTypes([...allTypes])}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                selectedTypes.length === allTypes.length ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}>All</button>
            {allTypes.map((t) => {
              const active = selectedTypes.includes(t);
              return (
                <button key={t} type="button" onClick={() => toggleType(t)}
                  className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                    active ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}>{t}</button>
              );
            })}
          </div>
          {selectedTypes.length > 0 && (
            <p className="text-[11px] text-zinc-500 mt-1.5">{selectedTypes.length} of {allTypes.length} selected</p>
          )}
        </div>
      )}

      {/* Format */}
      <div>
        <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">Format</p>
        <div className="flex gap-2">
          {(['csv', 'pdf'] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFormat(f)}
              className={`px-4 py-2 text-xs rounded-lg font-medium transition-colors ${
                format === f ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}>
              {f.toUpperCase()}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-zinc-500 mt-1.5">
          {format === 'csv' ? 'Spreadsheet-compatible, great for accounting software.' : 'Formatted report, good for printing or sharing.'}
        </p>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" onClick={handleExport} disabled={loading}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          Export {format.toUpperCase()}
        </Button>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

const FILTER_DEFAULTS = {
  sortCol: 'date' as string | null,
  sortDir: 'desc' as SortDir,
  fType: null as string[] | null,
  search: '',
};

export function Expenses() {
  const saved = loadFilters('expenses', FILTER_DEFAULTS);
  const [page, setPage] = useState(1);
  const [sortCol, setSortCol] = useState<string | null>(saved.sortCol);
  const [sortDir, setSortDir] = useState<SortDir>(saved.sortDir);
  const [fType, setFType] = useState<string[] | null>(saved.fType);
  const [search, setSearch] = useState(saved.search);
  const [debouncedSearch, setDebouncedSearch] = useState(saved.search);
  const [showAdd, setShowAdd] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [selected, setSelected] = useState<Expense | null>(null);

  const MINS = {
    expense_id:   colMinWidth('ID',          true, false),
    date:         colMinWidth('Date',        true, false),
    type:         colMinWidth('Type',        true, true),
    description:  colMinWidth('Description', true, false),
    amount:       colMinWidth('Amount',      true, false),
    order_number: colMinWidth('Order #',     true, false),
    receipt:      50,
    link:         50,
  };

  const { rz, totalWidth } = useColWidths({
    expense_id:   Math.max(MINS.expense_id, 100),
    date:         Math.max(MINS.date, 115),
    type:         Math.max(MINS.type, 130),
    description:  Math.max(MINS.description, 420),
    amount:       Math.max(MINS.amount, 120),
    order_number: Math.max(MINS.order_number, 150),
    receipt:      MINS.receipt,
    link:         MINS.link,
  });

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    saveFilters('expenses', { sortCol, sortDir, fType, search });
  }, [sortCol, sortDir, fType, search]);

  const handleSort = useCallback((col: string) => {
    setSortCol((prev) => { if (prev === col) return prev; return col; });
    setSortDir((prev) => sortCol === col ? (prev === 'asc' ? 'desc' : 'asc') : 'desc');
    setPage(1);
  }, [sortCol]);

  const { data: filterOptions } = useQuery<FilterOptions>({
    queryKey: ['expense-filters'],
    queryFn: () => api.get('/expenses/filters').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  function activeFilter(sel: string[] | null, opts?: string[]): string[] | undefined {
    if (sel === null) return undefined;
    if (sel.length >= (opts?.length ?? Infinity)) return undefined;
    return sel;
  }

  const params = {
    page,
    limit: 50,
    sort_by: sortCol ?? undefined,
    sort_dir: sortDir,
    types: activeFilter(fType, filterOptions?.types)?.join(','),
    search: debouncedSearch || undefined,
  };

  const { data, isLoading } = useQuery<PaginatedResult<Expense>>({
    queryKey: ['expenses', params],
    queryFn: () => api.get('/expenses', { params }).then((r) => r.data),
  });

  const hasActiveFilters = fType !== null || !!debouncedSearch;

  const totalAmount = data?.data.reduce((s, e) => s + e.amount, 0) ?? 0;
  const sh = { sortCol, sortDir, onSort: handleSort };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-100">Expenses</h1>
        <div className="flex items-center gap-3">
          {hasActiveFilters && (
            <button onClick={() => { setFType(null); setSearch(''); }}
              className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
              <X size={12} /> Clear filters
            </button>
          )}
          <input
            type="text"
            placeholder="Search description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 w-52"
          />
          <Button size="sm" variant="ghost" onClick={() => setShowExport(true)}>
            <Download size={14} /> Export
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus size={14} /> Add Expense
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">Loading…</div>
        ) : (
          <table className="text-xs whitespace-nowrap border-collapse" style={{ tableLayout: 'fixed', width: totalWidth + 'px' }}>
            <thead className="sticky top-0 bg-zinc-950 z-10">
              <tr className="border-b border-zinc-700 text-zinc-300 uppercase tracking-wide">
                <ColHeader label="ID"          col="expense_id"  {...sh} {...rz('expense_id')}   minWidth={MINS.expense_id} align="center" />
                <ColHeader label="Date"        col="date"        {...sh} {...rz('date')}         minWidth={MINS.date} />
                <ColHeader label="Type"        col="type"        {...sh} {...rz('type')}         minWidth={MINS.type}
                  filterOptions={filterOptions?.types} filterSelected={fType} onFilterChange={(v) => { setFType(v); setPage(1); }} />
                <ColHeader label="Description" col="description" {...sh} {...rz('description')}  minWidth={MINS.description} />
                <ColHeader label="Amount"      col="amount"      {...sh} {...rz('amount')}       minWidth={MINS.amount} align="center" />
                <ColHeader label="Order #"     col="order_number" {...sh} {...rz('order_number')} minWidth={MINS.order_number} />
                <th style={{ width: MINS.receipt + 'px', minWidth: MINS.receipt + 'px' }}
                  className="px-2 py-2 text-center font-semibold text-zinc-300 uppercase tracking-wide">Rcpt</th>
                <th style={{ width: MINS.link + 'px', minWidth: MINS.link + 'px' }}
                  className="px-2 py-2 text-center font-semibold text-zinc-300 uppercase tracking-wide">Link</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {!data?.data.length ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-zinc-500">No expenses found.</td></tr>
              ) : data.data.map((expense) => (
                <tr key={expense.id} className="hover:bg-zinc-800/30 transition-colors cursor-pointer"
                  onClick={() => setSelected(expense)}>
                  <td className="px-3 py-2 font-mono text-indigo-400 text-[11px] text-center">{expense.expense_id ?? '—'}</td>
                  <td className="px-3 py-2 text-zinc-500">{formatDate(expense.date)}</td>
                  <td className="px-3 py-2">
                    <span className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">{expense.type}</span>
                  </td>
                  <td className="px-3 py-2 text-zinc-200 truncate" title={expense.description}>{expense.description}</td>
                  <td className="px-3 py-2 text-center font-medium text-zinc-200">{formatCurrency(expense.amount, expense.currency)}</td>
                  <td className="px-3 py-2 text-zinc-500 font-mono text-[11px]">{expense.order_number ?? '—'}</td>
                  <td className="px-2 py-2 text-center">
                    {expense.receipt_url && (
                      <a href={expense.receipt_url} target="_blank" rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title="View receipt">
                        <img src={expense.receipt_url} alt="receipt" className="h-7 w-7 object-cover rounded border border-zinc-700 hover:border-indigo-500 transition-colors mx-auto" />
                      </a>
                    )}
                  </td>
                  <td className="px-2 py-2 text-center">
                    {expense.link && (
                      <a href={expense.link} target="_blank" rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center justify-center text-indigo-400 hover:text-indigo-300 transition-colors">
                        <ExternalLink size={13} />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data && (
        <div className="flex items-center justify-between px-6 py-3 pr-44 border-t border-zinc-800 text-xs text-zinc-500">
          <span>{data.total} expense{data.total !== 1 ? 's' : ''}{data.total > 0 ? ` · Total: ${formatCurrency(totalAmount, 'USD')}` : ''}</span>
          {data.total_pages > 1 && (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
              <span className="px-2 py-1">{page} / {data.total_pages}</span>
              <Button variant="ghost" size="sm" disabled={page >= data.total_pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </div>
      )}

      <Modal open={showExport} onClose={() => setShowExport(false)} title="Export Expenses">
        <ExportModal allTypes={filterOptions?.types ?? []} availableYears={filterOptions?.years ?? []} onClose={() => setShowExport(false)} />
      </Modal>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Expense">
        <ExpenseModal onClose={() => setShowAdd(false)} />
      </Modal>

      <Modal open={!!selected} onClose={() => setSelected(null)} title="Expense">
        {selected && <ExpenseActionModal expense={selected} onClose={() => setSelected(null)} />}
      </Modal>
    </div>
  );
}
