import { useState, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Plus, X, Loader2, Pencil, Trash2, ExternalLink } from 'lucide-react';
import { api, type PaginatedResult } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { formatCurrency, formatDate, cn } from '../lib/utils';
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
  condition: string | null;
  quantity: number;
  lot_available_qty: number;
  cert_number: string | null;
  raw_purchase_label: string | null;
  unique_id: string | null;
  unique_id_2: string | null;
  raw_cost: number;
  grading_cost: number | null;
  listed_price: number | null;
  order_details_link: string | null;
  card_show_id: string | null;
  card_show_name: string | null;
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
  location_name: string | null;
  card_show_price: number | null;
  is_card_show: boolean;
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
  listed_price: number | null;
  listing_id: string | null;
  card_show_price: number | null;
  location_name: string | null;
}

interface BulkCartItem {
  cart_entry_id: string;  // unique per cart row; lets the same card_instance be added multiple times
  id: string;             // card_instance_id (the source lot — may repeat across entries)
  listing_id?: string | null;
  card_name: string | null;
  set_name: string | null;
  cert_number: string | null;
  grade_label: string | null;
  company: string | null;
  raw_purchase_label: string | null;
  sticker_price_input: string;  // raw string
  final_price_input: string;    // raw string, used at submit
  card_type: 'graded' | 'raw';
  /** For raw lots: how many cards from this lot to sell (defaults to 1). */
  quantity: number;
  /** Source lot quantity — cap for the qty input. Always 1 for graded. */
  lot_quantity: number;
  // Standing reference prices on the underlying card / listing — surfaced
  // inline so the user can edit them right from the cart without leaving
  // the bulk flow. NOT the same as sticker_price_input above (which is
  // this sale's per-row price).
  card_show_price: number | null;
  listed_price: number | null;
  is_listed: boolean;
  // Local draft state for the inline CS/Listed price inputs. Empty when
  // not actively editing; populated on focus so blur can detect changes.
  cs_price_draft?: string;
  listed_price_draft?: string;
}

interface RawCardShowResult {
  id: string;
  card_name: string | null;
  set_name: string | null;
  condition: string | null;
  card_show_price: number | null;
  listed_price: number | null;
  listing_id: string | null;
  is_listed: boolean;
  raw_purchase_label: string | null;
  quantity: number;
}

// ── Record Sale Modal ─────────────────────────────────────────────────────────

function RecordSaleModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'platform-type' | 'type' | 'search' | 'copies' | 'raw-search' | 'raw-select' | 'other-lookup' | 'details' | 'bulk-search' | 'bulk-review' | 'bulk-confirm'>('platform-type');
  const [saleMode, setSaleMode] = useState<'graded' | 'raw'>('graded');

  // Step 1a — card name search (graded)
  const [gradedSearchMode, setGradedSearchMode] = useState<'name' | 'url'>('name');
  const [cardSearch, setCardSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedCardName, setSelectedCardName] = useState<string | null>(null);
  const [listingUrl, setListingUrl] = useState('');
  const [urlLookupLoading, setUrlLookupLoading] = useState(false);

  // Step 1b — copy selection (graded)
  const [selectedCard, setSelectedCard] = useState<SlabResult | null>(null);
  const [listedOnly, setListedOnly] = useState(true);

  // Raw mode
  const [rawSearchMode, setRawSearchMode] = useState<'name' | 'id' | 'url'>('name');
  const [rawSearch, setRawSearch] = useState('');
  const [debouncedRawSearch, setDebouncedRawSearch] = useState('');
  const [selectedRawCardName, setSelectedRawCardName] = useState<string | null>(null);
  const [selectedRawCard, setSelectedRawCard] = useState<RawCardResult | null>(null);
  const [rawListingUrl, setRawListingUrl] = useState('');
  const [rawUrlLookupLoading, setRawUrlLookupLoading] = useState(false);

  // Bulk sale state
  const [bulkCart, setBulkCart] = useState<BulkCartItem[]>([]);
  const [bulkSearch, setBulkSearch] = useState('');
  const [debouncedBulkSearch, setDebouncedBulkSearch] = useState('');
  const [bulkExactMatch, setBulkExactMatch] = useState(false);
  const [bulkDiscount, setBulkDiscount] = useState('');
  const [bulkTab, setBulkTab] = useState<'graded' | 'raw'>('graded');
  const [bulkSearchMode, setBulkSearchMode] = useState<'search' | 'url'>('search');
  const [bulkUrl, setBulkUrl] = useState('');
  const [bulkUrlLoading, setBulkUrlLoading] = useState(false);
  // Re-add confirmation for the bulk raw cart — replaces window.confirm so the
  // prompt matches the rest of the app's styling.
  const [reAddPrompt, setReAddPrompt] = useState<{
    cardName: string;
    usedQty: number;
    lotQty: number;
    onConfirm: () => void;
  } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedBulkSearch(bulkSearch), 300);
    return () => clearTimeout(t);
  }, [bulkSearch]);

  // Step 2 — sale details
  const [platform, setPlatform] = useState<string>('');
  const [cardShowId, setCardShowId] = useState<string>('');
  const [showArchived, setShowArchived] = useState(false);
  const [strikePrice, setStrikePrice] = useState('');
  const [rawSaleQty, setRawSaleQty] = useState('1');
  // Reset Sell qty whenever the picked raw card changes so a stale value
  // (e.g. '5' typed for a prior 5-card lot) can't quietly flip the whole
  // stack sold on the next card.
  useEffect(() => {
    setRawSaleQty('1');
  }, [selectedRawCard?.id]);

  // Auto-fill Strike Price from the card's existing reference price when a
  // raw card is picked — CS sticker for card_show, list price for ebay.
  // Matches what the bulk-sale cart already does on add. Only fires when
  // Strike is still empty so user-typed values aren't clobbered.
  useEffect(() => {
    if (!selectedRawCard) return;
    if (strikePrice) return;
    const ref = platform === 'card_show'
      ? selectedRawCard.card_show_price
      : platform === 'ebay'
        ? selectedRawCard.listed_price
        : null;
    if (ref && ref > 0) setStrikePrice((ref / 100).toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRawCard?.id, platform]);

  // Same auto-fill for graded — defaults strike from the slab's active
  // listing price when present and Strike is empty.
  useEffect(() => {
    if (!selectedCard) return;
    if (strikePrice) return;
    const ref = selectedCard.listed_price;
    if (ref && ref > 0) setStrikePrice((ref / 100).toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCard?.id]);

  // Sync the CS/Listed Price form inputs with whichever card is currently
  // selected. Empty string when no value is set so the placeholder shows.
  useEffect(() => {
    const activeCard = saleMode === 'raw' ? selectedRawCard : selectedCard;
    setCsPriceInput(activeCard?.card_show_price ? (activeCard.card_show_price / 100).toFixed(2) : '');
    setListedPriceInput(activeCard?.listed_price ? (activeCard.listed_price / 100).toFixed(2) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRawCard?.id, selectedCard?.id, saleMode]);
  const [orderEarnings, setOrderEarnings] = useState('');
  const [ebayLink, setEbayLink] = useState('');
  const [notes, setNotes] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [soldAt, setSoldAt] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Card Show sticker + eBay list price inputs — shown as labeled form
  // lines above Strike Price. Both save on blur via dedicated mutations
  // and reflect updates back into the local selectedRawCard / selectedCard.
  const [csPriceInput,     setCsPriceInput]     = useState('');
  const [listedPriceInput, setListedPriceInput] = useState('');
  const csPriceMut = useMutation({
    mutationFn: ({ id, cents }: { id: string; cents: number | null }) =>
      api.patch(`/cards/${id}`, { card_show_price: cents }),
    onSuccess: (_data, vars) => {
      if (selectedRawCard && selectedRawCard.id === vars.id) {
        setSelectedRawCard({ ...selectedRawCard, card_show_price: vars.cents });
      } else if (selectedCard && selectedCard.id === vars.id) {
        setSelectedCard({ ...selectedCard, card_show_price: vars.cents });
      }
      // Fan out to bulk cart rows pointing at the same card_instance so they
      // reflect the new sticker without a refetch. cs_price_draft is cleared
      // so the next focus re-initialises from the new value.
      setBulkCart(prev => prev.map(c => c.id === vars.id
        ? { ...c, card_show_price: vars.cents, cs_price_draft: undefined }
        : c));
      queryClient.invalidateQueries({ queryKey: ['sale-raw-search'] });
      queryClient.invalidateQueries({ queryKey: ['card-show-raw'] });
      toast.success('CS price updated');
    },
    onError: () => toast.error('Failed to update CS price'),
  });
  function commitCsPrice() {
    const activeCard = saleMode === 'raw' ? selectedRawCard : selectedCard;
    if (!activeCard) return;
    const current = activeCard.card_show_price ?? null;
    const trimmed = csPriceInput.trim();
    const cents = trimmed === '' ? null : Math.round(parseFloat(trimmed) * 100);
    if (cents !== null && (!Number.isFinite(cents) || cents < 0)) {
      toast.error('Enter a valid CS price');
      return;
    }
    if (cents === current) return;
    csPriceMut.mutate({ id: activeCard.id, cents });
  }
  const listedPriceMut = useMutation({
    mutationFn: ({ listingId, cents }: { listingId: string; cents: number }) =>
      api.patch(`/listings/${listingId}`, { list_price: cents / 100 }),
    onSuccess: (_data, vars) => {
      if (selectedRawCard && selectedRawCard.listing_id === vars.listingId) {
        setSelectedRawCard({ ...selectedRawCard, listed_price: vars.cents });
      } else if (selectedCard && selectedCard.listing_id === vars.listingId) {
        setSelectedCard({ ...selectedCard, listed_price: vars.cents });
      }
      // Fan out to bulk cart rows pointing at the same listing.
      setBulkCart(prev => prev.map(c => c.listing_id === vars.listingId
        ? { ...c, listed_price: vars.cents, listed_price_draft: undefined }
        : c));
      queryClient.invalidateQueries({ queryKey: ['sale-raw-search'] });
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      toast.success('Listed price updated');
    },
    onError: () => toast.error('Failed to update listed price'),
  });
  // Per-row commit helpers for the bulk cart's inline CS / Listed inputs.
  function commitCartCsPrice(cartEntryId: string) {
    const row = bulkCart.find(c => c.cart_entry_id === cartEntryId);
    if (!row || row.cs_price_draft === undefined) return;
    const trimmed = row.cs_price_draft.trim();
    const cents = trimmed === '' ? null : Math.round(parseFloat(trimmed) * 100);
    if (cents !== null && (!Number.isFinite(cents) || cents < 0)) {
      toast.error('Enter a valid CS price');
      return;
    }
    if (cents === (row.card_show_price ?? null)) {
      setBulkCart(prev => prev.map(c => c.cart_entry_id === cartEntryId ? { ...c, cs_price_draft: undefined } : c));
      return;
    }
    csPriceMut.mutate({ id: row.id, cents });
  }
  function commitCartListedPrice(cartEntryId: string) {
    const row = bulkCart.find(c => c.cart_entry_id === cartEntryId);
    if (!row?.listing_id || row.listed_price_draft === undefined) return;
    const trimmed = row.listed_price_draft.trim();
    if (trimmed === '') {
      toast.error('Listed price cannot be empty — cancel the listing on the Listings page instead');
      setBulkCart(prev => prev.map(c => c.cart_entry_id === cartEntryId ? { ...c, listed_price_draft: undefined } : c));
      return;
    }
    const cents = Math.round(parseFloat(trimmed) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      toast.error('Enter a valid listed price');
      return;
    }
    if (cents === (row.listed_price ?? null)) {
      setBulkCart(prev => prev.map(c => c.cart_entry_id === cartEntryId ? { ...c, listed_price_draft: undefined } : c));
      return;
    }
    listedPriceMut.mutate({ listingId: row.listing_id, cents });
  }

  function commitListedPrice() {
    const activeCard = saleMode === 'raw' ? selectedRawCard : selectedCard;
    if (!activeCard?.listing_id) return;
    const current = activeCard.listed_price ?? null;
    const trimmed = listedPriceInput.trim();
    if (trimmed === '') {
      toast.error('Listed price cannot be empty — cancel the listing on the Listings page instead');
      setListedPriceInput(current != null ? (current / 100).toFixed(2) : '');
      return;
    }
    const cents = Math.round(parseFloat(trimmed) * 100);
    if (!Number.isFinite(cents) || cents < 0) {
      toast.error('Enter a valid listed price');
      return;
    }
    if (cents === current) return;
    listedPriceMut.mutate({ listingId: activeCard.listing_id, cents });
  }

  const { data: cardShowsData } = useQuery<{ data: Array<{ id: string; name: string; show_date: string; end_date: string | null; num_days: number; location: string | null }> }>({
    queryKey: ['card-shows'],
    queryFn: () => api.get('/card-shows').then((r) => r.data),
    enabled: platform === 'card_show',
  });

  const selectedShow = cardShowId ? (cardShowsData?.data ?? []).find((s) => s.id === cardShowId) : null;
  const showDateMin = selectedShow?.show_date.slice(0, 10) ?? undefined;
  const showDateMax = selectedShow ? (selectedShow.end_date?.slice(0, 10) ?? selectedShow.show_date.slice(0, 10)) : undefined;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(cardSearch), 300);
    return () => clearTimeout(t);
  }, [cardSearch]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedRawSearch(rawSearch), 300);
    return () => clearTimeout(t);
  }, [rawSearch]);

  // Phase 1: search for card names (deduped by name in the dropdown)
  const { data: searchResults, isFetching: isSearching } = useQuery<PaginatedResult<SlabResult>>({
    queryKey: ['card-name-search', debouncedSearch],
    queryFn: () => api.get('/grading/slabs', {
      params: { search: debouncedSearch, limit: 100, status: 'unsold', sort_by: 'card_name', sort_dir: 'asc', personal_collection: 'no' },
    }).then(r => r.data),
    enabled: debouncedSearch.length >= 2 && (step === 'search' || (step === 'other-lookup' && saleMode === 'graded')),
  });

  // Phase 2: fetch all copies of selected card name, sorted by cert number (FIFO)
  const { data: copiesResult, isFetching: isLoadingCopies } = useQuery<PaginatedResult<SlabResult>>({
    queryKey: ['card-copies', selectedCardName],
    queryFn: () => api.get('/grading/slabs', {
      params: { search: selectedCardName, limit: 200, status: 'unsold', sort_by: 'cert_number', sort_dir: 'asc', personal_collection: 'no' },
    }).then(r => r.data),
    enabled: !!selectedCardName && step === 'copies',
  });

  // Raw card search
  const { data: rawResults, isFetching: isRawSearching } = useQuery<PaginatedResult<RawCardResult>>({
    queryKey: ['sale-raw-search', debouncedRawSearch],
    queryFn: () => api.get('/cards', {
      params: { search: debouncedRawSearch, decision: 'sell_raw', status: 'purchased_raw,inspected,raw_for_sale', limit: 100, sort_by: 'card_name', sort_dir: 'asc', is_personal_collection: 'no' },
    }).then(r => r.data),
    enabled: debouncedRawSearch.length >= 2 && (step === 'raw-search' || step === 'raw-select' || (step === 'other-lookup' && saleMode === 'raw')),
  });

  // Bulk search: card show graded inventory
  const bulkIsEbay = platform === 'ebay';
  const { data: bulkSearchResults, isFetching: isBulkSearching } = useQuery<PaginatedResult<SlabResult>>({
    queryKey: ['bulk-sale-search', debouncedBulkSearch, bulkIsEbay, bulkExactMatch],
    queryFn: () => api.get('/grading/slabs', {
      params: bulkIsEbay
        ? { search: debouncedBulkSearch, limit: 50, status: 'unsold', for_sale: 'yes', sort_by: 'card_name', sort_dir: 'asc', personal_collection: 'no', exact: bulkExactMatch ? 'true' : undefined }
        : { search: debouncedBulkSearch, limit: 50, status: 'unsold', is_card_show: 'yes', sort_by: 'card_name', sort_dir: 'asc', personal_collection: 'no', exact: bulkExactMatch ? 'true' : undefined },
    }).then(r => r.data),
    enabled: step === 'bulk-search' && bulkTab === 'graded',
  });
  // Bulk search: raw inventory
  // For card shows, we don't enforce is_card_show=yes — users don't pre-tag
  // raw cards to a show, so the filter would hide everything sellable.
  // Status list matches the individual raw sale flow so inspected/awaiting
  // cards are reachable from bulk too.
  const { data: bulkRawResults, isFetching: isBulkRawSearching } = useQuery<PaginatedResult<RawCardShowResult>>({
    queryKey: ['bulk-sale-raw-search', debouncedBulkSearch, bulkIsEbay, bulkExactMatch],
    queryFn: () => api.get('/cards', {
      params: bulkIsEbay
        ? { search: debouncedBulkSearch || undefined, limit: 50, is_listed: 'yes', status: 'purchased_raw,inspected,raw_for_sale', decision: 'sell_raw', is_personal_collection: 'no', exact: bulkExactMatch ? 'true' : undefined }
        : { search: debouncedBulkSearch || undefined, limit: 50, status: 'purchased_raw,inspected,raw_for_sale', decision: 'sell_raw', is_personal_collection: 'no', exact: bulkExactMatch ? 'true' : undefined },
    }).then(r => r.data),
    enabled: step === 'bulk-search' && bulkTab === 'raw',
  });
  const bulkSearchRows = bulkSearchResults?.data ?? [];
  const bulkRawRows = bulkRawResults?.data ?? [];

  const uniqueRawCardNames = rawResults
    ? Array.from(
        rawResults.data.reduce((map, c) => {
          const name = c.card_name ?? 'Unknown';
          map.set(name, (map.get(name) ?? 0) + 1);
          return map;
        }, new Map<string, number>())
      )
    : [];
  const rawCopiesForName = (rawResults?.data ?? []).filter(c => c.card_name === selectedRawCardName);

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

  // Filter copies to exact name match, then optionally to listed-only (eBay only)
  const allCopies = copiesResult?.data.filter(c => c.card_name === selectedCardName && !c.is_personal_collection) ?? [];
  const copies = (platform === 'ebay' && listedOnly) ? allCopies.filter(c => c.is_listed) : allCopies;
  const listedCount = allCopies.filter(c => c.is_listed).length;

  // Auto-select first copy in filtered list (FIFO) — only on the copies step.
  // Use functional setState so we don't clobber a user's manual click on every
  // render (copies is a fresh array ref each render).
  useEffect(() => {
    if (step !== 'copies') return;
    setSelectedCard(prev => {
      if (prev && copies.some(c => c.id === prev.id)) return prev;
      return copies.length > 0 ? copies[0] : null;
    });
  }, [copies, step]);


  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cardId = saleMode === 'raw' ? selectedRawCard?.id : selectedCard?.id;
    if (!cardId) { toast.error('Select a card'); return; }
    // Empty is invalid; 0 is allowed (giveaway / total loss).
    if (!strikePrice.trim() || isNaN(parseFloat(strikePrice)) || parseFloat(strikePrice) < 0) {
      toast.error('Enter a strike price (0 is OK for giveaways)'); return;
    }
    // Raw lots can carry quantity > 1; validate the user-entered qty.
    let qtyToSell: number | undefined;
    if (saleMode === 'raw' && selectedRawCard) {
      const max = selectedRawCard.quantity;
      const qty = parseInt(rawSaleQty || '1', 10);
      if (!Number.isFinite(qty) || qty < 1) { toast.error('Quantity must be at least 1'); return; }
      if (qty > max) { toast.error(`Only ${max} of these in inventory; can't sell ${qty}`); return; }
      qtyToSell = qty;
    }
    const strikeCents = Math.round(parseFloat(strikePrice) * 100);
    const earningsCents = platform === 'ebay' && orderEarnings ? Math.round(parseFloat(orderEarnings) * 100) : strikeCents;
    const feesCents = Math.max(0, strikeCents - earningsCents);
    setSubmitting(true);
    try {
      await api.post('/sales', {
        card_instance_id: cardId,
        listing_id: saleMode === 'raw' ? undefined : (selectedCard?.listing_id ?? undefined),
        platform,
        card_show_id: platform === 'card_show' && cardShowId ? cardShowId : undefined,
        sale_price: strikePrice,
        platform_fees: feesCents > 0 ? String(feesCents / 100) : undefined,
        currency,
        sold_at: soldAt || undefined,
        unique_id: platform === 'ebay' ? (orderNumber || undefined) : undefined,
        unique_id_2: notes || undefined,
        order_details_link: platform === 'ebay' ? (ebayLink || undefined) : undefined,
        quantity: qtyToSell,
      });
      toast.success('Sale recorded!');
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to record sale');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBulkUrlLookup() {
    if (!bulkUrl.trim()) return;
    setBulkUrlLoading(true);
    try {
      const res = await api.get('/listings/by-url/all', { params: { url: bulkUrl.trim() } });
      const rows: Array<{
        id: string; listing_id: string; card_name: string | null; set_name: string | null;
        cert_number: string | null; grade_label: string | null; company: string | null;
        raw_purchase_label: string | null; card_show_price: number | null;
        condition: string | null; list_price?: number | null; listed_price?: number | null;
      }> = res.data.data;
      if (!rows.length) { toast.error('No active listings found for that URL'); return; }
      const alreadyAdded = new Set(bulkCart.map(c => c.id));
      // Deduplicate: one card per unique identity (name + grade + company)
      const seenIdentities = new Set<string>();
      const newItems: BulkCartItem[] = rows
        .filter(r => {
          if (alreadyAdded.has(r.id)) return false;
          const key = `${r.card_name ?? ''}|${r.grade_label ?? ''}|${r.company ?? ''}`;
          if (seenIdentities.has(key)) return false;
          seenIdentities.add(key);
          return true;
        })
        .map<BulkCartItem>(r => ({
          cart_entry_id: crypto.randomUUID(),
          id: r.id,
          listing_id: r.listing_id,
          card_name: r.card_name,
          set_name: r.set_name,
          cert_number: r.cert_number,
          grade_label: r.grade_label ?? r.condition,
          company: r.company,
          raw_purchase_label: r.raw_purchase_label,
          sticker_price_input: r.card_show_price ? (r.card_show_price / 100).toFixed(2) : '',
          final_price_input: r.card_show_price ? (r.card_show_price / 100).toFixed(2) : '',
          card_type: r.cert_number ? 'graded' : 'raw',
          quantity: 1,
          // URL-lookup path doesn't return the source lot quantity; default to
          // 1 (the lookup is per-listing, which is usually one card anyway).
          lot_quantity: 1,
          card_show_price: r.card_show_price ?? null,
          listed_price: r.list_price ?? r.listed_price ?? null,
          is_listed: true,  // came from /listings/by-url so it IS listed
        }));
      if (!newItems.length) { toast('All cards from that URL are already in the cart'); return; }
      setBulkCart(prev => [...prev, ...newItems]);
      toast.success(`Added ${newItems.length} card${newItems.length !== 1 ? 's' : ''} from listing`);
      setBulkUrl('');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Could not find listing');
    } finally {
      setBulkUrlLoading(false);
    }
  }

  // ── Step: platform-type ───────────────────────────────────────────────────

  if (step === 'platform-type') return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">Where is this sale from?</p>
      <div className="grid grid-cols-2 gap-3">
        <button type="button"
          onClick={() => { setPlatform('ebay'); setListedOnly(true); setStep('type'); }}
          className="rounded-xl border-2 border-indigo-500 bg-indigo-500/10 px-4 py-5 text-left hover:bg-indigo-500/20 transition-colors">
          <p className="text-sm font-semibold text-indigo-300">eBay</p>
          <p className="text-xs text-zinc-500 mt-0.5">Listed inventory, FIFO cert selection</p>
        </button>
        <button type="button"
          onClick={() => { setPlatform('card_show'); setListedOnly(false); setStep('type'); }}
          className="rounded-xl border-2 border-zinc-700 bg-zinc-800/40 px-4 py-5 text-left hover:border-zinc-500 hover:bg-zinc-800 transition-colors">
          <p className="text-sm font-semibold text-zinc-200">Other</p>
          <p className="text-xs text-zinc-500 mt-0.5">Card shows, private sales, etc.</p>
        </button>
      </div>
      <div className="flex justify-end pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );

  // ── Step: type ────────────────────────────────────────────────────────────

  if (step === 'type') return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <button type="button" onClick={() => setStep('platform-type')} className="text-xs text-zinc-500 hover:text-zinc-300">← Back</button>
        <span className="text-xs text-zinc-600">{platform === 'ebay' ? 'eBay' : 'Other'}</span>
      </div>
      <p className="text-xs text-zinc-500">What type of card are you selling?</p>
      <div className={cn('grid gap-3', (platform === 'card_show' || platform === 'ebay') ? 'grid-cols-3' : 'grid-cols-2')}>
        <button type="button"
          onClick={() => { setSaleMode('graded'); setStep(platform === 'ebay' ? 'search' : 'other-lookup'); }}
          className="rounded-xl border-2 border-indigo-500 bg-indigo-500/10 px-4 py-5 text-left hover:bg-indigo-500/20 transition-colors">
          <p className="text-sm font-semibold text-indigo-300">Graded</p>
          <p className="text-xs text-zinc-500 mt-0.5">PSA, BGS, CGC slabs</p>
        </button>
        <button type="button"
          onClick={() => { setSaleMode('raw'); setStep(platform === 'ebay' ? 'raw-search' : 'other-lookup'); }}
          className="rounded-xl border-2 border-zinc-700 bg-zinc-800/40 px-4 py-5 text-left hover:border-zinc-500 hover:bg-zinc-800 transition-colors">
          <p className="text-sm font-semibold text-zinc-200">Raw</p>
          <p className="text-xs text-zinc-500 mt-0.5">Ungraded cards</p>
        </button>
        {platform === 'card_show' && (
          <button type="button"
            onClick={() => { setBulkCart([]); setBulkSearch(''); setBulkDiscount(''); setBulkUrl(''); setBulkSearchMode('search'); setStep('bulk-search'); }}
            className="rounded-xl border-2 border-teal-600/60 bg-teal-500/10 px-4 py-5 text-left hover:bg-teal-500/20 transition-colors">
            <p className="text-sm font-semibold text-teal-300">Bulk Sale</p>
            <p className="text-xs text-zinc-500 mt-0.5">Multiple cards, one transaction</p>
          </button>
        )}
        {platform === 'ebay' && (
          <button type="button"
            onClick={() => { setBulkCart([]); setBulkSearch(''); setBulkDiscount(''); setBulkUrl(''); setBulkSearchMode('search'); setStep('bulk-search'); }}
            className="rounded-xl border-2 border-teal-600/60 bg-teal-500/10 px-4 py-5 text-left hover:bg-teal-500/20 transition-colors">
            <p className="text-sm font-semibold text-teal-300">Set Listing</p>
            <p className="text-xs text-zinc-500 mt-0.5">Multiple cards, total split evenly</p>
          </button>
        )}
      </div>
      <div className="flex justify-end pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );

  // ── Step 1a: Search by card name (graded) ─────────────────────────────────

  if (step === 'search') return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setStep('type')} className="text-xs text-zinc-500 hover:text-zinc-300">← Back</button>
          <span className="text-xs text-zinc-600">Graded</span>
        </div>
        {platform === 'ebay' && (
          <div className="flex gap-1">
            {(['name', 'url'] as const).map((m) => (
              <button key={m} type="button" onClick={() => setGradedSearchMode(m)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${gradedSearchMode === m ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                {m === 'name' ? 'Name' : 'Listing URL'}
              </button>
            ))}
          </div>
        )}
      </div>

      {(platform !== 'ebay' || gradedSearchMode === 'name') ? (
        <>
          <div className="relative">
            <Input label="Search Card" placeholder="Card name or cert number…"
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
                    onClick={() => { setSelectedCardName(name); setCardSearch(name); setSelectedCard(null); setStep('copies'); }}>
                    <span className="text-sm text-zinc-200 truncate">{name}</span>
                    <span className="shrink-0 text-[10px] text-zinc-500 tabular-nums">{count} unsold</span>
                  </button>
                ))}
              </div>
            ) : !isSearching ? (
              <p className="text-xs text-zinc-500 px-1">No unsold copies found.</p>
            ) : null
          )}
        </>
      ) : (
        <>
          <Input label="eBay Listing URL" type="url" placeholder="https://www.ebay.com/itm/…"
            value={listingUrl} onChange={(e) => setListingUrl(e.target.value)} autoFocus />
          <Button type="button" disabled={!listingUrl || urlLookupLoading}
            onClick={async () => {
              setUrlLookupLoading(true);
              try {
                const res = await api.get('/listings/by-url', { params: { url: listingUrl } });
                setSelectedCard(res.data.data);
                setStep('details');
              } catch {
                toast.error('No active listing found for that URL');
              } finally {
                setUrlLookupLoading(false);
              }
            }}>
            {urlLookupLoading ? <Loader2 size={14} className="animate-spin" /> : null}
            Find Card
          </Button>
        </>
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

  // ── Step: raw-search ─────────────────────────────────────────────────────

  if (step === 'raw-search') return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setStep('type')} className="text-xs text-zinc-500 hover:text-zinc-300">← Back</button>
          <span className="text-xs text-zinc-600">Raw</span>
        </div>
        <div className="flex gap-1">
          {(['name', 'id', 'url'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setRawSearchMode(m)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${rawSearchMode === m ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
              {m === 'name' ? 'Name' : m === 'id' ? 'Purchase ID' : 'Listing URL'}
            </button>
          ))}
        </div>
      </div>

      {rawSearchMode === 'url' ? (
        <>
          <Input label="eBay Listing URL" type="url" placeholder="https://www.ebay.com/itm/…"
            value={rawListingUrl} onChange={(e) => setRawListingUrl(e.target.value)} autoFocus />
          <Button type="button" disabled={!rawListingUrl || rawUrlLookupLoading}
            onClick={async () => {
              setRawUrlLookupLoading(true);
              try {
                const res = await api.get('/listings/by-url', { params: { url: rawListingUrl } });
                const d = res.data.data;
                setSelectedRawCard({
                  id: d.id,
                  card_name: d.card_name,
                  set_name: d.set_name,
                  card_number: null,
                  condition: d.condition ?? null,
                  quantity: 1,
                  purchase_cost: null,
                  currency: d.currency,
                  raw_purchase_label: d.raw_purchase_label ?? null,
                  is_listed: true,
                  listed_price: d.listed_price ?? null,
                  listing_id: d.listing_id ?? null,
                  card_show_price: d.card_show_price ?? null,
                  location_name: d.location_name ?? null,
                });
                setStep('details');
              } catch {
                toast.error('No active raw listing found for that URL');
              } finally {
                setRawUrlLookupLoading(false);
              }
            }}>
            {rawUrlLookupLoading ? <Loader2 size={14} className="animate-spin" /> : null}
            Find Card
          </Button>
        </>
      ) : (
        <>
          <div className="relative">
            <Input
              label="Search Card"
              placeholder={rawSearchMode === 'name' ? 'Card name or part number…' : 'Purchase ID (e.g. 2026R10)…'}
              value={rawSearch} onChange={(e) => setRawSearch(e.target.value)}
              autoComplete="off" autoFocus
            />
            {isRawSearching && <Loader2 size={13} className="absolute right-3 top-[30px] animate-spin text-zinc-500" />}
          </div>

          {debouncedRawSearch.length >= 2 && (
            rawSearchMode === 'name' ? (
              uniqueRawCardNames.length > 0 ? (
                <div className="rounded-lg border border-zinc-700 overflow-hidden">
                  {uniqueRawCardNames.map(([name, count]) => (
                    <button key={name} type="button"
                      className="w-full text-left px-4 py-3 hover:bg-zinc-800 border-b border-zinc-700/40 last:border-0 flex items-center justify-between gap-3 transition-colors"
                      onClick={() => { setSelectedRawCardName(name); setSelectedRawCard(null); setStep('raw-select'); }}>
                      <span className="text-sm text-zinc-200 truncate">{name}</span>
                      <span className="shrink-0 text-[10px] text-zinc-500 tabular-nums">{count} card{count !== 1 ? 's' : ''}</span>
                    </button>
                  ))}
                </div>
              ) : !isRawSearching ? (
                <p className="text-xs text-zinc-500 px-1">No raw cards found for sale.</p>
              ) : null
            ) : (
              (rawResults?.data ?? []).length > 0 ? (
                <div className="rounded-lg border border-zinc-700 overflow-hidden">
                  {(rawResults?.data ?? []).map((card) => (
                    <button key={card.id} type="button"
                      className="w-full text-left px-4 py-3 hover:bg-zinc-800 border-b border-zinc-700/40 last:border-0 transition-colors"
                      onClick={() => { setSelectedRawCard(card); setStep('details'); }}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-sm text-indigo-300">{card.raw_purchase_label ?? '—'}</span>
                        {card.condition && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-700/60 text-zinc-300">{card.condition}</span>}
                      </div>
                      <p className="text-[11px] text-zinc-500 mt-0.5 truncate">{card.card_name}</p>
                    </button>
                  ))}
                </div>
              ) : !isRawSearching ? (
                <p className="text-xs text-zinc-500 px-1">No raw cards found for that ID.</p>
              ) : null
            )
          )}
        </>
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
        <button type="button" onClick={() => { setStep('raw-search'); setSelectedRawCardName(null); setSelectedRawCard(null); }}
          className="text-xs text-zinc-500 hover:text-zinc-300 shrink-0">← Back</button>
        <p className="text-xs font-medium text-zinc-300 truncate">{selectedRawCardName}</p>
      </div>

      <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
        {rawCopiesForName.map((copy, idx) => {
          const isFifo = idx === 0;
          const isSelected = selectedRawCard?.id === copy.id;
          return (
            <button key={copy.id} type="button"
              onClick={() => setSelectedRawCard(copy)}
              className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
                isSelected ? 'border-amber-500/50 bg-amber-500/10' : 'border-zinc-700/50 bg-zinc-800/40 hover:bg-zinc-800'
              }`}>
              <div className="flex items-center gap-2">
                {isFifo && (
                  <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded px-1 py-0.5">FIFO</span>
                )}
                <span className="text-sm font-mono text-zinc-200">{copy.raw_purchase_label ?? '—'}</span>
                {copy.condition && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-700/60 text-zinc-300">{copy.condition}</span>}
                <span className="text-[10px] text-zinc-500">{copy.quantity} card{copy.quantity !== 1 ? 's' : ''}</span>
                {isSelected && <span className="ml-auto text-[10px] text-amber-400 font-medium">Selected</span>}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" disabled={!selectedRawCard} onClick={() => setStep('details')}>
          Continue →
        </Button>
      </div>
    </div>
  );

  // ── Step: other-lookup ───────────────────────────────────────────────────

  if (step === 'other-lookup') return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setStep('type')} className="text-xs text-zinc-500 hover:text-zinc-300">← Back</button>
        <span className="text-xs text-zinc-600">{saleMode === 'graded' ? 'Graded' : 'Raw'}</span>
      </div>

      <div className="relative">
        <Input
          label={saleMode === 'graded' ? 'Cert # or Card Name' : 'Purchase ID or Card Name'}
          placeholder={saleMode === 'graded' ? 'e.g. 12345678 or Charizard…' : 'e.g. 2026R117 or Charizard…'}
          value={saleMode === 'graded' ? cardSearch : rawSearch}
          onChange={(e) => saleMode === 'graded' ? setCardSearch(e.target.value) : setRawSearch(e.target.value)}
          autoFocus autoComplete="off"
        />
        {(isSearching || isRawSearching) && (
          <Loader2 size={13} className="absolute right-3 top-[30px] animate-spin text-zinc-500" />
        )}
      </div>

      {saleMode === 'graded' ? (
        debouncedSearch.length >= 2 && (
          (searchResults?.data.length ?? 0) > 0 ? (
            <div className="rounded-lg border border-zinc-700 overflow-hidden max-h-72 overflow-y-auto">
              {searchResults!.data.map((card) => (
                <button key={card.id} type="button"
                  className="w-full text-left px-4 py-3 hover:bg-zinc-800 border-b border-zinc-700/40 last:border-0 transition-colors"
                  onClick={() => { setSelectedCard(card); setStep('details'); }}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-zinc-200 truncate">{card.card_name}</span>
                    <span className="text-xs text-zinc-500 shrink-0">{card.company} {card.grade_label}</span>
                  </div>
                  {card.cert_number && (
                    <p className="text-[10px] font-mono text-zinc-500 mt-0.5">#{String(card.cert_number).padStart(8, '0')}</p>
                  )}
                  {card.is_listed && (
                    <p className="text-[10px] text-amber-400 mt-0.5">Active eBay listing — remember to delist</p>
                  )}
                </button>
              ))}
            </div>
          ) : !isSearching ? (
            <p className="text-xs text-zinc-500 px-1">No unsold graded cards found.</p>
          ) : null
        )
      ) : (
        debouncedRawSearch.length >= 2 && (
          (rawResults?.data.length ?? 0) > 0 ? (
            <div className="rounded-lg border border-zinc-700 overflow-hidden max-h-72 overflow-y-auto">
              {rawResults!.data.map((card) => (
                <button key={card.id} type="button"
                  className="w-full text-left px-4 py-3 hover:bg-zinc-800 border-b border-zinc-700/40 last:border-0 transition-colors"
                  onClick={() => { setSelectedRawCard(card); setStep('details'); }}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-sm text-indigo-300">{card.raw_purchase_label ?? '—'}</span>
                    {card.condition && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-zinc-700/60 text-zinc-300">{card.condition}</span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-0.5 truncate">{card.card_name}</p>
                  {card.is_listed && (
                    <p className="text-[10px] text-amber-400 mt-0.5">Active eBay listing — remember to delist</p>
                  )}
                </button>
              ))}
            </div>
          ) : !isRawSearching ? (
            <p className="text-xs text-zinc-500 px-1">No raw cards found for sale.</p>
          ) : null
        )
      )}

      <div className="flex justify-end pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );

  // ── Step 2: Sale details ──────────────────────────────────────────────────

  if (step === 'details') return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Selected card summary */}
      {saleMode === 'raw' && selectedRawCard ? (
        <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/50 px-4 py-3 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-100 truncate">{selectedRawCard.card_name}</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                {selectedRawCard.set_name}{selectedRawCard.card_number ? ` · ${selectedRawCard.card_number}` : ''}
                {selectedRawCard.condition ? <span className="ml-2 font-medium px-1.5 py-0.5 rounded bg-zinc-700/60 text-zinc-300">{selectedRawCard.condition}</span> : ''}
                {/* Always render both reference prices (em-dash when null) so
                    the user can see at a glance whether a CS sticker or eBay
                    listing exists — vs the field being silently absent. */}
                <span className={`ml-2 ${selectedRawCard.card_show_price ? 'text-zinc-400' : 'text-zinc-600'}`}>
                  CS: {selectedRawCard.card_show_price ? formatCurrency(selectedRawCard.card_show_price, selectedRawCard.currency) : '—'}
                </span>
                <span className={`ml-2 ${selectedRawCard.listed_price ? 'text-zinc-400' : 'text-zinc-600'}`}>
                  Listed: {selectedRawCard.listed_price ? formatCurrency(selectedRawCard.listed_price, selectedRawCard.currency) : '—'}
                </span>
              </p>
            </div>
            <button type="button" onClick={() => setStep('raw-select')} className="text-[11px] text-indigo-400 hover:text-indigo-300 shrink-0">Change</button>
          </div>
          <div className="border-t border-zinc-700/50 pt-2 flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-amber-400">Ship this card</span>
            <span className="font-mono text-sm text-zinc-200">{selectedRawCard.raw_purchase_label ?? '—'}</span>
          </div>
          {platform === 'ebay' && selectedRawCard.location_name && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Location</span>
              <span className="text-sm text-zinc-300">{selectedRawCard.location_name}</span>
            </div>
          )}
          {/* Always render Sell qty for raw so the user can see/confirm
              what's about to flip sold — even for qty=1 lots where the
              field is effectively read-only. */}
          <div className="flex items-center gap-2 border-t border-zinc-700/50 pt-2">
            <label className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Sell qty</label>
            <input
              type="number" min={1} max={selectedRawCard.quantity}
              value={rawSaleQty}
              readOnly={selectedRawCard.quantity === 1}
              onChange={(e) => setRawSaleQty(e.target.value)}
              className={`w-20 px-2 py-1 text-sm bg-zinc-900 border border-zinc-700 rounded text-zinc-100 focus:outline-none focus:border-indigo-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${selectedRawCard.quantity === 1 ? 'opacity-60 cursor-not-allowed' : ''}`}
            />
            <span className="text-[11px] text-zinc-500">of {selectedRawCard.quantity} in this lot</span>
          </div>
        </div>
      ) : selectedCard ? (
        <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/50 px-4 py-3 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-zinc-100 truncate">{selectedCard.card_name}</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                {selectedCard.company} {selectedCard.grade_label}
                <span className={`ml-2 ${selectedCard.card_show_price ? 'text-zinc-400' : 'text-zinc-600'}`}>
                  CS: {selectedCard.card_show_price ? formatCurrency(selectedCard.card_show_price, selectedCard.currency) : '—'}
                </span>
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
          {platform === 'ebay' && selectedCard.location_name && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Location</span>
              <span className="text-sm text-zinc-300">{selectedCard.location_name}</span>
            </div>
          )}
        </div>
      ) : null}

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
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Card Show</label>
          <select
            value={cardShowId}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '__archived__') { setShowArchived(true); return; }
              setCardShowId(val);
              const show = (cardShowsData?.data ?? []).find((s) => s.id === val);
              if (show) setSoldAt(show.show_date.slice(0, 10));
            }}
            className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors"
          >
            <option value="">— Select show (optional) —</option>
            {(() => {
              const all = cardShowsData?.data ?? [];
              const recent = all.slice(0, 3);
              const archived = all.slice(3);
              const visibleShows = showArchived ? all : recent;
              return (
                <>
                  {visibleShows.map((s) => {
                    const fmt = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
                    const dateLabel = s.num_days > 1 && s.end_date ? `${fmt(s.show_date)} – ${fmt(s.end_date)}` : fmt(s.show_date);
                    return (
                      <option key={s.id} value={s.id}>
                        {s.name} · {dateLabel}{s.location ? ` · ${s.location}` : ''}
                      </option>
                    );
                  })}
                  {!showArchived && archived.length > 0 && (
                    <option value="__archived__">— Archived Show ({archived.length} more) —</option>
                  )}
                </>
              );
            })()}
          </select>
        </div>
      )}

      {platform === 'card_show' && (selectedCard?.is_listed || selectedRawCard?.is_listed) && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
          <span className="text-amber-400 text-sm shrink-0">⚠</span>
          <p className="text-xs text-amber-300 leading-relaxed">
            This card has an active eBay listing — remember to delist it after recording this sale.
          </p>
        </div>
      )}

      {/* Reference-price form lines — shown for any sale once a card is
          selected, regardless of platform. CS Price saves on blur via
          PATCH /cards/:id; Listed Price is read-only for now (editing
          would need a per-listing PATCH endpoint). selectedRawCard /
          selectedCard reflect any CS update so the summary above stays
          in sync without a refetch. */}
      {(selectedRawCard || selectedCard) && (() => {
        const activeCurrency = saleMode === 'raw'
          ? selectedRawCard?.currency ?? 'USD'
          : selectedCard?.currency ?? 'USD';
        const showListed = platform === 'ebay';
        return (
          <div className={cn('flex flex-col gap-1', showListed && 'sm:grid sm:grid-cols-2 sm:gap-3')}>
            <div className="flex flex-col gap-1">
              <Input
                label="CS Price (sticker)"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={csPriceInput}
                onChange={(e) => setCsPriceInput(e.target.value.replace(/[^\d.]/g, ''))}
                onBlur={commitCsPrice}
                disabled={csPriceMut.isPending}
              />
              <p className="text-[11px] text-zinc-500">Saves on blur — separate from Strike Price.</p>
            </div>
            {showListed && (() => {
              const activeListingId = saleMode === 'raw'
                ? selectedRawCard?.listing_id ?? null
                : selectedCard?.listing_id ?? null;
              const noListing = !activeListingId;
              return (
                <div className="flex flex-col gap-1">
                  <Input
                    label="Listed Price (eBay)"
                    type="text"
                    inputMode="decimal"
                    placeholder={noListing ? '— no active listing —' : '0.00'}
                    value={listedPriceInput}
                    onChange={(e) => setListedPriceInput(e.target.value.replace(/[^\d.]/g, ''))}
                    onBlur={commitListedPrice}
                    disabled={noListing || listedPriceMut.isPending}
                    className={noListing ? 'opacity-60 cursor-not-allowed' : ''}
                  />
                  <p className="text-[11px] text-zinc-500">
                    {noListing
                      ? 'No active listing — create one on the Listings page first.'
                      : <>Saves to the listing on blur ({activeCurrency}). Listings page reflects this immediately.</>}
                  </p>
                </div>
              );
            })()}
          </div>
        );
      })()}

      {(() => {
        const sellQty = saleMode === 'raw' ? Math.max(1, parseInt(rawSaleQty || '1', 10) || 1) : 1;
        const isMulti = sellQty > 1;
        const strikeLabel = isMulti ? 'Strike Price (total)' : 'Strike Price';
        const priceNum = parseFloat(strikePrice);
        const perCard = isMulti && Number.isFinite(priceNum) && priceNum > 0
          ? (priceNum / sellQty).toFixed(2)
          : null;
        return platform === 'ebay' ? (
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Input label={strikeLabel} type="text" inputMode="decimal" placeholder="0.00"
                value={strikePrice} onChange={(e) => setStrikePrice(e.target.value)} />
              {perCard && <p className="text-[11px] text-zinc-500">≈ ${perCard} per card</p>}
            </div>
            <Input label="Order Earnings (After Fees)" type="text" inputMode="decimal" placeholder="0.00"
              value={orderEarnings} onChange={(e) => setOrderEarnings(e.target.value)} />
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Input label={strikeLabel} type="text" inputMode="decimal" placeholder="0.00"
              value={strikePrice} onChange={(e) => setStrikePrice(e.target.value)} />
            {perCard && <p className="text-[11px] text-zinc-500">≈ ${perCard} per card</p>}
          </div>
        );
      })()}

      {platform === 'ebay' && (
        <>
          <Input label="eBay Order Details Link" type="url" placeholder="https://www.ebay.com/…"
            value={ebayLink} onChange={(e) => setEbayLink(e.target.value)} />
          <Input label="Order #" placeholder="e.g. eBay order number"
            value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
        </>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Sold Date</label>
        <input type="date" value={soldAt} onChange={(e) => setSoldAt(e.target.value)}
          min={showDateMin} max={showDateMax}
          className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors [color-scheme:dark]" />
      </div>

      <Input label="Notes" placeholder="Card Show, Location, Person, Etc..."
        value={notes} onChange={(e) => setNotes(e.target.value)} />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={() => {
          if (platform !== 'ebay') { setStep('other-lookup'); return; }
          setStep(saleMode === 'raw' ? (rawSearchMode === 'id' ? 'raw-search' : 'raw-select') : (gradedSearchMode === 'url' ? 'search' : 'copies'));
        }}>Back</Button>
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 size={14} className="animate-spin" />}
          Record Sale
        </Button>
      </div>
    </form>
  );

  // ── Step: bulk-search ────────────────────────────────────────────────────────

  if (step === 'bulk-search') {
    // Per-source cart-qty rollup for raw lots: lets us allow the same multi-
    // card lot to be added multiple times (one entry per discrete sale, each
    // with its own price), capped at the lot's remaining capacity.
    const rawCartQtyBySource = new Map<string, number>();
    for (const c of bulkCart) {
      if (c.card_type !== 'raw') continue;
      rawCartQtyBySource.set(c.id, (rawCartQtyBySource.get(c.id) ?? 0) + (c.quantity || 0));
    }
    const alreadyAdded = new Set(bulkCart.map(c => c.id));
    const isSearching = bulkTab === 'graded' ? isBulkSearching : isBulkRawSearching;
    const activeRows = bulkTab === 'graded' ? bulkSearchRows : bulkRawRows;
    return (
      <>
      {reAddPrompt && (
        // In-app confirm — replaces window.confirm(). z-[60] sits above the
        // parent Record Sale modal (z-50) and backdrop intercepts click-aways.
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setReAddPrompt(null)} />
          <div className="relative bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-5 space-y-3">
            <p className="text-sm font-semibold text-zinc-100">Add another entry?</p>
            <p className="text-xs text-zinc-400 leading-relaxed">
              <span className="font-medium text-zinc-200">{reAddPrompt.cardName}</span> is already in the cart
              ({reAddPrompt.usedQty} of {reAddPrompt.lotQty}). Only add another if a second copy sold at a different price.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setReAddPrompt(null)}>Cancel</Button>
              <Button type="button" onClick={() => { reAddPrompt.onConfirm(); setReAddPrompt(null); }}>
                Add Another
              </Button>
            </div>
          </div>
        </div>
      )}
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <button type="button" onClick={() => setStep('type')} className="text-xs text-zinc-500 hover:text-zinc-300">← Back</button>
          <span className="text-xs text-zinc-600">{platform === 'ebay' ? 'eBay · Set Listing' : 'Card Show · Bulk Sale'}</span>
        </div>

        {bulkIsEbay && (
          <div className="flex gap-1">
            {(['search', 'url'] as const).map((m) => (
              <button key={m} type="button" onClick={() => { setBulkSearchMode(m); setBulkSearch(''); setBulkUrl(''); }}
                className={`px-3 py-1 text-xs rounded-md font-medium capitalize transition-colors ${bulkSearchMode === m ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                {m === 'url' ? 'Listing URL' : 'Search'}
              </button>
            ))}
          </div>
        )}

        {bulkIsEbay && bulkSearchMode === 'url' ? (
          <div className="space-y-2">
            <Input label="eBay Listing URL" placeholder="https://www.ebay.com/itm/…"
              value={bulkUrl} onChange={(e) => setBulkUrl(e.target.value)}
              autoFocus autoComplete="off" />
            <Button type="button" variant="secondary" className="w-full"
              disabled={!bulkUrl.trim() || bulkUrlLoading}
              onClick={handleBulkUrlLookup}>
              {bulkUrlLoading ? <><Loader2 size={13} className="animate-spin mr-1.5" />Finding cards…</> : 'Find All Cards in Listing'}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex gap-1">
              {(['graded', 'raw'] as const).map((t) => (
                <button key={t} type="button" onClick={() => { setBulkTab(t); setBulkSearch(''); }}
                  className={`px-3 py-1 text-xs rounded-md font-medium capitalize transition-colors ${bulkTab === t ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                  {t}
                </button>
              ))}
            </div>
            <div className="relative">
              <Input label={`Search ${bulkTab === 'graded' ? 'Graded' : 'Raw'} ${platform === 'ebay' ? 'eBay Listed' : 'Card Show'} Inventory`}
                placeholder={bulkTab === 'graded' ? 'Card name or cert #…' : 'Card name…'}
                value={bulkSearch} onChange={(e) => setBulkSearch(e.target.value)}
                autoFocus autoComplete="off" />
              {isSearching && <Loader2 size={13} className="absolute right-3 top-[30px] animate-spin text-zinc-500" />}
            </div>
            <label className="flex items-center gap-2 text-[11px] text-zinc-400 cursor-pointer select-none">
              <input type="checkbox" checked={bulkExactMatch} onChange={(e) => setBulkExactMatch(e.target.checked)}
                className="accent-indigo-500" />
              Strict match — require exact term (no fuzzy/substring)
            </label>
          </>
        )}
        {activeRows.length > 0 ? (
          <div className="rounded-lg border border-zinc-700 overflow-hidden max-h-52 overflow-y-auto">
            {bulkTab === 'graded' ? bulkSearchRows.map((r) => {
              const added = alreadyAdded.has(r.id);
              return (
                <button key={r.id} type="button" disabled={added}
                  onClick={() => {
                    if (added) return;
                    const stickerStr = r.card_show_price ? (r.card_show_price / 100).toFixed(2) : '';
                    const discPct = parseFloat(bulkDiscount || '0');
                    const finalStr = stickerStr && discPct > 0
                      ? (parseFloat(stickerStr) * (1 - discPct / 100)).toFixed(2)
                      : stickerStr;
                    setBulkCart(prev => [...prev, {
                      cart_entry_id: crypto.randomUUID(),
                      id: r.id,
                      listing_id: r.listing_id ?? null,
                      card_name: r.card_name,
                      set_name: r.set_name,
                      cert_number: r.cert_number,
                      grade_label: r.grade_label,
                      company: r.company,
                      raw_purchase_label: null,
                      sticker_price_input: stickerStr,
                      final_price_input: finalStr,
                      card_type: 'graded',
                      quantity: 1,
                      lot_quantity: 1,
                      card_show_price: r.card_show_price ?? null,
                      listed_price: r.listed_price ?? null,
                      is_listed: r.is_listed ?? false,
                    }]);
                  }}
                  className="w-full text-left px-4 py-2.5 hover:bg-zinc-800 border-b border-zinc-700/40 last:border-0 flex items-center justify-between gap-3 transition-colors disabled:opacity-40 disabled:cursor-default">
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-200 truncate">{r.card_name ?? '—'}</p>
                    <p className="text-xs text-zinc-500 truncate">{r.set_name ?? ''}{r.cert_number ? ` · #${r.cert_number}` : ''}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-zinc-400 font-medium">{r.company} {r.grade_label}</p>
                    <p className="text-xs text-zinc-500">{r.card_show_price ? `$${(r.card_show_price / 100).toFixed(2)}` : 'No price'}</p>
                  </div>
                </button>
              );
            }) : bulkRawRows.map((r) => {
              // Raw multi-card lots: re-add as many discrete sales as the lot
              // has remaining capacity for. Each entry holds its own price.
              // Single-card raw rows behave like before (one-shot).
              const usedQty = rawCartQtyBySource.get(r.id) ?? 0;
              const lotQty = r.quantity || 1;
              const added = usedQty >= lotQty;
              return (
                <button key={r.id} type="button" disabled={added}
                  onClick={() => {
                    if (added) return;
                    const doAdd = () => {
                      const rawStickerStr = r.card_show_price ? (r.card_show_price / 100).toFixed(2) : '';
                      const rawDiscPct = parseFloat(bulkDiscount || '0');
                      const rawFinalStr = rawStickerStr && rawDiscPct > 0
                        ? (parseFloat(rawStickerStr) * (1 - rawDiscPct / 100)).toFixed(2)
                        : rawStickerStr;
                      setBulkCart(prev => [...prev, {
                        cart_entry_id: crypto.randomUUID(),
                        id: r.id,
                        listing_id: r.listing_id ?? null,
                        card_name: r.card_name,
                        set_name: r.set_name,
                        cert_number: null,
                        grade_label: r.condition,
                        company: null,
                        raw_purchase_label: r.raw_purchase_label ?? null,
                        sticker_price_input: rawStickerStr,
                        final_price_input: rawFinalStr,
                        card_type: 'raw',
                        quantity: 1,
                        lot_quantity: lotQty,
                        card_show_price: r.card_show_price ?? null,
                        listed_price: r.listed_price ?? null,
                        is_listed: r.is_listed ?? false,
                      }]);
                    };
                    // Re-add confirm — multi-add is intentional only when the
                    // copies sold at different prices. Click-happy users were
                    // accidentally double-adding the same card.
                    if (usedQty > 0) {
                      setReAddPrompt({
                        cardName: r.card_name ?? 'This card',
                        usedQty,
                        lotQty,
                        onConfirm: doAdd,
                      });
                      return;
                    }
                    doAdd();
                  }}
                  className="w-full text-left px-4 py-2.5 hover:bg-zinc-800 border-b border-zinc-700/40 last:border-0 flex items-center justify-between gap-3 transition-colors disabled:opacity-40 disabled:cursor-default">
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-200 truncate">
                      {r.card_name ?? '—'}
                      {usedQty > 0 && (
                        <span className="ml-2 text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                          in cart ×{usedQty}
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-zinc-500 truncate">{r.set_name ?? ''}{r.raw_purchase_label ? ` · ${r.raw_purchase_label}` : ''}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-zinc-400 font-medium">{r.condition ?? 'Raw'}</p>
                    <p className="text-xs text-zinc-500">{r.card_show_price ? `$${(r.card_show_price / 100).toFixed(2)}` : 'No price'}</p>
                  </div>
                </button>
              );
            })}
          </div>
        ) : !isSearching && bulkSearch.length >= 1 && !(bulkIsEbay && bulkSearchMode === 'url') ? (
          <p className="text-xs text-zinc-500 px-1">No {bulkTab} {platform === 'ebay' ? 'eBay listed' : 'card show'} inventory found.</p>
        ) : null}

        {bulkCart.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Cart ({bulkCart.length})</p>
            <div className="rounded-lg border border-zinc-700 overflow-hidden">
              <div className="max-h-[360px] overflow-y-auto">
              {bulkCart.map((item, i) => {
                // 0 is valid (giveaway / total loss). Only flag empty or non-numeric.
                const missingPrice = !item.sticker_price_input.trim() || isNaN(parseFloat(item.sticker_price_input)) || parseFloat(item.sticker_price_input) < 0;
                // Cross-entry rollup: sum of qtys across all cart rows sharing
                // this source must not exceed the lot. Per-row min is 1.
                const totalForSource = item.card_type === 'raw'
                  ? (rawCartQtyBySource.get(item.id) ?? item.quantity)
                  : item.quantity;
                const qtyInvalid = item.quantity < 1 || totalForSource > item.lot_quantity;
                const showQty = item.card_type === 'raw' && item.lot_quantity > 1;
                return (
                  <div key={item.cart_entry_id} className="flex items-start gap-3 px-3 py-2 border-b border-zinc-700/40 last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-200 leading-snug">{item.card_name ?? '—'}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        {item.card_type === 'raw'
                          ? `${item.grade_label ?? 'Raw'}${item.raw_purchase_label ? ` · ${item.raw_purchase_label}` : ''}`
                          : `${item.company ?? ''} ${item.grade_label ?? ''}${item.cert_number ? ` · #${item.cert_number}` : ''}`}
                      </p>
                      {item.quantity > 1 && parseFloat(item.sticker_price_input || '0') > 0 && (
                        <p className="text-[10px] text-zinc-600 mt-0.5">
                          total — ≈ ${(parseFloat(item.sticker_price_input) / item.quantity).toFixed(2)} per card
                        </p>
                      )}
                    </div>
                    {showQty && (
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[10px] text-zinc-500 uppercase tracking-wide">Qty</span>
                        <input
                          type="text" inputMode="numeric"
                          value={String(item.quantity)}
                          onChange={(e) => {
                            const val = parseInt(e.target.value.replace(/[^0-9]/g, ''), 10);
                            const next = Number.isFinite(val) ? val : 1;
                            setBulkCart(prev => prev.map((c, idx) => idx === i ? { ...c, quantity: Math.max(1, next) } : c));
                          }}
                          className={cn('w-12 text-xs bg-zinc-800 rounded px-2 py-1 text-zinc-200 text-right focus:outline-none', qtyInvalid ? 'border border-amber-600/60' : 'border border-zinc-600 focus:border-indigo-500')}
                          title={`${item.lot_quantity} in this lot`}
                        />
                        <span className="text-[10px] text-zinc-500">/ {item.lot_quantity}</span>
                      </div>
                    )}
                    {!bulkIsEbay && (
                      <div className="flex items-center gap-1 shrink-0">
                        <span className={cn('text-xs', missingPrice ? 'text-amber-500' : 'text-zinc-500')}>$</span>
                        <input
                          type="text" inputMode="decimal"
                          value={item.sticker_price_input}
                          placeholder="Required"
                          onChange={(e) => {
                            // Allow only digits + a single decimal point. Avoids
                            // browser number-input quirks (scroll-wheel snap,
                            // step-rounding) that previously turned 175 into
                            // 174.98 on the CS Price field.
                            const val = e.target.value.replace(/[^0-9.]/g, '');
                            setBulkCart(prev => prev.map((c, idx) => idx === i ? { ...c, sticker_price_input: val, final_price_input: val } : c));
                          }}
                          className={cn('w-20 text-xs bg-zinc-800 rounded px-2 py-1 text-zinc-200 focus:outline-none', missingPrice ? 'border border-amber-600/60 placeholder:text-amber-700' : 'border border-zinc-600 focus:border-indigo-500')}
                        />
                      </div>
                    )}
                    {/* Standing CS sticker on the underlying card — separate
                        from this sale's sticker_price_input above. Saves on
                        blur to /cards/:id and fans out to all cart rows that
                        point at the same card_instance. */}
                    <div className="flex items-center gap-1 shrink-0" title="Card's standing CS sticker price">
                      <span className="text-[10px] text-zinc-500 uppercase tracking-wide">CS</span>
                      <input
                        type="text" inputMode="decimal"
                        value={item.cs_price_draft !== undefined
                          ? item.cs_price_draft
                          : item.card_show_price != null ? (item.card_show_price / 100).toFixed(2) : ''}
                        placeholder="—"
                        onFocus={() => setBulkCart(prev => prev.map((c, idx) => idx === i ? { ...c, cs_price_draft: c.card_show_price != null ? (c.card_show_price / 100).toFixed(2) : '' } : c))}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^0-9.]/g, '');
                          setBulkCart(prev => prev.map((c, idx) => idx === i ? { ...c, cs_price_draft: val } : c));
                        }}
                        onBlur={() => commitCartCsPrice(item.cart_entry_id)}
                        disabled={csPriceMut.isPending}
                        className="w-16 text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-emerald-400 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    {/* Listed price — only on eBay bulk sales. Disabled with a
                        dash when the source card has no active listing. */}
                    {bulkIsEbay && (
                      <div className="flex items-center gap-1 shrink-0" title={item.listing_id ? 'Active listing price' : 'No active listing'}>
                        <span className="text-[10px] text-zinc-500 uppercase tracking-wide">List</span>
                        <input
                          type="text" inputMode="decimal"
                          value={item.listed_price_draft !== undefined
                            ? item.listed_price_draft
                            : item.listed_price != null ? (item.listed_price / 100).toFixed(2) : ''}
                          placeholder={item.listing_id ? '—' : '—'}
                          onFocus={() => setBulkCart(prev => prev.map((c, idx) => idx === i ? { ...c, listed_price_draft: c.listed_price != null ? (c.listed_price / 100).toFixed(2) : '' } : c))}
                          onChange={(e) => {
                            const val = e.target.value.replace(/[^0-9.]/g, '');
                            setBulkCart(prev => prev.map((c, idx) => idx === i ? { ...c, listed_price_draft: val } : c));
                          }}
                          onBlur={() => commitCartListedPrice(item.cart_entry_id)}
                          disabled={!item.listing_id || listedPriceMut.isPending}
                          className={cn('w-16 text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sky-400 focus:outline-none focus:border-indigo-500',
                            !item.listing_id && 'opacity-50 cursor-not-allowed')}
                        />
                      </div>
                    )}
                    <button type="button" onClick={() => setBulkCart(prev => prev.filter((_, idx) => idx !== i))}
                      className="text-zinc-600 hover:text-red-400 transition-colors shrink-0">
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
              </div>
            </div>
            <div className="flex items-center justify-between">
              {!bulkIsEbay && bulkCart.some(i => !i.sticker_price_input.trim() || isNaN(parseFloat(i.sticker_price_input)) || parseFloat(i.sticker_price_input) < 0) && (
                <p className="text-xs text-amber-500">Enter a sticker price for each line (total per line, not per card)</p>
              )}
              {(() => {
                // Validate cross-entry: each source's summed qty ≤ its lot.
                const overflow = bulkCart.some(i => {
                  if (i.quantity < 1) return true;
                  const total = i.card_type === 'raw' ? (rawCartQtyBySource.get(i.id) ?? i.quantity) : i.quantity;
                  return total > i.lot_quantity;
                });
                return overflow ? <p className="text-xs text-amber-500">Each lot's cart qty must fit within its remaining inventory</p> : null;
              })()}
              <div className="ml-auto">
                <Button type="button"
                  disabled={
                    bulkCart.length === 0
                    || (!bulkIsEbay && bulkCart.some(i => !i.sticker_price_input.trim() || isNaN(parseFloat(i.sticker_price_input)) || parseFloat(i.sticker_price_input) < 0))
                    || bulkCart.some(i => {
                      if (i.quantity < 1) return true;
                      const total = i.card_type === 'raw' ? (rawCartQtyBySource.get(i.id) ?? i.quantity) : i.quantity;
                      return total > i.lot_quantity;
                    })
                  }
                  onClick={() => setStep('bulk-review')}>
                  Review Sale →
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
      </>
    );
  }

  // ── Step: bulk-review ────────────────────────────────────────────────────────

  if (step === 'bulk-review') {
    const isEbaySet = platform === 'ebay';
    const n = bulkCart.length;

    // For eBay set listings: total inputs that divide evenly per card
    const totalStrikeCents = Math.round(parseFloat(strikePrice || '0') * 100);
    const totalEarningsCents = orderEarnings ? Math.round(parseFloat(orderEarnings) * 100) : totalStrikeCents;
    const perCardStrike = n > 0 ? (totalStrikeCents / n / 100).toFixed(2) : '0.00';
    const perCardEarnings = n > 0 ? (totalEarningsCents / n / 100).toFixed(2) : '0.00';
    const perCardFees = n > 0 ? ((totalStrikeCents - totalEarningsCents) / n / 100).toFixed(2) : '0.00';

    // Card show total (manual per-card pricing)
    const total = bulkCart.reduce((s, item) => {
      const final = Math.round(parseFloat(item.final_price_input || '0') * 100);
      return s + final;
    }, 0);

    function updateReviewField(entryId: string, field: 'sticker_price_input' | 'final_price_input', val: string) {
      setBulkCart(prev => prev.map(c => {
        if (c.cart_entry_id !== entryId) return c;
        // Cascade sticker → final when final is still empty/0. Users were
        // entering only sticker, then bouncing off a disabled Review &
        // Confirm because every row needs final to be > 0.
        if (field === 'sticker_price_input') {
          const currentFinal = parseFloat(c.final_price_input || '0');
          // Cascade only when final is empty / non-numeric / negative, NOT
          // when final has been intentionally set to 0 (giveaway).
          const finalEmpty = !c.final_price_input.trim() || isNaN(currentFinal) || currentFinal < 0;
          return { ...c, sticker_price_input: val, ...(finalEmpty ? { final_price_input: val } : {}) };
        }
        return { ...c, [field]: val };
      }));
    }

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <button type="button" onClick={() => setStep('bulk-search')} className="text-xs text-zinc-500 hover:text-zinc-300">← Back</button>
          <span className="text-xs text-zinc-600">{isEbaySet ? 'eBay · Set Listing · Review' : 'Card Show · Bulk Sale · Review'}</span>
        </div>

        {isEbaySet ? (
          /* ── eBay Set Listing: enter totals, split evenly ── */
          <div className="space-y-3">
            <div className="p-3 bg-zinc-800/50 border border-zinc-700 rounded-lg">
              <p className="text-xs font-medium text-zinc-400 mb-2">Set Listing Totals — split evenly across {n} card{n !== 1 ? 's' : ''}</p>
              <div className="grid grid-cols-2 gap-3">
                <Input label="Total Strike Price" type="text" inputMode="decimal" placeholder="0.00"
                  value={strikePrice} onChange={(e) => setStrikePrice(e.target.value)} />
                <Input label="Total After Fees" type="text" inputMode="decimal" placeholder="0.00"
                  value={orderEarnings} onChange={(e) => setOrderEarnings(e.target.value)} />
              </div>
              {strikePrice && (
                <p className="text-xs text-zinc-500 mt-2">
                  Per card: <span className="text-zinc-300">${perCardStrike} strike</span>
                  {orderEarnings && parseFloat(perCardFees) > 0 && <> · <span className="text-zinc-300">${perCardEarnings} after fees</span> · <span className="text-amber-400">${perCardFees} fees</span></>}
                </p>
              )}
            </div>
            <Input label="eBay Order Details Link" type="url" placeholder="https://www.ebay.com/…"
              value={ebayLink} onChange={(e) => setEbayLink(e.target.value)} />
            <Input label="Order #" placeholder="e.g. eBay order number"
              value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
          </div>
        ) : (
          /* ── Card Show: per-card manual pricing ── */
          <div className="flex items-end gap-3">
            <div className="w-36">
              <Input label="Discount % (all)" type="number" min="0" max="100" step="1"
                placeholder="0" value={bulkDiscount} onChange={(e) => {
                  const pct = parseFloat(e.target.value || '0');
                  setBulkDiscount(e.target.value);
                  const multiplier = 1 - pct / 100;
                  setBulkCart(prev => prev.map(c => ({
                    ...c,
                    final_price_input: c.sticker_price_input
                      ? (parseFloat(c.sticker_price_input) * multiplier).toFixed(2)
                      : c.final_price_input,
                  })));
                }} />
            </div>
            {parseFloat(bulkDiscount || '0') > 0 && (
              <p className="text-xs text-zinc-500 pb-2">{parseFloat(bulkDiscount)}% off each card</p>
            )}
          </div>
        )}

        <div className="rounded-lg border border-zinc-700 overflow-hidden">
          <div className={cn('grid gap-x-2 px-3 py-2 bg-zinc-900 border-b border-zinc-700',
            isEbaySet ? 'grid-cols-[1fr_auto]' : 'grid-cols-[1fr_6rem_6rem_4rem]')}>
            <span className="text-[10px] text-zinc-500 uppercase tracking-widest">Card</span>
            {isEbaySet
              ? <span className="text-[10px] text-zinc-500 uppercase tracking-widest text-right">Per-Card</span>
              : <>
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest text-right">Sticker</span>
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest text-right">Final</span>
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest text-right">Disc.</span>
                </>
            }
          </div>
          <div className="max-h-[280px] overflow-y-auto">
          {bulkCart.map((item) => {
            const sticker = parseFloat(item.sticker_price_input || '0');
            const final = parseFloat(item.final_price_input || '0');
            const discountPct = sticker > 0 ? Math.round((1 - final / sticker) * 100) : 0;
            return (
              <div key={item.cart_entry_id} className={cn('gap-x-2 px-3 py-2.5 border-b border-zinc-700/40 last:border-0 items-start',
                isEbaySet ? 'flex items-center justify-between' : 'grid grid-cols-[1fr_6rem_6rem_4rem]')}>
                <div className="min-w-0">
                  <p className="text-sm text-zinc-200 leading-snug">
                    {item.card_name ?? '—'}
                    {item.quantity > 1 && <span className="ml-1.5 text-[10px] text-amber-400/80 font-medium">×{item.quantity}</span>}
                  </p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {item.card_type === 'raw'
                      ? `${item.grade_label ?? 'Raw'}${item.raw_purchase_label ? ` · ${item.raw_purchase_label}` : ''}`
                      : `${item.company ?? ''} ${item.grade_label ?? ''}${item.cert_number ? ` · #${item.cert_number}` : ''}`}
                  </p>
                  {item.quantity > 1 && final > 0 && (
                    <p className="text-[10px] text-zinc-600 mt-0.5">
                      total — ≈ ${(final / item.quantity).toFixed(2)} per card
                    </p>
                  )}
                </div>
                {isEbaySet ? (
                  <p className="text-sm tabular-nums text-zinc-400 shrink-0">
                    {strikePrice ? `$${perCardStrike}` : '—'}
                  </p>
                ) : (
                  <>
                    <div className="flex items-center justify-end gap-0.5">
                      <span className="text-zinc-600 text-xs">$</span>
                      <input type="text" inputMode="decimal"
                        value={item.sticker_price_input}
                        onChange={(e) => updateReviewField(item.cart_entry_id, 'sticker_price_input', e.target.value.replace(/[^0-9.]/g, ''))}
                        className="w-16 text-xs bg-zinc-800 border border-zinc-700 rounded px-1.5 py-1 text-zinc-300 text-right focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="flex items-center justify-end gap-0.5">
                      <span className="text-zinc-600 text-xs">$</span>
                      <input type="text" inputMode="decimal"
                        value={item.final_price_input}
                        onChange={(e) => updateReviewField(item.cart_entry_id, 'final_price_input', e.target.value.replace(/[^0-9.]/g, ''))}
                        className={cn('w-16 text-xs bg-zinc-800 rounded px-1.5 py-1 text-zinc-100 text-right focus:outline-none focus:border-indigo-500',
                          !item.final_price_input.trim() || isNaN(final) || final < 0 ? 'border border-amber-600/60' : 'border border-indigo-600/60')}
                      />
                    </div>
                    <p className={cn('text-xs text-right tabular-nums', discountPct > 0 ? 'text-amber-400' : 'text-zinc-600')}>
                      {discountPct > 0 ? `-${discountPct}%` : '—'}
                    </p>
                  </>
                )}
              </div>
            );
          })}
          </div>
          <div className={cn('gap-x-2 px-3 py-2.5 bg-zinc-900/50 border-t border-zinc-700',
            isEbaySet ? 'flex items-center justify-between' : 'grid grid-cols-[1fr_6rem_6rem_4rem]')}>
            <p className="text-xs font-semibold text-zinc-400">{n} card{n !== 1 ? 's' : ''}</p>
            {isEbaySet
              ? <p className="text-sm font-bold text-zinc-100 tabular-nums">
                  {strikePrice ? `$${strikePrice} total` : '—'}
                </p>
              : <><span /><span /><p className="text-sm font-bold text-zinc-100 text-right tabular-nums col-start-3">${(total / 100).toFixed(2)}</p></>
            }
          </div>
        </div>

        {/* Card show fields (non-eBay only) */}
        {!isEbaySet && (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Card Show</label>
              <select value={cardShowId} onChange={(e) => {
                const val = e.target.value;
                if (val === '__archived__') { setShowArchived(true); return; }
                setCardShowId(val);
                const show = (cardShowsData?.data ?? []).find((s) => s.id === val);
                if (show) setSoldAt(show.show_date.slice(0, 10));
              }} className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors">
                <option value="">— Select show (optional) —</option>
                {(() => {
                  const all = cardShowsData?.data ?? [];
                  const visibleShows = showArchived ? all : all.slice(0, 3);
                  const archived = all.slice(3);
                  return (
                    <>
                      {visibleShows.map((s) => {
                        const fmt = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
                        const dateLabel = s.num_days > 1 && s.end_date ? `${fmt(s.show_date)} – ${fmt(s.end_date)}` : fmt(s.show_date);
                        return <option key={s.id} value={s.id}>{s.name} · {dateLabel}{s.location ? ` · ${s.location}` : ''}</option>;
                      })}
                      {!showArchived && archived.length > 0 && <option value="__archived__">— Show {archived.length} more —</option>}
                    </>
                  );
                })()}
              </select>
            </div>
          </>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Sold Date</label>
          <input type="date" value={soldAt} onChange={(e) => setSoldAt(e.target.value)}
            min={showDateMin} max={showDateMax}
            className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors [color-scheme:dark]" />
        </div>
        <Input label="Notes" placeholder="Person, location, etc." value={notes} onChange={(e) => setNotes(e.target.value)} />

        <div className="flex items-center justify-between gap-2 pt-1">
          <span />
          <div className="flex justify-end gap-2 ml-auto">
            <Button type="button" variant="ghost" onClick={() => setStep('bulk-search')}>Back</Button>
            <Button type="button"
              disabled={bulkCart.length === 0}
              onClick={() => {
                // Validate at click time, not on every render, so the button
                // doesn't flicker disabled mid-typing (which made users think
                // it was permanently broken).
                if (isEbaySet) {
                  if (!strikePrice.trim() || isNaN(parseFloat(strikePrice)) || parseFloat(strikePrice) < 0) {
                    toast.error('Enter a total strike price (0 is OK for giveaways)');
                    return;
                  }
                } else {
                  // 0 is valid (giveaway). Flag only empty / non-numeric / negative.
                  const blocked = bulkCart.filter(i => { const raw = i.final_price_input; const n = parseFloat(raw); return !raw.trim() || isNaN(n) || n < 0; });
                  if (blocked.length > 0) {
                    const names = blocked.slice(0, 3).map(b => b.card_name ?? '(unnamed)').join(', ');
                    toast.error(`Missing final price: ${names}${blocked.length > 3 ? ` +${blocked.length - 3} more` : ''}`);
                    return;
                  }
                }
                setStep('bulk-confirm');
              }}>
              Review &amp; Confirm →
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ── Step: bulk-confirm ───────────────────────────────────────────────────────

  if (step === 'bulk-confirm') {
    const isEbaySet = platform === 'ebay';
    const n = bulkCart.length;

    // eBay set: split total evenly per card
    const totalStrikeCents = Math.round(parseFloat(strikePrice || '0') * 100);
    const totalEarningsCents = orderEarnings ? Math.round(parseFloat(orderEarnings) * 100) : totalStrikeCents;
    const totalFeesCents = Math.max(0, totalStrikeCents - totalEarningsCents);
    // Distribute remainder to first card to avoid rounding loss
    const basePerCard = Math.floor(totalStrikeCents / n);
    const baseFeesPerCard = Math.floor(totalFeesCents / n);
    const strikeRemainder = totalStrikeCents - basePerCard * n;
    const feesRemainder = totalFeesCents - baseFeesPerCard * n;

    const itemsWithFinal = bulkCart.map((item, idx) => {
      if (isEbaySet) {
        const sale_price = basePerCard + (idx === 0 ? strikeRemainder : 0);
        const platform_fees = baseFeesPerCard + (idx === 0 ? feesRemainder : 0);
        return { ...item, final_price: sale_price, platform_fees };
      }
      return { ...item, final_price: Math.round(parseFloat(item.final_price_input || '0') * 100), platform_fees: 0 };
    });
    const total = itemsWithFinal.reduce((s, i) => s + i.final_price, 0);
    const selectedShow = (cardShowsData?.data ?? []).find(s => s.id === cardShowId);

    async function handleBulkSubmit() {
      setSubmitting(true);
      try {
        await api.post('/sales/batch', {
          items: itemsWithFinal.map(item => ({
            card_instance_id: item.id,
            // Coerce null → undefined so it's omitted from the JSON. The
            // server's zod schema accepts string|undefined, not null —
            // raw cart rows with no active listing now hold null here.
            listing_id: item.listing_id ?? undefined,
            sale_price: item.final_price,
            platform_fees: item.platform_fees,
            // Always send the cart qty — never undefined. Server's recordSale
            // defaults undefined to card.quantity (the source lot's full count),
            // which silently flips a whole multi-card lot sold when the user
            // really only meant to sell 1 from it.
            quantity: item.quantity,
          })),
          platform: isEbaySet ? 'ebay' : 'card_show',
          card_show_id: isEbaySet ? undefined : (cardShowId || undefined),
          unique_id: isEbaySet ? (orderNumber || undefined) : undefined,
          order_details_link: isEbaySet ? (ebayLink || undefined) : undefined,
          currency,
          sold_at: soldAt || undefined,
          unique_id_2: notes || undefined,
        });
        toast.success(`${itemsWithFinal.length} sales recorded!`);
        queryClient.invalidateQueries({ queryKey: ['sales'] });
        onClose();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
        toast.error(err?.response?.data?.error ?? 'Failed to record sales');
      } finally {
        setSubmitting(false);
      }
    }

    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <button type="button" onClick={() => setStep('bulk-review')} className="text-xs text-zinc-500 hover:text-zinc-300">← Back</button>
          <span className="text-xs text-zinc-600">{isEbaySet ? 'eBay · Set Listing · Confirm' : 'Card Show · Bulk Sale · Confirm'}</span>
        </div>

        <div className="rounded-lg border border-zinc-700 bg-zinc-900/40 p-4 space-y-2">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Sale Summary</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <span className="text-zinc-500">Cards</span>
            <span className="text-zinc-200 font-medium">{bulkCart.length}</span>
            <span className="text-zinc-500">{isEbaySet ? 'Total Strike' : 'Total'}</span>
            <span className="text-zinc-100 font-bold">${(total / 100).toFixed(2)}</span>
            {isEbaySet && totalFeesCents > 0 && <>
              <span className="text-zinc-500">After Fees</span>
              <span className="text-zinc-100">${(totalEarningsCents / 100).toFixed(2)}</span>
              <span className="text-zinc-500">Fees</span>
              <span className="text-amber-400">${(totalFeesCents / 100).toFixed(2)}</span>
              <span className="text-zinc-500">Per Card</span>
              <span className="text-zinc-400 text-xs">${(basePerCard / 100).toFixed(2)} strike · ${((basePerCard - baseFeesPerCard) / 100).toFixed(2)} after fees</span>
            </>}
            {isEbaySet && orderNumber && <>
              <span className="text-zinc-500">Order #</span>
              <span className="text-zinc-200 font-mono text-xs">{orderNumber}</span>
            </>}
            {!isEbaySet && selectedShow && <>
              <span className="text-zinc-500">Card Show</span>
              <span className="text-zinc-200 truncate">{selectedShow.name}</span>
            </>}
            {soldAt && <>
              <span className="text-zinc-500">Date</span>
              <span className="text-zinc-200">{new Date(soldAt + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            </>}
            {notes && <>
              <span className="text-zinc-500">Notes</span>
              <span className="text-zinc-200 truncate">{notes}</span>
            </>}
          </div>
        </div>

        <div className="rounded-lg border border-zinc-700 overflow-hidden max-h-[360px] overflow-y-auto">
          {itemsWithFinal.map((item) => (
            <div key={item.cart_entry_id} className="flex items-start justify-between gap-3 px-3 py-2.5 border-b border-zinc-700/40 last:border-0">
              <div className="min-w-0">
                <p className="text-sm text-zinc-200 leading-snug">{item.card_name ?? '—'}</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {item.card_type === 'raw'
                    ? `${item.grade_label ?? 'Raw'}${item.raw_purchase_label ? ` · ${item.raw_purchase_label}` : ''}`
                    : `${item.company ?? ''} ${item.grade_label ?? ''}${item.cert_number ? ` · #${item.cert_number}` : ''}`}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-medium text-zinc-100 tabular-nums">${(item.final_price / 100).toFixed(2)}</p>
                {isEbaySet && item.platform_fees > 0 && (
                  <p className="text-xs text-zinc-500 tabular-nums">${((item.final_price - item.platform_fees) / 100).toFixed(2)} after fees</p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={() => setStep('bulk-review')}>Back</Button>
          <Button type="button" disabled={submitting} onClick={handleBulkSubmit}>
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Confirm &amp; Record {bulkCart.length} Sales
          </Button>
        </div>
      </div>
    );
  }
}
// ── Sale Action Modal (Edit / Delete) ─────────────────────────────────────────

function SaleActionModal({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'prompt' | 'edit' | 'delete'>('prompt');
  const [platform, setPlatform] = useState(sale.platform);
  const [strikePrice, setStrikePrice] = useState((sale.sale_price / 100).toFixed(2));
  const [orderEarnings, setOrderEarnings] = useState((sale.net_proceeds / 100).toFixed(2));
  const [ebayLink, setEbayLink] = useState(sale.order_details_link ?? '');
  const [notes, setNotes] = useState(sale.unique_id_2 ?? '');
  const [currency, setCurrency] = useState(sale.currency);
  const [soldAt, setSoldAt] = useState(sale.sold_at ? sale.sold_at.slice(0, 10) : '');
  const [orderNumber, setOrderNumber] = useState(sale.unique_id ?? '');
  const [quantity, setQuantity] = useState(String(sale.quantity ?? 1));
  const [submitting, setSubmitting] = useState(false);

  // Max sale qty = what's on this sale today + what's still available in the
  // same lot to grow into. Keeps the lot's original total invariant.
  const qtyMax = (sale.quantity ?? 1) + (sale.lot_available_qty ?? 0);
  const qtyParsed = parseInt(quantity || '0', 10);
  const qtyValid = Number.isFinite(qtyParsed) && qtyParsed >= 1 && qtyParsed <= qtyMax;

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!qtyValid) {
      toast.error(qtyParsed < 1 ? 'Quantity must be at least 1' : `Lot has only ${qtyMax} available`);
      return;
    }
    setSubmitting(true);
    const strikeCents = Math.round(parseFloat(strikePrice) * 100);
    const earningsCents = platform === 'ebay' && orderEarnings ? Math.round(parseFloat(orderEarnings) * 100) : strikeCents;
    const feesCents = Math.max(0, strikeCents - earningsCents);
    try {
      await api.put(`/sales/${sale.id}`, {
        platform,
        sale_price: strikePrice,
        platform_fees: String(feesCents / 100),
        shipping_cost: '0',
        currency,
        sold_at: soldAt || undefined,
        unique_id: platform === 'ebay' ? (orderNumber || undefined) : undefined,
        unique_id_2: notes || undefined,
        order_details_link: platform === 'ebay' ? (ebayLink || undefined) : undefined,
        quantity: qtyParsed,
      });
      toast.success('Sale updated');
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Input label={`Quantity (max ${qtyMax})`} type="text" inputMode="numeric"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value.replace(/[^0-9]/g, ''))} />
          {!qtyValid && quantity !== '' && (
            <p className="text-[11px] text-rose-400 mt-1">
              {qtyParsed < 1 ? 'Must be at least 1' : `Lot only has ${qtyMax} available — extras would have to come from new inventory`}
            </p>
          )}
          {qtyValid && qtyParsed !== sale.quantity && (
            <p className="text-[11px] text-zinc-500 mt-1">
              {qtyParsed > sale.quantity
                ? `Will pull ${qtyParsed - sale.quantity} more from the source lot`
                : `Will return ${sale.quantity - qtyParsed} to the source lot`}
            </p>
          )}
        </div>
      </div>
      {platform === 'ebay' ? (
        <div className="grid grid-cols-2 gap-3">
          <Input label="Strike Price" type="text" inputMode="decimal" value={strikePrice} onChange={(e) => setStrikePrice(e.target.value)} />
          <Input label="Order Earnings (After Fees)" type="text" inputMode="decimal" value={orderEarnings} onChange={(e) => setOrderEarnings(e.target.value)} />
        </div>
      ) : (
        <Input label="Strike Price" type="text" inputMode="decimal" value={strikePrice} onChange={(e) => setStrikePrice(e.target.value)} />
      )}
      {platform === 'ebay' && (
        <>
          <Input label="eBay Order Details Link" type="url" placeholder="https://www.ebay.com/…" value={ebayLink} onChange={(e) => setEbayLink(e.target.value)} />
          <Input label="Order #" value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} />
        </>
      )}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Sold Date</label>
        <input type="date" value={soldAt} onChange={(e) => setSoldAt(e.target.value)}
          className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors [color-scheme:dark]" />
      </div>
      <Input label="Notes" placeholder="Card Show, Location, Person, Etc..." value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={() => setMode('prompt')}>Back</Button>
        <Button type="submit" disabled={submitting || !qtyValid}>
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

type CardTypeFilter = 'all' | 'graded' | 'raw';

const SALES_FILTER_DEFAULTS = {
  sortCol: 'sold_at' as string | null,
  sortDir: 'desc' as SortDir,
  fPlatform: null as string[] | null,
  fSoldDates: [] as string[],
  cardType: 'all' as CardTypeFilter,
  search: '',
};

export function Sales() {
  const saved = loadFilters('sales', SALES_FILTER_DEFAULTS);
  const [page, setPage] = useState(1);
  const [sortCol, setSortCol] = useState<string | null>(saved.sortCol);
  const [sortDir, setSortDir] = useState<SortDir>(saved.sortDir);
  const [fPlatform, setFPlatform] = useState<string[] | null>(saved.fPlatform);
  const [fSoldDates, setFSoldDates] = useState<string[]>(saved.fSoldDates ?? []);
  const [cardType, setCardType] = useState<CardTypeFilter>(saved.cardType ?? 'all');
  const [search, setSearch] = useState(saved.search);
  const [debouncedSearch, setDebouncedSearch] = useState(saved.search);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const MINS = {
    date:         colMinWidth('Date Sold',     true,  true),
    cert:         colMinWidth('Cert / ID', true, false),
    card:         colMinWidth('Card',          true,  false),
    grade_cond:   colMinWidth('Grade / Cond.', true, false),
    qty:          colMinWidth('Qty',           true,  false),
    sale_method:  colMinWidth('Sale Method',   true,  true),
    link:         50,
    raw_cost:     colMinWidth('Raw Cost',      true,  false),
    grading_cost: colMinWidth('Grading Cost',  true,  false),
    listed_price: colMinWidth('Listing Price', true,  false),
    strike:       colMinWidth('Strike Price',  true,  false),
    after_ebay:   colMinWidth('After Fees',    true,  false),
    net:          colMinWidth('Net',           true,  false),
  };
  const { rz, totalWidth } = useColWidths({ date: Math.max(MINS.date, 115), cert: Math.max(MINS.cert, 155), card: Math.max(MINS.card, 460), grade_cond: Math.max(MINS.grade_cond, 130), qty: Math.max(MINS.qty, 60), sale_method: Math.max(MINS.sale_method, 200), link: 50, raw_cost: Math.max(MINS.raw_cost, 105), grading_cost: Math.max(MINS.grading_cost, 130), listed_price: Math.max(MINS.listed_price, 130), strike: Math.max(MINS.strike, 130), after_ebay: Math.max(MINS.after_ebay, 130), net: Math.max(MINS.net, 105) });

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    saveFilters('sales', { sortCol, sortDir, fPlatform, fSoldDates, cardType, search });
  }, [sortCol, sortDir, fPlatform, cardType, search]);

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
    card_type: cardType !== 'all' ? cardType : undefined,
    sold_dates: fSoldDates.length ? fSoldDates.join(',') : undefined,
  };

  const { data, isLoading } = useQuery<PaginatedResult<Sale>>({
    queryKey: ['sales', params],
    queryFn: () => api.get('/sales', { params }).then((r) => r.data),
  });

  const hasActiveFilters = fPlatform !== null || !!debouncedSearch || fSoldDates.length > 0;

  const sh = { sortCol, sortDir, onSort: handleSort };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-100">Sales</h1>
        <div className="flex items-center gap-3">
          {hasActiveFilters && (
            <button onClick={() => { setFPlatform(null); setCardType('all'); setSearch(''); setFSoldDates([]); }}
              className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
              <X size={12} /> Clear filters
            </button>
          )}
          <div className="flex items-center gap-1">
            {(['all', 'graded', 'raw'] as CardTypeFilter[]).map((t) => (
              <button key={t} onClick={() => { setCardType(t); setPage(1); }}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${cardType === t ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Card, cert, SKU, 2026R117, order #…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 w-64"
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
                <ColHeader label="Date Sold"      col="sold_at"      {...sh} {...rz('date')} minWidth={MINS.date}
                  filterDateValues={fSoldDates} onFilterDatesChange={(d) => { setFSoldDates(d); setPage(1); }} />
                <ColHeader label="Cert / ID" col="cert_number" {...sh} {...rz('cert')} minWidth={MINS.cert} wrap />
                <ColHeader label="Card"           col="card_name"    {...sh} {...rz('card')} minWidth={MINS.card} />
                <ColHeader label="Grade / Cond."  {...sh} {...rz('grade_cond')} minWidth={MINS.grade_cond} />
                <ColHeader label="Qty"            col="quantity"     {...sh} {...rz('qty')} minWidth={MINS.qty} align="right" />
                <ColHeader label="Sale Method"    col="platform"     {...sh} {...rz('sale_method')} minWidth={MINS.sale_method}
                  filterOptions={filterOptions?.platforms} filterSelected={fPlatform} onFilterChange={(v) => { setFPlatform(v); setPage(1); }} />
                <th style={{ width: MINS.link + 'px', minWidth: MINS.link + 'px' }} className="px-2 py-2 text-center font-semibold text-zinc-300 uppercase tracking-wide">Link</th>
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
                <tr><td colSpan={13} className="px-3 py-10 text-center text-zinc-500">No sales found.</td></tr>
              ) : data.data.map((sale) => (
                <tr key={sale.id} className="hover:bg-zinc-800/30 transition-colors cursor-pointer" onClick={() => setSelectedSale(sale)}>
                  <td className="px-3 py-2 text-zinc-500">{formatDate(sale.sold_at)}</td>
                  <td className="px-3 py-2 font-mono text-zinc-400 text-[11px]">
                    {sale.cert_number
                      ? String(sale.cert_number).padStart(8, '0')
                      : sale.raw_purchase_label ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <p className="font-medium text-zinc-200 whitespace-normal break-words leading-snug">{sale.card_name ?? 'Unknown'}</p>
                    <p className="text-[10px] text-zinc-500 whitespace-normal break-words">
                      {sale.set_name}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-zinc-300">
                    {sale.grade_label || sale.grade != null
                      ? <span><span className="text-zinc-500 text-[10px] mr-1">{sale.grading_company}</span>{sale.grade_label ?? sale.grade}</span>
                      : sale.condition
                      ? <span><span className="text-zinc-500 text-[10px] mr-1">Raw</span>{sale.condition}</span>
                      : <span className="text-zinc-700">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-400">{sale.quantity ?? 1}</td>
                  <td className="px-3 py-2">
                    <span className="text-xs text-zinc-400">{platformLabel(sale.platform)}</span>
                    {sale.platform === 'card_show' && sale.card_show_name && (
                      <p className="text-[10px] text-zinc-500 mt-0.5 whitespace-normal break-words leading-snug">
                        {sale.card_show_name}
                      </p>
                    )}
                  </td>
                  <td className="px-2 py-2 text-center">
                    {sale.order_details_link && (
                      <a href={sale.order_details_link} target="_blank" rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center justify-center text-indigo-400 hover:text-indigo-300 transition-colors">
                        <ExternalLink size={13} />
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-zinc-400">{formatCurrency(sale.raw_cost * (sale.quantity ?? 1), sale.currency)}</td>
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

      <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="Record Sale" className="max-w-3xl">
        <RecordSaleModal onClose={() => setShowAddModal(false)} />
      </Modal>


      <Modal open={!!selectedSale} onClose={() => setSelectedSale(null)} title="Sale">
        {selectedSale && <SaleActionModal sale={selectedSale} onClose={() => setSelectedSale(null)} />}
      </Modal>
    </div>
  );
}
