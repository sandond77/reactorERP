import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { Search, X, Loader2, AlertTriangle, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, type PaginatedResult } from '../../lib/api';
import { Button } from '../ui/Button';
import {
  getPicks, togglePick, removePicks, clearPicks,
  reconcilePicks, subscribeToPicks,
  getReviewState, updateReviewEntry, clearReviewEntries, clearAllReviewState,
  type ReviewEntry,
} from '../../lib/card-show-picks';

// Slab shape from GET /grading/slabs?status=unsold&is_card_show=no.
// Columns mirror what the Card Show Inventory table shows, so users have the
// same scan-friendly context (Cert · Card · Grade · Company · Cost · Listed).
interface SlabRow {
  id: string;
  sku: string | null;
  card_name: string | null;
  set_name: string | null;
  cert_number: string | null;
  grade_label: string | null;
  company: string;
  is_listed: boolean;
  listed_price: number | null;
  card_show_price: number | null;
  raw_cost: number;
  grading_cost: number;
  // Same-identity siblings (catalog_id + grade + company match) already at a
  // card show. Shown inline as an amber "@show: N" chip so the user doesn't
  // over-stock a card that's already got copies at the booth. IDs are used
  // when the user opts to propagate their entered price to those siblings on
  // commit.
  at_show_count: number;
  at_show_sibling_ids: string[];
}

interface PricingSuggestion {
  slab_id: string;
  total_cost_cents: number;
  suggested_price_cents: number | null;
  sample_count: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

// Two-phase pick-list workflow:
//   1. Add mode  — search unsold non-card-show slab inventory, tick to add to
//      the browser-local pick list. Persists across sessions in localStorage.
//   2. Review mode — for each pick, mark "Found" (physically in hand) and
//      enter a CS Price. Commit sends only Found + Priced rows to the
//      existing POST /card-shows/add-inventory endpoint, which handles
//      is_card_show=true + location assignment. Cards not found stay in the
//      pick list for the next session.
export function PickListModal({ open, onClose }: Props) {
  const qc = useQueryClient();

  // Subscribe to picks storage so both modes see the same list. Using the
  // React 18 useSyncExternalStore API for the correct snapshot semantics.
  const picks = useSyncExternalStore(
    (cb) => subscribeToPicks(cb),
    () => JSON.stringify(getPicks()),
    () => '[]',
  );
  const pickedIds = useMemo<string[]>(() => JSON.parse(picks || '[]'), [picks]);
  const pickedSet = useMemo(() => new Set(pickedIds), [pickedIds]);

  const [mode, setMode] = useState<'add' | 'review'>('add');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Sort state for the Add-mode table. Server sorts via `sort_by`/`sort_dir`
  // params; default is cert ascending (matches how users physically scan a
  // storage box — low cert to high). Only server-supported sort keys here —
  // company would need client-side sort so it's omitted for now.
  type SortCol = 'cert_number' | 'card_name' | 'grade' | 'raw_cost' | 'listed_price';
  const [sortBy, setSortBy] = useState<SortCol>('cert_number');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  function toggleSort(col: SortCol) {
    if (sortBy === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortDir('asc');
    }
  }

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Per-row review state — Found flag + CS Price input string. Persisted to
  // localStorage alongside the pick list so accidentally clicking the
  // backdrop doesn't wipe partial work. Subscribes to the same listeners as
  // the pick list, so any keystroke re-renders the modal (fine at typical
  // pick-list sizes; keeps the UI honest about what's persisted).
  const reviewRaw = useSyncExternalStore(
    (cb) => subscribeToPicks(cb),
    () => JSON.stringify(getReviewState()),
    () => '{}',
  );
  const reviewState = useMemo<Record<string, ReviewEntry>>(() => JSON.parse(reviewRaw || '{}'), [reviewRaw]);
  // Two-click confirm for the destructive "Clear all picks" button — inline
  // pattern per CLAUDE.md (no window.confirm ever).
  const [clearArmed, setClearArmed] = useState(false);

  // Per-row toggle: "also update N same-identity siblings already at a card
  // show to my entered price on commit." Modal-local state; not persisted —
  // it's a per-commit decision, not scratchpad state worth carrying forward.
  const [propagateIds, setPropagateIds] = useState<Set<string>>(new Set());
  const togglePropagate = (id: string) => setPropagateIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Add-mode search: unsold slabs not in card-show inventory. Infinite-scroll
  // pagination via IntersectionObserver on a sentinel row at the bottom of
  // the table body.
  const PAGE_LIMIT = 50;
  const addQuery = useInfiniteQuery<PaginatedResult<SlabRow>>({
    queryKey: ['card-show-picker-add', debouncedSearch, sortBy, sortDir],
    queryFn: ({ pageParam }) => api.get('/grading/slabs', {
      params: {
        status: 'unsold', is_card_show: 'no', personal_collection: 'no',
        search: debouncedSearch || undefined, limit: PAGE_LIMIT, page: pageParam,
        sort_by: sortBy, sort_dir: sortDir,
      },
    }).then((r) => r.data),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.total_pages ? last.page + 1 : undefined),
    enabled: open && mode === 'add',
  });

  // Review mode: fetch the full slab detail for currently-picked ids. Server
  // doesn't have a bulk-by-id endpoint, so reuse the same list query
  // unbounded (limit 100) and filter client-side. For pick lists of typical
  // size (<50) this is fine.
  const reviewQuery = useQuery<PaginatedResult<SlabRow>>({
    queryKey: ['card-show-picker-review', pickedIds.join(',')],
    queryFn: () => api.get('/grading/slabs', {
      params: { status: 'unsold', is_card_show: 'no', personal_collection: 'no', limit: 100, page: 1 },
    }).then((r) => r.data),
    enabled: open && mode === 'review' && pickedIds.length > 0,
  });

  // Pricing suggestions — reuses the /grading/card-show-pricing-suggestions
  // endpoint that the Add-to-Card-Show modal already relies on. Suggestion is
  // the most recent card_show_price set on a same-identity slab currently at
  // a card show; sample_count reports how many contributing slabs there were.
  const suggestionsQuery = useQuery<PricingSuggestion[]>({
    queryKey: ['card-show-picker-pricing', pickedIds.join(',')],
    queryFn: () => api.post('/grading/card-show-pricing-suggestions', { slab_ids: pickedIds })
      .then((r) => r.data),
    enabled: open && mode === 'review' && pickedIds.length > 0,
  });
  const suggestionMap = useMemo(() => {
    const m = new Map<string, PricingSuggestion>();
    for (const s of suggestionsQuery.data ?? []) m.set(s.slab_id, s);
    return m;
  }, [suggestionsQuery.data]);

  // Reconcile localStorage against eligible IDs whenever new slab data arrives.
  // If any picks are no longer eligible (sold, moved to card show elsewhere),
  // silently drop them from localStorage and toast the count so the user knows
  // why the number changed.
  // Reconciliation only runs in review mode (see effect below), so we key the
  // eligible-ids set solely off the review-mode query. Add-mode results are
  // search-filtered and paged, so they don't represent the full eligible
  // universe anyway.
  const eligibleIds = useMemo(() => {
    const src = reviewQuery.data?.data;
    return new Set((src ?? []).map((r) => r.id));
  }, [reviewQuery.data]);
  const reconciledOnceRef = useRef(false);
  useEffect(() => {
    if (!open || pickedIds.length === 0) return;
    // Only reconcile once per open, and only when we have review-mode data
    // (add-mode data is filtered by search so it doesn't represent the full
    // eligible universe).
    if (mode !== 'review') return;
    if (reviewQuery.isFetching) return;
    if (reconciledOnceRef.current) return;
    const dropped = reconcilePicks(eligibleIds);
    reconciledOnceRef.current = true;
    if (dropped.length > 0) {
      toast(
        `${dropped.length} pick${dropped.length === 1 ? '' : 's'} removed — those cards are no longer eligible.`,
        { icon: 'ℹ️' },
      );
    }
  }, [open, mode, pickedIds.length, eligibleIds, reviewQuery.isFetching]);

  // Reset the reconcile guard whenever the modal closes so a fresh open
  // triggers a new check.
  useEffect(() => {
    if (!open) reconciledOnceRef.current = false;
  }, [open]);

  // Rows for review mode: the intersection of picks and eligible slabs.
  const reviewRows = useMemo<SlabRow[]>(() => {
    if (mode !== 'review') return [];
    const all = reviewQuery.data?.data ?? [];
    const map = new Map(all.map((r) => [r.id, r]));
    return pickedIds.map((id) => map.get(id)).filter((r): r is SlabRow => !!r);
  }, [mode, pickedIds, reviewQuery.data]);

  // Commit: bulk /card-shows/add-inventory for Found+Priced rows only. When
  // a row has Propagate ticked, its at_show_sibling_ids are appended to the
  // payload with the same price — the endpoint already handles "existing
  // card-show slab, new price" as a straight update.
  const commitMut = useMutation({
    mutationFn: async () => {
      const eligible = reviewRows.filter((r) => {
        const s = reviewState[r.id];
        if (!s || !s.found) return false;
        const priceCents = parseCents(s.price);
        return priceCents !== null;
      });
      if (eligible.length === 0) throw new Error('Nothing to commit');
      const cards: { id: string; card_show_price: number }[] = [];
      let propagatedCount = 0;
      for (const r of eligible) {
        const priceCents = parseCents(reviewState[r.id].price)!;
        cards.push({ id: r.id, card_show_price: priceCents });
        if (propagateIds.has(r.id) && r.at_show_sibling_ids.length > 0) {
          for (const sibId of r.at_show_sibling_ids) {
            cards.push({ id: sibId, card_show_price: priceCents });
            propagatedCount++;
          }
        }
      }
      await api.post('/card-shows/add-inventory', { cards });
      return { count: eligible.length, propagatedCount, ids: eligible.map((r) => r.id) };
    },
    onSuccess: ({ count, propagatedCount, ids }) => {
      removePicks(ids);
      // Clear review state only for the committed rows so any not-found rows
      // keep their entries in localStorage for next session.
      clearReviewEntries(ids);
      // Clear propagate flags for committed rows.
      setPropagateIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      qc.invalidateQueries({ queryKey: ['overall'] });
      qc.invalidateQueries({ queryKey: ['grading-slabs'] });
      const propagated = propagatedCount > 0 ? ` · repriced ${propagatedCount} existing` : '';
      toast.success(`Moved ${count} card${count === 1 ? '' : 's'} to card show inventory${propagated}.`);
      // If nothing left to review, drop back to Add mode.
      if (getPicks().length === 0) {
        setMode('add');
        onClose();
      }
    },
    onError: (err: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const msg = (err as any)?.response?.data?.error ?? (err as Error)?.message ?? 'Failed to commit picks.';
      toast.error(msg);
    },
  });

  // Ready-to-commit summary
  const readyRows = reviewRows.filter((r) => {
    const s = reviewState[r.id];
    return s?.found && parseCents(s.price) !== null;
  });
  const readyTotalCents = readyRows.reduce((sum, r) => sum + (parseCents(reviewState[r.id].price) ?? 0), 0);

  // Add-mode rows — flatten all pages the infinite query has fetched so far
  const addRows = useMemo<SlabRow[]>(
    () => addQuery.data?.pages.flatMap((p) => p.data) ?? [],
    [addQuery.data],
  );
  const addTotal = addQuery.data?.pages[0]?.total ?? 0;

  function toggleReview(id: string, patch: Partial<ReviewEntry>) {
    // Delegates to the localStorage helper; the useSyncExternalStore
    // subscription above will re-render this modal in response.
    updateReviewEntry(id, patch);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-7xl mx-4 max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-800 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">Card Show Pick List</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Working list of slabs for your next show — persists in this browser until committed.
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Mode filter pills */}
        <div className="px-5 py-3 border-b border-zinc-800 shrink-0 flex items-center gap-3">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setMode('add')}
              className={
                'px-3 py-1 text-xs rounded-md font-medium transition-colors ' +
                (mode === 'add' ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200')
              }
            >
              Add cards
            </button>
            <button
              type="button"
              onClick={() => setMode('review')}
              className={
                'px-3 py-1 text-xs rounded-md font-medium transition-colors ' +
                (mode === 'review' ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200')
              }
            >
              Review picks
              <span className={`ml-1.5 text-[10px] ${mode === 'review' ? 'text-indigo-200' : 'text-zinc-500'}`}>
                {pickedIds.length}
              </span>
            </button>
          </div>
          {pickedIds.length > 0 && (
            clearArmed ? (
              <div className="ml-auto flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-red-500/10 border border-red-500/40">
                <AlertTriangle size={12} className="text-red-400" />
                <span className="text-xs text-red-200">
                  Clear all <span className="font-semibold">{pickedIds.length}</span> pick{pickedIds.length === 1 ? '' : 's'}? This can't be undone.
                </span>
                <button
                  type="button"
                  onClick={() => { clearPicks(); clearAllReviewState(); setClearArmed(false); }}
                  className="ml-1 px-2 py-0.5 text-[11px] font-semibold rounded bg-red-600 hover:bg-red-500 text-white transition-colors"
                >
                  Yes, clear all
                </button>
                <button
                  type="button"
                  onClick={() => setClearArmed(false)}
                  className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setClearArmed(true)}
                className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-zinc-700 text-zinc-400 hover:text-red-300 hover:border-red-500/50 transition-colors"
              >
                <Trash2 size={11} /> Clear All
              </button>
            )
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {mode === 'add' ? (
            <AddMode
              search={search}
              setSearch={setSearch}
              rows={addRows}
              pickedSet={pickedSet}
              loading={addQuery.isLoading}
              sortBy={sortBy}
              sortDir={sortDir}
              onSort={toggleSort}
              total={addTotal}
              hasNextPage={!!addQuery.hasNextPage}
              isFetchingNextPage={addQuery.isFetchingNextPage}
              fetchNextPage={() => addQuery.fetchNextPage()}
            />
          ) : (
            <ReviewMode
              rows={reviewRows}
              reviewState={reviewState}
              onChange={toggleReview}
              onRemovePick={(id) => { removePicks([id]); clearReviewEntries([id]); }}
              loading={reviewQuery.isLoading || reviewQuery.isFetching}
              empty={pickedIds.length === 0}
              suggestions={suggestionMap}
              propagateIds={propagateIds}
              onTogglePropagate={togglePropagate}
            />
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-800 p-4 shrink-0 flex items-center justify-between">
          <div className="text-xs text-zinc-400">
            {mode === 'review' ? (
              <>
                Ready: <span className="text-zinc-100 font-semibold">{readyRows.length} / {reviewRows.length}</span>
                {readyRows.length > 0 && (
                  <span className="ml-2 text-zinc-500">
                    · Sticker total <span className="text-zinc-100 font-semibold">${(readyTotalCents / 100).toFixed(2)}</span>
                  </span>
                )}
              </>
            ) : (
              <>Picks so far: <span className="text-zinc-100 font-semibold">{pickedIds.length}</span></>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            {mode === 'review' && (
              <Button
                size="sm"
                onClick={() => commitMut.mutate()}
                disabled={readyRows.length === 0 || commitMut.isPending}
              >
                {commitMut.isPending
                  ? <><Loader2 size={12} className="animate-spin mr-1.5" />Committing…</>
                  : `Commit ${readyRows.length} → Card Show`}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Add mode ─────────────────────────────────────────────────────────────────

type SortCol = 'cert_number' | 'card_name' | 'grade' | 'raw_cost' | 'listed_price';

function AddMode(props: {
  search: string;
  setSearch: (s: string) => void;
  rows: SlabRow[];
  pickedSet: Set<string>;
  loading: boolean;
  sortBy: SortCol;
  sortDir: 'asc' | 'desc';
  onSort: (col: SortCol) => void;
  total: number;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}) {
  const { search, setSearch, rows, pickedSet, loading, sortBy, sortDir, onSort, total, hasNextPage, isFetchingNextPage, fetchNextPage } = props;

  // Infinite-scroll sentinel: an IntersectionObserver on a tiny row at the
  // bottom of the tbody triggers fetchNextPage. Scoped to the scroll container
  // via `root` so it only fires when the sentinel actually enters the modal's
  // visible area, not the full document viewport.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    const root = scrollRef.current;
    const target = sentinelRef.current;
    if (!root || !target) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { fetchNextPage(); break; }
      }
    }, { root, rootMargin: '200px 0px', threshold: 0 });
    io.observe(target);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, rows.length]);
  const sortIcon = (col: SortCol) => {
    if (sortBy !== col) return <span className="text-zinc-600">↕</span>;
    return <span className="text-indigo-400">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };
  const headerBtn = (col: SortCol, label: string, align: 'left' | 'right' = 'left') => (
    <button
      type="button"
      onClick={() => onSort(col)}
      className={`w-full flex items-center gap-1 uppercase tracking-wide font-medium hover:text-zinc-200 transition-colors ${align === 'right' ? 'justify-end' : ''}`}
    >
      <span>{label}</span>
      {sortIcon(col)}
    </button>
  );
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search unsold slab inventory (name or cert #)…"
          className="w-full pl-8 pr-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
          autoFocus
        />
      </div>
      {loading ? (
        <div className="text-center text-xs text-zinc-500 py-6"><Loader2 size={13} className="inline animate-spin mr-1.5" />Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-center text-xs text-zinc-500 py-6">
          {search ? 'No matches.' : 'Start typing to search unsold slabs.'}
        </div>
      ) : (
        // Tabular layout to match Card Show Inventory / Graded Overall — same
        // column set (Cert · Card · Grade · Company · Cost · Listed) so scanning
        // the pick candidates feels identical to browsing the main table.
        <div className="border border-zinc-800 rounded-lg overflow-hidden">
          <div ref={scrollRef} className="max-h-[55vh] overflow-y-auto">
            <table className="w-full text-xs table-fixed">
              <colgroup>
                <col className="w-10" />
                <col className="w-28" />
                <col />
                <col className="w-32" />
                <col className="w-20" />
                <col className="w-24" />
                <col className="w-24" />
              </colgroup>
              <thead className="sticky top-0 z-10 bg-zinc-900/95 backdrop-blur">
                <tr className="border-b border-zinc-700 text-zinc-400">
                  <th className="px-2 py-2"></th>
                  <th className="px-2 py-2 text-left">{headerBtn('cert_number', 'Cert')}</th>
                  <th className="px-2 py-2 text-left">{headerBtn('card_name', 'Card')}</th>
                  <th className="px-2 py-2 text-left">{headerBtn('grade', 'Grade')}</th>
                  <th className="px-2 py-2 text-left uppercase tracking-wide font-medium">Company</th>
                  <th className="px-2 py-2 text-right">{headerBtn('raw_cost', 'Cost', 'right')}</th>
                  <th className="px-2 py-2 text-right">{headerBtn('listed_price', 'Listed', 'right')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const picked = pickedSet.has(r.id);
                  const cost = ((r.raw_cost ?? 0) + (r.grading_cost ?? 0)) / 100;
                  return (
                    <tr
                      key={r.id}
                      onClick={() => togglePick(r.id)}
                      className={`cursor-pointer transition-colors border-b border-zinc-800 last:border-0 ${picked ? 'bg-indigo-900/20 hover:bg-indigo-900/30' : 'hover:bg-zinc-800/50'}`}
                    >
                      <td className="px-2 py-1.5">
                        <input
                          type="checkbox"
                          checked={picked}
                          onChange={() => togglePick(r.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="accent-indigo-500"
                        />
                      </td>
                      <td className="px-2 py-1.5 font-mono text-[11px] text-indigo-300 whitespace-nowrap">
                        {r.cert_number ?? '—'}
                      </td>
                      <td className="px-2 py-1.5 text-zinc-200 overflow-hidden">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="truncate">{r.card_name ?? '—'}</span>
                          {r.is_listed && (
                            <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-[1px] rounded bg-sky-500/15 border border-sky-500/40 text-sky-300">
                              eBay
                            </span>
                          )}
                          {r.at_show_count > 0 && (
                            <span
                              className="shrink-0 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-[1px] rounded bg-amber-500/15 border border-amber-500/40 text-amber-300"
                              title={`${r.at_show_count} same-identity slab${r.at_show_count === 1 ? '' : 's'} already at a card show`}
                            >
                              @show ×{r.at_show_count}
                            </span>
                          )}
                        </div>
                        {r.set_name && (
                          <div className="truncate text-[10px] text-zinc-500">{r.set_name}</div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-zinc-300 truncate">{r.grade_label ?? '—'}</td>
                      <td className="px-2 py-1.5 text-zinc-400 truncate">{r.company}</td>
                      <td className="px-2 py-1.5 text-right text-zinc-300 tabular-nums whitespace-nowrap">${cost.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-right text-zinc-300 tabular-nums whitespace-nowrap">
                        {r.listed_price != null ? `$${(r.listed_price / 100).toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  );
                })}
                {/* Sentinel row that trips the IntersectionObserver to load
                    the next page. Height 1px so it doesn't add visible space
                    at the end of the list. */}
                {hasNextPage && (
                  <tr ref={sentinelRef} aria-hidden>
                    <td colSpan={7} className="h-px" />
                  </tr>
                )}
                {isFetchingNextPage && (
                  <tr>
                    <td colSpan={7} className="px-2 py-3 text-center text-[11px] text-zinc-500">
                      <Loader2 size={11} className="inline animate-spin mr-1.5" />Loading more…
                    </td>
                  </tr>
                )}
                {!hasNextPage && rows.length > 0 && (
                  <tr>
                    <td colSpan={7} className="px-2 py-2 text-center text-[10px] text-zinc-600">
                      End of results · {total} total
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Review mode ──────────────────────────────────────────────────────────────

function ReviewMode(props: {
  rows: SlabRow[];
  reviewState: Record<string, ReviewEntry>;
  onChange: (id: string, patch: Partial<ReviewEntry>) => void;
  onRemovePick: (id: string) => void;
  loading: boolean;
  empty: boolean;
  suggestions: Map<string, PricingSuggestion>;
  propagateIds: Set<string>;
  onTogglePropagate: (id: string) => void;
}) {
  const { rows, reviewState, onChange, onRemovePick, loading, empty, suggestions, propagateIds, onTogglePropagate } = props;
  if (empty) {
    return (
      <div className="text-center text-xs text-zinc-500 py-8">
        No picks yet. Switch to <span className="text-zinc-300">Add cards</span> to build your list.
      </div>
    );
  }
  if (loading) {
    return <div className="text-center text-xs text-zinc-500 py-6"><Loader2 size={13} className="inline animate-spin mr-1.5" />Loading…</div>;
  }
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-zinc-500 leading-relaxed">
        Pull each card from storage. Tick <span className="text-zinc-300">Found</span> once in hand and enter the sticker price for the show. Only Found + Priced rows will be committed.
      </p>
      {rows.map((r) => {
        const state = reviewState[r.id] ?? { found: false, price: '' };
        const priceCents = parseCents(state.price);
        const priceValid = priceCents !== null;
        const cost = ((r.raw_cost ?? 0) + (r.grading_cost ?? 0)) / 100;
        const listed = r.listed_price != null ? r.listed_price / 100 : null;
        // Pricing suggestion for this identity (most recent card_show_price
        // on a same-identity sibling currently at a show).
        const sug = suggestions.get(r.id);
        const suggested = sug?.suggested_price_cents != null ? sug.suggested_price_cents / 100 : null;
        const sampleCount = sug?.sample_count ?? 0;
        const propagate = propagateIds.has(r.id);
        // Only offer propagate when there's a valid entered price and there
        // are siblings whose prices might actually change.
        const canPropagate = state.found && priceValid && r.at_show_sibling_ids.length > 0;
        return (
          <div key={r.id} className="border border-zinc-800 rounded-lg p-3 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-zinc-100 truncate flex items-center gap-1.5">
                  <span className="truncate">{r.card_name ?? '—'}</span>
                  {r.is_listed && (
                    <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-[1px] rounded bg-sky-500/15 border border-sky-500/40 text-sky-300">
                      eBay
                    </span>
                  )}
                  {r.at_show_count > 0 && (
                    <span
                      className="shrink-0 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-[1px] rounded bg-amber-500/15 border border-amber-500/40 text-amber-300"
                      title={`${r.at_show_count} same-identity slab${r.at_show_count === 1 ? '' : 's'} already at a card show`}
                    >
                      @show ×{r.at_show_count}
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-zinc-500 truncate">
                  {r.set_name ?? ''}
                  {r.cert_number ? ` · #${r.cert_number}` : ''}
                  {' · '}{r.company} {r.grade_label}
                </p>
                <p className="text-[10px] text-zinc-600 mt-0.5">
                  Cost ${cost.toFixed(2)}{listed != null && ` · Listed $${listed.toFixed(2)}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRemovePick(r.id)}
                className="text-[10px] text-zinc-500 hover:text-red-400 transition-colors shrink-0"
                title="Remove from pick list"
              >
                Remove
              </button>
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-xs text-zinc-300 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={state.found}
                  onChange={(e) => onChange(r.id, { found: e.target.checked })}
                  className="accent-indigo-500"
                />
                Found
              </label>
              <div className="flex-1 flex items-center gap-1.5">
                <span className="text-[11px] text-zinc-500">CS Price $</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={state.price}
                  onChange={(e) => onChange(r.id, { price: e.target.value })}
                  disabled={!state.found}
                  placeholder={listed != null ? listed.toFixed(2) : '0.00'}
                  className={
                    'flex-1 max-w-[9rem] px-2 py-1 text-xs rounded border transition-colors ' +
                    (state.found
                      ? (priceValid || state.price === ''
                          ? 'bg-zinc-800 border-zinc-700 text-zinc-100 focus:outline-none focus:border-indigo-500'
                          : 'bg-zinc-800 border-red-500 text-red-300 focus:outline-none')
                      : 'bg-zinc-900 border-zinc-800 text-zinc-600 cursor-not-allowed')
                  }
                />
                {state.found && !priceValid && state.price !== '' && (
                  <span className="text-[10px] text-red-400">Invalid</span>
                )}
              </div>
            </div>
            {/* Suggested price line — reference only. Shown when a same-identity
                sibling at a show has a card_show_price set. Small "Use" button
                pre-fills the input so users don't have to retype the number. */}
            {suggested != null && (
              <div className="flex items-center gap-2 pl-6 text-[11px]">
                <span className="text-zinc-500">
                  Suggested <span className="text-zinc-200 font-semibold tabular-nums">${suggested.toFixed(2)}</span>
                  <span className="text-zinc-600 ml-1">· {sampleCount} sample{sampleCount === 1 ? '' : 's'}</span>
                </span>
                {state.found && Math.round(suggested * 100) !== parseCents(state.price) && (
                  <button
                    type="button"
                    onClick={() => onChange(r.id, { price: suggested.toFixed(2) })}
                    className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/30 transition-colors"
                  >
                    Use
                  </button>
                )}
              </div>
            )}
            {/* Propagate toggle — bundle the sibling IDs into the commit
                payload so their card_show_price gets updated to match this
                row's entered price. Hidden until Found + valid price. */}
            {canPropagate && (
              <label className="flex items-center gap-1.5 pl-6 text-[11px] text-zinc-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={propagate}
                  onChange={() => onTogglePropagate(r.id)}
                  className="accent-amber-500"
                />
                Also update {r.at_show_sibling_ids.length} other cop{r.at_show_sibling_ids.length === 1 ? 'y' : 'ies'} at show to <span className="text-zinc-200 font-semibold tabular-nums">${(priceCents! / 100).toFixed(2)}</span>
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Parse a user-entered dollar string into cents. Returns null on invalid or
// zero — commit refuses to send cards without a positive price.
function parseCents(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100);
}
