import { useState, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { api, type PaginatedResult } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { AddCardForm } from '../components/inventory/AddCardForm';
import { CardDetailModal } from '../components/inventory/CardDetailModal';
import { formatCurrency, formatDate } from '../lib/utils';
import { loadFilters, saveFilters } from '../lib/filter-store';
import { ColHeader, useColWidths, colMinWidth } from '../components/ui/TableHeader';

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

interface RawFilterOptions {
  games: string[];
  languages: string[];
  conditions: string[];
}

type SortDir = 'asc' | 'desc';

const STATUS_LABELS: Record<string, string> = {
  purchased_raw: 'Purchased',
  inspected: 'Inspected',
};

const RAW_FILTER_DEFAULTS = {
  sortCol: null as string | null,
  sortDir: 'asc' as SortDir,
  fGame: null as string[] | null,
  fLanguage: null as string[] | null,
  fCondition: null as string[] | null,
  search: '',
};

export function RawInventory() {
  const qc = useQueryClient();
  const saved = loadFilters('raw-inventory', RAW_FILTER_DEFAULTS);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(saved.search);
  const [debouncedSearch, setDebouncedSearch] = useState(saved.search);
  const [sortCol, setSortCol] = useState<string | null>(saved.sortCol);
  const [sortDir, setSortDir] = useState<SortDir>(saved.sortDir);
  const [fGame, setFGame] = useState<string[] | null>(saved.fGame);
  const [fLanguage, setFLanguage] = useState<string[] | null>(saved.fLanguage);
  const [fCondition, setFCondition] = useState<string[] | null>(saved.fCondition);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const MINS = {
    card:      colMinWidth('Card',      true,  false),
    game:      colMinWidth('Game',      true,  true),
    lang:      colMinWidth('Lang',      true,  true),
    condition: colMinWidth('Condition', true,  true),
    cost:      colMinWidth('Cost',      true,  false),
    purchased: colMinWidth('Purchased', true,  false),
    status:    colMinWidth('Status',    true,  false),
    notes:     colMinWidth('Notes',     false, false),
  };
  const { rz, totalWidth } = useColWidths({ card: Math.max(MINS.card, 500), game: Math.max(MINS.game, 90), lang: Math.max(MINS.lang, 70), condition: Math.max(MINS.condition, 100), cost: Math.max(MINS.cost, 110), purchased: Math.max(MINS.purchased, 140), status: Math.max(MINS.status, 110), notes: Math.max(MINS.notes, 200) });

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    saveFilters('raw-inventory', { sortCol, sortDir, fGame, fLanguage, fCondition, search });
  }, [sortCol, sortDir, fGame, fLanguage, fCondition, search]);

  const handleSort = useCallback((col: string) => {
    setSortCol((prev) => {
      if (prev === col) return prev;
      return col;
    });
    setSortDir((prev) => sortCol === col ? (prev === 'asc' ? 'desc' : 'asc') : 'asc');
    setPage(1);
  }, [sortCol]);

  const { data: filterOptions } = useQuery<RawFilterOptions>({
    queryKey: ['raw-inventory-filters'],
    queryFn: () => api.get('/cards/filters').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  function activeFilter(sel: string[] | null, opts?: string[]): string[] | undefined {
    if (sel === null) return undefined;
    if (sel.length >= (opts?.length ?? Infinity)) return undefined;
    return sel;
  }

  const params = {
    page,
    limit: 50,
    status: 'purchased_raw,inspected',
    search: debouncedSearch || undefined,
    card_game: activeFilter(fGame, filterOptions?.games)?.join(','),
    language: activeFilter(fLanguage, filterOptions?.languages)?.join(','),
    condition: activeFilter(fCondition, filterOptions?.conditions)?.join(','),
  };

  const { data, isLoading } = useQuery<PaginatedResult<RawCardRow>>({
    queryKey: ['raw-inventory', params],
    queryFn: () => api.get('/cards', { params }).then((r) => r.data),
  });

  const hasActiveFilters = [fGame, fLanguage, fCondition].some((f) => f !== null && f.length > 0) || !!debouncedSearch;

  function clearAllFilters() {
    setFGame(null); setFLanguage(null); setFCondition(null); setSearch('');
    setPage(1);
  }

  const sh = { sortCol, sortDir, onSort: handleSort };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-100">Raw Inventory</h1>
        <div className="flex items-center gap-3">
          {hasActiveFilters && (
            <button onClick={clearAllFilters}
              className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
              <X size={12} /> Clear filters
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
                <ColHeader label="Card"      col="card_name"     {...sh} {...rz('card')} minWidth={MINS.card} />
                <ColHeader label="Game"      col="card_game"     {...sh} {...rz('game')} minWidth={MINS.game}
                  filterOptions={filterOptions?.games} filterSelected={fGame} onFilterChange={(v) => { setFGame(v); setPage(1); }} />
                <ColHeader label="Lang"      col="language"      {...sh} {...rz('lang')} minWidth={MINS.lang}
                  filterOptions={filterOptions?.languages} filterSelected={fLanguage} onFilterChange={(v) => { setFLanguage(v); setPage(1); }} />
                <ColHeader label="Condition" col="condition"     {...sh} {...rz('condition')} minWidth={MINS.condition}
                  filterOptions={filterOptions?.conditions} filterSelected={fCondition} onFilterChange={(v) => { setFCondition(v); setPage(1); }} />
                <ColHeader label="Cost"      col="purchase_cost" {...sh} {...rz('cost')} align="right" minWidth={MINS.cost} />
                <ColHeader label="Purchased" col="purchased_at"  {...sh} {...rz('purchased')} minWidth={MINS.purchased} />
                <ColHeader label="Status"    col="status"        {...sh} {...rz('status')} minWidth={MINS.status} />
                <ColHeader label="Notes"                         {...sh} {...rz('notes')} minWidth={MINS.notes} />
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
