import { useState, useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { X, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { formatCurrency, formatDate } from '../lib/utils';
import { ColHeader, useColWidths, colMinWidth } from '../components/ui/TableHeader';
import { loadFilters, saveFilters } from '../lib/filter-store';
import { InspectionPanel } from './raw/InspectionPanel';
import type { PurchaseRow, PurchaseType } from './raw/types';
import { STATUS_COLORS, TYPE_COLORS } from './raw/types';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import toast from 'react-hot-toast';

const DEFAULTS = {
  search: '',
  fType:  null as PurchaseType | null,
};

export function Inspection() {
  const saved = loadFilters('inspection', DEFAULTS);
  const qc = useQueryClient();
  const [page, setPage]               = useState(1);
  const [search, setSearch]           = useState(saved.search);
  const [debouncedSearch, setDebounced] = useState(saved.search);
  const [fType, setFType]             = useState<PurchaseType | null>(saved.fType);
  const [drillRow, setDrillRow]       = useState<PurchaseRow | null>(null);
  const [deleteRow, setDeleteRow]     = useState<PurchaseRow | null>(null);

  const MINS = {
    pid:     colMinWidth('ID',         true, false),
    type:    colMinWidth('Type',       true, false),
    card:    colMinWidth('Card',       true, false),
    source:  colMinWidth('Source',     true, false),
    cards:   colMinWidth('Cards',      true, false),
    cost:    colMinWidth('Cost (USD)', true, false),
    avg:     colMinWidth('Avg/Card',   true, false),
    status:  colMinWidth('Status',     true, false),
    bought:  colMinWidth('Purchased',  true, false),
    inspect:   colMinWidth('Inspected', true, false),
    for_sale:  colMinWidth('For Sale',  true, false),
    for_grade: colMinWidth('For Grade', true, false),
  };
  const { rz, totalWidth } = useColWidths({
    pid:       Math.max(MINS.pid,       110),
    type:      Math.max(MINS.type,       80),
    card:      Math.max(MINS.card,      280),
    source:    Math.max(MINS.source,    140),
    cards:     Math.max(MINS.cards,      70),
    cost:      Math.max(MINS.cost,      110),
    avg:       Math.max(MINS.avg,       100),
    status:    Math.max(MINS.status,    100),
    bought:    Math.max(MINS.bought,    110),
    inspect:   Math.max(MINS.inspect,   110),
    for_sale:  Math.max(MINS.for_sale,   80),
    for_grade: Math.max(MINS.for_grade,  85),
  });

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    saveFilters('inspection', { search, fType });
  }, [search, fType]);

  const params = {
    page,
    pageSize:         50,
    search:           debouncedSearch || undefined,
    needs_inspection: true,
    type:             fType ?? undefined,
  };

  const { data, isLoading } = useQuery<{ data: PurchaseRow[]; total: number; totalPages: number }>({
    queryKey: ['raw-purchases', params],
    queryFn: () => api.get('/raw-purchases', { params }).then((r) => r.data),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['raw-purchases'] });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/raw-purchases/${id}`),
    onSuccess: () => { invalidate(); setDeleteRow(null); toast.success('Purchase deleted'); },
    onError: () => toast.error('Failed to delete'),
  });

  const hasActiveFilters = !!debouncedSearch || fType !== null;
  function clearFilters() { setSearch(''); setFType(null); setPage(1); }

  const sh = { sortCol: null, sortDir: 'asc' as const, onSort: () => {} };

  if (drillRow) {
    return <InspectionPanel purchase={drillRow} onClose={() => setDrillRow(null)} />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-100">Inspection</h1>
        <div className="flex items-center gap-3">
          {hasActiveFilters && (
            <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
              <X size={12} /> Reset filters
            </button>
          )}

          {/* Type filter */}
          <div className="flex gap-1">
            <button onClick={() => { setFType(null); setPage(1); }}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${fType === null ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
              All
            </button>
            {(['raw', 'bulk'] as PurchaseType[]).map((t) => (
              <button key={t}
                onClick={() => { setFType(t); setPage(1); }}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors capitalize ${fType === t ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                {t}
              </button>
            ))}
          </div>

          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-52 px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">Loading…</div>
        ) : (
          <table className="text-xs whitespace-nowrap border-collapse" style={{ tableLayout: 'fixed', width: totalWidth + 'px' }}>
            <thead className="sticky top-0 bg-zinc-950 z-10">
              <tr className="border-b border-zinc-700 text-zinc-300 uppercase tracking-wide">
                <ColHeader label="ID"         col="purchase_id"    {...sh} {...rz('pid')}     minWidth={MINS.pid} />
                <ColHeader label="Type"       col="type"           {...sh} {...rz('type')}    minWidth={MINS.type} />
                <ColHeader label="Card"       col="card_name"      {...sh} {...rz('card')}    minWidth={MINS.card} />
                <ColHeader label="Source"     col="source"         {...sh} {...rz('source')}  minWidth={MINS.source} />
                <ColHeader label="Cards"      col="card_count"     {...sh} {...rz('cards')}   minWidth={MINS.cards} align="right" />
                <ColHeader label="Cost (USD)" col="total_cost_usd" {...sh} {...rz('cost')}    minWidth={MINS.cost} align="right" />
                <ColHeader label="Avg/Card"   col="avg_cost_usd"   {...sh} {...rz('avg')}     minWidth={MINS.avg} align="right" />
                <ColHeader label="Status"     col="status"         {...sh} {...rz('status')}  minWidth={MINS.status} />
                <ColHeader label="Purchased"  col="purchased_at"   {...sh} {...rz('bought')}  minWidth={MINS.bought} />
                <ColHeader label="Inspected" col="inspected_count" {...sh} {...rz('inspect')}   minWidth={MINS.inspect}   align="right" />
                <ColHeader label="For Sale"  col="sell_raw_count"  {...sh} {...rz('for_sale')}  minWidth={MINS.for_sale}  align="right" />
                <ColHeader label="For Grade" col="grade_count"     {...sh} {...rz('for_grade')} minWidth={MINS.for_grade} align="right" />
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {!data?.data.length ? (
                <tr>
                  <td colSpan={13} className="px-4 py-10 text-center text-zinc-500">
                    No purchases found.
                  </td>
                </tr>
              ) : data.data.map((row) => (
                <tr key={row.id}
                  className="hover:bg-zinc-800/25 cursor-pointer transition-colors group"
                  onClick={() => setDrillRow(row)}>
                  <td className="px-4 py-2">
                    <span className="font-mono text-indigo-300">{row.purchase_id}</span>
                  </td>
                  <td className="px-4 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium capitalize ${TYPE_COLORS[row.type]}`}>
                      {row.type}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <p className="text-zinc-200 truncate">{row.card_name ?? '—'}</p>
                    {row.set_name && (
                      <p className="text-[10px] text-zinc-500">
                        {row.set_name}{row.card_number ? ` · #${row.card_number}` : ''}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2 text-zinc-400">{row.source ?? '—'}</td>
                  <td className="px-4 py-2 text-right text-zinc-300">{row.card_count}</td>
                  <td className="px-4 py-2 text-right text-zinc-300">
                    {row.total_cost_usd ? formatCurrency(row.total_cost_usd, 'USD') : '—'}
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-400">
                    {row.avg_cost_usd ? formatCurrency(row.avg_cost_usd, 'USD') : '—'}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`capitalize font-medium ${STATUS_COLORS[row.status]}`}>{row.status}</span>
                  </td>
                  <td className="px-4 py-2 text-zinc-500">{formatDate(row.purchased_at)}</td>
                  <td className="px-4 py-2 text-right">
                    <span className={row.inspected_count > 0 ? 'text-emerald-400' : 'text-zinc-600'}>
                      {row.inspected_count}/{row.card_count}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <span className={row.sell_raw_count > 0 ? 'text-zinc-300' : 'text-zinc-700'}>
                      {row.sell_raw_count > 0 ? row.sell_raw_count : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <span className={row.grade_count > 0 ? 'text-indigo-300' : 'text-zinc-700'}>
                      {row.grade_count > 0 ? row.grade_count : '—'}
                    </span>
                  </td>
                  <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => setDeleteRow(row)}
                      title="Delete purchase"
                      className="p-1 rounded text-zinc-600 hover:text-red-400 hover:bg-zinc-800 transition-colors opacity-0 group-hover:opacity-100">
                      <Trash2 size={14} />
                    </button>
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
          <span>{data.total} purchase{data.total !== 1 ? 's' : ''}</span>
          <div className="flex items-center gap-2">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}
              className="px-2 py-1 rounded bg-zinc-800 disabled:opacity-30 hover:bg-zinc-700">Prev</button>
            <span>Page {page}</span>
            <button disabled={page >= (data.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}
              className="px-2 py-1 rounded bg-zinc-800 disabled:opacity-30 hover:bg-zinc-700">Next</button>
          </div>
        </div>
      )}
      {/* Delete confirmation */}
      <Modal open={!!deleteRow} onClose={() => setDeleteRow(null)} title="Delete Purchase">
        {deleteRow && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-300">
              Delete <span className="font-medium text-zinc-100">{deleteRow.purchase_id}</span>
              {deleteRow.card_name ? ` — ${deleteRow.card_name}` : ''}?
            </p>
            <p className="text-xs text-zinc-500">This will permanently remove the purchase record and cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDeleteRow(null)}>Keep</Button>
              <Button size="sm" className="bg-red-600 hover:bg-red-500" onClick={() => deleteMut.mutate(deleteRow.id)}>
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
