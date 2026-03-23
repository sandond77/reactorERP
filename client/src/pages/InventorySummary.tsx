import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { api } from '../lib/api';
import { formatCurrency } from '../lib/utils';
import { ColHeader, useColWidths } from '../components/ui/TableHeader';

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

type SortDir = 'asc' | 'desc';

type SortKey = 'sku' | 'card_name' | 'set_name' | 'language' | 'rarity' | 'company' | 'grade' | 'qty' | 'total_cost' | 'avg_cost' | 'qty_listed';

function getSortValue(row: SummaryRow, col: SortKey): string | number | null {
  switch (col) {
    case 'sku': return row.sku ?? '';
    case 'card_name': return row.card_name ?? '';
    case 'set_name': return row.set_name ?? '';
    case 'language': return row.language;
    case 'rarity': return row.rarity ?? '';
    case 'company': return row.company;
    case 'grade': return row.grade ?? 0;
    case 'qty': return row.qty;
    case 'total_cost': return row.total_cost;
    case 'avg_cost': return row.avg_cost;
    case 'qty_listed': return row.qty_listed;
    default: return '';
  }
}

// ── Add Set Alias Modal ───────────────────────────────────────────────────────

interface AddSetAliasModalProps {
  onClose: () => void;
}

function AddSetAliasModal({ onClose }: AddSetAliasModalProps) {
  const queryClient = useQueryClient();
  const [language, setLanguage] = useState<'EN' | 'JP'>('EN');
  const [alias, setAlias] = useState('');
  const [setCode, setSetCode] = useState('');
  const [setName, setSetName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/sets/aliases', {
        language,
        alias,
        set_code: setCode,
        set_name: setName || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['inventory-summary'] });
      onClose();
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { error?: string; message?: string } } }).response?.data?.error ??
            (err as { response?: { data?: { error?: string; message?: string } } }).response?.data?.message ??
            'Failed to save alias.'
          : 'Failed to save alias.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-zinc-100">Add Set Alias</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Language */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Language</label>
            <div className="flex gap-4">
              {(['EN', 'JP'] as const).map((l) => (
                <label key={l} className="flex items-center gap-1.5 cursor-pointer text-sm text-zinc-300">
                  <input
                    type="radio"
                    name="language"
                    value={l}
                    checked={language === l}
                    onChange={() => setLanguage(l)}
                    className="accent-indigo-500"
                  />
                  {l}
                </label>
              ))}
            </div>
          </div>

          {/* Alias */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">
              PSA Set Name Fragment <span className="text-zinc-600">(alias)</span>
            </label>
            <input
              type="text"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="e.g. vmax climax"
              required
              className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Set Code */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Internal Set Code</label>
            <input
              type="text"
              value={setCode}
              onChange={(e) => setSetCode(e.target.value)}
              placeholder="e.g. SWSH9"
              required
              className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Optional canonical name */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">
              Canonical Name <span className="text-zinc-600">(optional)</span>
            </label>
            <input
              type="text"
              value={setName}
              onChange={(e) => setSetName(e.target.value)}
              placeholder="e.g. Brilliant Stars"
              className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              {submitting ? 'Saving…' : 'Save Alias'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function InventorySummary() {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [fLanguage, setFLanguage] = useState<string[]>([]);
  const [fRarity, setFRarity] = useState<string[]>([]);
  const [fCompany, setFCompany] = useState<string[]>([]);
  const [showAliasModal, setShowAliasModal] = useState(false);
  const { rz, totalWidth } = useColWidths({ sku: 180, card: 480, set: 180, lang: 60, rarity: 110, grader: 80, grade: 130, qty: 60, total_cost: 110, avg_cost: 110, listed: 80 });

  const { data, isLoading } = useQuery<{ data: SummaryRow[] }>({
    queryKey: ['inventory-summary'],
    queryFn: () => api.get('/catalog/inventory-summary').then((r) => r.data),
  });

  const rows = data?.data ?? [];

  // Derive filter options from data
  const languageOptions = [...new Set(rows.map((r) => r.language))].sort();
  const rarityOptions = [...new Set(rows.map((r) => r.rarity).filter(Boolean) as string[])].sort();
  const companyOptions = [...new Set(rows.map((r) => r.company))].sort();

  // Filter by search + column filters
  const filtered = rows.filter((r) => {
    const matchSearch = !search ||
      r.sku?.toLowerCase().includes(search.toLowerCase()) ||
      r.card_name?.toLowerCase().includes(search.toLowerCase()) ||
      r.set_name?.toLowerCase().includes(search.toLowerCase());

    const matchLang = fLanguage.length === 0 || fLanguage.length === languageOptions.length || fLanguage.includes(r.language);
    const matchRarity = fRarity.length === 0 || fRarity.length === rarityOptions.length || fRarity.includes(r.rarity ?? '');
    const matchCompany = fCompany.length === 0 || fCompany.length === companyOptions.length || fCompany.includes(r.company);

    return matchSearch && matchLang && matchRarity && matchCompany;
  });

  // Client-side sort at SummaryRow level before grouping
  const sortedFiltered = sortCol
    ? [...filtered].sort((a, b) => {
        const av = getSortValue(a, sortCol as SortKey);
        const bv = getSortValue(b, sortCol as SortKey);
        if (av === bv) return 0;
        if (av == null || av === '') return 1;
        if (bv == null || bv === '') return -1;
        const cmp = av < bv ? -1 : 1;
        return sortDir === 'asc' ? cmp : -cmp;
      })
    : filtered;

  const groups = groupRows(sortedFiltered);
  // Preserve sort order from sortedFiltered by using insertion order
  const sortedKeys = sortCol
    ? [...groups.keys()]
    : [...groups.keys()].sort();

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

  const handleSort = (col: string) => {
    setSortCol((prev) => {
      if (prev === col) return prev;
      return col;
    });
    setSortDir((prev) => sortCol === col ? (prev === 'asc' ? 'desc' : 'asc') : 'asc');
  };

  const sh = { sortCol, sortDir, onSort: handleSort };

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
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAliasModal(true)}
            className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 hover:border-zinc-500 rounded-lg transition-colors"
          >
            + Add Set
          </button>
          <input
            type="text"
            placeholder="Search SKU, card, set…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 w-64"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">Loading…</div>
        ) : !sortedKeys.length ? (
          <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">No inventory found.</div>
        ) : (
          <table className="text-xs whitespace-nowrap border-collapse" style={{ tableLayout: 'fixed', width: totalWidth + 'px' }}>
            <thead className="sticky top-0 bg-zinc-950 z-10">
              <tr className="border-b border-zinc-700 text-zinc-300 uppercase tracking-wide">
                <ColHeader label="Part #"     col="sku"        {...sh} {...rz('sku')} />
                <ColHeader label="Card"       col="card_name"  {...sh} {...rz('card')} />
                <ColHeader label="Set"        col="set_name"   {...sh} {...rz('set')} />
                <ColHeader label="Lang"       col="language"   {...sh} {...rz('lang')}
                  filterOptions={languageOptions} filterSelected={fLanguage} onFilterChange={setFLanguage} />
                <ColHeader label="Rarity"     col="rarity"     {...sh} {...rz('rarity')}
                  filterOptions={rarityOptions} filterSelected={fRarity} onFilterChange={setFRarity} />
                <ColHeader label="Grader"     col="company"    {...sh} {...rz('grader')}
                  filterOptions={companyOptions} filterSelected={fCompany} onFilterChange={setFCompany} />
                <ColHeader label="Grade"      col="grade"      {...sh} {...rz('grade')} />
                <ColHeader label="Qty"        col="qty"        {...sh} {...rz('qty')} align="right" />
                <ColHeader label="Total Cost" col="total_cost" {...sh} {...rz('total_cost')} align="right" />
                <ColHeader label="Avg Cost"   col="avg_cost"   {...sh} {...rz('avg_cost')} align="right" />
                <ColHeader label="Listed"     col="qty_listed" {...sh} {...rz('listed')} align="right" />
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
                      <td className="px-3 py-1.5 text-zinc-200 truncate" title={displayName}>
                        {displayName}
                      </td>
                      <td className="px-3 py-1.5 text-zinc-400 truncate">{setName}</td>
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
                    <td className="px-3 py-1.5 text-zinc-200 font-medium truncate" title={displayName}>
                      {displayName}
                    </td>
                    <td className="px-3 py-1.5 text-zinc-400 truncate">{setName}</td>
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

      {/* Add Set Alias Modal */}
      {showAliasModal && <AddSetAliasModal onClose={() => setShowAliasModal(false)} />}
    </div>
  );
}
