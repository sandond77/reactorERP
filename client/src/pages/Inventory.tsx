import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ExternalLink } from 'lucide-react';
import { api, type PaginatedResult } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { AddCardForm } from '../components/inventory/AddCardForm';
import { CardDetailModal } from '../components/inventory/CardDetailModal';
import { formatCurrency, formatDate } from '../lib/utils';

interface SlabRow {
  id: string;
  card_name: string | null;
  cert_number: string | null;
  grade_label: string | null;
  numeric_grade: number | null;
  company: string;
  is_listed: boolean;
  listed_price: number | null;
  listing_url: string | null;
  listing_platform: string | null;
  raw_cost: number;
  grading_cost: number;
  strike_price: number | null;
  after_ebay: number | null;
  raw_purchase_date: string | null;
  date_listed: string | null;
  date_sold: string | null;
  roi_pct: number | null;
  notes: string | null;
  is_card_show: boolean;
}

type StatusFilter = 'all' | 'graded';

function fmt(cents: number | null): string {
  if (cents == null) return '—';
  return formatCurrency(cents);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return formatDate(d);
}

function NetCell({ afterEbay, raw, grading }: { afterEbay: number | null; raw: number; grading: number }) {
  if (afterEbay == null) {
    const cost = raw + grading;
    return <span className="text-red-400">-{formatCurrency(cost)}</span>;
  }
  const net = afterEbay - raw - grading;
  return <span className={net >= 0 ? 'text-green-400' : 'text-red-400'}>{fmt(net)}</span>;
}

function RoiCell({ roi, afterEbay, raw, grading }: { roi: number | null; afterEbay: number | null; raw: number; grading: number }) {
  let pct = roi != null ? Number(roi) : null;
  if (pct == null && afterEbay != null) {
    const cost = raw + grading;
    pct = cost > 0 ? ((afterEbay - cost) / cost) * 100 : null;
  }
  if (pct == null) return <span className="text-zinc-600">—</span>;
  return (
    <span className={pct >= 0 ? 'text-green-400' : 'text-red-400'}>
      {pct.toFixed(1)}%
    </span>
  );
}

export function Inventory() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('graded');
  const [addOpen, setAddOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleSearchChange = useCallback((val: string) => {
    setSearch(val);
    clearTimeout((handleSearchChange as any)._t);
    (handleSearchChange as any)._t = setTimeout(() => {
      setDebouncedSearch(val);
      setPage(1);
    }, 300);
  }, []);

  const { data, isLoading } = useQuery<PaginatedResult<SlabRow>>({
    queryKey: ['inventory-slabs', page, debouncedSearch, statusFilter],
    queryFn: () =>
      api
        .get('/grading/slabs', {
          params: { page, limit: 50, search: debouncedSearch || undefined, status: statusFilter },
        })
        .then((r) => r.data),
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-100">Inventory</h1>
        <Button onClick={() => setAddOpen(true)}>
          <Plus size={16} /> Add Card
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-zinc-800 bg-zinc-950/50">
        <input
          type="text"
          placeholder="Search card or cert…"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="flex-1 max-w-72 px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
        />
        <div className="flex gap-1 ml-auto">
          {(['all', 'graded'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`px-3 py-1 text-xs rounded font-medium capitalize transition-colors ${
                statusFilter === s
                  ? 'bg-zinc-600 text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">Loading…</div>
        ) : !data?.data.length ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <p className="text-zinc-500 text-sm">No cards found.</p>
            <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}>Add your first card</Button>
          </div>
        ) : (
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="sticky top-0 bg-zinc-950 z-10">
              <tr className="border-b border-zinc-800 text-left text-zinc-500 uppercase tracking-wide">
                <th className="px-3 py-2 font-medium">Cert</th>
                <th className="px-3 py-2 font-medium min-w-[260px]">Card</th>
                <th className="px-3 py-2 font-medium">Grade</th>
                <th className="px-3 py-2 font-medium text-center">Listed?</th>
                <th className="px-3 py-2 font-medium text-right">Listed Price</th>
                <th className="px-3 py-2 font-medium text-center">Listing</th>
                <th className="px-3 py-2 font-medium text-right">Raw</th>
                <th className="px-3 py-2 font-medium text-right">Grading Cost</th>
                <th className="px-3 py-2 font-medium text-right">Strike Price</th>
                <th className="px-3 py-2 font-medium text-right">After Ebay</th>
                <th className="px-3 py-2 font-medium text-right">Net</th>
                <th className="px-3 py-2 font-medium">Raw Purchase Date</th>
                <th className="px-3 py-2 font-medium">Date Listed</th>
                <th className="px-3 py-2 font-medium">Date Sold</th>
                <th className="px-3 py-2 font-medium text-right">% ROI</th>
                <th className="px-3 py-2 font-medium min-w-[160px]">Notes</th>
                <th className="px-3 py-2 font-medium text-center">Card Show?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {data.data.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setSelectedId(row.id)}
                  className="hover:bg-zinc-800/25 cursor-pointer transition-colors"
                >
                  <td className="px-3 py-1.5 font-mono text-zinc-400">{row.cert_number ?? '—'}</td>
                  <td className="px-3 py-1.5 text-zinc-200 max-w-[320px] truncate" title={row.card_name ?? ''}>
                    {row.card_name ?? '—'}
                  </td>
                  <td className="px-3 py-1.5 text-zinc-300 font-medium">
                    <span className="text-zinc-500 text-[10px] mr-1">{row.company}</span>
                    {row.grade_label ?? '—'}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {row.is_listed ? (
                      <span className="text-green-400 font-medium">Yes</span>
                    ) : (
                      <span className="text-zinc-600">No</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right text-zinc-300">{fmt(row.listed_price)}</td>
                  <td className="px-3 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                    {row.listing_url ? (
                      <a
                        href={row.listing_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex text-blue-400 hover:text-blue-300"
                      >
                        <ExternalLink size={12} />
                      </a>
                    ) : (
                      <span className="text-zinc-700">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right text-zinc-400">{fmt(row.raw_cost)}</td>
                  <td className="px-3 py-1.5 text-right text-zinc-500">
                    {row.grading_cost > 0 ? fmt(row.grading_cost) : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right text-zinc-300">{fmt(row.strike_price)}</td>
                  <td className="px-3 py-1.5 text-right text-zinc-300">{fmt(row.after_ebay)}</td>
                  <td className="px-3 py-1.5 text-right">
                    <NetCell afterEbay={row.after_ebay} raw={row.raw_cost} grading={row.grading_cost} />
                  </td>
                  <td className="px-3 py-1.5 text-zinc-500">{fmtDate(row.raw_purchase_date)}</td>
                  <td className="px-3 py-1.5 text-zinc-500">{fmtDate(row.date_listed)}</td>
                  <td className="px-3 py-1.5 text-zinc-500">{fmtDate(row.date_sold)}</td>
                  <td className="px-3 py-1.5 text-right">
                    <RoiCell roi={row.roi_pct} afterEbay={row.after_ebay} raw={row.raw_cost} grading={row.grading_cost} />
                  </td>
                  <td className="px-3 py-1.5 text-zinc-500 max-w-[200px] truncate" title={row.notes ?? ''}>
                    {row.notes ?? '—'}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {row.is_card_show ? (
                      <span className="text-yellow-400">Yes</span>
                    ) : (
                      <span className="text-zinc-700">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {data && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-zinc-800 text-xs text-zinc-500">
          <span>{(data.total ?? 0).toLocaleString()} cards</span>
          {data.total_pages > 1 && (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
              <span>{page} / {data.total_pages}</span>
              <Button variant="ghost" size="sm" disabled={page >= data.total_pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Card">
        <AddCardForm onSuccess={() => { setAddOpen(false); qc.invalidateQueries({ queryKey: ['inventory-slabs'] }); }} />
      </Modal>

      {selectedId && (
        <CardDetailModal
          cardId={selectedId}
          onClose={() => setSelectedId(null)}
          onDelete={(id) => { qc.invalidateQueries({ queryKey: ['inventory-slabs'] }); setSelectedId(null); }}
        />
      )}
    </div>
  );
}
