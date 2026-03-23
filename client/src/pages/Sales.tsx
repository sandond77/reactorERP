import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type PaginatedResult } from '../lib/api';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { formatCurrency, formatDate } from '../lib/utils';
import { ColHeader, useColWidths } from '../components/ui/TableHeader';

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
}

interface SaleFilterOptions {
  platforms: string[];
}

type SortDir = 'asc' | 'desc';

export function Sales() {
  const [page, setPage] = useState(1);
  const [sortCol, setSortCol] = useState<string | null>('sold_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [fPlatform, setFPlatform] = useState<string[]>([]);
  const { rz, totalWidth } = useColWidths({ card: 560, platform: 100, sale_price: 110, net: 110, profit: 110, date: 120 });

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
  };

  const { data, isLoading } = useQuery<PaginatedResult<Sale>>({
    queryKey: ['sales', params],
    queryFn: () => api.get('/sales', { params }).then((r) => r.data),
  });

  const sh = { sortCol, sortDir, onSort: handleSort };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-100">Sales</h1>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">Loading…</div>
        ) : !data?.data.length ? (
          <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">No sales yet.</div>
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
              {data.data.map((sale) => (
                <tr key={sale.id} className="hover:bg-zinc-800/30 transition-colors">
                  <td className="px-3 py-2">
                    <p className="font-medium text-zinc-200 truncate" title={sale.card_name ?? ''}>{sale.card_name ?? 'Unknown'}</p>
                    <p className="text-[10px] text-zinc-500">
                      {sale.set_name}{sale.grade ? ` · ${sale.grading_company} ${sale.grade_label ?? sale.grade}` : ''}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    <Badge className="bg-zinc-700/50 text-zinc-300">{sale.platform}</Badge>
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
    </div>
  );
}
