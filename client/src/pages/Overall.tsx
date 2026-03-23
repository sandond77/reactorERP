import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, X } from 'lucide-react';
import { api, type PaginatedResult } from '../lib/api';
import { Button } from '../components/ui/Button';
import { formatCurrency } from '../lib/utils';
import { SlabDetailModal } from '../components/inventory/SlabDetailModal';
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

type SortDir = 'asc' | 'desc';
type StatusFilter = 'all' | 'graded' | 'sold';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function certLink(company: string, cert: string): string | null {
  switch (company) {
    case 'PSA': return `https://www.psacard.com/cert/${cert}`;
    case 'CGC': return `https://www.cgccards.com/certlookup/${cert}`;
    case 'SGC': return `https://sgccard.com/cert/${cert}`;
    default:    return null;
  }
}

function fmt(cents: number | null) { return cents == null ? '' : formatCurrency(cents); }

function fmtDate(d?: string | null) {
  if (!d) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }).format(new Date(d));
}

function NetCell({ afterEbay, raw, grading }: { afterEbay: number | null; raw: number; grading: number }) {
  if (afterEbay == null) return <span className="text-red-400">-{formatCurrency(raw + grading)}</span>;
  const net = afterEbay - raw - grading;
  return <span className={net >= 0 ? 'text-green-400' : 'text-red-400'}>{formatCurrency(net)}</span>;
}

function RoiCell({ roi, afterEbay, raw, grading }: { roi: number | null; afterEbay: number | null; raw: number; grading: number }) {
  let pct = roi != null ? Number(roi) : null;
  if (pct == null && afterEbay != null) {
    const cost = raw + grading;
    pct = cost > 0 ? ((afterEbay - cost) / cost) * 100 : null;
  }
  if (pct == null) return <></>;
  return <span className={pct >= 0 ? 'text-green-400' : 'text-red-400'}>{pct.toFixed(2)}%</span>;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function Overall() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortCol, setSortCol] = useState<string | null>('cert_number');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const { rz, totalWidth } = useColWidths({ cert_number: 120, card_name: 720, grade: 130, company: 90, is_listed: 80, listed_price: 110, listing: 65, raw_cost: 85, grading_cost: 110, strike_price: 105, after_ebay: 100, net: 85, raw_purchase_date: 150, date_listed: 110, date_sold: 105, roi_pct: 75, notes: 180, card_show: 100 });

  // Per-column filters
  const [selectedSlab, setSelectedSlab] = useState<SlabRow | null>(null);

  const [fCompany, setFCompany]       = useState<string[]>([]);
  const [fGrade, setFGrade]           = useState<string[]>([]);
  const [fListed, setFListed]         = useState<string[]>([]);
  const [fCardShow, setFCardShow]     = useState<string[]>([]);
  const [fPurchYear, setFPurchYear]   = useState<string[]>([]);
  const [fListYear, setFListYear]     = useState<string[]>([]);
  const [fSoldYear, setFSoldYear]     = useState<string[]>([]);

  const handleSearchChange = useCallback((val: string) => {
    setSearch(val);
    clearTimeout((handleSearchChange as any)._t);
    (handleSearchChange as any)._t = setTimeout(() => { setDebouncedSearch(val); setPage(1); }, 300);
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
    page, limit: 100,
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
    queryKey: ['overall', params],
    queryFn: () => api.get('/grading/slabs', { params }).then((r) => r.data),
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
      <div className="flex items-center gap-4 px-6 py-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-100 shrink-0">Overall</h1>
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
          {(['all', 'graded', 'sold'] as StatusFilter[]).map((s) => (
            <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`px-3 py-1 text-xs rounded font-medium capitalize transition-colors ${statusFilter === s ? 'bg-zinc-600 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">Loading…</div>
        ) : !data?.data.length ? (
          <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">No records found.</div>
        ) : (
          <table className="text-xs whitespace-nowrap border-collapse" style={{ tableLayout: 'fixed', width: totalWidth + 'px' }}>
            <thead className="sticky top-0 bg-zinc-950 z-10">
              <tr className="border-b border-zinc-700 text-zinc-300 uppercase tracking-wide">
                <ColHeader label="Cert"              col="cert_number"       {...sh} {...rz('cert_number')} />
                <ColHeader label="Card"              col="card_name"         {...sh} {...rz('card_name')} />
                <ColHeader label="Grade"             col="grade"             {...sh} {...rz('grade')}
                  filterOptions={filterOptions?.grades}    filterSelected={fGrade}    onFilterChange={(v) => { setFGrade(v); setPage(1); }} />
                <ColHeader label="Company"                                   {...sh} {...rz('company')}
                  filterOptions={filterOptions?.companies} filterSelected={fCompany}  onFilterChange={(v) => { setFCompany(v); setPage(1); }} align="center" />
                <ColHeader label="Listed?"           col="is_listed"         {...sh} {...rz('is_listed')} align="center"
                  filterOptions={filterOptions?.listed}    filterSelected={fListed}   onFilterChange={(v) => { setFListed(v); setPage(1); }} />
                <ColHeader label="Listed Price"      col="listed_price"      {...sh} {...rz('listed_price')} align="right" />
                <ColHeader label="Listing"                                   {...sh} {...rz('listing')} align="center" />
                <ColHeader label="Raw"               col="raw_cost"          {...sh} {...rz('raw_cost')} align="right" />
                <ColHeader label="Grading Cost"      col="grading_cost"      {...sh} {...rz('grading_cost')} align="right" />
                <ColHeader label="Strike Price"      col="strike_price"      {...sh} {...rz('strike_price')} align="right" />
                <ColHeader label="After Ebay"        col="after_ebay"        {...sh} {...rz('after_ebay')} align="right" />
                <ColHeader label="Net"               col="net"               {...sh} {...rz('net')} align="right" />
                <ColHeader label="Raw Purchase Date" col="raw_purchase_date" {...sh} {...rz('raw_purchase_date')}
                  filterOptions={filterOptions?.purchase_years} filterSelected={fPurchYear} onFilterChange={(v) => { setFPurchYear(v); setPage(1); }} />
                <ColHeader label="Date Listed"       col="date_listed"       {...sh} {...rz('date_listed')}
                  filterOptions={filterOptions?.listed_years}   filterSelected={fListYear}  onFilterChange={(v) => { setFListYear(v); setPage(1); }} />
                <ColHeader label="Date Sold"         col="date_sold"         {...sh} {...rz('date_sold')}
                  filterOptions={filterOptions?.sold_years}     filterSelected={fSoldYear}  onFilterChange={(v) => { setFSoldYear(v); setPage(1); }} />
                <ColHeader label="% ROI"             col="roi_pct"           {...sh} {...rz('roi_pct')} align="right" />
                <ColHeader label="Notes"                                     {...sh} {...rz('notes')} />
                <ColHeader label="Card Show?"                                {...sh} {...rz('card_show')} align="center"
                  filterOptions={filterOptions?.card_show} filterSelected={fCardShow} onFilterChange={(v) => { setFCardShow(v); setPage(1); }} />
              </tr>
            </thead>
            <tbody>
              {data.data.map((row) => {
                const link = row.cert_number ? certLink(row.company, row.cert_number) : null;
                return (
                  <tr key={row.id} onClick={() => setSelectedSlab(row)} className="border-b border-zinc-800/40 hover:bg-zinc-800/20 transition-colors cursor-pointer">
                    <td className="px-3 py-1 font-mono text-[11px]">
                      {link ? (
                        <a href={link} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">{row.cert_number}</a>
                      ) : <span className="text-zinc-400">{row.cert_number ?? ''}</span>}
                    </td>
                    <td className="px-3 py-1 text-zinc-200 max-w-[340px] truncate" title={row.card_name ?? ''}>{row.card_name ?? ''}</td>
                    <td className="px-3 py-1 text-zinc-300">{row.grade_label ?? ''}</td>
                    <td className="px-3 py-1 text-center text-zinc-400 text-[11px]">{row.company}</td>
                    <td className="px-3 py-1 text-center">
                      {row.is_listed ? <span className="text-green-400">Yes</span> : <span className="text-zinc-600">No</span>}
                    </td>
                    <td className="px-3 py-1 text-right text-zinc-300">{fmt(row.listed_price)}</td>
                    <td className="px-3 py-1 text-center" onClick={(e) => e.stopPropagation()} >
                      {row.listing_url ? (
                        <a href={row.listing_url} target="_blank" rel="noopener noreferrer" className="inline-flex text-blue-400 hover:text-blue-300">
                          <ExternalLink size={11} />
                        </a>
                      ) : ''}
                    </td>
                    <td className="px-3 py-1 text-right text-zinc-400">{fmt(row.raw_cost)}</td>
                    <td className="px-3 py-1 text-right text-zinc-500">{row.grading_cost > 0 ? fmt(row.grading_cost) : ''}</td>
                    <td className="px-3 py-1 text-right text-zinc-300">{fmt(row.strike_price)}</td>
                    <td className="px-3 py-1 text-right text-zinc-300">{fmt(row.after_ebay)}</td>
                    <td className="px-3 py-1 text-right"><NetCell afterEbay={row.after_ebay} raw={row.raw_cost} grading={row.grading_cost} /></td>
                    <td className="px-3 py-1 text-zinc-500">{fmtDate(row.raw_purchase_date)}</td>
                    <td className="px-3 py-1 text-zinc-500">{fmtDate(row.date_listed)}</td>
                    <td className="px-3 py-1 text-zinc-500">{fmtDate(row.date_sold)}</td>
                    <td className="px-3 py-1 text-right"><RoiCell roi={row.roi_pct} afterEbay={row.after_ebay} raw={row.raw_cost} grading={row.grading_cost} /></td>
                    <td className="px-3 py-1 text-zinc-500 max-w-[220px] truncate" title={row.notes ?? ''}>{row.notes ?? ''}</td>
                    <td className="px-3 py-1 text-center">
                      {row.is_card_show ? <span className="text-yellow-400">Yes</span> : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {selectedSlab && (
        <SlabDetailModal slab={selectedSlab} onClose={() => setSelectedSlab(null)} />
      )}

      {data && (
        <div className="flex items-center justify-between px-6 py-3 pr-44 border-t border-zinc-800 text-xs text-zinc-500">
          <span>{(data.total ?? 0).toLocaleString()} total records</span>
          {data.total_pages > 1 && (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
              <span>{page} / {data.total_pages}</span>
              <Button variant="ghost" size="sm" disabled={page >= data.total_pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
