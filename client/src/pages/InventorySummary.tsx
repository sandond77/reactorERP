import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { formatCurrency } from '../lib/utils';

interface SummaryRow {
  sku: string | null;
  card_name: string | null;
  set_name: string | null;
  set_code: string | null;
  card_number: string | null;
  rarity: string | null;
  language: string;
  company: string;
  grade: number | null;
  grade_label: string | null;
  qty: number;
  total_cost: number;
  avg_cost: number;
  qty_listed: number;
  qty_sold: number;
  catalog_id: string | null;
}

// Group rows by SKU (or card_name if no SKU)
function groupRows(rows: SummaryRow[]) {
  const groups: Map<string, SummaryRow[]> = new Map();
  for (const row of rows) {
    const key = row.sku ?? `__nosku__${row.card_name ?? ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return groups;
}

function totalQty(rows: SummaryRow[]) {
  return rows.reduce((s, r) => s + r.qty, 0);
}
function totalCost(rows: SummaryRow[]) {
  return rows.reduce((s, r) => s + r.total_cost, 0);
}

export function InventorySummary() {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery<{ data: SummaryRow[] }>({
    queryKey: ['inventory-summary'],
    queryFn: () => api.get('/catalog/inventory-summary').then((r) => r.data),
  });

  const rows = data?.data ?? [];

  // Filter by search
  const filtered = search
    ? rows.filter(
        (r) =>
          r.sku?.toLowerCase().includes(search.toLowerCase()) ||
          r.card_name?.toLowerCase().includes(search.toLowerCase()) ||
          r.set_name?.toLowerCase().includes(search.toLowerCase())
      )
    : rows;

  const groups = groupRows(filtered);
  const sortedKeys = [...groups.keys()].sort();

  const toggleGroup = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const totalCards = rows.reduce((s, r) => s + r.qty, 0);
  const matchedCards = rows.filter((r) => r.catalog_id).reduce((s, r) => s + r.qty, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Inventory Summary</h1>
          {!isLoading && (
            <p className="text-xs text-zinc-500 mt-0.5">
              {totalCards.toLocaleString()} cards in {sortedKeys.length.toLocaleString()} unique parts
              {matchedCards < totalCards && (
                <span className="ml-2 text-amber-500">
                  · {(totalCards - matchedCards).toLocaleString()} unlinked (run match-catalog)
                </span>
              )}
            </p>
          )}
        </div>
        <input
          type="text"
          placeholder="Search SKU, card, set…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 w-64"
        />
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">Loading…</div>
        ) : !sortedKeys.length ? (
          <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">No inventory found.</div>
        ) : (
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="sticky top-0 bg-zinc-950 z-10">
              <tr className="border-b border-zinc-800 text-left text-zinc-500 uppercase tracking-wide">
                <th className="px-3 py-2 font-medium min-w-[180px]">Part #</th>
                <th className="px-3 py-2 font-medium min-w-[220px]">Card</th>
                <th className="px-3 py-2 font-medium">Set</th>
                <th className="px-3 py-2 font-medium">Lang</th>
                <th className="px-3 py-2 font-medium">Rarity</th>
                <th className="px-3 py-2 font-medium">Grader</th>
                <th className="px-3 py-2 font-medium">Grade</th>
                <th className="px-3 py-2 font-medium text-right">Qty</th>
                <th className="px-3 py-2 font-medium text-right">Total Cost</th>
                <th className="px-3 py-2 font-medium text-right">Avg Cost</th>
                <th className="px-3 py-2 font-medium text-right">Listed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {sortedKeys.map((key) => {
                const groupRows = groups.get(key)!;
                const isNoSku = key.startsWith('__nosku__');
                const sku = isNoSku ? null : key;
                const displayName = groupRows[0].card_name ?? '—';
                const setName = groupRows[0].set_name ?? groupRows[0].set_code ?? '—';
                const lang = groupRows[0].language;
                const rarity = groupRows[0].rarity ?? '—';
                const isExpanded = expanded.has(key);
                const qty = totalQty(groupRows);
                const cost = totalCost(groupRows);

                // Single grade line — no expansion needed
                if (groupRows.length === 1) {
                  const r = groupRows[0];
                  return (
                    <tr key={key} className="hover:bg-zinc-800/25">
                      <td className="px-3 py-1.5 font-mono text-indigo-400 text-[11px]">
                        {sku ?? <span className="text-zinc-600 italic">unlinked</span>}
                      </td>
                      <td className="px-3 py-1.5 text-zinc-200 max-w-[260px] truncate" title={displayName}>
                        {displayName}
                      </td>
                      <td className="px-3 py-1.5 text-zinc-400 max-w-[160px] truncate">{setName}</td>
                      <td className="px-3 py-1.5 text-zinc-500">{lang}</td>
                      <td className="px-3 py-1.5 text-zinc-500">{rarity}</td>
                      <td className="px-3 py-1.5 text-zinc-400">{r.company}</td>
                      <td className="px-3 py-1.5 text-zinc-300 font-medium">{r.grade_label ?? (r.grade != null ? String(r.grade) : '—')}</td>
                      <td className="px-3 py-1.5 text-right text-zinc-300">{r.qty}</td>
                      <td className="px-3 py-1.5 text-right text-zinc-400">{formatCurrency(r.total_cost)}</td>
                      <td className="px-3 py-1.5 text-right text-zinc-500">{formatCurrency(r.avg_cost)}</td>
                      <td className="px-3 py-1.5 text-right text-zinc-500">{r.qty_listed > 0 ? <span className="text-green-400">{r.qty_listed}</span> : '—'}</td>
                    </tr>
                  );
                }

                // Multiple grade lines — collapsible
                return [
                  // Summary row
                  <tr
                    key={`${key}-summary`}
                    className="hover:bg-zinc-800/40 cursor-pointer bg-zinc-900/30"
                    onClick={() => toggleGroup(key)}
                  >
                    <td className="px-3 py-1.5 font-mono text-indigo-400 text-[11px]">
                      <span className="inline-flex items-center gap-1">
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        {sku ?? <span className="text-zinc-600 italic">unlinked</span>}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-zinc-200 font-medium max-w-[260px] truncate" title={displayName}>
                      {displayName}
                    </td>
                    <td className="px-3 py-1.5 text-zinc-400 max-w-[160px] truncate">{setName}</td>
                    <td className="px-3 py-1.5 text-zinc-500">{lang}</td>
                    <td className="px-3 py-1.5 text-zinc-500">{rarity}</td>
                    <td className="px-3 py-1.5 text-zinc-600">{groupRows.map((r) => r.company).filter((v, i, a) => a.indexOf(v) === i).join(', ')}</td>
                    <td className="px-3 py-1.5 text-zinc-600">{groupRows.length} grades</td>
                    <td className="px-3 py-1.5 text-right text-zinc-200 font-semibold">{qty}</td>
                    <td className="px-3 py-1.5 text-right text-zinc-300 font-medium">{formatCurrency(cost)}</td>
                    <td className="px-3 py-1.5 text-right text-zinc-500">{formatCurrency(Math.round(cost / qty))}</td>
                    <td className="px-3 py-1.5 text-right text-zinc-500">
                      {groupRows.reduce((s, r) => s + r.qty_listed, 0) > 0
                        ? <span className="text-green-400">{groupRows.reduce((s, r) => s + r.qty_listed, 0)}</span>
                        : '—'}
                    </td>
                  </tr>,
                  // Expanded grade rows
                  ...(isExpanded
                    ? groupRows.map((r, idx) => (
                        <tr key={`${key}-grade-${idx}`} className="hover:bg-zinc-800/15">
                          <td className="px-3 py-1 pl-8 text-zinc-700 font-mono text-[10px]">↳</td>
                          <td className="px-3 py-1 text-zinc-400">{r.card_name ?? '—'}</td>
                          <td className="px-3 py-1 text-zinc-600">{setName}</td>
                          <td className="px-3 py-1 text-zinc-600">{r.language}</td>
                          <td className="px-3 py-1 text-zinc-600">{r.rarity ?? '—'}</td>
                          <td className="px-3 py-1 text-zinc-400">{r.company}</td>
                          <td className="px-3 py-1 text-zinc-300">{r.grade_label ?? (r.grade != null ? String(r.grade) : '—')}</td>
                          <td className="px-3 py-1 text-right text-zinc-400">{r.qty}</td>
                          <td className="px-3 py-1 text-right text-zinc-500">{formatCurrency(r.total_cost)}</td>
                          <td className="px-3 py-1 text-right text-zinc-600">{formatCurrency(r.avg_cost)}</td>
                          <td className="px-3 py-1 text-right">{r.qty_listed > 0 ? <span className="text-green-400">{r.qty_listed}</span> : '—'}</td>
                        </tr>
                      ))
                    : []),
                ];
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
