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
import { ColHeader, useColWidths } from '../components/ui/TableHeader';
import toast from 'react-hot-toast';

interface Sale {
  id: string;
  card_name: string | null;
  set_name: string | null;
  platform: string;
  sale_price: number;
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
}

interface SaleFilterOptions {
  platforms: string[];
}

interface SlabResult {
  card_instance_id: string;
  card_name: string | null;
  set_name: string | null;
  company: string | null;
  grade_label: string | null;
  numeric_grade: number | null;
  cert_number: string | null;
  currency: string;
}

type SortDir = 'asc' | 'desc';

const PLATFORMS = ['ebay', 'card_show', 'tcgplayer', 'facebook', 'instagram', 'local', 'other'] as const;

// ── Record Sale Modal ─────────────────────────────────────────────────────────

function RecordSaleModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [cardSearch, setCardSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedCard, setSelectedCard] = useState<SlabResult | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [platform, setPlatform] = useState<string>('ebay');
  const [salePrice, setSalePrice] = useState('');
  const [platformFees, setPlatformFees] = useState('');
  const [shippingCost, setShippingCost] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [soldAt, setSoldAt] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(cardSearch), 300);
    return () => clearTimeout(t);
  }, [cardSearch]);

  const { data: cardResults } = useQuery<PaginatedResult<SlabResult>>({
    queryKey: ['card-picker-sale', debouncedSearch],
    queryFn: () => api.get('/grading/slabs', { params: { search: debouncedSearch, limit: 8, status: 'graded' } }).then(r => r.data),
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
    if (!salePrice) { toast.error('Enter a sale price'); return; }
    setSubmitting(true);
    try {
      await api.post('/sales', {
        card_instance_id: selectedCard.card_instance_id,
        platform,
        sale_price: salePrice,
        platform_fees: platformFees || undefined,
        shipping_cost: shippingCost || undefined,
        currency,
        sold_at: soldAt || undefined,
        unique_id: orderNumber || undefined,
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

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Card picker */}
      <div className="relative" ref={dropdownRef}>
        <Input
          label="Card"
          placeholder="Search by name…"
          value={selectedCard ? `${selectedCard.card_name ?? ''}${selectedCard.grade_label ? ` · ${selectedCard.company} ${selectedCard.grade_label}` : ''}${selectedCard.cert_number ? ` #${selectedCard.cert_number}` : ''}` : cardSearch}
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
                <div className="text-xs text-zinc-500">
                  {card.set_name}{card.grade_label ? ` · ${card.company} ${card.grade_label}` : ''}
                  {card.cert_number ? <span className="ml-1 font-mono">#{card.cert_number}</span> : ''}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Select label="Platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>
          {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
        </Select>
        <Select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          <option value="USD">USD</option>
          <option value="JPY">JPY</option>
        </Select>
      </div>

      <Input label="Sale Price" type="number" step="0.01" min="0" placeholder="0.00"
        value={salePrice} onChange={(e) => setSalePrice(e.target.value)} />

      <div className="grid grid-cols-2 gap-3">
        <Input label="Platform Fees" type="number" step="0.01" min="0" placeholder="0.00"
          value={platformFees} onChange={(e) => setPlatformFees(e.target.value)} />
        <Input label="Shipping Cost" type="number" step="0.01" min="0" placeholder="0.00"
          value={shippingCost} onChange={(e) => setShippingCost(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Sold Date</label>
          <input type="date" value={soldAt} onChange={(e) => setSoldAt(e.target.value)}
            className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors [color-scheme:dark]" />
        </div>
        <Input label="Order #" placeholder="e.g. eBay order number" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 size={14} className="animate-spin" />}
          Record Sale
        </Button>
      </div>
    </form>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function Sales() {
  const [page, setPage] = useState(1);
  const [sortCol, setSortCol] = useState<string | null>('sold_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [fPlatform, setFPlatform] = useState<string[] | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const { rz, totalWidth } = useColWidths({ card: 560, platform: 100, sale_price: 110, net: 110, profit: 110, date: 120 });

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

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
                <ColHeader label="Card"       col="card_name"    {...sh} {...rz('card')} />
                <ColHeader label="Platform"   col="platform"     {...sh} {...rz('platform')}
                  filterOptions={filterOptions?.platforms} filterSelected={fPlatform} onFilterChange={(v) => { setFPlatform(v); setPage(1); }} />
                <ColHeader label="Sale Price" col="sale_price"   {...sh} {...rz('sale_price')} align="right" />
                <ColHeader label="Net"        col="net_proceeds" {...sh} {...rz('net')} align="right" />
                <ColHeader label="Profit"     col="profit"       {...sh} {...rz('profit')} align="right" />
                <ColHeader label="Date"       col="sold_at"      {...sh} {...rz('date')} />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {!data?.data.length ? (
                <tr><td colSpan={6} className="px-3 py-10 text-center text-zinc-500">No sales found.</td></tr>
              ) : data.data.map((sale) => (
                <tr key={sale.id} className="hover:bg-zinc-800/30 transition-colors">
                  <td className="px-3 py-2">
                    <p className="font-medium text-zinc-200 truncate" title={sale.card_name ?? ''}>{sale.card_name ?? 'Unknown'}</p>
                    <p className="text-[10px] text-zinc-500">
                      {sale.set_name}{sale.grade ? ` · ${sale.grading_company} ${sale.grade_label ?? sale.grade}` : ''}
                      {sale.cert_number ? <span className="ml-1 font-mono">#{String(sale.cert_number).padStart(8, '0')}</span> : ''}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    <Badge className="bg-zinc-700/50 text-zinc-300">{sale.platform.replace('_', ' ')}</Badge>
                  </td>
                  <td className="px-3 py-2 text-right text-zinc-300">{formatCurrency(sale.sale_price, sale.currency)}</td>
                  <td className="px-3 py-2 text-right text-zinc-300">{formatCurrency(sale.net_proceeds, sale.currency)}</td>
                  <td className={`px-3 py-2 text-right font-medium ${sale.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {sale.profit >= 0 ? '+' : ''}{formatCurrency(sale.profit, sale.currency)}
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{formatDate(sale.sold_at)}</td>
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

      <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="Record Sale">
        <RecordSaleModal onClose={() => setShowAddModal(false)} />
      </Modal>
    </div>
  );
}
