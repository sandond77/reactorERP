import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Download, FileSpreadsheet, FileText, FileType2,
  ShoppingCart, Boxes, Receipt, ChevronLeft, Check,
} from 'lucide-react';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';
import { cn } from '../lib/utils';
import toast from 'react-hot-toast';

type Dataset = 'sales' | 'inventory' | 'expenses';
type Format = 'csv' | 'xlsx' | 'pdf';
type Step = 1 | 2 | 3;

interface SalesFilterOptions {
  platforms: string[];
}

interface ExpenseFilterOptions {
  types: string[];
  years: number[];
}

const DATASETS: { value: Dataset; label: string; icon: React.ElementType; tagline: string; description: string }[] = [
  {
    value:       'sales',
    label:       'Sales',
    icon:        ShoppingCart,
    tagline:     'Every recorded sale with profit and cost basis',
    description: 'Use for tax filing, accounting reconciliation, or year-over-year sales analysis.',
  },
  {
    value:       'inventory',
    label:       'Inventory',
    icon:        Boxes,
    tagline:     'Current stock — graded slabs and raw cards',
    description: 'Use for valuation snapshots, insurance lists, or external listing platforms.',
  },
  {
    value:       'expenses',
    label:       'Expenses',
    icon:        Receipt,
    tagline:     'Grading fees, shipping, supplies, show costs',
    description: 'Use for business deductions, monthly expense tracking, or audit support.',
  },
];

const FORMATS: { value: Format; label: string; icon: React.ElementType; sub: string }[] = [
  { value: 'csv',  label: 'CSV',   icon: FileText,        sub: 'Universal · opens in Excel, Sheets, QuickBooks, etc.' },
  { value: 'xlsx', label: 'Excel', icon: FileSpreadsheet, sub: 'Native .xlsx · preserves number and date types' },
  { value: 'pdf',  label: 'PDF',   icon: FileType2,       sub: 'Printable · best for sharing or filing' },
];

const STATUS_VALUES = ['purchased_raw', 'inspected', 'grading_submitted', 'graded', 'raw_for_sale', 'sold', 'lost_damaged'] as const;

export function Export() {
  const [step, setStep] = useState<Step>(1);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [format, setFormat]   = useState<Format | null>(null);
  const [loading, setLoading] = useState(false);

  // Sales filters
  const [salesFrom, setSalesFrom]         = useState('');
  const [salesTo, setSalesTo]             = useState('');
  const [salesPlatform, setSalesPlatform] = useState('');

  // Inventory filters
  const [invType, setInvType]     = useState<'all' | 'graded' | 'raw'>('all');
  const [invStatus, setInvStatus] = useState('');

  // Expenses filters
  const [expFrom, setExpFrom]   = useState('');
  const [expTo, setExpTo]       = useState('');
  const [expTypes, setExpTypes] = useState<string[]>([]);

  const { data: salesOpts } = useQuery<SalesFilterOptions>({
    queryKey: ['sales-filter-options'],
    queryFn:  () => api.get('/sales/filters').then((r) => r.data),
    enabled:  step === 3 && dataset === 'sales',
  });
  const { data: expOpts } = useQuery<ExpenseFilterOptions>({
    queryKey: ['expense-filter-options'],
    queryFn:  () => api.get('/expenses/filters').then((r) => r.data),
    enabled:  step === 3 && dataset === 'expenses',
  });

  function pickDataset(d: Dataset) {
    setDataset(d);
    setStep(2);
  }
  function pickFormat(f: Format) {
    setFormat(f);
    setStep(3);
  }
  function startOver() {
    setStep(1);
    setDataset(null);
    setFormat(null);
  }
  function back() {
    if (step === 3) setStep(2);
    else if (step === 2) setStep(1);
  }

  function applyYear(y: number, target: 'sales' | 'expenses') {
    const from = `${y}-01-01`;
    const to   = `${y}-12-31`;
    if (target === 'sales') { setSalesFrom(from); setSalesTo(to); }
    else                    { setExpFrom(from);   setExpTo(to); }
  }

  async function handleExport() {
    if (!dataset || !format) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ format });
      if (dataset === 'sales') {
        if (salesFrom)     params.set('from', salesFrom);
        if (salesTo)       params.set('to', salesTo);
        if (salesPlatform) params.set('platform', salesPlatform);
      } else if (dataset === 'inventory') {
        if (invType !== 'all') params.set('type', invType);
        if (invStatus)         params.set('status', invStatus);
      } else {
        if (expFrom)         params.set('from', expFrom);
        if (expTo)           params.set('to', expTo);
        if (expTypes.length) params.set('types', expTypes.join(','));
      }
      const res = await api.get(`/exports/${dataset}?${params}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      const today = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `${dataset}_${today}.${format}`;
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
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Export</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Step {step} of 3</p>
        </div>
        {step > 1 && (
          <div className="flex items-center gap-2">
            <button onClick={back} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">
              <ChevronLeft size={14} /> Back
            </button>
            <button onClick={startOver} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Start over</button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto px-6 py-8">
        <div className="max-w-2xl mx-auto">
          {step === 1 && <StepDataset onPick={pickDataset} />}
          {step === 2 && dataset && <StepFormat dataset={dataset} onPick={pickFormat} />}
          {step === 3 && dataset && format && (
            <StepFilters
              dataset={dataset}
              format={format}
              loading={loading}
              onExport={handleExport}
              // Sales props
              salesFrom={salesFrom} setSalesFrom={setSalesFrom}
              salesTo={salesTo}     setSalesTo={setSalesTo}
              salesPlatform={salesPlatform} setSalesPlatform={setSalesPlatform}
              salesPlatformOptions={salesOpts?.platforms ?? []}
              // Inventory props
              invType={invType}     setInvType={setInvType}
              invStatus={invStatus} setInvStatus={setInvStatus}
              // Expenses props
              expFrom={expFrom}   setExpFrom={setExpFrom}
              expTo={expTo}       setExpTo={setExpTo}
              expTypes={expTypes} setExpTypes={setExpTypes}
              expTypeOptions={expOpts?.types ?? []}
              expYearOptions={expOpts?.years ?? []}
              applyYear={applyYear}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step 1: dataset ─────────────────────────────────────────────────────────

function StepDataset({ onPick }: { onPick: (d: Dataset) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-zinc-100">What do you want to export?</h2>
        <p className="text-sm text-zinc-500 mt-1">Pick a dataset. You'll choose the format and filters next.</p>
      </div>
      <div className="space-y-2">
        {DATASETS.map((d) => {
          const Icon = d.icon;
          return (
            <button
              key={d.value}
              onClick={() => onPick(d.value)}
              className="w-full flex items-start gap-4 px-4 py-4 rounded-xl border border-zinc-800 bg-zinc-900 hover:border-indigo-500 hover:bg-indigo-600/5 transition-colors text-left group"
            >
              <span className="w-10 h-10 rounded-lg bg-zinc-800 group-hover:bg-indigo-600/20 flex items-center justify-center shrink-0 transition-colors">
                <Icon size={18} className="text-zinc-300 group-hover:text-indigo-400 transition-colors" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-zinc-100">{d.label}</span>
                <span className="block text-xs text-zinc-400 mt-0.5">{d.tagline}</span>
                <span className="block text-[11px] text-zinc-600 mt-1">{d.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Step 2: format ──────────────────────────────────────────────────────────

function StepFormat({ dataset, onPick }: { dataset: Dataset; onPick: (f: Format) => void }) {
  const d = DATASETS.find((x) => x.value === dataset)!;
  return (
    <div className="space-y-4">
      <Crumb label="Dataset" value={d.label} />
      <div>
        <h2 className="text-lg font-semibold text-zinc-100">What format?</h2>
        <p className="text-sm text-zinc-500 mt-1">Choose how you want the file delivered.</p>
      </div>
      <div className="space-y-2">
        {FORMATS.map((f) => {
          const Icon = f.icon;
          return (
            <button
              key={f.value}
              onClick={() => onPick(f.value)}
              className="w-full flex items-start gap-4 px-4 py-4 rounded-xl border border-zinc-800 bg-zinc-900 hover:border-indigo-500 hover:bg-indigo-600/5 transition-colors text-left group"
            >
              <span className="w-10 h-10 rounded-lg bg-zinc-800 group-hover:bg-indigo-600/20 flex items-center justify-center shrink-0 transition-colors">
                <Icon size={18} className="text-zinc-300 group-hover:text-indigo-400 transition-colors" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-zinc-100">{f.label}</span>
                <span className="block text-xs text-zinc-500 mt-0.5">{f.sub}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Step 3: filters ─────────────────────────────────────────────────────────

interface FiltersStepProps {
  dataset: Dataset;
  format: Format;
  loading: boolean;
  onExport: () => void;
  salesFrom: string;
  setSalesFrom: (v: string) => void;
  salesTo: string;
  setSalesTo: (v: string) => void;
  salesPlatform: string;
  setSalesPlatform: (v: string) => void;
  salesPlatformOptions: string[];
  invType: 'all' | 'graded' | 'raw';
  setInvType: (v: 'all' | 'graded' | 'raw') => void;
  invStatus: string;
  setInvStatus: (v: string) => void;
  expFrom: string;
  setExpFrom: (v: string) => void;
  expTo: string;
  setExpTo: (v: string) => void;
  expTypes: string[];
  setExpTypes: (v: string[]) => void;
  expTypeOptions: string[];
  expYearOptions: number[];
  applyYear: (y: number, target: 'sales' | 'expenses') => void;
}

function StepFilters(p: FiltersStepProps) {
  const d = DATASETS.find((x) => x.value === p.dataset)!;
  const f = FORMATS.find((x) => x.value === p.format)!;
  const recentYears = [new Date().getFullYear(), new Date().getFullYear() - 1, new Date().getFullYear() - 2];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <Crumb label="Dataset" value={d.label} />
        <Crumb label="Format"  value={f.label} />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-zinc-100">Filter the export</h2>
        <p className="text-sm text-zinc-500 mt-1">Narrow the data down or leave blank to export everything.</p>
      </div>

      {p.dataset === 'sales' && (
        <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <FilterBlock label="Date range">
            <div className="grid grid-cols-2 gap-3">
              <DateInput label="From" value={p.salesFrom} onChange={p.setSalesFrom} />
              <DateInput label="To"   value={p.salesTo}   onChange={p.setSalesTo} />
            </div>
            <div className="flex gap-2 mt-2 flex-wrap">
              {recentYears.map((y) => (
                <YearPill key={y} year={y} active={p.salesFrom === `${y}-01-01` && p.salesTo === `${y}-12-31`} onClick={() => p.applyYear(y, 'sales')} />
              ))}
              <YearPill year="All" active={!p.salesFrom && !p.salesTo} onClick={() => { p.setSalesFrom(''); p.setSalesTo(''); }} />
            </div>
          </FilterBlock>
          <FilterBlock label="Platform">
            <select
              value={p.salesPlatform}
              onChange={(e) => p.setSalesPlatform(e.target.value)}
              className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500"
            >
              <option value="">All platforms</option>
              {p.salesPlatformOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </FilterBlock>
        </div>
      )}

      {p.dataset === 'inventory' && (
        <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <FilterBlock label="Card type">
            <div className="flex gap-1">
              {(['all', 'graded', 'raw'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => p.setInvType(t)}
                  className={cn(
                    'px-3 py-1 text-xs rounded-md font-medium transition-colors capitalize',
                    p.invType === t ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200',
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </FilterBlock>
          <FilterBlock label="Status">
            <select
              value={p.invStatus}
              onChange={(e) => p.setInvStatus(e.target.value)}
              className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500"
            >
              <option value="">All statuses</option>
              {STATUS_VALUES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </FilterBlock>
        </div>
      )}

      {p.dataset === 'expenses' && (
        <div className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <FilterBlock label="Date range">
            <div className="grid grid-cols-2 gap-3">
              <DateInput label="From" value={p.expFrom} onChange={p.setExpFrom} />
              <DateInput label="To"   value={p.expTo}   onChange={p.setExpTo} />
            </div>
            <div className="flex gap-2 mt-2 flex-wrap">
              {p.expYearOptions.map((y) => (
                <YearPill key={y} year={y} active={p.expFrom === `${y}-01-01` && p.expTo === `${y}-12-31`} onClick={() => p.applyYear(y, 'expenses')} />
              ))}
              <YearPill year="All" active={!p.expFrom && !p.expTo} onClick={() => { p.setExpFrom(''); p.setExpTo(''); }} />
            </div>
          </FilterBlock>
          {p.expTypeOptions.length > 0 && (
            <FilterBlock label="Types">
              <div className="flex flex-wrap gap-2">
                {p.expTypeOptions.map((t) => {
                  const on = p.expTypes.includes(t);
                  return (
                    <button
                      key={t}
                      onClick={() => p.setExpTypes(on ? p.expTypes.filter((x) => x !== t) : [...p.expTypes, t])}
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
              {p.expTypes.length > 0 && (
                <button onClick={() => p.setExpTypes([])} className="mt-2 text-[11px] text-zinc-500 hover:text-zinc-300">
                  Clear types
                </button>
              )}
            </FilterBlock>
          )}
        </div>
      )}

      <div className="pt-2 flex items-center gap-3">
        <Button onClick={p.onExport} disabled={p.loading} className="w-full sm:w-auto">
          <Download size={14} /> {p.loading ? 'Generating…' : `Export ${p.dataset}`}
        </Button>
        <p className="text-[11px] text-zinc-500">
          File will download to your browser's default location.
        </p>
      </div>
    </div>
  );
}

// ─── Bits ────────────────────────────────────────────────────────────────────

function Crumb({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-600/15 border border-indigo-500/30 text-[11px] text-indigo-300">
      <Check size={11} />
      <span className="text-zinc-500">{label}:</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}

function FilterBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">{label}</p>
      {children}
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
        className="w-full rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 [color-scheme:dark]"
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
