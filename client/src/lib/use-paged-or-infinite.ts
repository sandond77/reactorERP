import { useEffect, useRef, useState } from 'react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import type { PaginatedResult } from './api';

export type ViewMode = 'pagination' | 'infinite';

const STORAGE_PREFIX = 'view-mode:';

// Read/write user preference for a given page. Falls back to 'pagination'
// so anyone loading the app for the first time sees the familiar UX.
export function useViewMode(pageKey: string): [ViewMode, (m: ViewMode) => void] {
  const storageKey = STORAGE_PREFIX + pageKey;
  const [mode, setMode] = useState<ViewMode>(() => {
    if (typeof window === 'undefined') return 'pagination';
    return (localStorage.getItem(storageKey) as ViewMode) ?? 'pagination';
  });
  const set = (m: ViewMode) => {
    setMode(m);
    try { localStorage.setItem(storageKey, m); } catch { /* private mode etc. */ }
  };
  return [mode, set];
}

interface Opts<T> {
  // Base query key. Filters + search should all live here so a filter change
  // invalidates BOTH the paginated cache and the infinite scroll cache.
  queryKey: unknown[];
  // Fetches page N (1-indexed). Server returns the standard PaginatedResult
  // shape used everywhere else in the app.
  fetch: (page: number) => Promise<PaginatedResult<T>>;
  mode: ViewMode;
  // Only meaningful in pagination mode. Ignored in infinite mode.
  page: number;
  // Skip the fetch entirely (e.g. tab hidden).
  enabled?: boolean;
}

interface Result<T> {
  data: T[];
  total: number;
  totalPages: number;
  isLoading: boolean;
  isFetchingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
}

// Bridges the app's existing PaginatedResult<T> API with either
// useQuery (pagination mode) or useInfiniteQuery (infinite scroll mode).
// The two queries have separate cache keys so switching modes doesn't
// discard the other's state — flip back and you're where you were.
export function usePagedOrInfinite<T>(opts: Opts<T>): Result<T> {
  const enabled = opts.enabled ?? true;

  const paginated = useQuery<PaginatedResult<T>>({
    queryKey: [...opts.queryKey, '__paginated', opts.page],
    queryFn: () => opts.fetch(opts.page),
    enabled: enabled && opts.mode === 'pagination',
  });

  const infinite = useInfiniteQuery<PaginatedResult<T>>({
    queryKey: [...opts.queryKey, '__infinite'],
    queryFn: ({ pageParam }) => opts.fetch(pageParam as number),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.page < lastPage.total_pages ? lastPage.page + 1 : undefined,
    enabled: enabled && opts.mode === 'infinite',
  });

  if (opts.mode === 'pagination') {
    return {
      data:           paginated.data?.data ?? [],
      total:          paginated.data?.total ?? 0,
      totalPages:     paginated.data?.total_pages ?? 1,
      isLoading:      paginated.isLoading,
      isFetchingMore: false,
      hasMore:        false,
      loadMore:       () => {},
    };
  }

  // infinite mode
  return {
    data:           infinite.data?.pages.flatMap((p) => p.data) ?? [],
    total:          infinite.data?.pages[0]?.total ?? 0,
    totalPages:     infinite.data?.pages[0]?.total_pages ?? 1,
    isLoading:      infinite.isLoading,
    isFetchingMore: infinite.isFetchingNextPage,
    hasMore:        infinite.hasNextPage ?? false,
    loadMore:       () => { infinite.fetchNextPage(); },
  };
}

// Returns a callback ref to attach to a sentinel element at the bottom of
// the list. The observer stays alive whenever there's more to fetch, so the
// next batch prefetches the moment the sentinel enters the pre-load margin.
// Uses state-based ref (not useRef) so the effect re-runs when the sentinel
// element itself mounts/unmounts — a useRef mutation wouldn't trigger the
// effect, and inline (el)=>ref.current=el callbacks fire on every render
// which caused the previous "sentinel goes null mid-fetch" clunkiness.
export function useInfiniteSentinel(
  hasMore: boolean,
  _isFetchingMore: boolean, // kept in signature for backwards compat; unused
  loadMore: () => void,
): (el: HTMLElement | null) => void {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  useEffect(() => {
    if (!el || !hasMore) return;
    // 800px root margin means "start loading when the sentinel is within a
    // full viewport-height of coming into view." At typical scroll speeds
    // that gives fetches ~300ms of head start — long enough that new rows
    // are usually rendered by the time the user reaches them.
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMoreRef.current();
    }, { rootMargin: '800px' });
    io.observe(el);
    return () => io.disconnect();
  }, [el, hasMore]);
  return setEl;
}
