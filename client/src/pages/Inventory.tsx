import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ExternalLink, X } from 'lucide-react';
import { api, type PaginatedResult } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { AddSlabForm } from '../components/inventory/AddSlabForm';
import { CardDetailModal } from '../components/inventory/CardDetailModal';
import { formatCurrency, formatDate } from '../lib/utils';
import { ColHeader, useColWidths, colMinWidth } from '../components/ui/TableHeader';

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
  listing_id: string | null;
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
  order_details_link: string | null;
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

function certLink(company: string, cert: string): string | null {
  switch (company) {
    case 'PSA': return `https://www.psacard.com/cert/${cert}`;
    case 'CGC': return `https://www.cgccards.com/certlookup/${cert}`;
    case 'SGC': return `https://sgccard.com/cert/${cert}`;
    case 'ARS': return `https://ars-grading.com/grading/searchNumber?id=${cert}`;
    default:    return null;
  }
}

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
  const MINS = {
    cert:        colMinWidth('Cert',              true,  false),
    card:        colMinWidth('Card',              true,  false),
    grade:       colMinWidth('Grade',             true,  true),
    company:     colMinWidth('Company',           false, true),
    listed:      colMinWidth('Listed?',           true,  true),
    listed_price: colMinWidth('Listed Price',     true,  false),
    listing:     colMinWidth('Listing',           false, false),
    raw:         colMinWidth('Raw',               true,  false),
    grading_cost: colMinWidth('Grading Cost',     true,  false),
    strike:      colMinWidth('Strike Price',      true,  false),
    after_ebay:  colMinWidth('After Ebay',        true,  false),
    net:         colMinWidth('Net',               true,  false),
    purch_date:  colMinWidth('Raw Purchase Date', true,  true),
    date_listed: colMinWidth('Date Listed',       true,  true),
    date_sold:   colMinWidth('Date Sold',         true,  true),
    roi:         colMinWidth('% ROI',             true,  false),
    notes:       colMinWidth('Notes',             false, false),
    card_show:   colMinWidth('Card Show?',        false, true),
  };
  const { rz, totalWidth } = useColWidths({ cert: Math.max(MINS.cert, 120), card: Math.max(MINS.card, 680), grade: Math.max(MINS.grade, 130), company: Math.max(MINS.company, 90), listed: Math.max(MINS.listed, 80), listed_price: Math.max(MINS.listed_price, 100), listing: Math.max(MINS.listing, 60), raw: Math.max(MINS.raw, 80), grading_cost: Math.max(MINS.grading_cost, 105), strike: Math.max(MINS.strike, 95), after_ebay: Math.max(MINS.after_ebay, 90), net: Math.max(MINS.net, 80), purch_date: Math.max(MINS.purch_date, 140), date_listed: Math.max(MINS.date_listed, 100), date_sold: Math.max(MINS.date_sold, 100), roi: Math.max(MINS.roi, 70), notes: Math.max(MINS.notes, 170), card_show: Math.max(MINS.card_show, 95) });

  const [fCompany, setFCompany] = useState<string[] | null>(null);
  const [fGrade, setFGrade] = useState<string[] | null>(null);
  const [fListed, setFListed] = useState<string[] | null>(null);
  const [fCardShow, setFCardShow] = useState<string[] | null>(null);
  const [fPurchYear, setFPurchYear] = useState<string[] | null>(null);
  const [fListYear, setFListYear] = useState<string[] | null>(null);
  const [fSoldYear, setFSoldYear] = useState<string[] | null>(null);
  const [fPurchDate, setFPurchDate] = useState('');
  const [fListDate, setFListDate] = useState('');
  const [fSoldDate, setFSoldDate] = useState('');

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

  function activeFilter(sel: string[] | null, opts?: string[]): string[] | undefined {
    if (sel === null) return undefined;
    if (sel.length >= (opts?.length ?? Infinity)) return undefined;
    return sel;
  }

  const params = {
    page, limit: 50,
    search: debouncedSearch || undefined,
    status: statusFilter,
    sort_by: sortCol ?? undefined,
    sort_dir: sortDir,
    companies:      activeFilter(fCompany,   filterOptions?.companies)?.join(','),
    grades:         activeFilter(fGrade,     filterOptions?.grades)?.join(','),
    is_listed:      activeFilter(fListed,    filterOptions?.listed)?.[0]?.toLowerCase(),
    is_card_show:   activeFilter(fCardShow,  filterOptions?.card_show)?.[0]?.toLowerCase(),
    purchase_years: activeFilter(fPurchYear, filterOptions?.purchase_years)?.join(','),
    listed_years:   activeFilter(fListYear,  filterOptions?.listed_years)?.join(','),
    sold_years:     activeFilter(fSoldYear,  filterOptions?.sold_years)?.join(','),
    purchase_date:  fPurchDate || undefined,
    listed_date:    fListDate  || undefined,
    sold_date:      fSoldDate  || undefined,
  };

  const { data, isLoading } = useQuery<PaginatedResult<SlabRow>>({
    queryKey: ['inventory-slabs', params],
    queryFn: () => api.get('/grading/slabs', { params }).then((r) => r.data),
  });

  const hasActiveFilters = fPurchDate || fListDate || fSoldDate ||
    [fCompany, fGrade, fListed, fCardShow, fPurchYear, fListYear, fSoldYear].some((f) => f !== null && f.length > 0);

  function clearAllFilters() {
    setFCompany(null); setFGrade(null); setFListed(null); setFCardShow(null);
    setFPurchYear(null); setFListYear(null); setFSoldYear(null);
    setFPurchDate(''); setFListDate(''); setFSoldDate('');
    setPage(1);
  }

  const sh = { sortCol, sortDir, onSort: handleSort };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-100">Graded/Slabs</h1>
        <div className="flex items-center gap-3">
          {hasActiveFilters && (
            <button onClick={clearAllFilters} className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
              <X size={12} /> Clear filters
            </button>
          )}
          <div className="flex gap-1">
            {(['all', 'graded'] as StatusFilter[]).map((s) => (
              <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }}
                className={`px-3 py-1 text-xs rounded font-medium capitalize transition-colors ${statusFilter === s ? 'bg-zinc-600 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
                {s}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Search card or cert…"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-64 px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
          />
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus size={14} /> Add Slab
          </Button>
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
                <ColHeader label="Cert"              col="cert_number"       {...sh} {...rz('cert')} minWidth={MINS.cert} />
                <ColHeader label="Card"              col="card_name"         {...sh} {...rz('card')} minWidth={MINS.card} />
                <ColHeader label="Grade"             col="grade"             {...sh} {...rz('grade')} minWidth={MINS.grade}
                  filterOptions={filterOptions?.grades}    filterSelected={fGrade}    onFilterChange={(v) => { setFGrade(v); setPage(1); }} />
                <ColHeader label="Company"                                   {...sh} {...rz('company')} minWidth={MINS.company}
                  filterOptions={filterOptions?.companies} filterSelected={fCompany}  onFilterChange={(v) => { setFCompany(v); setPage(1); }} align="center" />
                <ColHeader label="Listed?"           col="is_listed"         {...sh} {...rz('listed')} align="center" minWidth={MINS.listed}
                  filterOptions={filterOptions?.listed}    filterSelected={fListed}   onFilterChange={(v) => { setFListed(v); setPage(1); }} />
                <ColHeader label="Listed Price"      col="listed_price"      {...sh} {...rz('listed_price')} align="right" minWidth={MINS.listed_price} />
                <ColHeader label="Listing"                                   {...sh} {...rz('listing')} align="center" minWidth={MINS.listing} />
                <ColHeader label="Raw"               col="raw_cost"          {...sh} {...rz('raw')} align="right" minWidth={MINS.raw} />
                <ColHeader label="Grading Cost"      col="grading_cost"      {...sh} {...rz('grading_cost')} align="right" minWidth={MINS.grading_cost} />
                <ColHeader label="Strike Price"      col="strike_price"      {...sh} {...rz('strike')} align="right" minWidth={MINS.strike} />
                <ColHeader label="After Ebay"        col="after_ebay"        {...sh} {...rz('after_ebay')} align="right" minWidth={MINS.after_ebay} />
                <ColHeader label="Net"               col="net"               {...sh} {...rz('net')} align="right" minWidth={MINS.net} />
                <ColHeader label="Raw Purchase Date" col="raw_purchase_date" {...sh} {...rz('purch_date')} minWidth={MINS.purch_date}
                  filterOptions={filterOptions?.purchase_years} filterSelected={fPurchYear} onFilterChange={(v) => { setFPurchYear(v); setPage(1); }}
                  filterDateValue={fPurchDate} onFilterDateChange={(d) => { setFPurchDate(d); setPage(1); }} />
                <ColHeader label="Date Listed"       col="date_listed"       {...sh} {...rz('date_listed')} minWidth={MINS.date_listed}
                  filterOptions={filterOptions?.listed_years}   filterSelected={fListYear}  onFilterChange={(v) => { setFListYear(v); setPage(1); }}
                  filterDateValue={fListDate} onFilterDateChange={(d) => { setFListDate(d); setPage(1); }} />
                <ColHeader label="Date Sold"         col="date_sold"         {...sh} {...rz('date_sold')} minWidth={MINS.date_sold}
                  filterOptions={filterOptions?.sold_years}     filterSelected={fSoldYear}  onFilterChange={(v) => { setFSoldYear(v); setPage(1); }}
                  filterDateValue={fSoldDate} onFilterDateChange={(d) => { setFSoldDate(d); setPage(1); }} />
                <ColHeader label="% ROI"             col="roi_pct"           {...sh} {...rz('roi')} align="right" minWidth={MINS.roi} />
                <ColHeader label="Notes"                                     {...sh} {...rz('notes')} minWidth={MINS.notes} />
                <ColHeader label="Card Show?"                                {...sh} {...rz('card_show')} align="center" minWidth={MINS.card_show}
                  filterOptions={filterOptions?.card_show} filterSelected={fCardShow} onFilterChange={(v) => { setFCardShow(v); setPage(1); }} />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {!data?.data.length ? (
                <tr><td colSpan={18} className="px-3 py-10 text-center text-zinc-500">No cards found.</td></tr>
              ) : data.data.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => setSelectedId(row.id)}
                  className="hover:bg-zinc-800/25 cursor-pointer transition-colors"
                >
                  <td className="px-3 py-1.5 font-mono text-[11px]">
                    {(() => {
                      const link = row.cert_number ? certLink(row.company, row.cert_number) : null;
                      const display = row.cert_number ? row.cert_number.padStart(8, '0') : '';
                      return link
                        ? <a href={link} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-blue-400 hover:underline">{display}</a>
                        : <span className="text-zinc-400">{display}</span>;
                    })()}
                  </td>
                  <td className="px-3 py-1.5 text-zinc-200 truncate" title={row.card_name ?? ''}>
                    {row.card_name ?? '—'}
                  </td>
                  <td className="px-3 py-1.5 text-zinc-300">{row.grade_label ?? ''}</td>
                  <td className="px-3 py-1.5 text-center text-zinc-400 text-[11px]">{row.company}</td>
                  <td className="px-3 py-1.5 text-center">
                    {row.is_listed ? (
                      <span className="text-green-400 font-medium">Yes</span>
                    ) : (
                      <span className="text-zinc-600">No</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right text-zinc-300">{fmt(row.listed_price)}</td>
                  <td className="px-3 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                    {row.order_details_link ? (
                      <a href={row.order_details_link} target="_blank" rel="noopener noreferrer"
                        className="inline-flex text-indigo-400 hover:text-indigo-300 transition-colors" title="Order details">
                        <ExternalLink size={12} />
                      </a>
                    ) : row.listing_url ? (
                      <a href={row.listing_url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex text-indigo-400 hover:text-indigo-300 transition-colors" title="eBay listing">
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
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Slab">
        <AddSlabForm onSuccess={() => { setAddOpen(false); qc.invalidateQueries({ queryKey: ['inventory-slabs'] }); }} />
      </Modal>

      {selectedId && (
        <CardDetailModal
          cardId={selectedId}
          onClose={() => setSelectedId(null)}
          onDelete={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
