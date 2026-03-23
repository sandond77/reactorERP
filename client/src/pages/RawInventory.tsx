import { useState, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { api, type PaginatedResult } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { AddCardForm } from '../components/inventory/AddCardForm';
import { CardDetailModal } from '../components/inventory/CardDetailModal';
import { formatCurrency, formatDate } from '../lib/utils';
import { ColHeader, useColWidths } from '../components/ui/TableHeader';

interface RawCardRow {
  id: string;
  card_name: string | null;
  set_name: string | null;
  card_number: string | null;
  card_game: string;
  language: string;
  condition: string | null;
  purchase_cost: number;
  currency: string;
  purchased_at: string | null;
  notes: string | null;
  status: string;
}

type SortDir = 'asc' | 'desc';
type SortKey = 'card_name' | 'card_game' | 'language' | 'condition' | 'purchase_cost' | 'purchased_at';

const STATUS_LABELS: Record<string, string> = {
  purchased_raw: 'Purchased',
  inspected: 'Inspected',
};

export function RawInventory() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [addOpen, setAddOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { rz, totalWidth } = useColWidths({ card: 500, game: 90, lang: 70, condition: 100, cost: 110, purchased: 140, status: 110, notes: 200 });

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const handleSort = useCallback((col: string) => {
    setSortCol((prev) => {
      if (prev === col) return prev;
      return col;
    });
    setSortDir((prev) => sortCol === col ? (prev === 'asc' ? 'desc' : 'asc') : 'asc');
    setPage(1);
  }, [sortCol]);

  const params = {
    page,
    limit: 50,
    status: 'purchased_raw,inspected',
    search: debouncedSearch || undefined,
  };

  const { data, isLoading } = useQuery<PaginatedResult<RawCardRow>>({
    queryKey: ['raw-inventory', params],
    queryFn: () => api.get('/cards', { params }).then((r) => r.data),
  });

  const sh = { sortCol, sortDir, onSort: handleSort };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-100">Raw Inventory</h1>
        <div className="flex items-center gap-3">
          {!!debouncedSearch && (
            <button onClick={() => setSearch('')}
              className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
              <X size={12} /> Clear
            </button>
          )}
          <input
            type="text"
            placeholder="Search card…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
          />
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus size={14} /> Add Card
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">Loading…</div>
        ) : (
          <table className="text-xs whitespace-nowrap border-collapse" style={{ tableLayout: 'fixed', width: totalWidth + 'px' }}>
            <thead className="sticky top-0 bg-zinc-950 z-10">
              <tr className="border-b border-zinc-700 text-zinc-300 uppercase tracking-wide">
                <ColHeader label="Card"       col="card_name"     {...sh} {...rz('card')} />
                <ColHeader label="Game"       col="card_game"     {...sh} {...rz('game')} />
                <ColHeader label="Lang"       col="language"      {...sh} {...rz('lang')} />
                <ColHeader label="Condition"  col="condition"     {...sh} {...rz('condition')} />
                <ColHeader label="Cost"       col="purchase_cost" {...sh} {...rz('cost')} align="right" />
                <ColHeader label="Purchased"  col="purchased_at"  {...sh} {...rz('purchased')} />
                <ColHeader label="Status"     col="status"        {...sh} {...rz('status')} />
                <ColHeader label="Notes"                          {...sh} {...rz('notes')} />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {!data?.data.length ? (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-zinc-500">No raw cards found.</td></tr>
              ) : data.data.map((row) => (
                <tr key={row.id} onClick={() => setSelectedId(row.id)}
                  className="hover:bg-zinc-800/25 cursor-pointer transition-colors">
                  <td className="px-3 py-1.5">
                    <p className="text-zinc-200 truncate" title={row.card_name ?? ''}>{row.card_name ?? '—'}</p>
                    {row.set_name && (
                      <p className="text-[10px] text-zinc-500">{row.set_name}{row.card_number ? ` · #${row.card_number}` : ''}</p>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-zinc-400 capitalize">{row.card_game}</td>
                  <td className="px-3 py-1.5 text-zinc-400">{row.language}</td>
                  <td className="px-3 py-1.5 text-zinc-400">{row.condition ?? '—'}</td>
                  <td className="px-3 py-1.5 text-right text-zinc-300">{formatCurrency(row.purchase_cost, row.currency)}</td>
                  <td className="px-3 py-1.5 text-zinc-500">{formatDate(row.purchased_at)}</td>
                  <td className="px-3 py-1.5 text-zinc-400">{STATUS_LABELS[row.status] ?? row.status}</td>
                  <td className="px-3 py-1.5 text-zinc-500 truncate" title={row.notes ?? ''}>{row.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data && (
        <div className="flex items-center justify-between px-6 py-3 pr-44 border-t border-zinc-800 text-xs text-zinc-500">
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

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Card">
        <AddCardForm onSuccess={() => { setAddOpen(false); qc.invalidateQueries({ queryKey: ['raw-inventory'] }); }} />
      </Modal>

      {selectedId && (
        <CardDetailModal
          cardId={selectedId}
          onClose={() => setSelectedId(null)}
          onDelete={() => { setSelectedId(null); qc.invalidateQueries({ queryKey: ['raw-inventory'] }); }}
        />
      )}
    </div>
  );
}
