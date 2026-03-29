import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { AddCardForm } from '../components/inventory/AddCardForm';
import { CardDetailModal } from '../components/inventory/CardDetailModal';
import { formatCurrency } from '../lib/utils';
import { ColHeader, useColWidths, colMinWidth } from '../components/ui/TableHeader';
import type { CardInstance, CardGroup } from '../lib/card-inventory';
import { instForSale, instToGrade, instGrading, instSold, groupKey, num } from '../lib/card-inventory';

type SortDir = 'asc' | 'desc';

export function RawInventory() {
  const qc = useQueryClient();
  const [search, setSearch]                   = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [expandedKeys, setExpandedKeys]       = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen]                 = useState(false);
  const [selectedId, setSelectedId]           = useState<string | null>(null);
  const [sortCol, setSortCol]                 = useState<string | null>(null);
  const [sortDir, setSortDir]                 = useState<SortDir>('asc');
  const [fSet, setFSet]                       = useState<string[] | null>(null);

  const MINS = {
    part:      colMinWidth('Part #',    true, false),
    card:      colMinWidth('Card Name', true, false),
    set:       colMinWidth('Set',       true, true),
    cardnum:   colMinWidth('Card #',    true, false),
    total:     colMinWidth('Total',     true, false),
    for_sale:  colMinWidth('For Sale',  true, false),
    sold:      colMinWidth('Sold',      true, false),
    to_grade:  colMinWidth('To Grade',  true, false),
    submitted: colMinWidth('Submitted', true, false),
    returned:  colMinWidth('Returned',  true, false),
    notes:     colMinWidth('Notes',     false, false),
  };

  const { rz, totalWidth } = useColWidths({
    part:      Math.max(MINS.part,      190),
    card:      Math.max(MINS.card,      220),
    set:       Math.max(MINS.set,       150),
    cardnum:   Math.max(MINS.cardnum,    70),
    total:     Math.max(MINS.total,      60),
    for_sale:  Math.max(MINS.for_sale,   70),
    sold:      Math.max(MINS.sold,       60),
    to_grade:  Math.max(MINS.to_grade,   70),
    submitted: Math.max(MINS.submitted,  80),
    returned:  Math.max(MINS.returned,   80),
    notes:     Math.max(MINS.notes,     160),
  });

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: rawData, isLoading } = useQuery<CardGroup[]>({
    queryKey: ['raw-inventory-grouped', debouncedSearch],
    queryFn: () => api.get('/cards/by-part', {
      params: debouncedSearch ? { search: debouncedSearch } : undefined,
    }).then((r) => r.data),
  });

  const setOptions = useMemo(
    () => [...new Set((rawData ?? []).map((g) => g.set_name).filter(Boolean) as string[])].sort(),
    [rawData]
  );

  const data = useMemo(() => {
    let rows = rawData ?? [];

    // Filter
    if (fSet && fSet.length > 0 && fSet.length < setOptions.length) {
      rows = rows.filter((g) => g.set_name && fSet.includes(g.set_name));
    }

    // Sort
    if (sortCol) {
      rows = [...rows].sort((a, b) => {
        let av: string | number = 0;
        let bv: string | number = 0;
        if (sortCol === 'sku')            { av = a.sku ?? ''; bv = b.sku ?? ''; }
        else if (sortCol === 'card_name') { av = a.card_name; bv = b.card_name; }
        else if (sortCol === 'set_name')  { av = a.set_name ?? ''; bv = b.set_name ?? ''; }
        else if (sortCol === 'card_number') { av = a.card_number ?? ''; bv = b.card_number ?? ''; }
        else if (sortCol === 'total')     { av = a.total; bv = b.total; }
        else if (sortCol === 'for_sale')  { av = a.for_sale_count;  bv = b.for_sale_count; }
        else if (sortCol === 'sold')      { av = a.sold_count;       bv = b.sold_count; }
        else if (sortCol === 'to_grade')  { av = a.to_grade_count;  bv = b.to_grade_count; }
        else if (sortCol === 'submitted') { av = a.grading_count;   bv = b.grading_count; }
        else if (sortCol === 'returned')  { av = a.returned_count;  bv = b.returned_count; }
        const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }

    return rows;
  }, [rawData, fSet, setOptions, sortCol, sortDir]);

  const handleSort = useCallback((col: string) => {
    setSortDir((prev) => sortCol === col ? (prev === 'asc' ? 'desc' : 'asc') : 'asc');
    setSortCol(col);
  }, [sortCol]);

  function toggleExpand(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  const hasActiveFilters = (fSet !== null && fSet.length > 0) || !!debouncedSearch;
  const invalidate = () => qc.invalidateQueries({ queryKey: ['raw-inventory-grouped'] });
  const sh = { sortCol, sortDir, onSort: handleSort };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-100">Raw Inventory</h1>
        <div className="flex items-center gap-3">
          {hasActiveFilters && (
            <button onClick={() => { setSearch(''); setFSet(null); }}
              className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
              <X size={12} /> Clear filters
            </button>
          )}
          <input
            type="text"
            placeholder="Search card…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56 px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
          />
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus size={14} /> Add Card
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">Loading…</div>
        ) : !data?.length ? (
          <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">No raw cards found.</div>
        ) : (
          <table className="text-xs border-collapse" style={{ tableLayout: 'fixed', width: totalWidth + 32 + 'px' }}>
            <thead className="sticky top-0 bg-zinc-950 z-10">
              <tr className="border-b border-zinc-700 text-zinc-300 uppercase tracking-wide">
                <th style={{ width: 32 }} />
                <ColHeader label="Part #"    col="sku"         {...sh} {...rz('part')}      minWidth={MINS.part} />
                <ColHeader label="Card Name" col="card_name"   {...sh} {...rz('card')}      minWidth={MINS.card} />
                <ColHeader label="Set"       col="set_name"    {...sh} {...rz('set')}       minWidth={MINS.set}
                  filterOptions={setOptions} filterSelected={fSet} onFilterChange={(v) => setFSet(v)} />
                <ColHeader label="Card #"    col="card_number" {...sh} {...rz('cardnum')}   minWidth={MINS.cardnum} />
                <ColHeader label="Total"     col="total"       {...sh} {...rz('total')}     minWidth={MINS.total}     align="right" />
                <ColHeader label="For Sale"  col="for_sale"    {...sh} {...rz('for_sale')}  minWidth={MINS.for_sale}  align="right" />
                <ColHeader label="Sold"      col="sold"        {...sh} {...rz('sold')}      minWidth={MINS.sold}      align="right" />
                <ColHeader label="To Grade"  col="to_grade"    {...sh} {...rz('to_grade')}  minWidth={MINS.to_grade}  align="right" />
                <ColHeader label="Submitted" col="submitted"   {...sh} {...rz('submitted')} minWidth={MINS.submitted} align="right" />
                <ColHeader label="Returned"  col="returned"    {...sh} {...rz('returned')}  minWidth={MINS.returned}  align="right" />
                <ColHeader label="Notes"     col="notes"       {...sh} {...rz('notes')}     minWidth={MINS.notes} />
              </tr>
            </thead>
            <tbody>
              {data.map((group) => {
                const key = groupKey(group);
                const expanded = expandedKeys.has(key);
                return (
                  <React.Fragment key={key}>
                    <tr className="border-b border-zinc-800 hover:bg-zinc-800/30 cursor-pointer transition-colors"
                      onClick={() => toggleExpand(key)}>
                      <td className="pl-3 text-zinc-500">
                        <ChevronRight size={12} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
                      </td>
                      <td className="px-3 py-2 font-mono text-zinc-400 text-[11px]">{group.sku ?? '—'}</td>
                      <td className="px-3 py-2 text-zinc-100 font-medium truncate">{group.card_name}</td>
                      <td className="px-3 py-2 text-zinc-400 text-[11px] truncate">{group.set_name ?? '—'}</td>
                      <td className="px-3 py-2 text-zinc-400 text-[11px]">{group.card_number ? `#${group.card_number}` : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-200 font-medium">{group.total}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(group.for_sale_count)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(group.sold_count)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(group.to_grade_count)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(group.grading_count)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(group.returned_count)}</td>
                      <td />
                    </tr>

                    {expanded && group.instances.map((inst) => (
                      <tr key={inst.id}
                        className="border-b border-zinc-800/40 bg-zinc-900/40 hover:bg-zinc-800/50 cursor-pointer transition-colors"
                        onClick={() => setSelectedId(inst.id)}>
                        <td className="pl-3">
                          <div className="w-px h-3 bg-zinc-700 mx-auto" />
                        </td>
                        <td className="px-3 py-1.5">
                          <span className="text-[10px] text-zinc-600 mr-1">ID</span>
                          <span className="font-mono text-[11px] text-indigo-300/70">{inst.raw_purchase_label ?? '—'}</span>
                        </td>
                        <td className="px-3 py-1.5 pl-5">
                          <span className="text-[10px] text-zinc-600 mr-1">Cond</span>
                          <span className="text-zinc-400 text-[11px]">{inst.condition ?? '—'}</span>
                          {inst.location_name && (
                            <span className="ml-3 text-[10px] text-zinc-600 mr-1">Loc</span>
                          )}
                          {inst.location_name && (
                            <span className="text-zinc-400 text-[11px]">{inst.location_name}</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          <span className="text-[10px] text-zinc-600 mr-1">Avg</span>
                          <span className="text-zinc-500 text-[11px]">{formatCurrency(inst.purchase_cost, inst.currency)}</span>
                        </td>
                        <td className="px-3 py-1.5" />
                        <td className="px-3 py-1.5 text-right tabular-nums text-zinc-400">{inst.quantity}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{num(instForSale(inst))}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{num(instSold(inst))}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{num(instToGrade(inst))}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{num(instGrading(inst))}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{num(inst.status === 'graded' ? inst.quantity : 0)}</td>
                        <td className="px-3 py-1.5 text-zinc-500 text-[10px]">{inst.notes ?? ''}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Card">
        <AddCardForm onSuccess={() => { setAddOpen(false); invalidate(); }} />
      </Modal>

      {selectedId && (
        <CardDetailModal
          cardId={selectedId}
          onClose={() => setSelectedId(null)}
          onDelete={() => { setSelectedId(null); invalidate(); }}
        />
      )}
    </div>
  );
}
