import { useState, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus, X, Loader2, Minus } from 'lucide-react';
import { api, type PaginatedResult } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { formatCurrency, formatDate, formatCertNumber } from '../lib/utils';
import { loadFilters, saveFilters } from '../lib/filter-store';
import { ColHeader, useColWidths, colMinWidth } from '../components/ui/TableHeader';
import toast from 'react-hot-toast';

interface AggregatedListing {
  card_name: string | null;
  set_name: string | null;
  part_number: string | null;
  grade_label: string | null;
  grading_company: string | null;
  platform: string;
  list_price: number | null;
  currency: string;
  ebay_listing_url: string | null;
  listed_at: string | null;
  num_listed: number;
  num_sold: number;
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
}

type SortDir = 'asc' | 'desc';

// ── Set Slot ──────────────────────────────────────────────────────────────────

type SetSlot = { cardName: string | null; slab: SlabResult | null };

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
        if (!s.is_card_show) m.set(s.card_name ?? '', (m.get(s.card_name ?? '') ?? 0) + 1);
        return m;
      }, new Map<string, number>())).filter(([n, c]) => n && c > 0)
    : [];

  const copies = (copiesData?.data ?? []).filter(
    c => c.card_name === slot.cardName && !c.is_listed && !c.is_card_show && !c.is_personal_collection
  );

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
        <button type="button" onClick={() => onUpdate({ cardName: null, slab: null })}
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
          <button type="button" onClick={() => { onUpdate({ cardName: null, slab: null }); setSearch(''); }}
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
                type="text" placeholder="Search card name…" value={search}
                onChange={(e) => setSearch(e.target.value)} autoFocus={index === 0}
                className="w-full px-2.5 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
              />
              {isSearching && <Loader2 size={11} className="absolute right-2 top-2 animate-spin text-zinc-500" />}
            </div>
            {debounced.length >= 2 && (
              uniqueNames.length > 0 ? (
                <div className="rounded border border-zinc-700/50 overflow-hidden max-h-36 overflow-y-auto">
                  {uniqueNames.map(([name, count]) => (
                    <button key={name} type="button"
                      className="w-full text-left px-3 py-2 hover:bg-zinc-700/40 border-b border-zinc-700/30 last:border-0 flex items-center justify-between gap-2 transition-colors"
                      onClick={() => { onUpdate({ cardName: name, slab: null }); setSearch(''); }}>
                      <span className="text-xs text-zinc-200 truncate">{name}</span>
                      <span className="text-[10px] text-zinc-500 tabular-nums shrink-0">{count} unsold</span>
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
                      onClick={() => { onUpdate({ cardName: slot.cardName, slab: copy }); setOpen(false); }}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${
                        takenElsewhere ? 'opacity-25 cursor-not-allowed' :
                        isPickedHere ? 'bg-indigo-500/10' : 'hover:bg-zinc-700/30'
                      }`}>
                      <div className={`w-3 h-3 rounded-full border shrink-0 flex items-center justify-center transition-colors ${isPickedHere ? 'bg-indigo-500 border-indigo-500' : 'border-zinc-600'}`}>
                        {isPickedHere && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                      <span className="font-mono text-xs text-zinc-200">{formatCertNumber(copy.cert_number)}</span>
                      <span className="text-[11px] text-zinc-500">{copy.grade_label}</span>
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
  const [step, setStep] = useState<'type' | 'sub-type' | 'set-count' | 'search' | 'quantity' | 'details' | 'set-search' | 'set-details'>('type');
  const [listingMode, setListingMode] = useState<'single' | 'set'>('single');

  // Step: search (single)
  const [cardSearch, setCardSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedCardName, setSelectedCardName] = useState<string | null>(null);

  // Step: quantity (single)
  const [qty, setQty] = useState(1);
  const [selectedGrade, setSelectedGrade] = useState<string | null>(null);
  const [customSelected, setCustomSelected] = useState<Set<string>>(new Set());

  // Set mode
  const [setTargetCount, setSetTargetCount] = useState('');
  const [setSlotList, setSetSlotList] = useState<SetSlot[]>([]);

  // Step: details (shared)
  const [price, setPrice] = useState('');
  const [listedAt, setListedAt] = useState('');
  const [ebayUrl, setEbayUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(cardSearch), 300);
    return () => clearTimeout(t);
  }, [cardSearch]);


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


  const allCopies = copiesResult?.data.filter(c => c.card_name === selectedCardName) ?? [];
  const availableCopies = allCopies.filter(c => !c.is_listed && !c.is_card_show && !c.is_personal_collection);

  const gradeBreakdown = availableCopies.reduce((map, c) => {
    const key = c.grade_label ?? 'Ungraded';
    map.set(key, (map.get(key) ?? 0) + 1);
    return map;
  }, new Map<string, number>());

  const gradeKeys = Array.from(gradeBreakdown.keys());
  const activeGrade = selectedGrade ?? gradeKeys[0] ?? null;
  const copiesForGrade = availableCopies.filter(c => (c.grade_label ?? 'Ungraded') === activeGrade);
  const fifoIds = new Set(copiesForGrade.slice(0, qty).map(c => c.id));
  const effectiveIds = customSelected.size > 0 ? customSelected : fifoIds;
  const selectedCopies = copiesForGrade.filter(c => effectiveIds.has(c.id));

  // Derived set slabs (only slots with a cert picked)
  const setSlabs = setSlotList.map(s => s.slab).filter((s): s is SlabResult => s != null);
  const takenSetIds = new Set(setSlabs.map(s => s.id));

  // Deduplicate search results by card name
  const uniqueCardNames = searchResults
    ? Array.from(
        searchResults.data.reduce((map, s) => {
          if (s.is_card_show) return map;
          const name = s.card_name ?? 'Unknown';
          map.set(name, (map.get(name) ?? 0) + 1);
          return map;
        }, new Map<string, number>())
      ).filter(([, count]) => count > 0)
    : [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const copiesToList = listingMode === 'set' ? setSlabs : selectedCopies;  // setSlabs is derived above
    if (copiesToList.length === 0) { toast.error('No copies selected'); return; }
    if (!price) { toast.error('Enter a list price'); return; }
    setSubmitting(true);
    try {
      await Promise.all(copiesToList.map(copy =>
        api.post('/listings', {
          card_instance_id: copy.id,
          platform: 'ebay',
          list_price: price,
          currency: 'USD',
          listed_at: listedAt || undefined,
          ebay_listing_url: ebayUrl || undefined,
        })
      ));
      const n = copiesToList.length;
      toast.success(n === 1 ? 'Listing recorded!' : `${n} listings recorded!`);
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      onClose();
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
        <button type="button" disabled
          className="rounded-xl border-2 border-zinc-700 bg-zinc-800/40 px-4 py-5 text-left opacity-40 cursor-not-allowed">
          <p className="text-sm font-semibold text-zinc-400">Raw</p>
          <p className="text-xs text-zinc-600 mt-0.5">Coming soon</p>
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
            {uniqueCardNames.map(([name, count]) => (
              <button key={name} type="button"
                className="w-full text-left px-4 py-3 hover:bg-zinc-800 border-b border-zinc-700/40 last:border-0 flex items-center justify-between gap-3 transition-colors"
                onClick={() => { setSelectedCardName(name); setQty(1); setStep('quantity'); }}>
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

  // ── Step: quantity (single) ──────────────────────────────────────────────

  if (step === 'quantity') return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 min-w-0">
        <button type="button" onClick={() => { setStep('search'); setSelectedCardName(null); }}
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
          {allCopies.some(c => c.is_card_show) && (
            <p className="text-xs text-zinc-600">{allCopies.filter(c => c.is_card_show).length} {allCopies.filter(c => c.is_card_show).length === 1 ? 'copy is' : 'copies are'} at a card show</p>
          )}
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
                </p>
                {allCopies.some(c => c.is_card_show) && (
                  <p className="text-[10px] text-zinc-600">{allCopies.filter(c => c.is_card_show).length} at card show</p>
                )}
                {allCopies.some(c => c.is_listed && !c.is_card_show) && (
                  <p className="text-[10px] text-zinc-600">{allCopies.filter(c => c.is_listed && !c.is_card_show).length} already listed</p>
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
            {copiesForGrade.map((copy, idx) => {
              const isSelected = effectiveIds.has(copy.id);
              const atLimit = !isSelected && effectiveIds.size >= qty;
              const isFifo = customSelected.size === 0 && idx < qty;
              const certLabel = formatCertNumber(copy.cert_number);
              return (
                <div key={copy.id}
                  onClick={atLimit ? undefined : () => setCustomSelected(() => {
                    const next = new Set(effectiveIds);
                    next.has(copy.id) ? next.delete(copy.id) : next.add(copy.id);
                    return next;
                  })}
                  className={`rounded-lg border px-3 py-2 flex items-center gap-2 transition-colors ${
                    atLimit ? 'cursor-not-allowed opacity-20 border-zinc-800/20 bg-zinc-900/20'
                    : isSelected ? 'cursor-pointer border-indigo-500/40 bg-indigo-500/8'
                    : 'cursor-pointer border-zinc-700/30 bg-zinc-800/20 opacity-50 hover:opacity-70'
                  }`}>
                  <div className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center transition-colors ${isSelected ? 'bg-indigo-500 border-indigo-500' : 'border-zinc-600'}`}>
                    {isSelected && <span className="text-[8px] text-white font-bold">✓</span>}
                  </div>
                  {isFifo && (
                    <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded px-1 py-0.5">FIFO</span>
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
            setSetSlotList(Array.from({ length: n }, () => ({ cardName: null, slab: null })));
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

  // ── Step: details (shared for single + set) ──────────────────────────────

  const copiesToList = listingMode === 'set' ? setSlabs : selectedCopies;
  const detailsBackStep: typeof step = listingMode === 'set' ? 'set-search' : 'quantity';

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

      <Input label="eBay Listing URL" type="url" placeholder="https://www.ebay.com/itm/…"
        value={ebayUrl} onChange={(e) => setEbayUrl(e.target.value)} />

      <div className="grid grid-cols-2 gap-3">
        <Input label={listingMode === 'set' ? 'Set Price (total)' : 'List Price'} type="number" step="0.01" min="0" placeholder="0.00"
          value={price} onChange={(e) => setPrice(e.target.value)} />
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Listed Date</label>
          <input type="date" value={listedAt} onChange={(e) => setListedAt(e.target.value)}
            className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors [color-scheme:dark]" />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={() => setStep(detailsBackStep)}>Back</Button>
        <Button type="submit" disabled={submitting || copiesToList.length === 0}>
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {submitting ? 'Recording…' : listingMode === 'set' ? `Record Set (${setSlabs.length} slabs)` : `Record ${qty > 1 ? `${qty} Listings` : 'Listing'}`}
        </Button>
      </div>
    </form>
  );
}

// ── Edit Listing Modal ────────────────────────────────────────────────────────

function EditListingModal({ row, onClose }: { row: AggregatedListing; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [price, setPrice] = useState(row.list_price != null ? (row.list_price / 100).toFixed(2) : '');
  const [ebayUrl, setEbayUrl] = useState(row.ebay_listing_url ?? '');
  const [saving, setSaving] = useState(false);
  const [deleteStep, setDeleteStep] = useState<null | 'confirm' | 'deleting'>(null);

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
      await api.patch('/listings/group', {
        ...groupKey,
        list_price: price || undefined,
        ebay_listing_url: ebayUrl || null,
      });
      toast.success('Listing updated');
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      queryClient.invalidateQueries({ queryKey: ['listing-filter-options'] });
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to update listing');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleteStep('deleting');
    try {
      const res = await api.delete('/listings/group', { data: groupKey });
      toast.success(`${res.data.cancelled} listing${res.data.cancelled !== 1 ? 's' : ''} cancelled`);
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      queryClient.invalidateQueries({ queryKey: ['listing-filter-options'] });
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to cancel listing');
      setDeleteStep(null);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      {/* Card summary */}
      <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/50 px-4 py-3 space-y-1">
        <p className="text-sm font-medium text-zinc-100">{row.card_name ?? 'Unknown'}</p>
        <div className="flex items-center gap-3 text-[11px] text-zinc-500">
          {row.set_name && <span>{row.set_name}</span>}
          {row.part_number && <span className="font-mono">{row.part_number}</span>}
          {row.grading_company && <span>{row.grading_company} {row.grade_label}</span>}
          <span className="ml-auto text-zinc-600">{row.num_listed} listing{row.num_listed !== 1 ? 's' : ''}</span>
        </div>
      </div>

      <Input label="eBay Listing URL" type="url" placeholder="https://www.ebay.com/itm/…"
        value={ebayUrl} onChange={(e) => setEbayUrl(e.target.value)} />

      <Input label="List Price" type="number" step="0.01" min="0" placeholder="0.00"
        value={price} onChange={(e) => setPrice(e.target.value)} />

      {/* Delete zone */}
      <div className="border-t border-zinc-800 pt-4">
        {deleteStep === null && (
          <button type="button" onClick={() => setDeleteStep('confirm')}
            className="text-xs text-red-500 hover:text-red-400 transition-colors">
            Cancel listing{row.num_listed !== 1 ? `s (${row.num_listed})` : ''}…
          </button>
        )}
        {deleteStep === 'confirm' && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/8 px-4 py-3 space-y-3">
            <p className="text-xs text-red-300 font-medium">
              Cancel {row.num_listed} active listing{row.num_listed !== 1 ? 's' : ''}?
            </p>
            <p className="text-[11px] text-zinc-500">This marks the listing as cancelled. Sales history is preserved.</p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setDeleteStep(null)}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
                Never mind
              </button>
              <button type="button" onClick={handleDelete}
                className="ml-auto px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-xs text-white font-medium transition-colors">
                Yes, cancel listing{row.num_listed !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        )}
        {deleteStep === 'deleting' && (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Loader2 size={12} className="animate-spin" /> Cancelling…
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 size={14} className="animate-spin" />}
          {saving ? 'Saving…' : 'Save Changes'}
        </Button>
      </div>
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
  search: '',
};

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
  const [search, setSearch] = useState(saved.search);
  const [debouncedSearch, setDebouncedSearch] = useState(saved.search);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editRow, setEditRow] = useState<AggregatedListing | null>(null);

  useEffect(() => {
    saveFilters('listings', { sortCol, sortDir, fPlatform, fGrade, fCompany, fPartNumber, fNumListed, fNumSold, fCardName, fPrice, search });
  }, [sortCol, sortDir, fPlatform, fGrade, fCompany, fPartNumber, fNumListed, fNumSold, fCardName, fPrice, search]);

  const MINS = {
    part:        colMinWidth('Part #',    false, true),   // ~100
    card:        colMinWidth('Card Name', true,  true),   // ~145
    company:     colMinWidth('Company',   false, true),   // ~115
    grade:       colMinWidth('Grade',     false, true),   // ~95
    platform:    colMinWidth('Platform',  true,  true),   // ~140
    price:       colMinWidth('Price',     true,  true),   // ~110
    link:        colMinWidth('Listing',   false, false),  // ~85
    num_listed:  colMinWidth('# Listed',  true,  true),   // ~130
    num_sold:    colMinWidth('# Sold',    true,  true),   // ~115
  };
  const { rz, totalWidth } = useColWidths({
    part: Math.max(MINS.part, 190), card: Math.max(MINS.card, 500),
    company: Math.max(MINS.company, 90), grade: Math.max(MINS.grade, 175),
    platform: Math.max(MINS.platform, 110), price: Math.max(MINS.price, 100),
    link: Math.max(MINS.link, 70), num_listed: Math.max(MINS.num_listed, 110),
    num_sold: Math.max(MINS.num_sold, 100),
  });

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
    search: debouncedSearch || undefined,
  };

  const { data, isLoading } = useQuery<PaginatedResult<AggregatedListing>>({
    queryKey: ['listings', params],
    queryFn: () => api.get('/listings', { params }).then((r) => r.data),
  });

  const hasActiveFilters = fPlatform !== null || fGrade !== null || fCompany !== null ||
    fPartNumber !== null || fNumListed !== null || fNumSold !== null ||
    fCardName !== null || fPrice !== null || !!debouncedSearch;

  const sh = { sortCol, sortDir, onSort: handleSort };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-100">Listings</h1>
        <div className="flex items-center gap-3">
          {hasActiveFilters && (
            <button onClick={() => { setFPlatform(null); setFGrade(null); setFCompany(null); setFPartNumber(null); setFNumListed(null); setFNumSold(null); setFCardName(null); setFPrice(null); setSearch(''); }}
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
                <ColHeader label="Part #"                          {...sh} {...rz('part')}    minWidth={MINS.part}
                  filterOptions={filterOptions?.part_numbers} filterSelected={fPartNumber} onFilterChange={(v) => { setFPartNumber(v); setPage(1); }} />
                <ColHeader label="Card Name"    col="card_name"  {...sh} {...rz('card')}    minWidth={MINS.card}
                  filterOptions={filterOptions?.card_names} filterSelected={fCardName} onFilterChange={(v) => { setFCardName(v); setPage(1); }} />
                <ColHeader label="Company"                         {...sh} {...rz('company')} minWidth={MINS.company}
                  filterOptions={filterOptions?.companies} filterSelected={fCompany} onFilterChange={(v) => { setFCompany(v); setPage(1); }} />
                <ColHeader label="Grade"                          {...sh} {...rz('grade')}   minWidth={MINS.grade}
                  filterOptions={filterOptions?.grades} filterSelected={fGrade} onFilterChange={(v) => { setFGrade(v); setPage(1); }} />
                <ColHeader label="Platform"     col="platform"   {...sh} {...rz('platform')} minWidth={MINS.platform}
                  filterOptions={filterOptions?.platforms} filterSelected={fPlatform} onFilterChange={(v) => { setFPlatform(v); setPage(1); }} />
                <ColHeader label="Price"      col="list_price"  {...sh} {...rz('price')} align="right" minWidth={MINS.price}
                  filterOptions={filterOptions?.prices} filterSelected={fPrice} onFilterChange={(v) => { setFPrice(v); setPage(1); }} />
                <ColHeader label="Listing"                       {...sh} {...rz('link')} align="center" minWidth={MINS.link} />
                <ColHeader label="# Listed"   col="num_listed"  {...sh} {...rz('num_listed')} align="center" minWidth={MINS.num_listed}
                  filterOptions={filterOptions?.num_listed} filterSelected={fNumListed} onFilterChange={(v) => { setFNumListed(v); setPage(1); }} />
                <ColHeader label="# Sold"     col="num_sold"    {...sh} {...rz('num_sold')} align="center" minWidth={MINS.num_sold}
                  filterOptions={filterOptions?.num_sold} filterSelected={fNumSold} onFilterChange={(v) => { setFNumSold(v); setPage(1); }} />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {!data?.data.length ? (
                <tr><td colSpan={9} className="px-3 py-10 text-center text-zinc-500">No listings found.</td></tr>
              ) : data.data.map((row, i) => (
                <tr key={i} onClick={() => setEditRow(row)} className="hover:bg-zinc-800/30 transition-colors cursor-pointer">
                  <td className="px-3 py-2 font-mono text-zinc-500 text-[11px] truncate" title={row.part_number ?? ''}>{row.part_number ?? '—'}</td>
                  <td className="px-3 py-2">
                    <p className="font-medium text-zinc-200 truncate" title={row.card_name ?? ''}>{row.card_name ?? 'Unknown'}</p>
                    {row.set_name && <p className="text-[10px] text-zinc-500 truncate">{row.set_name}</p>}
                  </td>
                  <td className="px-3 py-2 text-zinc-400 text-[11px]">{row.grading_company ?? '—'}</td>
                  <td className="px-3 py-2 text-zinc-300 text-[11px]">{row.grade_label ?? '—'}</td>
                  <td className="px-3 py-2 text-zinc-300 capitalize">{row.platform}</td>
                  <td className="px-3 py-2 text-right text-zinc-300">
                    {formatCurrency(row.list_price ?? 0, row.currency)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {row.ebay_listing_url ? (
                      <a href={row.ebay_listing_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex text-blue-400 hover:text-blue-300">
                        <ExternalLink size={13} />
                      </a>
                    ) : '—'}
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
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data && (
        <div className="flex items-center justify-between px-6 py-3 pr-44 border-t border-zinc-800 text-xs text-zinc-500">
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

      <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="Record Listing" className="max-w-2xl">
        <AddListingModal onClose={() => setShowAddModal(false)} />
      </Modal>

      <Modal open={!!editRow} onClose={() => setEditRow(null)} title="Edit Listing">
        {editRow && <EditListingModal row={editRow} onClose={() => setEditRow(null)} />}
      </Modal>
    </div>
  );
}
