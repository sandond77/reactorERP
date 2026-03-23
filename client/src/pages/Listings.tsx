import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { api, type PaginatedResult } from '../lib/api';
import { Button } from '../components/ui/Button';
import { formatCurrency, formatDate } from '../lib/utils';
import { ColHeader, useColWidths } from '../components/ui/TableHeader';

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

type SortDir = 'asc' | 'desc';

export function Listings() {
  const [page, setPage] = useState(1);
  const [sortCol, setSortCol] = useState<string | null>('listed_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [fPlatform, setFPlatform] = useState<string[]>([]);
  const { rz, totalWidth } = useColWidths({ card: 600, platform: 100, price: 110, listed: 120, link: 60 });

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

  function activeFilter(sel: string[], opts?: string[]) {
    return sel.length > 0 && sel.length < (opts?.length ?? 0) ? sel : [];
  }

  const platformFilter = activeFilter(fPlatform, filterOptions?.platforms);

  const params = {
    page,
    limit: 25,
    sort_by: sortCol ?? undefined,
    sort_dir: sortDir,
    platform: platformFilter.length === 1 ? platformFilter[0] : undefined,
    status: 'active',
  };

  const { data, isLoading } = useQuery<PaginatedResult<Listing>>({
    queryKey: ['listings', params],
    queryFn: () => api.get('/listings', { params }).then((r) => r.data),
  });

  const sh = { sortCol, sortDir, onSort: handleSort };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-100">Listings</h1>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">Loading…</div>
        ) : !data?.data.length ? (
          <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">No listings yet.</div>
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
              {data.data.map((listing) => (
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
    </div>
  );
}
