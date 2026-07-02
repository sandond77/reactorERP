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

// Attach to any element that should trigger fetchNextPage when it enters
// the viewport (e.g. a sentinel <div> at the bottom of the table). The
// ref is stable so the effect only re-runs when hasMore / callback change.
export function useInfiniteSentinel(hasMore: boolean, isFetchingMore: boolean, loadMore: () => void) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !hasMore || isFetchingMore) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMore();
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, isFetchingMore, loadMore]);
  return ref;
}
