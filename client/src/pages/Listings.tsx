import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus, X, Loader2 } from 'lucide-react';
import { api, type PaginatedResult } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { formatCurrency, formatDate } from '../lib/utils';
import { ColHeader, useColWidths } from '../components/ui/TableHeader';
import toast from 'react-hot-toast';

interface Listing {
  id: string;
  card_name: string | null;
  set_name: string | null;
  platform: string;
  listing_status: string;
  list_price: number | null;
  asking_price: number | null;
  currency: string;
  ebay_listing_url: string | null;
  listed_at: string | null;
  grade: number | null;
  grade_label: string | null;
  grading_company: string | null;
}

interface ListingFilterOptions {
  platforms: string[];
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

type SortDir = 'asc' | 'desc';

const PLATFORMS = ['ebay', 'card_show', 'tcgplayer', 'facebook', 'instagram', 'local', 'other'] as const;

// ── Add Listing Modal ─────────────────────────────────────────────────────────

function AddListingModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [cardSearch, setCardSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedCard, setSelectedCard] = useState<SlabResult | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [platform, setPlatform] = useState<string>('ebay');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [listedAt, setListedAt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(cardSearch), 300);
    return () => clearTimeout(t);
  }, [cardSearch]);

  const { data: cardResults } = useQuery<PaginatedResult<SlabResult>>({
    queryKey: ['card-picker-listing', debouncedSearch],
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
    if (!price) { toast.error('Enter a price'); return; }
    setSubmitting(true);
    try {
      await api.post('/listings', {
        card_instance_id: selectedCard.card_instance_id,
        platform,
        list_price: parseFloat(price),
        currency,
        listed_at: listedAt || undefined,
      });
      toast.success('Listing created!');
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to create listing');
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
        <Select label="Platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>
          {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
        </Select>
        <Select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          <option value="USD">USD</option>
          <option value="JPY">JPY</option>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input label="List Price" type="number" step="0.01" min="0" placeholder="0.00"
          value={price} onChange={(e) => setPrice(e.target.value)} />
        <Input label="Listed Date" type="date" value={listedAt} onChange={(e) => setListedAt(e.target.value)} />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 size={14} className="animate-spin" />}
          Create Listing
        </Button>
      </div>
    </form>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function Listings() {
  const [page, setPage] = useState(1);
  const [sortCol, setSortCol] = useState<string | null>('listed_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [fPlatform, setFPlatform] = useState<string[] | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const { rz, totalWidth } = useColWidths({ card: 600, platform: 100, price: 110, listed: 120, link: 60 });

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

  const { data: filterOptions } = useQuery<ListingFilterOptions>({
    queryKey: ['listing-filter-options'],
    queryFn: () => api.get('/listings/filters').then((r) => r.data),
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
    status: 'active',
  };

  const { data, isLoading } = useQuery<PaginatedResult<Listing>>({
    queryKey: ['listings', params],
    queryFn: () => api.get('/listings', { params }).then((r) => r.data),
  });

  const hasActiveFilters = fPlatform !== null || !!debouncedSearch;

  const sh = { sortCol, sortDir, onSort: handleSort };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-100">Listings</h1>
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
            <Plus size={14} /> Add Listing
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
                <ColHeader label="Card"     col="card_name"      {...sh} {...rz('card')} />
                <ColHeader label="Platform" col="platform"       {...sh} {...rz('platform')}
                  filterOptions={filterOptions?.platforms} filterSelected={fPlatform} onFilterChange={(v) => { setFPlatform(v); setPage(1); }} />
                <ColHeader label="Price"    col="list_price"     {...sh} {...rz('price')} align="right" />
                <ColHeader label="Listed"   col="listed_at"      {...sh} {...rz('listed')} />
                <ColHeader label="Link"                          {...sh} {...rz('link')} align="center" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {!data?.data.length ? (
                <tr><td colSpan={5} className="px-3 py-10 text-center text-zinc-500">No listings found.</td></tr>
              ) : data.data.map((listing) => (
                <tr key={listing.id} className="hover:bg-zinc-800/30 transition-colors">
                  <td className="px-3 py-2">
                    <p className="font-medium text-zinc-200 truncate" title={listing.card_name ?? ''}>{listing.card_name ?? 'Unknown'}</p>
                    <p className="text-[10px] text-zinc-500">
                      {listing.set_name}{listing.grade ? ` · ${listing.grading_company} ${listing.grade_label ?? listing.grade}` : ''}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-zinc-300">{listing.platform}</td>
                  <td className="px-3 py-2 text-right text-zinc-300">
                    {formatCurrency(listing.asking_price ?? listing.list_price ?? 0, listing.currency)}
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{formatDate(listing.listed_at)}</td>
                  <td className="px-3 py-2 text-center">
                    {listing.ebay_listing_url ? (
                      <a href={listing.ebay_listing_url} target="_blank" rel="noopener noreferrer" className="inline-flex text-blue-400 hover:text-blue-300">
                        <ExternalLink size={13} />
                      </a>
                    ) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data && (
        <div className="flex items-center justify-between px-6 py-3 pr-44 border-t border-zinc-800 text-xs text-zinc-500">
          <span>{data.total} listings</span>
          {data.total_pages > 1 && (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
              <span className="px-2 py-1">{page} / {data.total_pages}</span>
              <Button variant="ghost" size="sm" disabled={page >= data.total_pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </div>
      )}

      <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="Add Listing">
        <AddListingModal onClose={() => setShowAddModal(false)} />
      </Modal>
    </div>
  );
}
