import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type PaginatedResult } from '../lib/api';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { formatCurrency, formatDate } from '../lib/utils';

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

const LISTING_STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-500/20 text-green-300',
  sold: 'bg-gray-500/20 text-gray-400',
  cancelled: 'bg-red-500/20 text-red-400',
  expired: 'bg-yellow-500/20 text-yellow-300',
};

export function Listings() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery<PaginatedResult<Listing>>({
    queryKey: ['listings', page],
    queryFn: () => api.get('/listings', { params: { page, limit: 25 } }).then((r) => r.data),
  });

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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500 uppercase tracking-wide">
                <th className="px-6 py-3 font-medium">Card</th>
                <th className="px-4 py-3 font-medium">Platform</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Price</th>
                <th className="px-4 py-3 font-medium">Listed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {data.data.map((listing) => (
                <tr key={listing.id} className="hover:bg-zinc-800/30 transition-colors">
                  <td className="px-6 py-3">
                    <p className="font-medium text-zinc-200">{listing.card_name ?? 'Unknown'}</p>
                    <p className="text-xs text-zinc-500">
                      {listing.set_name}{listing.grade ? ` · ${listing.grading_company} ${listing.grade_label ?? listing.grade}` : ''}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-zinc-300">{listing.platform}</td>
                  <td className="px-4 py-3">
                    <Badge className={LISTING_STATUS_COLORS[listing.listing_status] ?? 'bg-zinc-700/50 text-zinc-400'}>
                      {listing.listing_status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-300">
                    {formatCurrency(listing.asking_price ?? listing.list_price ?? 0, listing.currency)}
                  </td>
                  <td className="px-4 py-3 text-zinc-500">{formatDate(listing.listed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data && data.total_pages > 1 && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-zinc-800 text-sm text-zinc-500">
          <span>{data.total} listings</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
            <span className="px-2 py-1">{page} / {data.total_pages}</span>
            <Button variant="ghost" size="sm" disabled={page >= data.total_pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
