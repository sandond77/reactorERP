import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type PaginatedResult } from '../lib/api';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { formatCurrency, formatDate } from '../lib/utils';

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

const SUBMISSION_STATUS_COLORS: Record<string, string> = {
  submitted: 'bg-blue-500/20 text-blue-300',
  in_review: 'bg-yellow-500/20 text-yellow-300',
  graded: 'bg-purple-500/20 text-purple-300',
  returned: 'bg-green-500/20 text-green-300',
  cancelled: 'bg-zinc-700/50 text-zinc-400',
};

export function Grading() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery<PaginatedResult<Submission>>({
    queryKey: ['grading', page],
    queryFn: () => api.get('/grading', { params: { page, limit: 25 } }).then((r) => r.data),
  });

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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500 uppercase tracking-wide">
                <th className="px-6 py-3 font-medium">Card</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Cost</th>
                <th className="px-4 py-3 font-medium">Submitted</th>
                <th className="px-4 py-3 font-medium">Est. Return</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {data.data.map((sub) => (
                <tr key={sub.id} className="hover:bg-zinc-800/30 transition-colors">
                  <td className="px-6 py-3">
                    <p className="font-medium text-zinc-200">{sub.card_name ?? 'Unknown'}</p>
                    <p className="text-xs text-zinc-500">{sub.set_name}</p>
                  </td>
                  <td className="px-4 py-3 text-zinc-300">{sub.company}</td>
                  <td className="px-4 py-3">
                    <Badge className={SUBMISSION_STATUS_COLORS[sub.status] ?? 'bg-zinc-700/50 text-zinc-400'}>
                      {sub.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-300">
                    {formatCurrency((sub.grading_fee ?? 0) + (sub.shipping_cost ?? 0), sub.currency)}
                  </td>
                  <td className="px-4 py-3 text-zinc-500">{formatDate(sub.submitted_at)}</td>
                  <td className="px-4 py-3 text-zinc-500">{formatDate(sub.estimated_return)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data && data.total_pages > 1 && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-zinc-800 text-sm text-zinc-500">
          <span>{data.total} submissions</span>
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
