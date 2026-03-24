import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Loader2 } from 'lucide-react';
import { api, type PaginatedResult } from '../lib/api';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { formatCurrency, formatDate } from '../lib/utils';
import { loadFilters, saveFilters } from '../lib/filter-store';
import { ColHeader, useColWidths, colMinWidth } from '../components/ui/TableHeader';
import toast from 'react-hot-toast';

interface Submission {
  id: string;
  card_name: string | null;
  set_name: string | null;
  company: string;
  status: string;
  service_level: string | null;
  grading_fee: number;
  shipping_cost: number;
  currency: string;
  submitted_at: string | null;
  estimated_return: string | null;
  returned_at: string | null;
}

interface SubmissionFilterOptions {
  companies: string[];
  statuses: string[];
}

interface SlabResult {
  card_instance_id: string;
  card_name: string | null;
  set_name: string | null;
  company: string | null;
  grade_label: string | null;
  grade: number | null;
  currency: string;
}

const SUBMISSION_STATUS_COLORS: Record<string, string> = {
  submitted: 'bg-blue-500/20 text-blue-300',
  in_review: 'bg-yellow-500/20 text-yellow-300',
  graded: 'bg-purple-500/20 text-purple-300',
  returned: 'bg-green-500/20 text-green-300',
  cancelled: 'bg-zinc-700/50 text-zinc-400',
};

const GRADING_COMPANIES = ['PSA', 'BGS', 'CGC', 'SGC', 'HGA', 'ACE', 'ARS', 'OTHER'] as const;

type SortDir = 'asc' | 'desc';

// ── Submit for Grading Modal ──────────────────────────────────────────────────

function SubmitGradingModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [cardSearch, setCardSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedCard, setSelectedCard] = useState<SlabResult | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [company, setCompany] = useState<string>('PSA');
  const [serviceLevel, setServiceLevel] = useState('');
  const [gradingFee, setGradingFee] = useState('');
  const [shippingCost, setShippingCost] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [submittedAt, setSubmittedAt] = useState('');
  const [estimatedReturn, setEstimatedReturn] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(cardSearch), 300);
    return () => clearTimeout(t);
  }, [cardSearch]);

  const { data: cardResults } = useQuery<PaginatedResult<SlabResult>>({
    queryKey: ['card-picker-grading', debouncedSearch],
    queryFn: () => api.get('/grading/slabs', { params: { search: debouncedSearch, limit: 8, status: 'unsold' } }).then(r => r.data),
    enabled: debouncedSearch.length >= 2,
  });

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !e.composedPath().includes(dropdownRef.current as EventTarget)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCard) { toast.error('Select a card'); return; }
    setSubmitting(true);
    try {
      await api.post('/grading', {
        card_instance_id: selectedCard.card_instance_id,
        company,
        service_level: serviceLevel || undefined,
        grading_fee: gradingFee ? parseFloat(gradingFee) : undefined,
        shipping_cost: shippingCost ? parseFloat(shippingCost) : undefined,
        currency,
        submitted_at: submittedAt || undefined,
        estimated_return: estimatedReturn || undefined,
      });
      toast.success('Submitted for grading!');
      queryClient.invalidateQueries({ queryKey: ['grading'] });
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Card picker */}
      <div className="relative" ref={dropdownRef}>
        <Input
          label="Card"
          placeholder="Search by name…"
          value={selectedCard ? `${selectedCard.card_name ?? ''}${selectedCard.grade_label ? ` · ${selectedCard.company} ${selectedCard.grade_label}` : ''}` : cardSearch}
          onChange={(e) => { setCardSearch(e.target.value); setSelectedCard(null); setShowDropdown(true); }}
          onFocus={() => setShowDropdown(true)}
          autoComplete="off"
        />
        {selectedCard && (
          <button type="button" onClick={() => { setSelectedCard(null); setCardSearch(''); }}
            className="absolute right-2 top-7 text-zinc-500 hover:text-zinc-300">
            <X size={14} />
          </button>
        )}
        {showDropdown && !selectedCard && debouncedSearch.length >= 2 && (cardResults?.data?.length ?? 0) > 0 && (
          <div className="absolute top-full left-0 right-0 z-20 bg-zinc-800 border border-zinc-700 rounded-lg mt-1 overflow-hidden max-h-48 overflow-y-auto shadow-xl">
            {cardResults!.data.map((card) => (
              <button key={card.card_instance_id} type="button"
                className="w-full text-left px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-700 border-b border-zinc-700/50 last:border-0"
                onMouseDown={() => { setSelectedCard(card); setShowDropdown(false); }}>
                <div className="font-medium">{card.card_name ?? 'Unknown'}</div>
                <div className="text-xs text-zinc-500">{card.set_name}{card.grade_label ? ` · ${card.company} ${card.grade_label}` : ''}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Select label="Grading Company" value={company} onChange={(e) => setCompany(e.target.value)}>
          {GRADING_COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
        </Select>
        <Select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          <option value="USD">USD</option>
          <option value="JPY">JPY</option>
        </Select>
      </div>

      <Input label="Service Level" placeholder="e.g. Regular, Express" value={serviceLevel}
        onChange={(e) => setServiceLevel(e.target.value)} />

      <div className="grid grid-cols-2 gap-3">
        <Input label="Grading Fee" type="number" step="0.01" min="0" placeholder="0.00"
          value={gradingFee} onChange={(e) => setGradingFee(e.target.value)} />
        <Input label="Shipping Cost" type="number" step="0.01" min="0" placeholder="0.00"
          value={shippingCost} onChange={(e) => setShippingCost(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input label="Submitted Date" type="date" value={submittedAt} onChange={(e) => setSubmittedAt(e.target.value)} />
        <Input label="Est. Return Date" type="date" value={estimatedReturn} onChange={(e) => setEstimatedReturn(e.target.value)} />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 size={14} className="animate-spin" />}
          Submit for Grading
        </Button>
      </div>
    </form>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

const GRADING_FILTER_DEFAULTS = {
  sortCol: 'submitted_at' as string | null,
  sortDir: 'desc' as SortDir,
  fCompany: null as string[] | null,
  fStatus: null as string[] | null,
  search: '',
};

export function Grading() {
  const saved = loadFilters('grading', GRADING_FILTER_DEFAULTS);
  const [page, setPage] = useState(1);
  const [sortCol, setSortCol] = useState<string | null>(saved.sortCol);
  const [sortDir, setSortDir] = useState<SortDir>(saved.sortDir);
  const [fCompany, setFCompany] = useState<string[] | null>(saved.fCompany);
  const [fStatus, setFStatus] = useState<string[] | null>(saved.fStatus);
  const [search, setSearch] = useState(saved.search);
  const [debouncedSearch, setDebouncedSearch] = useState(saved.search);
  const [showAddModal, setShowAddModal] = useState(false);
  const MINS = {
    card:       colMinWidth('Card',        true,  false),
    company:    colMinWidth('Company',     true,  true),
    status:     colMinWidth('Status',      true,  true),
    cost:       colMinWidth('Cost',        true,  false),
    submitted:  colMinWidth('Submitted',   true,  false),
    est_return: colMinWidth('Est. Return', true,  false),
  };
  const { rz, totalWidth } = useColWidths({ card: Math.max(MINS.card, 600), company: Math.max(MINS.company, 100), status: Math.max(MINS.status, 110), cost: Math.max(MINS.cost, 110), submitted: Math.max(MINS.submitted, 120), est_return: Math.max(MINS.est_return, 120) });

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    saveFilters('grading', { sortCol, sortDir, fCompany, fStatus, search });
  }, [sortCol, sortDir, fCompany, fStatus, search]);

  const handleSort = useCallback((col: string) => {
    setSortCol((prev) => {
      if (prev === col) return prev;
      return col;
    });
    setSortDir((prev) => sortCol === col ? (prev === 'asc' ? 'desc' : 'asc') : 'desc');
    setPage(1);
  }, [sortCol]);

  const { data: filterOptions } = useQuery<SubmissionFilterOptions>({
    queryKey: ['submission-filter-options'],
    queryFn: () => api.get('/grading/filters').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  function activeFilter(sel: string[] | null, opts?: string[]): string[] | undefined {
    if (sel === null) return undefined;
    if (sel.length >= (opts?.length ?? Infinity)) return undefined;
    return sel;
  }

  const params = {
    page,
    limit: 25,
    sort_by: sortCol ?? undefined,
    sort_dir: sortDir,
    companies: activeFilter(fCompany, filterOptions?.companies)?.join(','),
    statuses:  activeFilter(fStatus,  filterOptions?.statuses)?.join(','),
    search: debouncedSearch || undefined,
  };

  const { data, isLoading } = useQuery<PaginatedResult<Submission>>({
    queryKey: ['grading', params],
    queryFn: () => api.get('/grading', { params }).then((r) => r.data),
  });

  const hasActiveFilters = fCompany !== null || fStatus !== null || !!debouncedSearch;

  const sh = { sortCol, sortDir, onSort: handleSort };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-100">Grading Submissions</h1>
        <div className="flex items-center gap-3">
          {hasActiveFilters && (
            <button onClick={() => { setFCompany(null); setFStatus(null); setSearch(''); }}
              className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
              <X size={12} /> Clear filters
            </button>
          )}
          <input
            type="text"
            placeholder="Search card…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 w-52"
          />
          <Button size="sm" onClick={() => setShowAddModal(true)}>
            <Plus size={14} /> Submit for Grading
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
                <ColHeader label="Card"        col="card_name"        {...sh} {...rz('card')} minWidth={MINS.card} />
                <ColHeader label="Company"     col="company"          {...sh} {...rz('company')} minWidth={MINS.company}
                  filterOptions={filterOptions?.companies} filterSelected={fCompany} onFilterChange={(v) => { setFCompany(v); setPage(1); }} />
                <ColHeader label="Status"      col="status"           {...sh} {...rz('status')} minWidth={MINS.status}
                  filterOptions={filterOptions?.statuses} filterSelected={fStatus} onFilterChange={(v) => { setFStatus(v); setPage(1); }} />
                <ColHeader label="Cost"        col="grading_fee"      {...sh} {...rz('cost')} align="right" minWidth={MINS.cost} />
                <ColHeader label="Submitted"   col="submitted_at"     {...sh} {...rz('submitted')} minWidth={MINS.submitted} />
                <ColHeader label="Est. Return" col="estimated_return" {...sh} {...rz('est_return')} minWidth={MINS.est_return} />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {!data?.data.length ? (
                <tr><td colSpan={6} className="px-3 py-10 text-center text-zinc-500">No grading submissions found.</td></tr>
              ) : data.data.map((sub) => (
                <tr key={sub.id} className="hover:bg-zinc-800/30 transition-colors">
                  <td className="px-3 py-2">
                    <p className="font-medium text-zinc-200 truncate" title={sub.card_name ?? ''}>{sub.card_name ?? 'Unknown'}</p>
                    <p className="text-[10px] text-zinc-500">{sub.set_name}</p>
                  </td>
                  <td className="px-3 py-2 text-zinc-300">{sub.company}</td>
                  <td className="px-3 py-2">
                    <Badge className={SUBMISSION_STATUS_COLORS[sub.status] ?? 'bg-zinc-700/50 text-zinc-400'}>
                      {sub.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right text-zinc-300">
                    {formatCurrency((sub.grading_fee ?? 0) + (sub.shipping_cost ?? 0), sub.currency)}
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{formatDate(sub.submitted_at)}</td>
                  <td className="px-3 py-2 text-zinc-500">{formatDate(sub.estimated_return)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data && (
        <div className="flex items-center justify-between px-6 py-3 pr-44 border-t border-zinc-800 text-xs text-zinc-500">
          <span>{data.total} submissions</span>
          {data.total_pages > 1 && (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
              <span className="px-2 py-1">{page} / {data.total_pages}</span>
              <Button variant="ghost" size="sm" disabled={page >= data.total_pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </div>
      )}

      <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="Submit for Grading">
        <SubmitGradingModal onClose={() => setShowAddModal(false)} />
      </Modal>
    </div>
  );
}
