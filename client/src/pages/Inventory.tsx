import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ExternalLink, X } from 'lucide-react';
import { api, type PaginatedResult } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { AddCardForm } from '../components/inventory/AddCardForm';
import { CardDetailModal } from '../components/inventory/CardDetailModal';
import { formatCurrency, formatDate } from '../lib/utils';
import { ColHeader, useColWidths } from '../components/ui/TableHeader';

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

interface FilterOptions {
  companies: string[];
  grades: string[];
  listed: string[];
  card_show: string[];
  purchase_years: string[];
  listed_years: string[];
  sold_years: string[];
}

type StatusFilter = 'all' | 'graded';
type SortDir = 'asc' | 'desc';

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

  const [sortCol, setSortCol] = useState<string | null>('cert_number');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const { rz, totalWidth } = useColWidths({ cert: 110, card: 680, grade: 130, listed: 80, listed_price: 100, listing: 60, raw: 80, grading_cost: 105, strike: 95, after_ebay: 90, net: 80, purch_date: 140, date_listed: 100, date_sold: 100, roi: 70, notes: 170, card_show: 95 });

  const [fCompany, setFCompany] = useState<string[]>([]);
  const [fGrade, setFGrade] = useState<string[]>([]);
  const [fListed, setFListed] = useState<string[]>([]);
  const [fCardShow, setFCardShow] = useState<string[]>([]);
  const [fPurchYear, setFPurchYear] = useState<string[]>([]);
  const [fListYear, setFListYear] = useState<string[]>([]);
  const [fSoldYear, setFSoldYear] = useState<string[]>([]);

  const handleSearchChange = useCallback((val: string) => {
    setSearch(val);
    clearTimeout((handleSearchChange as any)._t);
    (handleSearchChange as any)._t = setTimeout(() => {
      setDebouncedSearch(val);
      setPage(1);
    }, 300);
  }, []);

  const handleSort = useCallback((col: string) => {
    setSortCol((prev) => {
      if (prev === col) return prev;
      return col;
    });
    setSortDir((prev) => sortCol === col ? (prev === 'asc' ? 'desc' : 'asc') : 'desc');
    setPage(1);
  }, [sortCol]);

  const { data: filterOptions } = useQuery<FilterOptions>({
    queryKey: ['slab-filter-options'],
    queryFn: () => api.get('/grading/slabs/filters').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  function activeFilter(sel: string[], opts?: string[]) {
    return sel.length > 0 && sel.length < (opts?.length ?? 0) ? sel : [];
  }

  const params = {
    page, limit: 50,
    search: debouncedSearch || undefined,
    status: statusFilter,
    sort_by: sortCol ?? undefined,
    sort_dir: sortDir,
    companies:      activeFilter(fCompany,   filterOptions?.companies).join(',')     || undefined,
    grades:         activeFilter(fGrade,     filterOptions?.grades).join(',')        || undefined,
    is_listed:      activeFilter(fListed,    filterOptions?.listed)[0]?.toLowerCase() || undefined,
    is_card_show:   activeFilter(fCardShow,  filterOptions?.card_show)[0]?.toLowerCase() || undefined,
    purchase_years: activeFilter(fPurchYear, filterOptions?.purchase_years).join(',') || undefined,
    listed_years:   activeFilter(fListYear,  filterOptions?.listed_years).join(',')   || undefined,
    sold_years:     activeFilter(fSoldYear,  filterOptions?.sold_years).join(',')     || undefined,
  };

  const { data, isLoading } = useQuery<PaginatedResult<SlabRow>>({
    queryKey: ['inventory-slabs', params],
    queryFn: () =>
      api.get('/grading/slabs', { params }).then((r) => r.data),
  });

  const hasActiveFilters = [fCompany, fGrade, fListed, fCardShow, fPurchYear, fListYear, fSoldYear]
    .some((f) => f.length > 0);

  function clearAllFilters() {
    setFCompany([]); setFGrade([]); setFListed([]); setFCardShow([]);
    setFPurchYear([]); setFListYear([]); setFSoldYear([]);
    setPage(1);
  }

  const sh = { sortCol, sortDir, onSort: handleSort };

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
        {hasActiveFilters && (
          <button onClick={clearAllFilters} className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
            <X size={12} /> Clear all filters
          </button>
        )}
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
          <table className="text-xs whitespace-nowrap border-collapse" style={{ tableLayout: 'fixed', width: totalWidth + 'px' }}>
            <thead className="sticky top-0 bg-zinc-950 z-10">
              <tr className="border-b border-zinc-700 text-zinc-300 uppercase tracking-wide">
                <ColHeader label="Cert"              col="cert_number"       {...sh} {...rz('cert')} />
                <ColHeader label="Card"              col="card_name"         {...sh} {...rz('card')} />
                <ColHeader label="Grade"             col="grade"             {...sh} {...rz('grade')}
                  filterOptions={filterOptions?.grades}    filterSelected={fGrade}    onFilterChange={(v) => { setFGrade(v); setPage(1); }} />
                <ColHeader label="Listed?"           col="is_listed"         {...sh} {...rz('listed')} align="center"
                  filterOptions={filterOptions?.listed}    filterSelected={fListed}   onFilterChange={(v) => { setFListed(v); setPage(1); }} />
                <ColHeader label="Listed Price"      col="listed_price"      {...sh} {...rz('listed_price')} align="right" />
                <ColHeader label="Listing"                                   {...sh} {...rz('listing')} align="center" />
                <ColHeader label="Raw"               col="raw_cost"          {...sh} {...rz('raw')} align="right" />
                <ColHeader label="Grading Cost"      col="grading_cost"      {...sh} {...rz('grading_cost')} align="right" />
                <ColHeader label="Strike Price"      col="strike_price"      {...sh} {...rz('strike')} align="right" />
                <ColHeader label="After Ebay"        col="after_ebay"        {...sh} {...rz('after_ebay')} align="right" />
                <ColHeader label="Net"               col="net"               {...sh} {...rz('net')} align="right" />
                <ColHeader label="Raw Purchase Date" col="raw_purchase_date" {...sh} {...rz('purch_date')}
                  filterOptions={filterOptions?.purchase_years} filterSelected={fPurchYear} onFilterChange={(v) => { setFPurchYear(v); setPage(1); }} />
                <ColHeader label="Date Listed"       col="date_listed"       {...sh} {...rz('date_listed')}
                  filterOptions={filterOptions?.listed_years}   filterSelected={fListYear}  onFilterChange={(v) => { setFListYear(v); setPage(1); }} />
                <ColHeader label="Date Sold"         col="date_sold"         {...sh} {...rz('date_sold')}
                  filterOptions={filterOptions?.sold_years}     filterSelected={fSoldYear}  onFilterChange={(v) => { setFSoldYear(v); setPage(1); }} />
                <ColHeader label="% ROI"             col="roi_pct"           {...sh} {...rz('roi')} align="right" />
                <ColHeader label="Notes"                                     {...sh} {...rz('notes')} />
                <ColHeader label="Card Show?"                                {...sh} {...rz('card_show')} align="center"
                  filterOptions={filterOptions?.card_show} filterSelected={fCardShow} onFilterChange={(v) => { setFCardShow(v); setPage(1); }} />
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
                  <td className="px-3 py-1.5 text-zinc-200 truncate" title={row.card_name ?? ''}>
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
                  <td className="px-3 py-1.5 text-zinc-500 truncate" title={row.notes ?? ''}>
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

      {/* Modals */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Card">
        <AddCardForm onSuccess={() => { setAddOpen(false); qc.invalidateQueries({ queryKey: ['inventory-slabs'] }); }} />
      </Modal>

      {selectedId && (
        <CardDetailModal
          cardId={selectedId}
          onClose={() => setSelectedId(null)}
          onDelete={(_id) => { qc.invalidateQueries({ queryKey: ['inventory-slabs'] }); setSelectedId(null); }}
        />
      )}
    </div>
  );
}
