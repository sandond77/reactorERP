import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { ExternalLink, Plus, X, Loader2, Minus, Trash2, ChevronRight } from 'lucide-react';
import { api, type PaginatedResult } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { formatCurrency, formatCertNumber } from '../lib/utils';
import { loadFilters, saveFilters } from '../lib/filter-store';
import { ColHeader, ColumnFilter, useColWidths, colMinWidth } from '../components/ui/TableHeader';
import { FilterDrawer, FilterDrawerLauncher } from '../components/ui/FilterDrawer';
import toast from 'react-hot-toast';
import { AlertTriangle } from 'lucide-react';

function isEbayOrderUrl(url: string): boolean {
  const u = url.toLowerCase();
  return u.includes('ebay.') && (
    u.includes('/sh/ord') ||
    u.includes('/vod/fetchorderdetails') ||
    u.includes('/mesh/') ||
    u.includes('/ord/') ||
    /orderid=/i.test(u) ||
    /order_id=/i.test(u)
  );
}

interface CertDetail {
  listing_id?: string | null;
  cert_number: string | null;
  grade_label: string | null;
  list_price: number | null;
  ebay_listing_url: string | null;
  listing_group_id?: string | null;
  card_name?: string | null;
  part_number?: string | null;
  company?: string | null;
  condition?: string | null;
  raw_purchase_label?: string | null;
  is_multi_qty?: boolean;
}

interface AggregatedListing {
  card_name: string | null;
  set_name: string | null;
  part_number: string | null;
  grade_label: string | null;
  grading_company: string | null;
  condition: string | null;
  platform: string;
  list_price: number | null;
  currency: string;
  ebay_listing_url: string | null;
  listed_at: string | null;
  num_listed: number;
  num_sold: number;
  raw_purchase_label: string | null;
  cert_details: CertDetail[] | null;
  listing_group_id?: string | null;
  listing_group_name?: string | null;
  has_multi_qty?: boolean;
  is_drained_multi_qty?: boolean;
  any_listing_id?: string | null;
}

interface ListingFilterOptions {
  platforms: string[];
  grades: string[];
  companies: string[];
  part_numbers: string[];
  num_listed: string[];
  num_sold: string[];
  card_names: string[];
  prices: string[];
  order_url_count: number;
}

interface SlabResult {
  id: string;
  card_name: string | null;
  set_name: string | null;
  company: string | null;
  grade_label: string | null;
  cert_number: string | null;
  currency: string;
  raw_purchase_date: string | null;
  is_listed: boolean;
  is_card_show: boolean;
  is_personal_collection: boolean;
  sku: string | null;
}

function slabDedupeKey(s: { sku?: string | null; card_name: string | null }): string {
  return s.sku ?? (s.card_name ?? 'Unknown').toLowerCase();
}

interface RawCardResult {
  id: string;
  card_name: string | null;
  set_name: string | null;
  card_number: string | null;
  condition: string | null;
  quantity: number;
  purchase_cost: number | null;
  currency: string;
  raw_purchase_label: string | null;
  is_listed: boolean;
}

type SortDir = 'asc' | 'desc';

// ── Set Slot ──────────────────────────────────────────────────────────────────

type SetSlot = { cardName: string | null; cardKey: string | null; slab: SlabResult | null };

function SetSlotRow({
  index,
  slot,
  takenIds,
  onUpdate,
}: {
  index: number;
  slot: SetSlot;
  takenIds: Set<string>;
  onUpdate: (slot: SetSlot) => void;
}) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(!slot.slab); // collapsed once cert picked

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: searchData, isFetching: isSearching } = useQuery<PaginatedResult<SlabResult>>({
    queryKey: ['set-slot-search', index, debounced],
    queryFn: () => api.get('/grading/slabs', {
      params: { search: debounced, limit: 100, status: 'unsold', sort_by: 'card_name', sort_dir: 'asc', personal_collection: 'no' },
    }).then(r => r.data),
    enabled: debounced.length >= 2 && !slot.cardName,
  });

  const { data: copiesData, isFetching: isLoadingCopies } = useQuery<PaginatedResult<SlabResult>>({
    queryKey: ['set-slot-copies', index, slot.cardName],
    queryFn: () => api.get('/grading/slabs', {
      params: { search: slot.cardName, limit: 200, status: 'unsold', sort_by: 'cert_number', sort_dir: 'asc', personal_collection: 'no' },
    }).then(r => r.data),
    enabled: !!slot.cardName && !slot.slab,
  });

  const uniqueNames = searchData
    ? Array.from(searchData.data.reduce((m, s) => {
        const key = slabDedupeKey(s);
        const name = s.card_name ?? '';
        const cur = m.get(key) ?? { name, count: 0, onShow: 0 };
        cur.count += 1;
        if (s.is_card_show) cur.onShow += 1;
        if (name.length > cur.name.length) cur.name = name;
        m.set(key, cur);
        return m;
      }, new Map<string, { name: string; count: number; onShow: number }>())).filter(([k, v]) => k && v.count > 0)
    : [];

  // Sort non-card-show certs first so on-show ones drop to the bottom of the picker.
  const copies = (copiesData?.data ?? [])
    .filter(c => slot.cardKey != null && slabDedupeKey(c) === slot.cardKey && !c.is_listed && !c.is_personal_collection)
    .sort((a, b) => Number(a.is_card_show) - Number(b.is_card_show));

  // Collapsed state — cert has been picked
  if (slot.slab && !open) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-zinc-700/40 bg-zinc-800/30">
        <div className="w-4 h-4 rounded-full bg-indigo-500 shrink-0 flex items-center justify-center">
          <span className="text-[8px] text-white font-bold">✓</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-zinc-200 truncate">{slot.slab.card_name}</p>
          <p className="text-[10px] text-zinc-500 font-mono">{formatCertNumber(slot.slab.cert_number)} · {slot.slab.grade_label}</p>
        </div>
        <button type="button" onClick={() => setOpen(true)}
          className="text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors shrink-0">
          Change
        </button>
        <button type="button" onClick={() => onUpdate({ cardName: null, cardKey: null, slab: null })}
          className="text-zinc-600 hover:text-red-400 transition-colors shrink-0">
          <X size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-700/50 bg-zinc-800/20 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/60">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wide font-medium">Card {index + 1}</span>
        {slot.cardName && (
          <button type="button" onClick={() => { onUpdate({ cardName: null, cardKey: null, slab: null }); setSearch(''); }}
            className="text-[10px] text-zinc-600 hover:text-zinc-300 transition-colors">
            ← Change card
          </button>
        )}
      </div>

      <div className="p-2.5 space-y-2">
        {/* Card search */}
        {!slot.cardName ? (
          <>
            <div className="relative">
              <input
                type="text" placeholder="Search card name or cert #…" value={search}
                onChange={(e) => setSearch(e.target.value)} autoFocus={index === 0}
                className="w-full px-2.5 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
              />
              {isSearching && <Loader2 size={11} className="absolute right-2 top-2 animate-spin text-zinc-500" />}
            </div>
            {debounced.length >= 2 && (
              uniqueNames.length > 0 ? (
                <div className="rounded border border-zinc-700/50 overflow-hidden max-h-36 overflow-y-auto">
                  {uniqueNames.map(([key, v]) => (
                    <button key={key} type="button"
                      className="w-full text-left px-3 py-2 hover:bg-zinc-700/40 border-b border-zinc-700/30 last:border-0 flex items-center justify-between gap-2 transition-colors"
                      onClick={() => { onUpdate({ cardName: v.name, cardKey: key, slab: null }); setSearch(''); }}>
                      <span className="text-xs text-zinc-200 truncate">{v.name}</span>
                      <span className="shrink-0 flex items-center gap-1.5">
                        {v.onShow > 0 && (
                          <span className="text-[9px] font-bold uppercase tracking-wide bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30 rounded px-1 py-0.5 tabular-nums">{v.onShow} on show</span>
                        )}
                        <span className="text-[10px] text-zinc-500 tabular-nums">{v.count} unsold</span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : !isSearching ? (
                <p className="text-[11px] text-zinc-600 px-1">No results.</p>
              ) : null
            )}
          </>
        ) : (
          /* Cert picker */
          <>
            <p className="text-xs text-zinc-300 font-medium truncate px-0.5">{slot.cardName}</p>
            {isLoadingCopies ? (
              <div className="flex items-center gap-1.5 py-1 text-[11px] text-zinc-600">
                <Loader2 size={11} className="animate-spin" /> Loading certs…
              </div>
            ) : copies.length === 0 ? (
              <p className="text-[11px] text-zinc-600 py-1">No unlisted copies available.</p>
            ) : (
              <div className="divide-y divide-zinc-800/60 rounded border border-zinc-700/40 overflow-hidden max-h-40 overflow-y-auto">
                {copies.map(copy => {
                  const isPickedHere = slot.slab?.id === copy.id;
                  const takenElsewhere = !isPickedHere && takenIds.has(copy.id);
                  return (
                    <button key={copy.id} type="button" disabled={takenElsewhere}
                      onClick={() => { onUpdate({ cardName: slot.cardName, cardKey: slot.cardKey, slab: copy }); setOpen(false); }}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${
                        takenElsewhere ? 'opacity-25 cursor-not-allowed' :
                        isPickedHere ? 'bg-indigo-500/10' : 'hover:bg-zinc-700/30'
                      }`}>
                      <div className={`w-3 h-3 rounded-full border shrink-0 flex items-center justify-center transition-colors ${isPickedHere ? 'bg-indigo-500 border-indigo-500' : 'border-zinc-600'}`}>
                        {isPickedHere && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                      <span className="font-mono text-xs text-zinc-200">{formatCertNumber(copy.cert_number)}</span>
                      <span className="text-[11px] text-zinc-500">{copy.grade_label}</span>
                      {copy.is_card_show && (
                        <span className="ml-auto text-[9px] font-bold uppercase tracking-wide bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30 rounded px-1 py-0.5">On Show</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Add Listing Modal ─────────────────────────────────────────────────────────

function AddListingModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'type' | 'sub-type' | 'set-count' | 'search' | 'quantity' | 'details' | 'set-search' | 'set-details' | 'raw-search' | 'raw-select'>('type');
  const [listingMode, setListingMode] = useState<'single' | 'set' | 'raw'>('single');

  // Step: search (single)
  const [cardSearch, setCardSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedCardName, setSelectedCardName] = useState<string | null>(null);
  const [selectedCardKey, setSelectedCardKey] = useState<string | null>(null);

  // Step: quantity (single)
  const [qty, setQty] = useState(1);
  const [selectedGrade, setSelectedGrade] = useState<string | null>(null);
  const [customSelected, setCustomSelected] = useState<Set<string>>(new Set());

  // Set mode
  const [setTargetCount, setSetTargetCount] = useState('');
  const [setSlotList, setSetSlotList] = useState<SetSlot[]>([]);

  // Raw mode
  const [rawSearch, setRawSearch] = useState('');
  const [debouncedRawSearch, setDebouncedRawSearch] = useState('');
  const [selectedRawCardName, setSelectedRawCardName] = useState<string | null>(null);
  const [selectedRawIds, setSelectedRawIds] = useState<Set<string>>(new Set());

  // Step: details (shared)
  const [price, setPrice] = useState('');
  const [listedAt, setListedAt] = useState('');
  const [ebayUrl, setEbayUrl] = useState('');
  const [setGroupName, setSetGroupName] = useState('');
  const [isMultiQty, setIsMultiQty] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(cardSearch), 300);
    return () => clearTimeout(t);
  }, [cardSearch]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedRawSearch(rawSearch), 300);
    return () => clearTimeout(t);
  }, [rawSearch]);

  // Reset grade + qty + custom when card selection changes
  useEffect(() => {
    setSelectedGrade(null);
    setQty(1);
    setCustomSelected(new Set());
  }, [selectedCardName]);

  // Phase 1: search for unique card names (single mode)
  const { data: searchResults, isFetching: isSearching } = useQuery<PaginatedResult<SlabResult>>({
    queryKey: ['listing-card-search', debouncedSearch],
    queryFn: () => api.get('/grading/slabs', {
      params: { search: debouncedSearch, limit: 100, status: 'unsold', sort_by: 'card_name', sort_dir: 'asc', personal_collection: 'no' },
    }).then(r => r.data),
    enabled: debouncedSearch.length >= 2 && step === 'search',
  });

  // Phase 2: fetch all unsold copies of selected card (single mode)
  const { data: copiesResult, isFetching: isLoadingCopies } = useQuery<PaginatedResult<SlabResult>>({
    queryKey: ['listing-copies', selectedCardName],
    queryFn: () => api.get('/grading/slabs', {
      params: { search: selectedCardName, limit: 200, status: 'unsold', sort_by: 'cert_number', sort_dir: 'asc', personal_collection: 'no' },
    }).then(r => r.data),
    enabled: !!selectedCardName && (step === 'quantity' || step === 'details'),
  });


  // Raw card search
  const { data: rawResults, isFetching: isRawSearching } = useQuery<PaginatedResult<RawCardResult>>({
    queryKey: ['listing-raw-search', debouncedRawSearch],
    queryFn: () => api.get('/cards', {
      params: { search: debouncedRawSearch, decision: 'sell_raw', status: 'purchased_raw,inspected,raw_for_sale', limit: 100, sort_by: 'card_name', sort_dir: 'asc', is_personal_collection: 'no' },
    }).then(r => r.data),
    enabled: debouncedRawSearch.length >= 2 && (step === 'raw-search' || step === 'raw-select'),
  });

  const allCopies = copiesResult?.data.filter(c => selectedCardKey != null && slabDedupeKey(c) === selectedCardKey) ?? [];
  const availableCopies = allCopies.filter(c => !c.is_listed && !c.is_personal_collection);

  const gradeBreakdown = availableCopies.reduce((map, c) => {
    const key = c.grade_label ?? 'Ungraded';
    map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  }, new Map<string, number>());

  const gradeKeys = Array.from(gradeBreakdown.keys());
  const activeGrade = selectedGrade ?? gradeKeys[0] ?? null;
  const copiesForGrade = availableCopies.filter(c => (c.grade_label ?? 'Ungraded') === activeGrade);
  // FIFO auto-pick prefers certs NOT already in card show inventory to avoid double-listing
  const fifoOrdered = [...copiesForGrade].sort((a, b) => Number(a.is_card_show) - Number(b.is_card_show));
  const fifoIds = new Set(fifoOrdered.slice(0, qty).map(c => c.id));
  const effectiveIds = customSelected.size > 0 ? customSelected : fifoIds;
  const selectedCopies = copiesForGrade.filter(c => effectiveIds.has(c.id));

  // Auto-check multi-qty the moment the user selects 2+ certs on a single-
  // slab listing — that IS a multi-qty listing on eBay's side. Only fires
  // on the 1→2 transition so an explicit uncheck in the details step sticks
  // even if the user later adds a 3rd cert.
  const prevSelectedCountRef = useRef(0);
  useEffect(() => {
    if (listingMode !== 'single') return;
    if (prevSelectedCountRef.current < 2 && selectedCopies.length >= 2) {
      setIsMultiQty(true);
    }
    prevSelectedCountRef.current = selectedCopies.length;
  }, [selectedCopies.length, listingMode]);

  // Derived set slabs (only slots with a cert picked)
  const setSlabs = setSlotList.map(s => s.slab).filter((s): s is SlabResult => s != null);
  const takenSetIds = new Set(setSlabs.map(s => s.id));

  // Dedupe by sku (falls back to lowercased card_name when unlinked).
  // Without this, casing-only variations of card_name_override — like
  // "...Charmander" vs "...CHARMANDER" — split a single part number into
  // two suggestions and miscount the unsold totals. We track every variant
  // and surface the longest one as the canonical display name.
  const uniqueCardNames = searchResults
    ? Array.from(
        searchResults.data.reduce((map, s) => {
          const key = slabDedupeKey(s);
          const name = s.card_name ?? 'Unknown';
          const cur = map.get(key) ?? { name, count: 0, onShow: 0 };
          cur.count += 1;
          if (s.is_card_show) cur.onShow += 1;
          if (name.length > cur.name.length) cur.name = name;
          map.set(key, cur);
          return map;
        }, new Map<string, { name: string; count: number; onShow: number }>())
      ).filter(([, v]) => v.count > 0)
    : [];

  // Raw: group by card name, then per-instance selector
  const uniqueRawCardNames = rawResults
    ? Array.from(
        rawResults.data.reduce((map, c) => {
          if (c.is_listed) return map;
          const name = c.card_name ?? 'Unknown';
          map.set(name, (map.get(name) ?? 0) + 1);
          return map;
        }, new Map<string, number>())
      )
    : [];
  const rawCopiesForName = (rawResults?.data ?? []).filter(c => c.card_name === selectedRawCardName && !c.is_listed);
  const selectedRawCards = rawCopiesForName.filter(c => selectedRawIds.has(c.id));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!price) { toast.error('Enter a list price'); return; }
    setSubmitting(true);
    try {
      let instancesToList: { id: string }[];
      if (listingMode === 'raw') {
        if (selectedRawCards.length === 0) { toast.error('No card selected'); setSubmitting(false); return; }
        instancesToList = selectedRawCards;
      } else {
        instancesToList = listingMode === 'set' ? setSlabs : selectedCopies;
        if (instancesToList.length === 0) { toast.error('No copies selected'); setSubmitting(false); return; }
      }
      // For set listings, divide the total price evenly per card
      const perCardPrice = listingMode === 'set' && instancesToList.length > 1
        ? (parseFloat(price) / instancesToList.length).toFixed(2)
        : price;
      const setGroupId = listingMode === 'set' ? crypto.randomUUID() : undefined;
      // Multi-qty flag only meaningful for single-slab graded mode with a
      // shared eBay URL and 2+ certs. Set-mode already groups via
      // listing_group_id; raw mode collapses under listing_group_id too.
      const multiQtyFlag = listingMode === 'single' && isMultiQty && instancesToList.length >= 1;
      await Promise.all(instancesToList.map(copy =>
        api.post('/listings', {
          card_instance_id: copy.id,
          platform: 'ebay',
          list_price: perCardPrice,
          currency: 'USD',
          listed_at: listedAt || undefined,
          ebay_listing_url: ebayUrl || undefined,
          listing_group_id: setGroupId,
          listing_group_name: listingMode === 'set' && setGroupName ? setGroupName : undefined,
          is_multi_qty: multiQtyFlag || undefined,
        })
      ));
      const n = instancesToList.length;
      toast.success(n === 1 ? 'Listing recorded!' : `${n} listings recorded!`);
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      queryClient.invalidateQueries({ queryKey: ['raw-inventory-grouped'] });
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to create listing');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Step: type ───────────────────────────────────────────────────────────

  if (step === 'type') return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">What type of inventory are you listing?</p>
      <div className="grid grid-cols-2 gap-3">
        <button type="button"
          onClick={() => setStep('sub-type')}
          className="rounded-xl border-2 border-indigo-500 bg-indigo-500/10 px-4 py-5 text-left hover:bg-indigo-500/20 transition-colors">
          <p className="text-sm font-semibold text-indigo-300">Graded</p>
          <p className="text-xs text-zinc-500 mt-0.5">PSA, BGS, CGC slabs</p>
        </button>
        <button type="button"
          onClick={() => { setListingMode('raw'); setStep('raw-search'); }}
          className="rounded-xl border-2 border-zinc-600 bg-zinc-800/40 px-4 py-5 text-left hover:bg-zinc-700/40 hover:border-zinc-500 transition-colors">
          <p className="text-sm font-semibold text-zinc-200">Raw</p>
          <p className="text-xs text-zinc-500 mt-0.5">Ungraded cards</p>
        </button>
      </div>
      <div className="flex justify-end pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );

  // ── Step: sub-type ───────────────────────────────────────────────────────

  if (step === 'sub-type') return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setStep('type')} className="text-xs text-zinc-500 hover:text-zinc-300">← Back</button>
        <span className="text-xs text-zinc-600">Graded</span>
      </div>
      <p className="text-xs text-zinc-500">Single slab or a set?</p>
      <div className="grid grid-cols-2 gap-3">
        <button type="button"
          onClick={() => { setListingMode('single'); setStep('search'); }}
          className="rounded-xl border-2 border-indigo-500 bg-indigo-500/10 px-4 py-5 text-left hover:bg-indigo-500/20 transition-colors">
          <p className="text-sm font-semibold text-indigo-300">Single Slab</p>
          <p className="text-xs text-zinc-500 mt-0.5">One card per listing</p>
        </button>
        <button type="button"
          onClick={() => { setListingMode('set'); setStep('set-count'); }}
          className="rounded-xl border-2 border-zinc-600 bg-zinc-800/40 px-4 py-5 text-left hover:bg-zinc-700/40 hover:border-zinc-500 transition-colors">
          <p className="text-sm font-semibold text-zinc-200">Set</p>
          <p className="text-xs text-zinc-500 mt-0.5">Multiple slabs, one listing</p>
        </button>
      </div>
      <div className="flex justify-end pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );

  // ── Step: search (single) ────────────────────────────────────────────────

  if (step === 'search') return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setStep('sub-type')} className="text-xs text-zinc-500 hover:text-zinc-300">← Back</button>
        <span className="text-xs text-zinc-600">Graded · Single Slab</span>
      </div>
      <div className="relative">
        <Input label="Search Card" placeholder="Card name or part number…"
          value={cardSearch} onChange={(e) => setCardSearch(e.target.value)}
          autoComplete="off" autoFocus />
        {isSearching && <Loader2 size={13} className="absolute right-3 top-[30px] animate-spin text-zinc-500" />}
      </div>

      {debouncedSearch.length >= 2 && (
        uniqueCardNames.length > 0 ? (
          <div className="rounded-lg border border-zinc-700 overflow-hidden">
            {uniqueCardNames.map(([key, v]) => (
              <button key={key} type="button"
                className="w-full text-left px-4 py-3 hover:bg-zinc-800 border-b border-zinc-700/40 last:border-0 flex items-start justify-between gap-3 transition-colors"
                onClick={() => { setSelectedCardName(v.name); setSelectedCardKey(key); setQty(1); setStep('quantity'); }}>
                <span className="text-sm text-zinc-200 break-words leading-snug">{v.name}</span>
                <span className="shrink-0 flex items-center gap-1.5 mt-0.5">
                  {v.onShow > 0 && (
                    <span className="text-[9px] font-bold uppercase tracking-wide bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30 rounded px-1 py-0.5 tabular-nums">{v.onShow} on show</span>
                  )}
                  <span className="text-[10px] text-zinc-500 font-mono tabular-nums">{v.count} unsold</span>
                </span>
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

  // ── Step: quantity (single) ──────────────────────────────────────────────

  if (step === 'quantity') return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 min-w-0">
        <button type="button" onClick={() => { setStep('search'); setSelectedCardName(null); setSelectedCardKey(null); }}
          className="text-xs text-zinc-500 hover:text-zinc-300 shrink-0">← Back</button>
        <p className="text-xs font-medium text-zinc-300 truncate">{selectedCardName}</p>
      </div>

      {isLoadingCopies ? (
        <div className="flex items-center justify-center py-8 text-zinc-600 text-sm">
          <Loader2 size={16} className="animate-spin mr-2" /> Loading copies…
        </div>
      ) : availableCopies.length === 0 ? (
        <div className="py-4 text-center space-y-1">
          <p className="text-sm text-zinc-500">No unlisted copies available.</p>
        </div>
      ) : (
        <>
          {gradeKeys.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {gradeKeys.map(grade => (
                <button key={grade} type="button"
                  onClick={() => { setSelectedGrade(grade); setQty(1); setCustomSelected(new Set()); }}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                    activeGrade === grade
                      ? 'border-indigo-500 bg-indigo-500/15 text-indigo-300'
                      : 'border-zinc-700 bg-zinc-800/40 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
                  }`}>
                  {grade}
                  <span className={`ml-1.5 tabular-nums ${activeGrade === grade ? 'text-indigo-400' : 'text-zinc-600'}`}>
                    {gradeBreakdown.get(grade)}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/50 p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-xs text-zinc-400">
                  <span className="font-medium text-zinc-200 tabular-nums">{copiesForGrade.length}</span>{' '}
                  unlisted {activeGrade ?? ''} {copiesForGrade.length === 1 ? 'copy' : 'copies'}
                  {copiesForGrade.some(c => c.is_card_show) && (
                    <span className="ml-1.5 text-fuchsia-300 tabular-nums">· {copiesForGrade.filter(c => c.is_card_show).length} on show</span>
                  )}
                </p>
                {allCopies.some(c => c.is_listed) && (
                  <p className="text-[10px] text-zinc-600">{allCopies.filter(c => c.is_listed).length} already listed</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setQty(q => Math.max(1, q - 1))}
                    className="w-8 h-8 rounded-lg bg-zinc-700 hover:bg-zinc-600 flex items-center justify-center text-zinc-200 transition-colors">
                    <Minus size={14} />
                  </button>
                  <span className="text-xl font-bold text-zinc-100 w-6 text-center tabular-nums">{qty}</span>
                  <button type="button" onClick={() => setQty(q => Math.min(copiesForGrade.length, q + 1))}
                    className="w-8 h-8 rounded-lg bg-zinc-700 hover:bg-zinc-600 flex items-center justify-center text-zinc-200 transition-colors">
                    <Plus size={14} />
                  </button>
                </div>
                <span className={`text-[10px] tabular-nums ${effectiveIds.size >= qty ? 'text-indigo-400' : 'text-zinc-500'}`}>
                  {effectiveIds.size} / {qty} selected
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {copiesForGrade.map((copy) => {
              const isSelected = effectiveIds.has(copy.id);
              const atLimit = !isSelected && effectiveIds.size >= qty;
              const isFifo = customSelected.size === 0 && fifoIds.has(copy.id);
              const certLabel = formatCertNumber(copy.cert_number);
              return (
                <div key={copy.id}
                  onClick={() => setCustomSelected(() => {
                    const next = new Set(effectiveIds);
                    if (next.has(copy.id)) {
                      next.delete(copy.id);
                    } else if (next.size >= qty) {
                      // Swap: drop the first-inserted entry and add this one
                      const first = next.values().next().value;
                      if (first) next.delete(first);
                      next.add(copy.id);
                    } else {
                      next.add(copy.id);
                    }
                    return next;
                  })}
                  className={`rounded-lg border px-3 py-2 flex items-center gap-2 transition-colors cursor-pointer ${
                    isSelected ? 'border-indigo-500/40 bg-indigo-500/8'
                    : atLimit ? 'border-zinc-700/30 bg-zinc-800/20 opacity-40 hover:opacity-80'
                    : 'border-zinc-700/30 bg-zinc-800/20 opacity-50 hover:opacity-80'
                  }`}>
                  <div className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center transition-colors ${isSelected ? 'bg-indigo-500 border-indigo-500' : 'border-zinc-600'}`}>
                    {isSelected && <span className="text-[8px] text-white font-bold">✓</span>}
                  </div>
                  {isFifo && (
                    <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded px-1 py-0.5">FIFO</span>
                  )}
                  {copy.is_card_show && (
                    <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30 rounded px-1 py-0.5">On Show</span>
                  )}
                  <span className="text-sm font-mono text-zinc-200">{certLabel}</span>
                  {isSelected && <span className="ml-auto text-[10px] text-indigo-400 font-medium">Will list</span>}
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" disabled={selectedCopies.length === 0} onClick={() => setStep('details')}>
          Continue →
        </Button>
      </div>
    </div>
  );

  // ── Step: raw-search ─────────────────────────────────────────────────────

  if (step === 'raw-search') return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setStep('type')} className="text-xs text-zinc-500 hover:text-zinc-300">← Back</button>
        <span className="text-xs text-zinc-600">Raw</span>
      </div>
      <div className="relative">
        <Input label="Search Card" placeholder="Card name, part number, or purchase ID…"
          value={rawSearch} onChange={(e) => setRawSearch(e.target.value)}
          autoComplete="off" autoFocus />
        {isRawSearching && <Loader2 size={13} className="absolute right-3 top-[30px] animate-spin text-zinc-500" />}
      </div>

      {debouncedRawSearch.length >= 2 && (
        uniqueRawCardNames.length > 0 ? (
          <div className="rounded-lg border border-zinc-700 overflow-hidden">
            {uniqueRawCardNames.map(([name, count]) => (
              <button key={name} type="button"
                className="w-full text-left px-4 py-3 hover:bg-zinc-800 border-b border-zinc-700/40 last:border-0 transition-colors"
                onClick={() => { setSelectedRawCardName(name); setSelectedRawIds(new Set()); setStep('raw-select'); }}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-zinc-200 truncate">{name}</span>
                  <span className="shrink-0 text-[10px] text-zinc-500 tabular-nums">{count} card{count !== 1 ? 's' : ''}</span>
                </div>
              </button>
            ))}
          </div>
        ) : !isRawSearching ? (
          <p className="text-xs text-zinc-500 px-1">No raw cards found for sale.</p>
        ) : null
      )}

      <div className="flex justify-end pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );

  // ── Step: raw-select ─────────────────────────────────────────────────────

  if (step === 'raw-select') return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 min-w-0">
        <button type="button" onClick={() => { setStep('raw-search'); setSelectedRawCardName(null); }}
          className="text-xs text-zinc-500 hover:text-zinc-300 shrink-0">← Back</button>
        <p className="text-xs font-medium text-zinc-300 truncate">{selectedRawCardName}</p>
      </div>

      <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
        {rawCopiesForName.map((copy) => {
          const isSelected = selectedRawIds.has(copy.id);
          return (
            <div key={copy.id}
              onClick={() => setSelectedRawIds((prev) => {
                const next = new Set(prev);
                if (next.has(copy.id)) { next.delete(copy.id); } else { next.add(copy.id); }
                return next;
              })}
              className={`rounded-lg border px-3 py-2 flex items-center gap-2 cursor-pointer transition-colors ${
                isSelected ? 'border-indigo-500/40 bg-indigo-500/8' : 'border-zinc-700/30 bg-zinc-800/20 opacity-50 hover:opacity-70'
              }`}>
              <div className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center transition-colors ${isSelected ? 'bg-indigo-500 border-indigo-500' : 'border-zinc-600'}`}>
                {isSelected && <span className="text-[8px] text-white font-bold">✓</span>}
              </div>
              <span className="text-sm font-mono text-zinc-200">{copy.raw_purchase_label ?? '—'}</span>
              {copy.condition && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-700/60 text-zinc-300">{copy.condition}</span>}
              <span className="text-[10px] text-zinc-500">{copy.quantity} card{copy.quantity !== 1 ? 's' : ''}</span>
              {isSelected && <span className="ml-auto text-[10px] text-indigo-400 font-medium">Will list</span>}
            </div>
          );
        })}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" disabled={selectedRawIds.size === 0} onClick={() => setStep('details')}>
          Continue →
        </Button>
      </div>
    </div>
  );

  // ── Step: set-count ──────────────────────────────────────────────────────

  if (step === 'set-count') return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setStep('sub-type')} className="text-xs text-zinc-500 hover:text-zinc-300">← Back</button>
        <span className="text-xs text-zinc-600">Graded · Set</span>
      </div>
      <p className="text-sm text-zinc-300">How many slabs are in this set?</p>
      <input
        type="number" min={2} max={50} placeholder="e.g. 5"
        value={setTargetCount}
        onChange={(e) => setSetTargetCount(e.target.value)}
        autoFocus
        className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button"
          disabled={!setTargetCount || parseInt(setTargetCount) < 2}
          onClick={() => {
            const n = parseInt(setTargetCount);
            setSetSlotList(Array.from({ length: n }, () => ({ cardName: null, cardKey: null, slab: null })));
            setStep('set-search');
          }}>
          Continue →
        </Button>
      </div>
    </div>
  );

  // ── Step: set-search ─────────────────────────────────────────────────────

  if (step === 'set-search') return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setStep('set-count')} className="text-xs text-zinc-500 hover:text-zinc-300">← Back</button>
          <span className="text-xs text-zinc-600">Graded · Set</span>
        </div>
        <span className="text-xs text-zinc-500 tabular-nums">
          {setSlabs.length} / {setSlotList.length} ready
        </span>
      </div>

      <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
        {setSlotList.map((slot, idx) => (
          <SetSlotRow
            key={idx}
            index={idx}
            slot={slot}
            takenIds={takenSetIds}
            onUpdate={(updated) => setSetSlotList(prev => prev.map((s, i) => i === idx ? updated : s))}
          />
        ))}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button"
          disabled={setSlabs.length < 2 || setSlabs.length !== setSlotList.length}
          onClick={() => setStep('set-details')}>
          Continue → ({setSlabs.length}/{setSlotList.length} ready)
        </Button>
      </div>
    </div>
  );

  // ── Step: details (shared for single + set + raw) ────────────────────────

  const detailsBackStep = (listingMode === 'set' ? 'set-search' : listingMode === 'raw' ? 'raw-select' : 'quantity') as typeof step;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Summary */}
      <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/50 px-4 py-3 space-y-1">
        {listingMode === 'set' ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-zinc-100">Set — {setSlabs.length} slabs</p>
              <button type="button" onClick={() => setStep('set-search')} className="text-[11px] text-indigo-400 hover:text-indigo-300 shrink-0">Change</button>
            </div>
            <div className="space-y-0.5 max-h-28 overflow-y-auto">
              {setSlabs.map(s => (
                <p key={s.id} className="text-[11px] text-zinc-500 truncate">
                  {s.card_name} · <span className="font-mono">{formatCertNumber(s.cert_number)}</span> · {s.grade_label}
                </p>
              ))}
            </div>
          </>
        ) : listingMode === 'raw' && selectedRawCards.length > 0 ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-zinc-100 truncate">{selectedRawCardName ?? 'Unknown'}</p>
              <button type="button" onClick={() => setStep('raw-select')} className="text-[11px] text-indigo-400 hover:text-indigo-300 shrink-0">Change</button>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-zinc-500 flex-wrap">
              {selectedRawCards[0].set_name && <span>{selectedRawCards[0].set_name}</span>}
              {selectedRawCards[0].card_number && <span className="font-mono">{selectedRawCards[0].card_number}</span>}
              {selectedRawCards[0].condition && (
                <span className="font-medium px-1.5 py-0.5 rounded bg-zinc-700/60 text-zinc-300">{selectedRawCards[0].condition}</span>
              )}
              <span>{selectedRawCards.reduce((s, c) => s + c.quantity, 0)} card{selectedRawCards.reduce((s, c) => s + c.quantity, 0) !== 1 ? 's' : ''}</span>
            </div>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              ID{selectedRawCards.length !== 1 ? 's' : ''}: {selectedRawCards.map(c => c.raw_purchase_label ?? '—').join(', ')}
            </p>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-zinc-100 truncate">{selectedCardName}</p>
              <button type="button" onClick={() => setStep('quantity')} className="text-[11px] text-indigo-400 hover:text-indigo-300 shrink-0">Change</button>
            </div>
            <p className="text-[11px] text-zinc-500">
              Listing {selectedCopies.length} cert{selectedCopies.length !== 1 ? 's' : ''}:
              {' '}{selectedCopies.map(c => formatCertNumber(c.cert_number)).join(', ')}
            </p>
          </>
        )}
      </div>

      {listingMode === 'set' && (
        <Input label="Set Name" placeholder="e.g. Shining Legends Set, Rainbow Rares…"
          value={setGroupName} onChange={(e) => setSetGroupName(e.target.value)} autoFocus />
      )}

      <div>
        <Input label="eBay Listing URL" type="url" placeholder="https://www.ebay.com/itm/…"
          value={ebayUrl} onChange={(e) => setEbayUrl(e.target.value)} />
        {ebayUrl && isEbayOrderUrl(ebayUrl) && (
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-amber-400">
            <AlertTriangle size={11} />
            This looks like a sold order URL, not a listing URL. Listing URLs contain <span className="font-mono">/itm/</span>.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input label={listingMode === 'set' ? 'Set Price (total)' : 'List Price'} type="text" inputMode="decimal" placeholder="0.00"
          value={price} onChange={(e) => setPrice(e.target.value)} />
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Listed Date</label>
          <input type="date" value={listedAt} onChange={(e) => setListedAt(e.target.value)}
            className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors [color-scheme:dark]" />
        </div>
      </div>

      {listingMode === 'single' && (
        <label className="flex items-start gap-2 rounded-lg bg-zinc-800/40 border border-zinc-700/40 px-3 py-2 cursor-pointer hover:border-zinc-600 transition-colors">
          <input type="checkbox" checked={isMultiQty} onChange={(e) => setIsMultiQty(e.target.checked)}
            className="mt-0.5 accent-indigo-500" />
          <div className="text-[11px] leading-relaxed">
            <span className="text-zinc-200 font-medium">Multi-qty listing (eBay-style)</span>
            <p className="text-zinc-500 mt-0.5">
              One eBay listing carrying multiple certs of the same card. Lets you add more certs to it later (like bumping qty on eBay) without creating a new listing.
            </p>
          </div>
        </label>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={() => setStep(detailsBackStep)}>Back</Button>
        <Button type="submit" disabled={submitting || (listingMode === 'raw' ? selectedRawCards.length === 0 : listingMode === 'set' ? setSlabs.length === 0 : selectedCopies.length === 0)}>
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {submitting ? 'Recording…' : listingMode === 'set' ? `Record Set (${setSlabs.length} slabs)` : listingMode === 'raw' ? 'Record Listing' : `Record ${qty > 1 ? `${qty} Listings` : 'Listing'}`}
        </Button>
      </div>
    </form>
  );
}

// ── Edit Listing Modal ────────────────────────────────────────────────────────

interface CandidateCert {
  id: string;
  card_name: string | null;
  cert_number: string | null;
  grade_label: string | null;
  company: string | null;
  purchase_cost: number;
}

function AddCertsToListingModal({ listingId, listingLabel, onClose, onAdded }: { listingId: string; listingLabel: string; onClose: () => void; onAdded: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const { data, isLoading } = useQuery<{ data: CandidateCert[] }>({
    queryKey: ['listing-candidate-certs', listingId],
    queryFn: () => api.get(`/listings/${listingId}/candidate-certs`).then(r => r.data),
  });

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    if (selected.size === 0) { toast.error('Pick at least one cert'); return; }
    setSubmitting(true);
    try {
      const res = await api.post(`/listings/${listingId}/certs`, { card_instance_ids: Array.from(selected) });
      toast.success(`${res.data.added} cert${res.data.added !== 1 ? 's' : ''} added`);
      onAdded();
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to add certs');
    } finally {
      setSubmitting(false);
    }
  }

  const rows = data?.data ?? [];
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-500 leading-relaxed">
        Adding to <span className="text-zinc-300 font-medium">{listingLabel}</span>. Only unsold slabs of the same catalog card, not already on another active listing, appear here.
      </p>
      <div className="border border-zinc-800 rounded-lg max-h-72 overflow-y-auto divide-y divide-zinc-800/60">
        {isLoading ? (
          <p className="px-3 py-4 text-[11px] text-zinc-600 text-center">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-4 text-[11px] text-zinc-600 text-center">No eligible certs. Add or grade more slabs of this card first.</p>
        ) : (
          rows.map(c => {
            const isSel = selected.has(c.id);
            return (
              <button key={c.id} type="button" onClick={() => toggle(c.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${isSel ? 'bg-indigo-500/10' : 'hover:bg-zinc-800/40'}`}>
                <div className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center ${isSel ? 'bg-indigo-500 border-indigo-500' : 'border-zinc-600'}`}>
                  {isSel && <span className="text-[8px] text-white font-bold">✓</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-[11px]">
                    {c.cert_number && <span className="font-mono text-indigo-300/70">{formatCertNumber(c.cert_number)}</span>}
                    {c.company && <span className="text-zinc-400">{c.company}</span>}
                    {c.grade_label && <span className="text-zinc-300">{c.grade_label}</span>}
                    <span className="ml-auto text-zinc-500">Cost {formatCurrency(c.purchase_cost, 'USD')}</span>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
      <div className="flex justify-between items-center pt-1">
        <span className="text-[11px] text-zinc-500">{selected.size} selected</span>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={submitting || selected.size === 0} onClick={handleSubmit}>
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {submitting ? 'Adding…' : `Add ${selected.size || ''} cert${selected.size !== 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function EditListingModal({ row, cert, onClose }: { row: AggregatedListing; cert?: CertDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const isSet = !!row.listing_group_id;
  // When opened from a sub-row click on a non-set row, scope to just that one
  // listing. The shared bottom URL/Price are used as the single-listing inputs.
  // Sets keep batch behavior (one URL + total price across components).
  const singleListingId = (!isSet && cert?.listing_id) ? cert.listing_id : null;
  const initialPrice = singleListingId && cert?.list_price != null
    ? (cert.list_price / 100).toFixed(2)
    : row.list_price != null ? (row.list_price / 100).toFixed(2) : '';
  const initialUrl = singleListingId
    ? (cert?.ebay_listing_url ?? '')
    : (row.ebay_listing_url ?? '');
  const [price, setPrice] = useState(initialPrice);
  const [ebayUrl, setEbayUrl] = useState(initialUrl);
  const [setName, setSetName] = useState(row.listing_group_name ?? '');
  const [saving, setSaving] = useState(false);
  const [deleteStep, setDeleteStep] = useState<null | 'confirm' | 'deleting'>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [addCertOpen, setAddCertOpen] = useState(false);
  const [promoting, setPromoting] = useState(false);
  // Scoped to the clicked cert when single-listing mode; otherwise full list.
  const [localCerts, setLocalCerts] = useState(
    singleListingId ? [cert!] : (row.cert_details ?? [])
  );

  // Any cert row on this listing group can serve as the parent for multi-qty
  // ops — the server treats them all as the same group. Prefer the clicked
  // cert if available.
  // Drained multi-qty rows have no active cert_details, so fall back to
  // any_listing_id from the aggregation to keep Add-cert / End working.
  const parentListingId = cert?.listing_id ?? row.cert_details?.[0]?.listing_id ?? row.any_listing_id ?? null;
  const isGradedRow = !!row.grading_company;
  const canAddCerts = isGradedRow && !isSet && !!row.has_multi_qty && !!parentListingId;
  const canPromote = isGradedRow && !isSet && !row.has_multi_qty && !!parentListingId && !!ebayUrl;
  const canEnd = isGradedRow && !isSet && !!row.has_multi_qty && !!parentListingId;
  const [ending, setEnding] = useState(false);
  const [endStep, setEndStep] = useState<null | 'confirm'>(null);

  async function handleEnd() {
    if (!parentListingId) return;
    setEnding(true);
    try {
      const res = await api.post(`/listings/${parentListingId}/end-multi-qty`);
      toast.success(`Listing ended (${res.data.ended} row${res.data.ended !== 1 ? 's' : ''} closed)`);
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      queryClient.invalidateQueries({ queryKey: ['listing-filter-options'] });
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to end listing');
    } finally {
      setEnding(false);
    }
  }

  async function handlePromote() {
    if (!parentListingId) return;
    setPromoting(true);
    try {
      const res = await api.post(`/listings/${parentListingId}/promote-multi-qty`);
      toast.success(res.data.promoted > 0
        ? `Converted to multi-qty (${res.data.promoted} row${res.data.promoted !== 1 ? 's' : ''})`
        : 'Already multi-qty');
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to promote listing');
    } finally {
      setPromoting(false);
    }
  }

  const groupKey = {
    part_number:     row.part_number ?? null,
    card_name:       row.card_name ?? null,
    grade_label:     row.grade_label ?? null,
    grading_company: row.grading_company ?? null,
    platform:        row.platform,
    currency:        row.currency,
  };

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (isSet) {
        await api.patch(`/listings/set-group/${row.listing_group_id}`, {
          listing_group_name: setName || undefined,
          ebay_listing_url: ebayUrl || null,
          list_price: price || undefined,
        });
      } else if (singleListingId) {
        // Sub-row click: patch only the clicked listing.
        await api.patch(`/listings/${singleListingId}`, {
          list_price: price || undefined,
          ebay_listing_url: ebayUrl || null,
        });
      } else {
        // Parent-row click on a single-listing row: patch via group endpoint
        // (which targets the one underlying listing in this case).
        await api.patch('/listings/group', {
          ...groupKey,
          list_price: price || undefined,
          ebay_listing_url: ebayUrl || null,
        });
      }
      toast.success('Listing updated');
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      queryClient.invalidateQueries({ queryKey: ['listing-filter-options'] });
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to update listing');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleteStep('deleting');
    try {
      if (singleListingId) {
        await api.delete(`/listings/${singleListingId}`);
        toast.success('Listing cancelled');
      } else {
        const res = isSet
          ? await api.delete(`/listings/set-group/${row.listing_group_id}`)
          : await api.delete('/listings/group', { data: groupKey });
        toast.success(`${res.data.cancelled} listing${res.data.cancelled !== 1 ? 's' : ''} cancelled`);
      }
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      queryClient.invalidateQueries({ queryKey: ['listing-filter-options'] });
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to cancel listing');
      setDeleteStep(null);
    }
  }

  async function cancelOneListing(listingId: string) {
    setCancellingId(listingId);
    try {
      await api.delete(`/listings/${listingId}`);
      const remaining = localCerts.filter(c => c.listing_id !== listingId);
      setLocalCerts(remaining);
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      queryClient.invalidateQueries({ queryKey: ['listing-filter-options'] });
      if (remaining.length === 0) { toast.success('All listings cancelled'); onClose(); }
      else toast.success('Listing cancelled');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to cancel listing');
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      {/* Card summary with per-cert cancel */}
      <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/50 overflow-hidden">
        <div className="px-4 py-3">
          {isSet ? (
            <div className="flex items-start gap-2">
              <p className="text-sm font-medium text-zinc-100 min-w-0 break-words">{row.listing_group_name ?? 'Unnamed Set'}</p>
              <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide bg-violet-500/20 text-violet-400 border border-violet-500/30 rounded px-1.5 py-0.5">Set</span>
            </div>
          ) : (
            <>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-100">
                  {row.card_name ?? 'Unknown'}
                  {row.has_multi_qty && (
                    <span className="ml-2 text-[9px] font-bold uppercase tracking-wide bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded px-1.5 py-0.5 align-middle">Multi-qty</span>
                  )}
                </p>
                <div className="flex items-center gap-2 text-[11px] text-zinc-500 mt-0.5">
                  {row.set_name && <span>{row.set_name}</span>}
                  {row.part_number && <span className="font-mono">{row.part_number}</span>}
                  {row.grading_company && <span>{row.grading_company} {row.grade_label}</span>}
                </div>
              </div>
              <span className="text-[11px] text-zinc-600">{localCerts.length} listing{localCerts.length !== 1 ? 's' : ''}</span>
            </div>
            {(canAddCerts || canPromote) && (
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {canAddCerts && (
                  <Button type="button" size="sm" variant="secondary" onClick={() => setAddCertOpen(true)}>
                    <Plus size={12} /> Add cert
                  </Button>
                )}
                {canPromote && (
                  <Button type="button" size="sm" variant="secondary" disabled={promoting} onClick={handlePromote}>
                    {promoting && <Loader2 size={12} className="animate-spin" />}
                    {promoting ? 'Converting…' : 'Convert to multi-qty'}
                  </Button>
                )}
              </div>
            )}
            </>
          )}
        </div>
        {localCerts.length > 0 && (
          <div className="border-t border-zinc-700/50 divide-y divide-zinc-800/60">
            {localCerts.map((c) => (
              <div key={c.listing_id ?? c.cert_number} className="flex items-center gap-3 px-4 py-2">
                <div className="flex-1 min-w-0">
                  {isSet && c.card_name && (
                    <p className="text-[11px] text-zinc-300 truncate">{c.card_name}</p>
                  )}
                  <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                    {c.raw_purchase_label && <span className="font-mono text-indigo-300/70">{c.raw_purchase_label}</span>}
                    {c.cert_number && <span className="font-mono text-indigo-300/70">{formatCertNumber(c.cert_number)}</span>}
                    {c.condition && <span>{c.condition}</span>}
                    {c.grade_label && <span>{c.grade_label}</span>}
                    {c.list_price != null && <span className="ml-auto text-zinc-400">{formatCurrency(c.list_price, row.currency)}</span>}
                  </div>
                </div>
                {c.listing_id && localCerts.length > 1 && !singleListingId && (
                  <button type="button"
                    disabled={cancellingId === c.listing_id}
                    onClick={() => cancelOneListing(c.listing_id!)}
                    className="shrink-0 flex items-center gap-1 text-[11px] text-zinc-600 hover:text-red-400 transition-colors disabled:opacity-40"
                    title="Cancel this listing">
                    {cancellingId === c.listing_id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {isSet && (
        <Input label="Set Name" placeholder="e.g. Shining Legends Set…"
          value={setName} onChange={(e) => setSetName(e.target.value)} />
      )}

      <div>
        <Input label="eBay Listing URL" type="url" placeholder="https://www.ebay.com/itm/…"
          value={ebayUrl} onChange={(e) => setEbayUrl(e.target.value)} />
        {ebayUrl && isEbayOrderUrl(ebayUrl) && (
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-amber-400">
            <AlertTriangle size={11} />
            This looks like a sold order URL, not a listing URL. Listing URLs contain <span className="font-mono">/itm/</span>.
          </p>
        )}
      </div>

      <Input label={isSet ? 'Set Price (total)' : 'List Price'} type="text" inputMode="decimal" placeholder="0.00"
        value={price} onChange={(e) => setPrice(e.target.value)} />

      <div className="pt-2 border-t border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {deleteStep === 'confirm' ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-red-300">
                {singleListingId
                  ? 'Cancel this listing?'
                  : `Cancel all ${localCerts.length > 1 ? `${localCerts.length} listings` : 'listing'}?`}
              </span>
              <Button type="button" size="sm" variant="ghost" onClick={() => setDeleteStep(null)}>No</Button>
              <Button type="button" size="sm"
                className="bg-red-600 hover:bg-red-500 text-white border-0"
                disabled={(deleteStep as string | null) === 'deleting'}
                onClick={handleDelete}>
                <Trash2 size={13} />
                {(deleteStep as string | null) === 'deleting' ? 'Cancelling…' : 'Yes, cancel'}
              </Button>
            </div>
          ) : (
            <button type="button" onClick={() => setDeleteStep('confirm')}
              className="flex items-center gap-1.5 text-xs text-zinc-600 hover:text-red-400 transition-colors">
              <Trash2 size={13} />
              {singleListingId
                ? 'Cancel this listing'
                : `Cancel all ${localCerts.length > 1 ? `(${localCerts.length})` : ''}`}
            </button>
          )}
          {canEnd && (
            endStep === 'confirm' ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-amber-300">End this listing?</span>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEndStep(null)}>No</Button>
                <Button type="button" size="sm"
                  className="bg-amber-600 hover:bg-amber-500 text-white border-0"
                  disabled={ending}
                  onClick={handleEnd}>
                  {ending && <Loader2 size={12} className="animate-spin" />}
                  {ending ? 'Ending…' : 'Yes, end'}
                </Button>
              </div>
            ) : (
              <button type="button" onClick={() => setEndStep('confirm')}
                className="flex items-center gap-1.5 text-xs text-zinc-600 hover:text-amber-400 transition-colors">
                End listing
              </button>
            )
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </div>

      <Modal open={addCertOpen} onClose={() => setAddCertOpen(false)} title="Add cert to listing">
        {parentListingId && (
          <AddCertsToListingModal
            listingId={parentListingId}
            listingLabel={`${row.card_name ?? 'card'} · ${row.grading_company ?? ''} ${row.grade_label ?? ''}`.trim()}
            onClose={() => setAddCertOpen(false)}
            onAdded={() => {
              queryClient.invalidateQueries({ queryKey: ['listings'] });
              queryClient.invalidateQueries({ queryKey: ['listing-filter-options'] });
              onClose();
            }}
          />
        )}
      </Modal>
    </form>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

const LISTINGS_FILTER_DEFAULTS = {
  sortCol: 'listed_at' as string | null,
  sortDir: 'desc' as SortDir,
  fPlatform: null as string[] | null,
  fGrade: null as string[] | null,
  fCompany: null as string[] | null,
  fPartNumber: null as string[] | null,
  fNumListed: null as string[] | null,
  fNumSold: null as string[] | null,
  fCardName: null as string[] | null,
  fPrice: null as string[] | null,
  fMultiQty: null as string[] | null,
  search: '',
};

const MULTI_QTY_FILTER_OPTIONS = ['Multi-Qty', 'Sold Out', 'Single'];

export function Listings() {
  const saved = loadFilters('listings', LISTINGS_FILTER_DEFAULTS);
  const [page, setPage] = useState(1);
  const [sortCol, setSortCol] = useState<string | null>(saved.sortCol);
  const [sortDir, setSortDir] = useState<SortDir>(saved.sortDir);
  const [fPlatform, setFPlatform] = useState<string[] | null>(saved.fPlatform);
  const [fGrade, setFGrade] = useState<string[] | null>(saved.fGrade);
  const [fCompany, setFCompany] = useState<string[] | null>(saved.fCompany);
  const [fPartNumber, setFPartNumber] = useState<string[] | null>(saved.fPartNumber);
  const [fNumListed, setFNumListed] = useState<string[] | null>(saved.fNumListed);
  const [fNumSold, setFNumSold] = useState<string[] | null>(saved.fNumSold);
  const [fCardName, setFCardName] = useState<string[] | null>(saved.fCardName);
  const [fPrice, setFPrice] = useState<string[] | null>(saved.fPrice);
  const [fMultiQty, setFMultiQty] = useState<string[] | null>(saved.fMultiQty);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [search, setSearch] = useState(saved.search);
  const [debouncedSearch, setDebouncedSearch] = useState(saved.search);
  const [listingTab, setListingTab] = useState<'graded' | 'raw' | 'graded_set' | 'raw_set'>('graded');
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [showAddModal, setShowAddModal] = useState(false);
  // Sub-row click sets `editTarget.cert` so the modal scopes to that listing.
  // Parent-row click (single-listing rows) leaves cert undefined.
  const [editTarget, setEditTarget] = useState<{ row: AggregatedListing; cert?: CertDetail } | null>(null);
  const setEditRow = (row: AggregatedListing, cert?: CertDetail) => setEditTarget({ row, cert });
  const queryClient = useQueryClient();

  const { mutate: migrateOrderUrls, isPending: migrating } = useMutation({
    mutationFn: () => api.post('/listings/migrate-order-urls').then(r => r.data as { migrated: number }),
    onSuccess: (data) => {
      toast.success(`Moved ${data.migrated} listing${data.migrated !== 1 ? 's' : ''} to sales`);
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      queryClient.invalidateQueries({ queryKey: ['listing-filter-options'] });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any) => toast.error(err?.response?.data?.error ?? 'Migration failed'),
  });

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setExpandedKeys(new Set()); }, [listingTab]);

  function rowKey(row: AggregatedListing) {
    if (row.listing_group_id) return `set|${row.listing_group_id}`;
    return `${row.part_number}|${row.card_name}|${row.grade_label}|${row.grading_company}|${row.platform}|${row.currency}`;
  }
  function toggleExpand(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  useEffect(() => {
    saveFilters('listings', { sortCol, sortDir, fPlatform, fGrade, fCompany, fPartNumber, fNumListed, fNumSold, fCardName, fPrice, fMultiQty, search });
  }, [sortCol, sortDir, fPlatform, fGrade, fCompany, fPartNumber, fNumListed, fNumSold, fCardName, fPrice, fMultiQty, search]);

  const MINS = {
    part:        colMinWidth('Part #',       false, true),   // ~100
    card:        colMinWidth('Card Name',    true,  true),   // ~145
    raw_id:      colMinWidth('Purchase ID',  false, false),  // ~90
    company:     colMinWidth('Company',      false, true),   // ~115
    grade:       colMinWidth('Grade',        false, true),   // ~95
    condition:   colMinWidth('Condition',    false, true),   // ~100
    platform:    colMinWidth('Platform',     true,  true),   // ~140
    price:       colMinWidth('Price',        true,  true),   // ~110
    link:        colMinWidth('Listing',      false, false),  // ~85
    multi:       colMinWidth('Status',       false, false),  // ~90
    num_listed:  colMinWidth('# Listed',     true,  true),   // ~130
    num_sold:    colMinWidth('# Sold',       true,  true),   // ~115
  };
  const { rz, totalWidth: _totalWidth } = useColWidths({
    part: Math.max(MINS.part, 190), card: Math.max(MINS.card, 620),
    raw_id: Math.max(MINS.raw_id, 150),
    company: Math.max(MINS.company, 90), grade: Math.max(MINS.grade, 175),
    condition: Math.max(MINS.condition, 100),
    platform: Math.max(MINS.platform, 130), price: Math.max(MINS.price, 120),
    link: Math.max(MINS.link, 70),
    multi: Math.max(MINS.multi, 80),
    num_listed: Math.max(MINS.num_listed, 110),
    num_sold: Math.max(MINS.num_sold, 100),
  });
  // graded/graded_set tab: hide condition + raw_id; raw/raw_set tab: hide company + grade
  const isRawTab = listingTab === 'raw' || listingTab === 'raw_set';
  const totalWidth = isRawTab
    ? _totalWidth - Math.max(MINS.company, 90) - Math.max(MINS.grade, 175) + Math.max(MINS.condition, 100)
    : _totalWidth - Math.max(MINS.condition, 100) - Math.max(MINS.raw_id, 150);

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
    grades: activeFilter(fGrade, filterOptions?.grades)?.join(','),
    companies: activeFilter(fCompany, filterOptions?.companies)?.join(','),
    part_numbers: activeFilter(fPartNumber, filterOptions?.part_numbers)?.join(','),
    num_listed: activeFilter(fNumListed, filterOptions?.num_listed)?.join(','),
    num_sold: activeFilter(fNumSold, filterOptions?.num_sold)?.join(','),
    card_names: activeFilter(fCardName, filterOptions?.card_names)?.join(','),
    prices: activeFilter(fPrice, filterOptions?.prices)?.join(','),
    multi_qty: activeFilter(fMultiQty, MULTI_QTY_FILTER_OPTIONS)?.join(','),
    search: debouncedSearch || undefined,
    listing_type: listingTab,
  };

  const { data, isLoading } = useQuery<PaginatedResult<AggregatedListing>>({
    queryKey: ['listings', params],
    queryFn: () => api.get('/listings', { params }).then((r) => r.data),
  });

  const hasActiveFilters = fPlatform !== null || fGrade !== null || fCompany !== null ||
    fPartNumber !== null || fNumListed !== null || fNumSold !== null ||
    fCardName !== null || fPrice !== null || fMultiQty !== null || !!debouncedSearch;

  const sh = { sortCol, sortDir, onSort: handleSort };

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 lg:gap-0 px-6 py-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-100">Listings</h1>
        <div className="flex items-center flex-wrap gap-3 w-full lg:w-auto justify-end">
          {hasActiveFilters && (
            <button onClick={() => { setFPlatform(null); setFGrade(null); setFCompany(null); setFPartNumber(null); setFNumListed(null); setFNumSold(null); setFCardName(null); setFPrice(null); setFMultiQty(null); setSearch(''); }}
              className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
              <X size={12} /> Clear filters
            </button>
          )}
          <div className="flex gap-1">
            {([['graded', 'Graded'], ['raw', 'Raw'], ['graded_set', 'Graded Set']] as const).map(([t, label]) => (
              <button key={t} onClick={() => setListingTab(t)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${listingTab === t ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                {label}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Search card…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 w-52"
          />
          <FilterDrawerLauncher
            onClick={() => setFilterDrawerOpen(true)}
            activeCount={
              (fPartNumber ? 1 : 0) +
              (fCardName ? 1 : 0) +
              (fCompany ? 1 : 0) +
              (fGrade ? 1 : 0) +
              (fPlatform ? 1 : 0) +
              (fPrice ? 1 : 0) +
              (fNumListed ? 1 : 0) +
              (fNumSold ? 1 : 0) +
              (fMultiQty ? 1 : 0)
            }
          />
          <Button size="sm" onClick={() => setShowAddModal(true)}>
            <Plus size={14} /> Add Listing
          </Button>
        </div>
      </div>

      {(filterOptions?.order_url_count ?? 0) > 0 && (
        <div className="px-6 py-2.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2 text-sm text-amber-400">
            <AlertTriangle size={14} className="shrink-0" />
            <span>
              {filterOptions!.order_url_count} listing{filterOptions!.order_url_count !== 1 ? 's have' : ' has'} an eBay order URL and may already be sold.
            </span>
          </div>
          <Button size="sm" onClick={() => migrateOrderUrls()} disabled={migrating}>
            {migrating && <Loader2 size={13} className="animate-spin" />}
            Move {filterOptions!.order_url_count} to sales
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">Loading…</div>
        ) : (
          <table className="text-xs whitespace-nowrap border-collapse hidden lg:table" style={{ tableLayout: 'fixed', width: totalWidth + 'px' }}>
            <thead className="sticky top-0 bg-zinc-950 z-10">
              <tr className="border-b border-zinc-700 text-zinc-300 uppercase tracking-wide">
                <ColHeader label="Part #"                          {...sh} {...rz('part')}    minWidth={MINS.part}
                  filterOptions={filterOptions?.part_numbers} filterSelected={fPartNumber} onFilterChange={(v) => { setFPartNumber(v); setPage(1); }} />
                <ColHeader label="Card Name"    col="card_name"  {...sh} {...rz('card')}    minWidth={MINS.card}
                  filterOptions={filterOptions?.card_names} filterSelected={fCardName} onFilterChange={(v) => { setFCardName(v); setPage(1); }} />
                {isRawTab && (
                  <ColHeader label="Purchase ID" {...sh} {...rz('raw_id')} minWidth={MINS.raw_id} />
                )}
                {!isRawTab ? (
                  <>
                    <ColHeader label="Company" {...sh} {...rz('company')} minWidth={MINS.company}
                      filterOptions={filterOptions?.companies} filterSelected={fCompany} onFilterChange={(v) => { setFCompany(v); setPage(1); }} />
                    <ColHeader label="Grade"   {...sh} {...rz('grade')}   minWidth={MINS.grade}
                      filterOptions={filterOptions?.grades} filterSelected={fGrade} onFilterChange={(v) => { setFGrade(v); setPage(1); }} />
                  </>
                ) : (
                  <ColHeader label="Condition" {...sh} {...rz('condition')} minWidth={MINS.condition} />
                )}
                <ColHeader label="Platform"     col="platform"   {...sh} {...rz('platform')} minWidth={MINS.platform}
                  filterOptions={filterOptions?.platforms} filterSelected={fPlatform} onFilterChange={(v) => { setFPlatform(v); setPage(1); }} />
                <ColHeader label="Price"      col="list_price"  {...sh} {...rz('price')} align="right" minWidth={MINS.price}
                  filterOptions={filterOptions?.prices} filterSelected={fPrice} onFilterChange={(v) => { setFPrice(v); setPage(1); }} />
                <ColHeader label="Listing"                       {...sh} {...rz('link')} align="center" minWidth={MINS.link} />
                <ColHeader label="Status"                        {...sh} {...rz('multi')} align="center" minWidth={MINS.multi}
                  filterOptions={MULTI_QTY_FILTER_OPTIONS} filterSelected={fMultiQty} onFilterChange={(v) => { setFMultiQty(v); setPage(1); }} />
                <ColHeader label="# Listed"   col="num_listed"  {...sh} {...rz('num_listed')} align="center" minWidth={MINS.num_listed}
                  filterOptions={filterOptions?.num_listed} filterSelected={fNumListed} onFilterChange={(v) => { setFNumListed(v); setPage(1); }} />
                <ColHeader label="# Sold"     col="num_sold"    {...sh} {...rz('num_sold')} align="center" minWidth={MINS.num_sold}
                  filterOptions={filterOptions?.num_sold} filterSelected={fNumSold} onFilterChange={(v) => { setFNumSold(v); setPage(1); }} />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {!data?.data.length ? (
                <tr><td colSpan={10} className="px-3 py-10 text-center text-zinc-500">No listings found.</td></tr>
              ) : data.data.map((row, i) => {
                const key = rowKey(row);
                const isExpanded = expandedKeys.has(key);
                const isGraded = listingTab === 'graded' || listingTab === 'graded_set';
                const hasExpandable = (row.cert_details?.length ?? 0) > 0;
                // Raw parent rows always hide per-listing fields (purchase id /
                // condition / price / url) — those live on the sub-rows under
                // the aggregation. Matches the graded singles UX: parent is the
                // summary, sub-row is the listing.
                const collapseRaw = !isGraded && hasExpandable;
                return (
                  <React.Fragment key={i}>
                    <tr
                      onClick={() => setEditRow(row)}
                      className="hover:bg-zinc-800/30 transition-colors cursor-pointer">
                      <td className="px-3 py-2 font-mono text-zinc-500 text-[11px] truncate" title={row.part_number ?? ''}>
                        {hasExpandable && (
                          <ChevronRight
                            size={11}
                            className={`inline-block mr-1 text-zinc-600 transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                            onClick={(e) => { e.stopPropagation(); toggleExpand(key); }}
                          />
                        )}
                        {row.part_number ?? '—'}
                      </td>
                      <td className="px-3 py-2">
                        {listingTab === 'graded_set' ? (
                          <p className="font-medium text-zinc-200 break-words whitespace-normal">
                            {row.listing_group_name ?? <span className="text-zinc-500 italic">Unnamed Set</span>}
                            <span className="ml-2 text-[9px] font-bold uppercase tracking-wide bg-violet-500/20 text-violet-400 border border-violet-500/30 rounded px-1.5 py-0.5 align-middle">Set</span>
                          </p>
                        ) : (
                          <>
                            <p className="font-medium text-zinc-200 break-words whitespace-normal" title={row.card_name ?? ''}>
                              {row.card_name ?? 'Unknown'}
                            </p>
                            {row.set_name && <p className="text-[10px] text-zinc-500 truncate">{row.set_name}</p>}
                          </>
                        )}
                      </td>
                      {!isGraded && (
                        <td className="px-3 py-2 font-mono text-indigo-300/70 text-[11px] truncate">
                          {collapseRaw ? '' : (row.raw_purchase_label ?? '—')}
                        </td>
                      )}
                      {isGraded ? (
                        <>
                          <td className="px-3 py-2 text-zinc-400 text-[11px]">{row.grading_company ?? '—'}</td>
                          <td className="px-3 py-2 text-zinc-300 text-[11px]">{row.grade_label ?? '—'}</td>
                        </>
                      ) : (
                        <td className="px-3 py-2 text-zinc-300 text-[11px]">{collapseRaw ? '' : (row.condition ?? '—')}</td>
                      )}
                      <td className="px-3 py-2 text-zinc-300 capitalize">{row.platform}</td>
                      <td className="px-3 py-2 text-right text-zinc-300">
                        {collapseRaw ? '' : formatCurrency(row.list_price ?? 0, row.currency)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {collapseRaw ? '' : row.ebay_listing_url ? (
                          isEbayOrderUrl(row.ebay_listing_url) ? (
                            <a href={row.ebay_listing_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                              title="Order URL — this may already be sold"
                              className="inline-flex text-amber-400 hover:text-amber-300 transition-colors">
                              <AlertTriangle size={13} />
                            </a>
                          ) : (
                            <a href={row.ebay_listing_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex text-indigo-400 hover:text-indigo-300 transition-colors">
                              <ExternalLink size={13} />
                            </a>
                          )
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {row.is_drained_multi_qty ? (
                          <span className="inline-flex items-center h-5 px-1.5 rounded bg-amber-500/15 text-amber-300 text-[10px] font-bold uppercase tracking-wide border border-amber-500/30" title="Multi-qty listing is sold out — Add cert to re-populate, or End Listing to close it">Sold Out</span>
                        ) : row.has_multi_qty ? (
                          <span className="inline-flex items-center h-5 px-1.5 rounded bg-cyan-500/15 text-cyan-300 text-[10px] font-bold uppercase tracking-wide border border-cyan-500/30">Multi</span>
                        ) : (
                          <span className="inline-flex items-center h-5 px-1.5 rounded bg-zinc-700/40 text-zinc-400 text-[10px] font-bold uppercase tracking-wide border border-zinc-700" title="Single-cert listing (not multi-qty)">Single</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded bg-indigo-500/15 text-indigo-300 text-[11px] font-semibold tabular-nums">
                          {row.num_listed}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {row.num_sold > 0 ? (
                          <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded bg-emerald-500/15 text-emerald-400 text-[11px] font-semibold tabular-nums">
                            {row.num_sold}
                          </span>
                        ) : <span className="text-zinc-600">0</span>}
                      </td>
                    </tr>
                    {isGraded && isExpanded && row.cert_details?.map((cert, ci) => (
                      <tr key={ci}
                        className="border-b border-zinc-800/40 bg-zinc-900/40 hover:bg-zinc-800/50 cursor-pointer transition-colors"
                        onClick={() => setEditRow(row, cert)}>
                        {/* Part # */}
                        <td className="px-3 py-1.5 font-mono text-[11px] text-zinc-500 truncate">
                          {listingTab === 'graded_set'
                            ? (cert.part_number ?? '—')
                            : <div className="w-px h-3 bg-zinc-700 mx-auto" />}
                        </td>
                        {/* Card Name */}
                        <td className="px-3 py-1.5 pl-5">
                          {listingTab === 'graded_set' ? (
                            <span className="text-[11px] text-zinc-300 break-words whitespace-normal">{cert.card_name ?? '—'}</span>
                          ) : (
                            <>
                              <span className="text-[10px] text-zinc-600 mr-1">Cert</span>
                              <span className="font-mono text-[11px] text-indigo-300/70">{formatCertNumber(cert.cert_number) ?? '—'}</span>
                              {cert.listing_group_id && (
                                <span className="ml-2 text-[9px] font-bold uppercase tracking-wide bg-violet-500/20 text-violet-400 border border-violet-500/30 rounded px-1.5 py-0.5">Set</span>
                              )}
                            </>
                          )}
                        </td>
                        {/* Company */}
                        <td className="px-3 py-1.5 text-zinc-400 text-[11px]">
                          {listingTab === 'graded_set' ? (cert.company ?? '—') : <span className="font-mono text-[11px] text-indigo-300/70">{formatCertNumber(cert.cert_number) ?? '—'}</span>}
                        </td>
                        {/* Grade */}
                        <td className="px-3 py-1.5 text-zinc-300 text-[11px]">
                          {cert.grade_label ?? '—'}
                        </td>
                        {/* Platform — empty */}
                        <td className="px-3 py-1.5" />
                        {/* Price */}
                        <td className="px-3 py-1.5 text-right text-zinc-400 text-[11px]">
                          {cert.list_price != null ? formatCurrency(cert.list_price, row.currency) : '—'}
                        </td>
                        {/* Link */}
                        <td className="px-3 py-1.5 text-center">
                          {cert.ebay_listing_url ? (
                            isEbayOrderUrl(cert.ebay_listing_url) ? (
                              <a href={cert.ebay_listing_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                                title="Order URL — this may already be sold"
                                className="inline-flex text-amber-400 hover:text-amber-300 transition-colors">
                                <AlertTriangle size={12} />
                              </a>
                            ) : (
                              <a href={cert.ebay_listing_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex text-indigo-400 hover:text-indigo-300 transition-colors">
                                <ExternalLink size={12} />
                              </a>
                            )
                          ) : '—'}
                        </td>
                        <td colSpan={3} />
                      </tr>
                    ))}
                    {!isGraded && isExpanded && row.cert_details?.map((cert, ci) => (
                      <tr key={ci}
                        className="border-b border-zinc-800/40 bg-zinc-900/40 hover:bg-zinc-800/50 cursor-pointer transition-colors"
                        onClick={() => setEditRow(row, cert)}>
                        {/* Part # — vertical line */}
                        <td className="px-3 py-1.5">
                          <div className="w-px h-3 bg-zinc-700 mx-auto" />
                        </td>
                        {/* Card Name — purchase ID label */}
                        <td className="px-3 py-1.5 pl-5">
                          <span className="text-[10px] text-zinc-600 mr-1">Purchase</span>
                          <span className="font-mono text-[11px] text-indigo-300/70">{cert.raw_purchase_label ?? '—'}</span>
                        </td>
                        {/* Purchase ID */}
                        <td className="px-3 py-1.5 font-mono text-indigo-300/70 text-[11px] truncate">
                          {cert.raw_purchase_label ?? '—'}
                        </td>
                        {/* Condition */}
                        <td className="px-3 py-1.5 text-zinc-300 text-[11px]">
                          {cert.condition ?? '—'}
                        </td>
                        {/* Platform — empty */}
                        <td className="px-3 py-1.5" />
                        {/* Price */}
                        <td className="px-3 py-1.5 text-right text-zinc-400 text-[11px]">
                          {cert.list_price != null ? formatCurrency(cert.list_price, row.currency) : '—'}
                        </td>
                        {/* Link */}
                        <td className="px-3 py-1.5 text-center">
                          {cert.ebay_listing_url ? (
                            isEbayOrderUrl(cert.ebay_listing_url) ? (
                              <a href={cert.ebay_listing_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                                title="Order URL — this may already be sold"
                                className="inline-flex text-amber-400 hover:text-amber-300 transition-colors">
                                <AlertTriangle size={12} />
                              </a>
                            ) : (
                              <a href={cert.ebay_listing_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex text-indigo-400 hover:text-indigo-300 transition-colors">
                                <ExternalLink size={12} />
                              </a>
                            )
                          ) : '—'}
                        </td>
                        <td colSpan={3} />
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Tablet (<lg): minimal-row table. Skips the expand-toggle behaviour
            — tapping a row always opens edit modal so users get full detail
            without the awkward inline sub-row UX at narrow widths. */}
        <table className="lg:hidden w-full text-xs">
          <thead className="sticky top-0 bg-zinc-950 z-10">
            <tr className="border-b border-zinc-700 text-[10px] text-zinc-400 uppercase tracking-wide">
              <th className="px-3 py-2 text-left font-medium">Card</th>
              <th className="px-3 py-2 text-left font-medium whitespace-nowrap">
                {listingTab === 'graded' || listingTab === 'graded_set' ? 'Grade' : 'Cond.'}
              </th>
              <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Platform</th>
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Price</th>
              <th className="px-3 py-2 text-center font-medium whitespace-nowrap">Listed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {!data?.data.length ? (
              <tr><td colSpan={5} className="px-3 py-10 text-center text-zinc-500">No listings found.</td></tr>
            ) : data.data.map((row, i) => {
              const isGraded = listingTab === 'graded' || listingTab === 'graded_set';
              return (
                <tr key={`m-${i}`} onClick={() => setEditRow(row)}
                    className="hover:bg-zinc-800/30 transition-colors cursor-pointer">
                  <td className="px-3 py-2">
                    <p className="text-zinc-200 break-words">
                      {listingTab === 'graded_set'
                        ? (row.listing_group_name ?? 'Unnamed Set')
                        : (row.card_name ?? 'Unknown')}
                    </p>
                    {row.set_name && listingTab !== 'graded_set' && (
                      <p className="text-[10px] text-zinc-500 truncate">{row.set_name}</p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-zinc-300 text-[11px]">
                    {isGraded
                      ? (row.grade_label ?? '—')
                      : (row.condition ?? '—')}
                  </td>
                  <td className="px-3 py-2 text-zinc-300 capitalize whitespace-nowrap">{row.platform}</td>
                  <td className="px-3 py-2 text-right text-zinc-200 font-medium whitespace-nowrap">
                    {row.list_price != null ? formatCurrency(row.list_price, row.currency) : '—'}
                  </td>
                  <td className="px-3 py-2 text-center text-zinc-400">{row.num_listed ?? 1}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {data && (
        <div className="flex items-center justify-center lg:justify-between gap-6 lg:gap-0 px-28 lg:px-6 lg:pr-44 py-3 border-t border-zinc-800 text-xs text-zinc-500">
          <span>{data.total} {data.total === 1 ? 'group' : 'groups'}</span>
          {data.total_pages > 1 && (
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
              <span className="px-2 py-1">{page} / {data.total_pages}</span>
              <Button variant="ghost" size="sm" disabled={page >= data.total_pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </div>
      )}

      <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="Record Listing" className="max-w-3xl">
        <AddListingModal onClose={() => setShowAddModal(false)} />
      </Modal>

      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Edit Listing">
        {editTarget && <EditListingModal row={editTarget.row} cert={editTarget.cert} onClose={() => setEditTarget(null)} />}
      </Modal>

      {/* Tablet (<lg) filter drawer — surfaces all the column-header filters
          that go away when the desktop table is hidden:lg:table. Filters are
          context-aware: Company/Grade only show in graded modes; Condition
          handling stays on the inline header (no multi-select). */}
      {(() => {
        const isGraded = listingTab === 'graded' || listingTab === 'graded_set';
        return (
          <FilterDrawer open={filterDrawerOpen} onClose={() => setFilterDrawerOpen(false)} title="Listings filters">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-zinc-400">Part #</span>
              <ColumnFilter options={filterOptions?.part_numbers ?? []} selected={fPartNumber} onChange={(v) => { setFPartNumber(v); setPage(1); }} align="right" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-zinc-400">Card name</span>
              <ColumnFilter options={filterOptions?.card_names ?? []} selected={fCardName} onChange={(v) => { setFCardName(v); setPage(1); }} align="right" />
            </div>
            {isGraded && (
              <>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-zinc-400">Company</span>
                  <ColumnFilter options={filterOptions?.companies ?? []} selected={fCompany} onChange={(v) => { setFCompany(v); setPage(1); }} align="right" />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-zinc-400">Grade</span>
                  <ColumnFilter options={filterOptions?.grades ?? []} selected={fGrade} onChange={(v) => { setFGrade(v); setPage(1); }} align="right" />
                </div>
              </>
            )}
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-zinc-400">Platform</span>
              <ColumnFilter options={filterOptions?.platforms ?? []} selected={fPlatform} onChange={(v) => { setFPlatform(v); setPage(1); }} align="right" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-zinc-400">Price</span>
              <ColumnFilter options={filterOptions?.prices ?? []} selected={fPrice} onChange={(v) => { setFPrice(v); setPage(1); }} align="right" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-zinc-400"># Listed</span>
              <ColumnFilter options={filterOptions?.num_listed ?? []} selected={fNumListed} onChange={(v) => { setFNumListed(v); setPage(1); }} align="right" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-zinc-400"># Sold</span>
              <ColumnFilter options={filterOptions?.num_sold ?? []} selected={fNumSold} onChange={(v) => { setFNumSold(v); setPage(1); }} align="right" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-zinc-400">Status</span>
              <ColumnFilter options={MULTI_QTY_FILTER_OPTIONS} selected={fMultiQty} onChange={(v) => { setFMultiQty(v); setPage(1); }} align="right" />
            </div>
          </FilterDrawer>
        );
      })()}
    </div>
  );
}
