import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet, FileText, FileType2 } from 'lucide-react';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';
import { cn } from '../lib/utils';
import toast from 'react-hot-toast';

type Dataset = 'sales' | 'inventory' | 'expenses';
type Format = 'csv' | 'xlsx' | 'pdf';

interface SalesFilterOptions {
  platforms: string[];
}

interface ExpenseFilterOptions {
  types: string[];
  years: number[];
}

const FORMATS: { value: Format; label: string; icon: React.ElementType; sub: string }[] = [
  { value: 'csv',  label: 'CSV',   icon: FileText,        sub: 'Universal · opens in Excel / Sheets / QuickBooks' },
  { value: 'xlsx', label: 'Excel', icon: FileSpreadsheet, sub: 'Native .xlsx · preserves types' },
  { value: 'pdf',  label: 'PDF',   icon: FileType2,       sub: 'Printable report' },
];

const TABS: { value: Dataset; label: string }[] = [
  { value: 'sales',     label: 'Sales' },
  { value: 'inventory', label: 'Inventory' },
  { value: 'expenses',  label: 'Expenses' },
];

const STATUS_VALUES = ['purchased_raw', 'inspected', 'grading_submitted', 'graded', 'raw_for_sale', 'sold', 'lost_damaged'] as const;

export function Export() {
  const [tab, setTab] = useState<Dataset>('sales');
  const [format, setFormat] = useState<Format>('csv');
  const [loading, setLoading] = useState(false);

  // Sales filters
  const [salesFrom, setSalesFrom]         = useState('');
  const [salesTo, setSalesTo]             = useState('');
  const [salesPlatform, setSalesPlatform] = useState('');

  // Inventory filters
  const [invType, setInvType]     = useState<'all' | 'graded' | 'raw'>('all');
  const [invStatus, setInvStatus] = useState('');

  // Expenses filters
  const [expFrom, setExpFrom]       = useState('');
  const [expTo, setExpTo]           = useState('');
  const [expTypes, setExpTypes]     = useState<string[]>([]);

  // Filter option fetches (only when relevant tab is active)
  const { data: salesOpts } = useQuery<SalesFilterOptions>({
    queryKey: ['sales-filter-options'],
    queryFn:  () => api.get('/sales/filters').then((r) => r.data),
    enabled:  tab === 'sales',
  });
  const { data: expOpts } = useQuery<ExpenseFilterOptions>({
    queryKey: ['expense-filter-options'],
    queryFn:  () => api.get('/expenses/filters').then((r) => r.data),
    enabled:  tab === 'expenses',
  });

  function applyYear(y: number, target: 'sales' | 'expenses') {
    const from = `${y}-01-01`;
    const to   = `${y}-12-31`;
    if (target === 'sales') { setSalesFrom(from); setSalesTo(to); }
    else                    { setExpFrom(from);   setExpTo(to); }
  }

  async function handleExport() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ format });
      if (tab === 'sales') {
        if (salesFrom)      params.set('from', salesFrom);
        if (salesTo)        params.set('to', salesTo);
        if (salesPlatform)  params.set('platform', salesPlatform);
      } else if (tab === 'inventory') {
        if (invType !== 'all') params.set('type', invType);
        if (invStatus)         params.set('status', invStatus);
      } else {
        if (expFrom)            params.set('from', expFrom);
        if (expTo)              params.set('to', expTo);
        if (expTypes.length)    params.set('types', expTypes.join(','));
      }

      const res = await api.get(`/exports/${tab}?${params}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      const today = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `${tab}_${today}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('Export ready');
    } catch (err) {
      console.error(err);
      toast.error('Export failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 lg:gap-0 px-6 py-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-100">Export</h1>
        <div className="flex items-center flex-wrap gap-3 w-full lg:w-auto justify-end">
          <div className="flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.value}
                onClick={() => setTab(t.value)}
                className={cn(
                  'px-3 py-1 text-xs rounded-md font-medium transition-colors',
                  tab === t.value
                    ? 'bg-indigo-600 text-white'
                    : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-6">
        <div className="max-w-2xl space-y-8">
          {/* Format picker */}
          <div>
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-3">Format</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {FORMATS.map((f) => {
                const Icon = f.icon;
                const active = format === f.value;
                return (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setFormat(f.value)}
                    className={cn(
                      'flex flex-col items-start gap-1 px-3 py-3 rounded-lg border text-left transition-colors',
                      active
                        ? 'bg-indigo-600/20 border-indigo-500 text-zinc-100'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-600',
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <Icon size={15} /> {f.label}
                    </span>
                    <span className="text-[11px] text-zinc-500">{f.sub}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Per-tab filters */}
          {tab === 'sales' && (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">Date range</p>
                <div className="grid grid-cols-2 gap-3">
                  <DateInput label="From" value={salesFrom} onChange={setSalesFrom} />
                  <DateInput label="To"   value={salesTo}   onChange={setSalesTo} />
                </div>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {[new Date().getFullYear(), new Date().getFullYear() - 1, new Date().getFullYear() - 2].map((y) => (
                    <YearPill key={y} year={y} active={salesFrom === `${y}-01-01` && salesTo === `${y}-12-31`} onClick={() => applyYear(y, 'sales')} />
                  ))}
                  <YearPill year="All" active={!salesFrom && !salesTo} onClick={() => { setSalesFrom(''); setSalesTo(''); }} />
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">Platform</p>
                <select
                  value={salesPlatform}
                  onChange={(e) => setSalesPlatform(e.target.value)}
                  className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">All platforms</option>
                  {(salesOpts?.platforms ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
          )}

          {tab === 'inventory' && (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">Card type</p>
                <div className="flex gap-1">
                  {(['all', 'graded', 'raw'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setInvType(t)}
                      className={cn(
                        'px-3 py-1 text-xs rounded-md font-medium transition-colors capitalize',
                        invType === t ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200',
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">Status</p>
                <select
                  value={invStatus}
                  onChange={(e) => setInvStatus(e.target.value)}
                  className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">All statuses</option>
                  {STATUS_VALUES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          )}

          {tab === 'expenses' && (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">Date range</p>
                <div className="grid grid-cols-2 gap-3">
                  <DateInput label="From" value={expFrom} onChange={setExpFrom} />
                  <DateInput label="To"   value={expTo}   onChange={setExpTo} />
                </div>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {(expOpts?.years ?? []).map((y) => (
                    <YearPill key={y} year={y} active={expFrom === `${y}-01-01` && expTo === `${y}-12-31`} onClick={() => applyYear(y, 'expenses')} />
                  ))}
                  <YearPill year="All" active={!expFrom && !expTo} onClick={() => { setExpFrom(''); setExpTo(''); }} />
                </div>
              </div>
              {(expOpts?.types?.length ?? 0) > 0 && (
                <div>
                  <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">Types</p>
                  <div className="flex flex-wrap gap-2">
                    {expOpts!.types.map((t) => {
                      const on = expTypes.includes(t);
                      return (
                        <button
                          key={t}
                          onClick={() => setExpTypes((prev) => on ? prev.filter((x) => x !== t) : [...prev, t])}
                          className={cn(
                            'px-3 py-1 text-xs rounded-md font-medium transition-colors',
                            on ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200',
                          )}
                        >
                          {t}
                        </button>
                      );
                    })}
                  </div>
                  {expTypes.length > 0 && (
                    <button onClick={() => setExpTypes([])} className="mt-2 text-[11px] text-zinc-500 hover:text-zinc-300">
                      Clear types
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Export trigger */}
          <div className="pt-2 border-t border-zinc-800">
            <Button onClick={handleExport} disabled={loading} className="w-full sm:w-auto">
              <Download size={14} /> {loading ? 'Generating…' : `Export ${tab}`}
            </Button>
            <p className="text-[11px] text-zinc-500 mt-2">
              Includes every field shown on the {tab} list view. Filtered by the selections above.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-zinc-500">{label}</label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 [color-scheme:dark]"
      />
    </div>
  );
}

function YearPill({ year, active, onClick }: { year: number | string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-3 py-1 text-xs rounded-md font-medium transition-colors',
        active ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200',
      )}
    >
      {year}
    </button>
  );
}
