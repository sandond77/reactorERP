import { useState, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Loader2, Pencil, Trash2 } from 'lucide-react';
import { api, type PaginatedResult } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { formatCurrency, formatDate } from '../lib/utils';
import { loadFilters, saveFilters } from '../lib/filter-store';
import { ColHeader, useColWidths, colMinWidth } from '../components/ui/TableHeader';
import toast from 'react-hot-toast';

interface Sale {
  id: string;
  card_name: string | null;
  set_name: string | null;
  platform: string;
  sale_price: number;
  platform_fees: number;
  shipping_cost: number;
  net_proceeds: number;
  total_cost_basis: number | null;
  profit: number;
  currency: string;
  sold_at: string;
  grade: number | null;
  grade_label: string | null;
  grading_company: string | null;
  cert_number: string | null;
  unique_id: string | null;
  unique_id_2: string | null;
  raw_cost: number;
  grading_cost: number | null;
  listed_price: number | null;
  order_details_link: string | null;
}

interface SaleFilterOptions {
  platforms: string[];
}

interface SlabResult {
  id: string;
  card_name: string | null;
  set_name: string | null;
  company: string | null;
  grade_label: string | null;
  numeric_grade: number | null;
  cert_number: string | null;
  currency: string;
  raw_purchase_date: string | null;
  listed_price: number | null;
  listing_id: string | null;
  is_listed: boolean;
  is_personal_collection: boolean;
}

type SortDir = 'asc' | 'desc';

const PLATFORMS = [
  { value: 'ebay',       label: 'eBay' },
  { value: 'card_show',  label: 'Card Show' },
  { value: 'local',      label: 'Private' },
  { value: 'other',      label: 'Other' },
] as const;

function platformLabel(value: string) {
  return PLATFORMS.find(p => p.value === value)?.label ?? value;
}

// ── Record Sale Modal ─────────────────────────────────────────────────────────

function RecordSaleModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'search' | 'copies' | 'details'>('search');

  // Step 1a — card name search
  const [cardSearch, setCardSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedCardName, setSelectedCardName] = useState<string | null>(null);

  // Step 1b — copy selection
  const [selectedCard, setSelectedCard] = useState<SlabResult | null>(null);
  const [listedOnly, setListedOnly] = useState(true);

  // Step 2 — sale details
  const [platform, setPlatform] = useState<string>('ebay');
  const [strikePrice, setStrikePrice] = useState('');
  const [orderEarnings, setOrderEarnings] = useState('');
  const [ebayLink, setEbayLink] = useState('');
  const [cardShowDetail, setCardShowDetail] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [soldAt, setSoldAt] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(cardSearch), 300);
    return () => clearTimeout(t);
  }, [cardSearch]);

  // Phase 1: search for card names (deduped by name in the dropdown)
  const { data: searchResults, isFetching: isSearching } = useQuery<PaginatedResult<SlabResult>>({
    queryKey: ['card-name-search', debouncedSearch],
    queryFn: () => api.get('/grading/slabs', {
      params: { search: debouncedSearch, limit: 100, status: 'unsold', sort_by: 'card_name', sort_dir: 'asc', personal_collection: 'no' },
    }).then(r => r.data),
    enabled: debouncedSearch.length >= 2 && step === 'search',
  });

  // Phase 2: fetch all copies of selected card name, sorted by cert number (FIFO)
  const { data: copiesResult, isFetching: isLoadingCopies } = useQuery<PaginatedResult<SlabResult>>({
    queryKey: ['card-copies', selectedCardName],
    queryFn: () => api.get('/grading/slabs', {
      params: { search: selectedCardName, limit: 200, status: 'unsold', sort_by: 'cert_number', sort_dir: 'asc', personal_collection: 'no' },
    }).then(r => r.data),
    enabled: !!selectedCardName && step === 'copies',
  });

  // Deduplicate search results by card_name
  const uniqueCardNames = searchResults
    ? Array.from(
        searchResults.data.reduce((map, s) => {
          const name = s.card_name ?? 'Unknown';
          if (!map.has(name)) map.set(name, 0);
          map.set(name, map.get(name)! + 1);
          return map;
        }, new Map<string, number>())
      )
    : [];

  // Filter copies to exact name match, then optionally to listed-only
  const allCopies = copiesResult?.data.filter(c => c.card_name === selectedCardName && !c.is_personal_collection) ?? [];
  const copies = listedOnly ? allCopies.filter(c => c.is_listed) : allCopies;
  const listedCount = allCopies.filter(c => c.is_listed).length;

  // Auto-select first copy in filtered list (FIFO)
  useEffect(() => {
    if (copies.length > 0) {
      setSelectedCard(copies[0]);
    } else {
      setSelectedCard(null);
    }
  }, [copies.length, listedOnly]);


  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCard) { toast.error('Select a card'); return; }
    if (!strikePrice) { toast.error('Enter a strike price'); return; }
    const strikeCents = Math.round(parseFloat(strikePrice) * 100);
    const earningsCents = orderEarnings ? Math.round(parseFloat(orderEarnings) * 100) : 0;
    const feesCents = Math.max(0, strikeCents - earningsCents);
    setSubmitting(true);
    try {
      await api.post('/sales', {
        card_instance_id: selectedCard.id,
        listing_id: selectedCard.listing_id ?? undefined,
        platform,
        sale_price: strikePrice,
        platform_fees: feesCents > 0 ? String(feesCents / 100) : undefined,
        currency,
        sold_at: soldAt || undefined,
        unique_id: orderNumber || undefined,
        unique_id_2: cardShowDetail || undefined,
        order_details_link: ebayLink || undefined,
      });
      toast.success('Sale recorded!');
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to record sale');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Step 1a: Search by card name ──────────────────────────────────────────

  if (step === 'search') return (
    <div className="space-y-3">
      <div className="relative">
        <Input
          label="Search Card"
          placeholder="Card name or part number…"
          value={cardSearch}
          onChange={(e) => setCardSearch(e.target.value)}
          autoComplete="off"
          autoFocus
        />
        {isSearching && (
          <Loader2 size={13} className="absolute right-3 top-[30px] animate-spin text-zinc-500" />
        )}
      </div>

      {/* In-flow results so modal height adjusts naturally */}
      {debouncedSearch.length >= 2 && (
        uniqueCardNames.length > 0 ? (
          <div className="rounded-lg border border-zinc-700 overflow-hidden">
            {uniqueCardNames.map(([name, count]) => (
              <button key={name} type="button"
                className="w-full text-left px-4 py-3 hover:bg-zinc-800 border-b border-zinc-700/40 last:border-0 flex items-center justify-between gap-3 transition-colors"
                onClick={() => {
                  setSelectedCardName(name);
                  setCardSearch(name);
                  setSelectedCard(null);
                  setStep('copies');
                }}>
                <span className="text-sm text-zinc-200 truncate">{name}</span>
                <span className="shrink-0 text-[10px] text-zinc-500 font-mono tabular-nums">{count} unsold</span>
              </button>
            ))}
          </div>
        ) : !isSearching ? (
          <p className="text-xs text-zinc-500 px-1">No unsold copies found.</p>
        ) : null
      )}

      <div className="flex justify-end pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );

  // ── Step 1b: Select copy (all unsold, FIFO pre-selected) ──────────────────

  if (step === 'copies') return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <button type="button" onClick={() => { setStep('search'); setSelectedCard(null); setSelectedCardName(null); }}
            className="text-xs text-zinc-500 hover:text-zinc-300 shrink-0">← Back</button>
          <p className="text-xs font-medium text-zinc-300 truncate">{selectedCardName}</p>
        </div>
        {/* Listed-only toggle */}
        <button type="button"
          onClick={() => setListedOnly(v => !v)}
          className={`shrink-0 flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors ${
            listedOnly
              ? 'bg-green-500/15 border-green-500/30 text-green-400'
              : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
          }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${listedOnly ? 'bg-green-400' : 'bg-zinc-600'}`} />
          {listedOnly ? `Listed (${listedCount})` : `All (${allCopies.length})`}
        </button>
      </div>

      {isLoadingCopies ? (
        <div className="flex items-center justify-center py-8 text-zinc-600 text-sm">
          <Loader2 size={16} className="animate-spin mr-2" /> Loading copies…
        </div>
      ) : copies.length === 0 ? (
        <div className="py-6 text-center space-y-1">
          <p className="text-sm text-zinc-500">
            {listedOnly ? 'No listed copies found.' : 'No unsold copies found.'}
          </p>
          {listedOnly && allCopies.length > 0 && (
            <button type="button" onClick={() => setListedOnly(false)}
              className="text-xs text-indigo-400 hover:text-indigo-300">
              Show all {allCopies.length} unsold copies
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
          {copies.map((copy, idx) => {
            const isFifo = idx === 0;
            const isSelected = selectedCard?.id === copy.id;
            return (
              <button key={copy.id} type="button"
                onClick={() => setSelectedCard(copy)}
                className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
                  isSelected
                    ? 'border-amber-500/50 bg-amber-500/10'
                    : 'border-zinc-700/50 bg-zinc-800/40 hover:bg-zinc-800'
                }`}>
                <div className="flex items-center gap-2">
                  {isFifo && (
                    <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded px-1 py-0.5">FIFO</span>
                  )}
                  <span className="text-sm font-mono text-zinc-200">
                    {copy.cert_number ? `#${String(copy.cert_number).padStart(8, '0')}` : 'No cert'}
                  </span>
                  <span className="text-xs text-zinc-400">{copy.company} {copy.grade_label}</span>
                  {copy.listed_price && (
                    <span className="text-xs text-zinc-500">{formatCurrency(copy.listed_price, copy.currency)}</span>
                  )}
                  {isSelected && <span className="ml-auto text-[10px] text-amber-400 font-medium">Selected</span>}
                </div>
                {copy.raw_purchase_date && (
                  <p className="text-[10px] text-zinc-600 mt-0.5">
                    Purchased {formatDate(copy.raw_purchase_date)}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" disabled={!selectedCard} onClick={() => setStep('details')}>
          Continue →
        </Button>
      </div>
    </div>
  );

  // ── Step 2: Sale details ──────────────────────────────────────────────────

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Selected cert summary */}
      {selectedCard && (
        <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/50 px-4 py-3 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-100 truncate">{selectedCard.card_name}</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                {selectedCard.company} {selectedCard.grade_label}
                {selectedCard.listed_price
                  ? <span className="ml-2 text-zinc-400">Listed: {formatCurrency(selectedCard.listed_price, selectedCard.currency)}</span>
                  : ''}
              </p>
            </div>
            <button type="button" onClick={() => setStep('copies')} className="text-[11px] text-indigo-400 hover:text-indigo-300 shrink-0">Change</button>
          </div>
          <div className="border-t border-zinc-700/50 pt-2 flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-amber-400">Ship this cert</span>
            <span className="font-mono text-sm text-zinc-200">
              {selectedCard.cert_number ? `#${String(selectedCard.cert_number).padStart(8, '0')}` : '—'}
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Select label="Sale Method" value={platform} onChange={(e) => setPlatform(e.target.value)}>
          {PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </Select>
        <Select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          <option value="USD">USD</option>
          <option value="JPY">JPY</option>
        </Select>
      </div>

      {platform === 'card_show' && (
        <Input label="Card Show Detail" placeholder="e.g. show name, location"
          value={cardShowDetail} onChange={(e) => setCardShowDetail(e.target.value)} />
      )}

      <div className="grid grid-cols-2 gap-3">
        <Input label="Strike Price" type="number" step="0.01" min="0" placeholder="0.00"
          value={strikePrice} onChange={(e) => setStrikePrice(e.target.value)} />
        <Input label="Order Earnings (After Fees)" type="number" step="0.01" min="0" placeholder="0.00"
          value={orderEarnings} onChange={(e) => setOrderEarnings(e.target.value)} />
      </div>

      {platform === 'ebay' && (
        <Input label="eBay Link" type="url" placeholder="https://www.ebay.com/…"
          value={ebayLink} onChange={(e) => setEbayLink(e.target.value)} />
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Sold Date</label>
          <input type="date" value={soldAt} onChange={(e) => setSoldAt(e.target.value)}
            className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors [color-scheme:dark]" />
        </div>
        <Input label="Order #" placeholder="e.g. eBay order number" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={() => setStep('copies')}>Back</Button>
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 size={14} className="animate-spin" />}
          Record Sale
        </Button>
      </div>
    </form>
  );
}

// ── Sale Action Modal (Edit / Delete) ─────────────────────────────────────────

function SaleActionModal({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'prompt' | 'edit' | 'delete'>('prompt');
  const [platform, setPlatform] = useState(sale.platform);
  const [strikePrice, setStrikePrice] = useState((sale.sale_price / 100).toFixed(2));
  const [orderEarnings, setOrderEarnings] = useState((sale.net_proceeds / 100).toFixed(2));
  const [ebayLink, setEbayLink] = useState(sale.order_details_link ?? '');
  const [cardShowDetail, setCardShowDetail] = useState(sale.unique_id_2 ?? '');
  const [currency, setCurrency] = useState(sale.currency);
  const [soldAt, setSoldAt] = useState(sale.sold_at ? sale.sold_at.slice(0, 10) : '');
  const [orderNumber, setOrderNumber] = useState(sale.unique_id ?? '');
  const [submitting, setSubmitting] = useState(false);

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    const strikeCents = Math.round(parseFloat(strikePrice) * 100);
    const earningsCents = orderEarnings ? Math.round(parseFloat(orderEarnings) * 100) : 0;
    const feesCents = Math.max(0, strikeCents - earningsCents);
    try {
      await api.put(`/sales/${sale.id}`, {
        platform,
        sale_price: strikePrice,
        platform_fees: String(feesCents / 100),
        shipping_cost: '0',
        currency,
        sold_at: soldAt || undefined,
        unique_id: orderNumber || undefined,
        unique_id_2: cardShowDetail || undefined,
        order_details_link: ebayLink || undefined,
      });
      toast.success('Sale updated');
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to update sale');
    } finally { setSubmitting(false); }
  }

  async function handleDelete() {
    setSubmitting(true);
    try {
      await api.delete(`/sales/${sale.id}`);
      toast.success('Sale deleted — card returned to inventory');
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to delete sale');
    } finally { setSubmitting(false); }
  }

  if (mode === 'delete') return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-300">Delete this sale? The card will be returned to your inventory as <span className="text-zinc-100 font-medium">graded</span>.</p>
      <p className="text-xs text-zinc-500 font-medium truncate">{sale.card_name}</p>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={() => setMode('prompt')}>Back</Button>
        <Button type="button" variant="danger" disabled={submitting} onClick={handleDelete}>
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          Delete Sale
        </Button>
      </div>
    </div>
  );

  if (mode === 'edit') return (
    <form onSubmit={handleEdit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Select label="Sale Method" value={platform} onChange={(e) => setPlatform(e.target.value)}>
          {PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </Select>
        <Select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          <option value="USD">USD</option>
          <option value="JPY">JPY</option>
        </Select>
      </div>
      {platform === 'card_show' && (
        <Input label="Card Show Detail" placeholder="e.g. show name, location"
          value={cardShowDetail} onChange={(e) => setCardShowDetail(e.target.value)} />
      )}
      <div className="grid grid-cols-2 gap-3">
        <Input label="Strike Price" type="number" step="0.01" min="0" value={strikePrice} onChange={(e) => setStrikePrice(e.target.value)} />
        <Input label="Order Earnings (After Fees)" type="number" step="0.01" min="0" value={orderEarnings} onChange={(e) => setOrderEarnings(e.target.value)} />
      </div>
      {platform === 'ebay' && (
        <Input label="eBay Link" type="url" placeholder="https://www.ebay.com/…" value={ebayLink} onChange={(e) => setEbayLink(e.target.value)} />
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Sold Date</label>
          <input type="date" value={soldAt} onChange={(e) => setSoldAt(e.target.value)}
            className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors [color-scheme:dark]" />
        </div>
        <Input label="Order #" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={() => setMode('prompt')}>Back</Button>
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 size={14} className="animate-spin" />}
          Save Changes
        </Button>
      </div>
    </form>
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500 truncate">{sale.card_name}</p>
      <button onClick={() => setMode('edit')}
        className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm text-zinc-200 transition-colors text-left">
        <Pencil size={15} className="text-zinc-400 shrink-0" />
        <div>
          <p className="font-medium">Edit Sale</p>
          <p className="text-xs text-zinc-500">Update price, fees, platform, or date</p>
        </div>
      </button>
      <button onClick={() => setMode('delete')}
        className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-zinc-800 hover:bg-red-900/40 text-sm text-zinc-200 hover:text-red-300 transition-colors text-left">
        <Trash2 size={15} className="text-zinc-400 shrink-0" />
        <div>
          <p className="font-medium">Delete Sale</p>
          <p className="text-xs text-zinc-500">Remove and return card to inventory</p>
        </div>
      </button>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

const SALES_FILTER_DEFAULTS = {
  sortCol: 'sold_at' as string | null,
  sortDir: 'desc' as SortDir,
  fPlatform: null as string[] | null,
  search: '',
};

export function Sales() {
  const saved = loadFilters('sales', SALES_FILTER_DEFAULTS);
  const [page, setPage] = useState(1);
  const [sortCol, setSortCol] = useState<string | null>(saved.sortCol);
  const [sortDir, setSortDir] = useState<SortDir>(saved.sortDir);
  const [fPlatform, setFPlatform] = useState<string[] | null>(saved.fPlatform);
  const [search, setSearch] = useState(saved.search);
  const [debouncedSearch, setDebouncedSearch] = useState(saved.search);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const MINS = {
    date:         colMinWidth('Date Sold',     true,  false),
    cert:         colMinWidth('Cert',          true,  false),
    card:         colMinWidth('Card',          true,  false),
    sale_method:  colMinWidth('Sale Method',   true,  true),
    raw_cost:     colMinWidth('Raw Cost',      true,  false),
    grading_cost: colMinWidth('Grading Cost',  true,  false),
    listed_price: colMinWidth('Listing Price', true,  false),
    strike:       colMinWidth('Strike Price',  true,  false),
    after_ebay:   colMinWidth('After Fees',    true,  false),
    net:          colMinWidth('Net',           true,  false),
  };
  const { rz, totalWidth } = useColWidths({ date: Math.max(MINS.date, 115), cert: Math.max(MINS.cert, 130), card: Math.max(MINS.card, 460), sale_method: Math.max(MINS.sale_method, 140), raw_cost: Math.max(MINS.raw_cost, 105), grading_cost: Math.max(MINS.grading_cost, 130), listed_price: Math.max(MINS.listed_price, 130), strike: Math.max(MINS.strike, 130), after_ebay: Math.max(MINS.after_ebay, 130), net: Math.max(MINS.net, 105) });

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    saveFilters('sales', { sortCol, sortDir, fPlatform, search });
  }, [sortCol, sortDir, fPlatform, search]);

  const handleSort = useCallback((col: string) => {
    setSortCol((prev) => {
      if (prev === col) return prev;
      return col;
    });
    setSortDir((prev) => sortCol === col ? (prev === 'asc' ? 'desc' : 'asc') : 'desc');
    setPage(1);
  }, [sortCol]);

  const { data: filterOptions } = useQuery<SaleFilterOptions>({
    queryKey: ['sale-filter-options'],
    queryFn: () => api.get('/sales/filters').then((r) => r.data),
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
    platforms: activeFilter(fPlatform, filterOptions?.platforms)?.join(','),
    search: debouncedSearch || undefined,
  };

  const { data, isLoading } = useQuery<PaginatedResult<Sale>>({
    queryKey: ['sales', params],
    queryFn: () => api.get('/sales', { params }).then((r) => r.data),
  });

  const hasActiveFilters = fPlatform !== null || !!debouncedSearch;

  const sh = { sortCol, sortDir, onSort: handleSort };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-100">Sales</h1>
        <div className="flex items-center gap-3">
          {hasActiveFilters && (
            <button onClick={() => { setFPlatform(null); setSearch(''); }}
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
            <Plus size={14} /> Record Sale
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
                <ColHeader label="Date Sold"      col="sold_at"      {...sh} {...rz('date')} minWidth={MINS.date} />
                <ColHeader label="Cert"           col="cert_number"  {...sh} {...rz('cert')} minWidth={MINS.cert} />
                <ColHeader label="Card"           col="card_name"    {...sh} {...rz('card')} minWidth={MINS.card} />
                <ColHeader label="Sale Method"    col="platform"     {...sh} {...rz('sale_method')} minWidth={MINS.sale_method}
                  filterOptions={filterOptions?.platforms} filterSelected={fPlatform} onFilterChange={(v) => { setFPlatform(v); setPage(1); }} />
                <ColHeader label="Raw Cost"       col="raw_cost"     {...sh} {...rz('raw_cost')} align="right" minWidth={MINS.raw_cost} />
                <ColHeader label="Grading Cost"   col="grading_cost" {...sh} {...rz('grading_cost')} align="right" minWidth={MINS.grading_cost} />
                <ColHeader label="Listing Price"  col="listed_price" {...sh} {...rz('listed_price')} align="right" minWidth={MINS.listed_price} />
                <ColHeader label="Strike Price"   col="sale_price"   {...sh} {...rz('strike')} align="right" minWidth={MINS.strike} />
                <ColHeader label="After Fees"     col="net_proceeds" {...sh} {...rz('after_ebay')} align="right" minWidth={MINS.after_ebay} />
                <ColHeader label="Net"            col="profit"       {...sh} {...rz('net')} align="right" minWidth={MINS.net} />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {!data?.data.length ? (
                <tr><td colSpan={10} className="px-3 py-10 text-center text-zinc-500">No sales found.</td></tr>
              ) : data.data.map((sale) => (
                <tr key={sale.id} className="hover:bg-zinc-800/30 transition-colors cursor-pointer" onClick={() => setSelectedSale(sale)}>
                  <td className="px-3 py-2 text-zinc-500">{formatDate(sale.sold_at)}</td>
                  <td className="px-3 py-2 font-mono text-zinc-400 text-[11px]">
                    {sale.cert_number ? String(sale.cert_number).padStart(8, '0') : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <p className="font-medium text-zinc-200 truncate" title={sale.card_name ?? ''}>{sale.card_name ?? 'Unknown'}</p>
                    <p className="text-[10px] text-zinc-500 truncate">
                      {sale.set_name}{sale.grade ? ` · ${sale.grading_company} ${sale.grade_label ?? sale.grade}` : ''}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-xs text-zinc-400">{platformLabel(sale.platform)}</span>
                  </td>
                  <td className="px-3 py-2 text-right text-zinc-400">{formatCurrency(sale.raw_cost, sale.currency)}</td>
                  <td className="px-3 py-2 text-right text-zinc-400">{sale.grading_cost ? formatCurrency(sale.grading_cost, sale.currency) : '—'}</td>
                  <td className="px-3 py-2 text-right text-zinc-400">{sale.listed_price ? formatCurrency(sale.listed_price, sale.currency) : '—'}</td>
                  <td className="px-3 py-2 text-right text-zinc-300">{formatCurrency(sale.sale_price, sale.currency)}</td>
                  <td className="px-3 py-2 text-right text-zinc-300">{formatCurrency(sale.net_proceeds, sale.currency)}</td>
                  <td className={`px-3 py-2 text-right font-medium ${sale.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {sale.profit >= 0 ? '+' : ''}{formatCurrency(sale.profit, sale.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data && (
        <div className="flex items-center justify-between px-6 py-3 pr-44 border-t border-zinc-800 text-xs text-zinc-500">
          <span>{data.total} sales</span>
          {data.total_pages > 1 && (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
              <span className="px-2 py-1">{page} / {data.total_pages}</span>
              <Button variant="ghost" size="sm" disabled={page >= data.total_pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </div>
      )}

      <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="Record Sale" className="max-w-2xl">
        <RecordSaleModal onClose={() => setShowAddModal(false)} />
      </Modal>

      <Modal open={!!selectedSale} onClose={() => setSelectedSale(null)} title="Sale">
        {selectedSale && <SaleActionModal sale={selectedSale} onClose={() => setSelectedSale(null)} />}
      </Modal>
    </div>
  );
}
