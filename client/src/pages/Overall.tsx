import { useState, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus, X } from 'lucide-react';
import { api, type PaginatedResult } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { formatCurrency } from '../lib/utils';
import { loadFilters, saveFilters } from '../lib/filter-store';
import { SlabDetailModal } from '../components/inventory/SlabDetailModal';
import { AddSlabForm } from '../components/inventory/AddSlabForm';
import { ColHeader, useColWidths, colMinWidth } from '../components/ui/TableHeader';

interface SlabRow {
  id: string;
  raw_purchase_label: string | null;
  card_name: string | null;
  cert_number: string | null;
  grade_label: string | null;
  numeric_grade: number | null;
  company: string;
  is_listed: boolean;
  listed_price: number | null;
  listing_url: string | null;
  listing_id: string | null;
  order_details_link: string | null;
  raw_cost: number;
  grading_cost: number;
  strike_price: number | null;
  after_ebay: number | null;
  raw_purchase_date: string | null;
  date_listed: string | null;
  date_sold: string | null;
  roi_pct: number | null;
  notes: string | null;
  location_name: string | null;
  location_id: string | null;
  is_card_show: boolean;
  is_personal_collection: boolean;
}

interface FilterOptions {
  companies: string[];
  grades: string[];
  listed: string[];
  card_show: string[];
  personal_collection: string[];
  purchase_years: string[];
  listed_years: string[];
  sold_years: string[];
}

type SortDir = 'asc' | 'desc';
type StatusFilter = 'all' | 'unsold' | 'sold' | 'graded';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function certLink(company: string, cert: string): string | null {
  switch (company) {
    case 'PSA': return `https://www.psacard.com/cert/${cert}`;
    case 'CGC': return `https://www.cgccards.com/certlookup/${cert}`;
    case 'SGC': return `https://sgccard.com/cert/${cert}`;
    case 'ARS': return `https://ars-grading.com/grading/searchNumber?id=${cert}`;
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

const OVERALL_FILTER_DEFAULTS = {
  sortCol: 'cert_number' as string | null,
  sortDir: 'asc' as SortDir,
  statusFilter: 'unsold' as StatusFilter,
  fCompany: null as string[] | null,
  fListed: null as string[] | null,
  fGrade: null as string[] | null,
  fCardShow: null as string[] | null,
  fPersonal: false,
  fPurchYear: null as string[] | null,
  fListYear: null as string[] | null,
  fSoldYear: null as string[] | null,
  fPurchDate: '',
  fListDate: '',
  fSoldDate: '',
  search: '',
};

export function Overall({ cardShowMode = false }: { cardShowMode?: boolean }) {
  const filterKey = cardShowMode ? 'card-show' : 'overall';
  const saved = loadFilters(filterKey, OVERALL_FILTER_DEFAULTS);
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(saved.search);
  const [debouncedSearch, setDebouncedSearch] = useState(saved.search);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(cardShowMode ? 'unsold' : saved.statusFilter);
  const [sortCol, setSortCol] = useState<string | null>(saved.sortCol);
  const [sortDir, setSortDir] = useState<SortDir>(saved.sortDir);
  const MINS = {
    part_number:        colMinWidth('Part #',             false, false),
    cert_number:        colMinWidth('Cert',              true,  false),
    card_name:          colMinWidth('Card',              true,  false),
    grade:              colMinWidth('Grade',             true,  true),
    company:            colMinWidth('Company',           false, true),
    is_listed:          colMinWidth('Listed?',           true,  true),
    listed_price:       colMinWidth('Listed',    true,  false),
    listing:            colMinWidth('Listing',   false, false),
    raw_cost:           colMinWidth('Raw',       true,  false),
    grading_cost:       colMinWidth('Grading',   true,  false),
    strike_price:       colMinWidth('Strike',    true,  false),
    after_ebay:         colMinWidth('After',     true,  false),
    net:                colMinWidth('Net',       true,  false),
    raw_purchase_date:  colMinWidth('Purchase',  true,  true),
    date_listed:        colMinWidth('Listed',    true,  true),
    date_sold:          colMinWidth('Date',      true,  true),
    roi_pct:            colMinWidth('% ROI',     true,  false),
    notes:              colMinWidth('Notes',     false, false),
    location:           colMinWidth('Location',  false, false),
    card_show:          colMinWidth('Card Show?', false, true),
  };
  const { rz, totalWidth } = useColWidths({ part_number: Math.max(MINS.part_number, 110), cert_number: Math.max(MINS.cert_number, 120), grade: Math.max(MINS.grade, 160), card_name: Math.max(MINS.card_name, 560), company: Math.max(MINS.company, 115), is_listed: Math.max(MINS.is_listed, 80), listed_price: Math.max(MINS.listed_price, 75), listing: Math.max(MINS.listing, 55), location: Math.max(MINS.location, 130), card_show: Math.max(MINS.card_show, 60), raw_cost: Math.max(MINS.raw_cost, 75), grading_cost: Math.max(MINS.grading_cost, 75), strike_price: Math.max(MINS.strike_price, 75), after_ebay: Math.max(MINS.after_ebay, 75), net: Math.max(MINS.net, 75), raw_purchase_date: Math.max(MINS.raw_purchase_date, 80), date_listed: Math.max(MINS.date_listed, 75), date_sold: Math.max(MINS.date_sold, 75), roi_pct: Math.max(MINS.roi_pct, 65), notes: Math.max(MINS.notes, 500) });

  // Per-column filters
  const [selectedSlab, setSelectedSlab] = useState<SlabRow | null>(null);

  const [fCompany, setFCompany]       = useState<string[] | null>(saved.fCompany);
  const [fGrade, setFGrade]           = useState<string[] | null>(saved.fGrade);
  const [fListed, setFListed]         = useState<string[] | null>(saved.fListed);
  const [fCardShow, setFCardShow]           = useState<string[] | null>(saved.fCardShow);
  const [fPersonal, setFPersonal] = useState<boolean>(saved.fPersonal);
  const [fPurchYear, setFPurchYear]         = useState<string[] | null>(saved.fPurchYear);
  const [fListYear, setFListYear]     = useState<string[] | null>(saved.fListYear);
  const [fSoldYear, setFSoldYear]     = useState<string[] | null>(saved.fSoldYear);
  const [fPurchDate, setFPurchDate]   = useState(saved.fPurchDate);
  const [fListDate, setFListDate]     = useState(saved.fListDate);
  const [fSoldDate, setFSoldDate]     = useState(saved.fSoldDate);

  useEffect(() => {
    saveFilters(filterKey, { sortCol, sortDir, statusFilter, fCompany, fGrade, fListed, fCardShow, fPersonal, fPurchYear, fListYear, fSoldYear, fPurchDate, fListDate, fSoldDate, search });
  }, [sortCol, sortDir, statusFilter, fCompany, fGrade, fListed, fCardShow, fPersonal, fPurchYear, fListYear, fSoldYear, fPurchDate, fListDate, fSoldDate, search]);

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

  // null → no filter (undefined param, show all)
  // []  → filter active but empty (send '' param, show nothing)
  // [...] → filter to these values
  function activeFilter(sel: string[] | null, opts?: string[]): string[] | undefined {
    if (sel === null) return undefined;
    if (sel.length >= (opts?.length ?? Infinity)) return undefined;
    return sel;
  }

  const params = {
    page, limit: 100,
    search: debouncedSearch || undefined,
    status: cardShowMode ? 'unsold' : statusFilter,
    sort_by: sortCol ?? undefined,
    sort_dir: sortDir,
    companies:      activeFilter(fCompany,   filterOptions?.companies)?.join(','),
    grades:         activeFilter(fGrade,     filterOptions?.grades)?.join(','),
    is_listed:      activeFilter(fListed,    filterOptions?.listed)?.[0]?.toLowerCase(),
    is_card_show:   cardShowMode ? 'yes' : activeFilter(fCardShow, filterOptions?.card_show)?.[0]?.toLowerCase(),
    personal_collection:   fPersonal ? 'yes' : undefined,
    purchase_years: activeFilter(fPurchYear, filterOptions?.purchase_years)?.join(','),
    listed_years:   activeFilter(fListYear,  filterOptions?.listed_years)?.join(','),
    sold_years:     activeFilter(fSoldYear,  filterOptions?.sold_years)?.join(','),
    purchase_date:  fPurchDate || undefined,
    listed_date:    fListDate  || undefined,
    sold_date:      fSoldDate  || undefined,
  };

  const { data, isLoading } = useQuery<PaginatedResult<SlabRow>>({
    queryKey: ['overall', params],
    queryFn: () => api.get('/grading/slabs', { params }).then((r) => r.data),
  });

  const hasActiveFilters = fPersonal || fPurchDate || fListDate || fSoldDate ||
    [fCompany, fGrade, fListed, fCardShow, fPurchYear, fListYear, fSoldYear].some((f) => f !== null && f.length > 0);

  function clearAllFilters() {
    setFCompany(null); setFGrade(null); setFListed(null); setFCardShow(null); setFPersonal(false);
    setFPurchYear(null); setFListYear(null); setFSoldYear(null);
    setFPurchDate(''); setFListDate(''); setFSoldDate('');
    setPage(1);
  }

  const sh = { sortCol, sortDir, onSort: handleSort };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-100">{cardShowMode ? 'Card Show Inventory' : 'Graded Overall'}</h1>
        <div className="flex items-center gap-3">
          {hasActiveFilters && (
            <button onClick={clearAllFilters} className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
              <X size={12} /> Clear filters
            </button>
          )}
          {!cardShowMode && (
            <div className="flex gap-1">
              {([
                { value: 'all',    label: 'All' },
                { value: 'unsold', label: 'Unsold' },
                { value: 'sold',   label: 'Sold' },
                { value: 'graded', label: 'Graded' },
              ] as { value: StatusFilter; label: string }[]).map(({ value, label }) => (
                <button key={value} onClick={() => { setStatusFilter(value); setPage(1); }}
                  className={`px-3 py-1 text-xs rounded font-medium transition-colors ${statusFilter === value ? 'bg-zinc-600 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
                  {label}
                </button>
              ))}
              <button onClick={() => { setFPersonal(v => !v); setPage(1); }}
                className={`px-3 py-1 text-xs rounded font-medium transition-colors ${fPersonal ? 'bg-zinc-600 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
                Personal
              </button>
            </div>
          )}
          <input
            type="text"
            placeholder="Search card or cert…"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-64 px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
          />
          {!cardShowMode && (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus size={14} /> Add Slab
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">Loading…</div>
        ) : (
          <table className="text-xs whitespace-nowrap border-collapse" style={{ tableLayout: 'fixed', width: totalWidth + 'px' }}>
            <thead className="sticky top-0 bg-zinc-950 z-10">
              <tr className="border-b border-zinc-700 text-zinc-300 uppercase tracking-wide">
                <ColHeader label="Part #"                                    {...sh} {...rz('part_number')} minWidth={MINS.part_number} />
                <ColHeader label="Cert"              col="cert_number"       {...sh} {...rz('cert_number')} minWidth={MINS.cert_number} />
                <ColHeader label="Grade"             col="grade"             {...sh} {...rz('grade')} minWidth={MINS.grade}
                  filterOptions={filterOptions?.grades} filterSelected={fGrade} onFilterChange={(v) => { setFGrade(v); setPage(1); }} />
                <ColHeader label="Card"              col="card_name"         {...sh} {...rz('card_name')} minWidth={MINS.card_name} />
                <ColHeader label="Company"                                   {...sh} {...rz('company')} minWidth={MINS.company}
                  filterOptions={filterOptions?.companies} filterSelected={fCompany}  onFilterChange={(v) => { setFCompany(v); setPage(1); }} align="center" />
                <ColHeader label="Listed?"           col="is_listed"         {...sh} {...rz('is_listed')} align="center" minWidth={MINS.is_listed}
                  filterOptions={filterOptions?.listed}    filterSelected={fListed}   onFilterChange={(v) => { setFListed(v); setPage(1); }} />
                <ColHeader label="Listed Price"      col="listed_price"      {...sh} {...rz('listed_price')} align="right" minWidth={MINS.listed_price} wrap />
                <ColHeader label="Listing"                                   {...sh} {...rz('listing')} align="center" minWidth={MINS.listing} />
                {!cardShowMode && <ColHeader label="Location"               {...sh} {...rz('location')} minWidth={MINS.location} />}
                {!cardShowMode && (
                  <ColHeader label="Card Show?"                              {...sh} {...rz('card_show')} align="center" minWidth={MINS.card_show}
                    filterOptions={filterOptions?.card_show} filterSelected={fCardShow} onFilterChange={(v) => { setFCardShow(v); setPage(1); }} filterAlign="right" />
                )}
                <ColHeader label="Raw"               col="raw_cost"          {...sh} {...rz('raw_cost')} align="right" minWidth={MINS.raw_cost} />
                <ColHeader label="Grading Cost"      col="grading_cost"      {...sh} {...rz('grading_cost')} align="right" minWidth={MINS.grading_cost} wrap />
                <ColHeader label="Strike Price"      col="strike_price"      {...sh} {...rz('strike_price')} align="right" minWidth={MINS.strike_price} wrap />
                <ColHeader label="After eBay"        col="after_ebay"        {...sh} {...rz('after_ebay')} align="right" minWidth={MINS.after_ebay} wrap />
                <ColHeader label="Net"               col="net"               {...sh} {...rz('net')} align="right" minWidth={MINS.net} />
                <ColHeader label="Raw Purchase Date" col="raw_purchase_date" {...sh} {...rz('raw_purchase_date')} minWidth={MINS.raw_purchase_date} wrap
                  filterOptions={filterOptions?.purchase_years} filterSelected={fPurchYear} onFilterChange={(v) => { setFPurchYear(v); setPage(1); }}
                  filterDateValue={fPurchDate} onFilterDateChange={(d) => { setFPurchDate(d); setPage(1); }} />
                <ColHeader label="Date Listed"       col="date_listed"       {...sh} {...rz('date_listed')} minWidth={MINS.date_listed} wrap
                  filterOptions={filterOptions?.listed_years}   filterSelected={fListYear}  onFilterChange={(v) => { setFListYear(v); setPage(1); }}
                  filterDateValue={fListDate} onFilterDateChange={(d) => { setFListDate(d); setPage(1); }} />
                <ColHeader label="Date Sold"         col="date_sold"         {...sh} {...rz('date_sold')} minWidth={MINS.date_sold} wrap
                  filterOptions={filterOptions?.sold_years}     filterSelected={fSoldYear}  onFilterChange={(v) => { setFSoldYear(v); setPage(1); }}
                  filterDateValue={fSoldDate} onFilterDateChange={(d) => { setFSoldDate(d); setPage(1); }} />
                <ColHeader label="% ROI"             col="roi_pct"           {...sh} {...rz('roi_pct')} align="right" minWidth={MINS.roi_pct} />
                <ColHeader label="Notes"                                     {...sh} {...rz('notes')} minWidth={MINS.notes} />
              </tr>
            </thead>
            <tbody>
              {!data?.data.length ? (
                <tr><td colSpan={20} className="px-3 py-10 text-center text-zinc-500">No records found.</td></tr>
              ) : data.data.map((row) => {
                const link = row.cert_number ? certLink(row.company, row.cert_number) : null;
                return (
                  <tr key={row.id} onClick={() => setSelectedSlab(row)} className="border-b border-zinc-800/40 hover:bg-zinc-800/20 transition-colors cursor-pointer">
                    <td className="px-3 py-1 font-mono text-[11px] text-indigo-300/70">{row.raw_purchase_label ?? ''}</td>
                    <td className="px-3 py-1 font-mono text-[11px]">
                      {link ? (
                        <a href={link} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">{row.cert_number}</a>
                      ) : <span className="text-zinc-400">{row.cert_number ?? ''}</span>}
                    </td>
                    <td className="px-3 py-1 text-zinc-300">{row.grade_label ?? ''}</td>
                    <td className="px-3 py-1 text-zinc-200 max-w-[340px] truncate" title={row.card_name ?? ''}>{row.card_name ?? ''}</td>
                    <td className="px-3 py-1 text-center text-zinc-400 text-[11px]">{row.company}</td>
                    <td className="px-3 py-1 text-center">
                      {row.is_listed ? <span className="text-green-400">Yes</span> : <span className="text-zinc-600">No</span>}
                    </td>
                    <td className="px-3 py-1 text-right text-zinc-300">{fmt(row.listed_price)}</td>
                    <td className="px-3 py-1 text-center" onClick={(e) => e.stopPropagation()}>
                      {row.order_details_link ? (
                        <a href={row.order_details_link} target="_blank" rel="noopener noreferrer"
                          className="inline-flex text-indigo-400 hover:text-indigo-300 transition-colors" title="Order details">
                          <ExternalLink size={11} />
                        </a>
                      ) : row.listing_url ? (
                        <a href={row.listing_url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex text-indigo-400 hover:text-indigo-300 transition-colors" title="eBay listing">
                          <ExternalLink size={11} />
                        </a>
                      ) : ''}
                    </td>
                    {!cardShowMode && <td className="px-3 py-1 text-zinc-400 truncate" title={row.location_name ?? ''}>{row.location_name ?? ''}</td>}
                    {!cardShowMode && (
                      <td className="px-3 py-1 text-center">
                        {row.is_card_show ? <span className="text-yellow-400">Yes</span> : ''}
                      </td>
                    )}
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
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Slab">
        <AddSlabForm onSuccess={() => { setAddOpen(false); qc.invalidateQueries({ queryKey: ['overall'] }); }} />
      </Modal>

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
