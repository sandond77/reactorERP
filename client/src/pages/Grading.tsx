import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type PaginatedResult } from '../lib/api';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { formatCurrency, formatDate } from '../lib/utils';
import { ColHeader, useColWidths } from '../components/ui/TableHeader';

interface Submission {
  id: string;
  card_name: string | null;
  set_name: string | null;
  company: string;
  status: string;
  service_level: string | null;
  grading_fee: number;
  shipping_cost: number;
  currency: string;
  submitted_at: string | null;
  estimated_return: string | null;
  returned_at: string | null;
}

interface SubmissionFilterOptions {
  companies: string[];
  statuses: string[];
}

const SUBMISSION_STATUS_COLORS: Record<string, string> = {
  submitted: 'bg-blue-500/20 text-blue-300',
  in_review: 'bg-yellow-500/20 text-yellow-300',
  graded: 'bg-purple-500/20 text-purple-300',
  returned: 'bg-green-500/20 text-green-300',
  cancelled: 'bg-zinc-700/50 text-zinc-400',
};

type SortDir = 'asc' | 'desc';

export function Grading() {
  const [page, setPage] = useState(1);
  const [sortCol, setSortCol] = useState<string | null>('submitted_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [fCompany, setFCompany] = useState<string[]>([]);
  const [fStatus, setFStatus] = useState<string[]>([]);
  const { rz, totalWidth } = useColWidths({ card: 600, company: 100, status: 110, cost: 110, submitted: 120, est_return: 120 });

  const handleSort = useCallback((col: string) => {
    setSortCol((prev) => {
      if (prev === col) return prev;
      return col;
    });
    setSortDir((prev) => sortCol === col ? (prev === 'asc' ? 'desc' : 'asc') : 'desc');
    setPage(1);
  }, [sortCol]);

  const { data: filterOptions } = useQuery<SubmissionFilterOptions>({
    queryKey: ['submission-filter-options'],
    queryFn: () => api.get('/grading/filters').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  function activeFilter(sel: string[], opts?: string[]) {
    return sel.length > 0 && sel.length < (opts?.length ?? 0) ? sel : [];
  }

  const companyFilter = activeFilter(fCompany, filterOptions?.companies);
  const statusFilter = activeFilter(fStatus, filterOptions?.statuses);

  const params = {
    page,
    limit: 25,
    sort_by: sortCol ?? undefined,
    sort_dir: sortDir,
    companies: companyFilter.join(',') || undefined,
    statuses: statusFilter.join(',') || undefined,
  };

  const { data, isLoading } = useQuery<PaginatedResult<Submission>>({
    queryKey: ['grading', params],
    queryFn: () => api.get('/grading', { params }).then((r) => r.data),
  });

  const sh = { sortCol, sortDir, onSort: handleSort };

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-100">Grading Submissions</h1>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">Loading…</div>
        ) : !data?.data.length ? (
          <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">No grading submissions yet.</div>
        ) : (
          <table className="text-xs whitespace-nowrap border-collapse" style={{ tableLayout: 'fixed', width: totalWidth + 'px' }}>
            <thead className="sticky top-0 bg-zinc-950 z-10">
              <tr className="border-b border-zinc-700 text-zinc-300 uppercase tracking-wide">
                <ColHeader label="Card"        col="card_name"      {...sh} {...rz('card')} />
                <ColHeader label="Company"     col="company"        {...sh} {...rz('company')}
                  filterOptions={filterOptions?.companies} filterSelected={fCompany} onFilterChange={(v) => { setFCompany(v); setPage(1); }} />
                <ColHeader label="Status"      col="status"         {...sh} {...rz('status')}
                  filterOptions={filterOptions?.statuses} filterSelected={fStatus} onFilterChange={(v) => { setFStatus(v); setPage(1); }} />
                <ColHeader label="Cost"        col="grading_fee"    {...sh} {...rz('cost')} align="right" />
                <ColHeader label="Submitted"   col="submitted_at"   {...sh} {...rz('submitted')} />
                <ColHeader label="Est. Return" col="estimated_return" {...sh} {...rz('est_return')} />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {data.data.map((sub) => (
                <tr key={sub.id} className="hover:bg-zinc-800/30 transition-colors">
                  <td className="px-3 py-2">
                    <p className="font-medium text-zinc-200 truncate" title={sub.card_name ?? ''}>{sub.card_name ?? 'Unknown'}</p>
                    <p className="text-[10px] text-zinc-500">{sub.set_name}</p>
                  </td>
                  <td className="px-3 py-2 text-zinc-300">{sub.company}</td>
                  <td className="px-3 py-2">
                    <Badge className={SUBMISSION_STATUS_COLORS[sub.status] ?? 'bg-zinc-700/50 text-zinc-400'}>
                      {sub.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right text-zinc-300">
                    {formatCurrency((sub.grading_fee ?? 0) + (sub.shipping_cost ?? 0), sub.currency)}
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{formatDate(sub.submitted_at)}</td>
                  <td className="px-3 py-2 text-zinc-500">{formatDate(sub.estimated_return)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data && (
        <div className="flex items-center justify-between px-6 py-3 pr-44 border-t border-zinc-800 text-xs text-zinc-500">
          <span>{data.total} submissions</span>
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
