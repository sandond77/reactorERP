import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus, X, ChevronRight } from 'lucide-react';
import { api, type PaginatedResult } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { formatCurrency } from '../lib/utils';
import { loadFilters, saveFilters } from '../lib/filter-store';
import { CardDetailModal } from '../components/inventory/CardDetailModal';
import { AddCardForm } from '../components/inventory/AddCardForm';
import { ColHeader, useColWidths, colMinWidth } from '../components/ui/TableHeader';
import { instForSale, instToGrade, instGrading, instSold, groupKey, num } from '../lib/card-inventory';
import type { CardGroup } from '../lib/card-inventory';

interface RawRow {
  id: string;
  raw_purchase_label: string | null;
  sku: string | null;
  card_name: string | null;
  set_name: string | null;
  card_number: string | null;
  condition: string | null;
  is_listed: boolean;
  listed_price: number | null;
  listing_url: string | null;
  listing_id: string | null;
  order_details_link: string | null;
  raw_cost: number;
  strike_price: number | null;
  after_ebay: number | null;
  raw_purchase_date: string | null;
  date_listed: string | null;
  date_sold: string | null;
  roi_pct: number | null;
  notes: string | null;
  location_name: string | null;
  location_id: string | null;
}

interface FilterOptions {
  conditions: string[];
  listed: string[];
  purchase_years: string[];
  listed_years: string[];
  sold_years: string[];
}

type SortDir = 'asc' | 'desc';
type StatusFilter = 'all' | 'unsold' | 'sold' | 'for_sale' | 'to_grade' | 'submitted' | 'summary';

function fmt(cents: number | null) { return cents == null ? '' : formatCurrency(cents); }

function fmtDate(d?: string | null) {
  if (!d) return '';
  return new Intl.DateTimeFormat('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }).format(new Date(d));
}

function NetCell({ afterEbay, raw }: { afterEbay: number | null; raw: number }) {
  if (afterEbay == null) return <span className="text-red-400">-{formatCurrency(raw)}</span>;
  const net = afterEbay - raw;
  return <span className={net >= 0 ? 'text-green-400' : 'text-red-400'}>{formatCurrency(net)}</span>;
}

function RoiCell({ roi, afterEbay, raw }: { roi: number | null; afterEbay: number | null; raw: number }) {
  let pct = roi != null ? Number(roi) : null;
  if (pct == null && afterEbay != null && raw > 0) pct = ((afterEbay - raw) / raw) * 100;
  if (pct == null) return <></>;
  return <span className={pct >= 0 ? 'text-green-400' : 'text-red-400'}>{pct.toFixed(2)}%</span>;
}

const RAW_OVERALL_DEFAULTS = {
  sortCol: null as string | null,
  sortDir: 'asc' as SortDir,
  statusFilter: 'all' as StatusFilter,
  fCondition: null as string[] | null,
  fListed: null as string[] | null,
  fPurchYear: null as string[] | null,
  fListYear: null as string[] | null,
  fSoldYear: null as string[] | null,
  fPurchDate: '',
  fListDate: '',
  fSoldDate: '',
  search: '',
};

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: 'summary',   label: 'Summary' },
  { value: 'all',       label: 'All' },
  { value: 'unsold',    label: 'Unsold' },
  { value: 'sold',      label: 'Sold' },
  { value: 'for_sale',  label: 'For Sale' },
  { value: 'to_grade',  label: 'To Grade' },
  { value: 'submitted', label: 'Submitted' },
];

export function RawOverall() {
  const filterKey = 'raw-overall';
  const saved = loadFilters(filterKey, RAW_OVERALL_DEFAULTS);
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(saved.search);
  const [debouncedSearch, setDebouncedSearch] = useState(saved.search);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(saved.statusFilter);
  const [sortCol, setSortCol] = useState<string | null>(saved.sortCol);
  const [sortDir, setSortDir] = useState<SortDir>(saved.sortDir);
  const [selectedRow, setSelectedRow] = useState<RawRow | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  const isSummary = statusFilter === 'summary';

  const MINS = {
    id:                colMinWidth('ID',            true,  false),
    sku:               colMinWidth('Part #',        true,  false),
    card_name:         colMinWidth('Card',          true,  false),
    condition:         colMinWidth('Condition',     true,  true),
    is_listed:         colMinWidth('Listed?',       true,  true),
    listed_price:      colMinWidth('Listed',        true,  false),
    listing:           colMinWidth('Link',          false, false),
    location:          colMinWidth('Location',      false, false),
    raw_cost:          colMinWidth('Cost',          true,  false),
    strike_price:      colMinWidth('Strike',        true,  false),
    after_ebay:        colMinWidth('After',         true,  false),
    net:               colMinWidth('Net',           true,  false),
    raw_purchase_date: colMinWidth('Purchase',      true,  true),
    date_listed:       colMinWidth('Listed',        true,  true),
    date_sold:         colMinWidth('Date',          true,  true),
    roi_pct:           colMinWidth('% ROI',         true,  false),
    notes:             colMinWidth('Notes',         false, false),
  };

  const { rz, totalWidth } = useColWidths({
    id:                Math.max(MINS.id,                130),
    sku:               Math.max(MINS.sku,               190),
    card_name:         Math.max(MINS.card_name,          500),
    condition:         Math.max(MINS.condition,           90),
    is_listed:         Math.max(MINS.is_listed,           80),
    listed_price:      Math.max(MINS.listed_price,        80),
    listing:           Math.max(MINS.listing,             55),
    location:          Math.max(MINS.location,           130),
    raw_cost:          Math.max(MINS.raw_cost,            75),
    strike_price:      Math.max(MINS.strike_price,        75),
    after_ebay:        Math.max(MINS.after_ebay,          75),
    net:               Math.max(MINS.net,                 75),
    raw_purchase_date: Math.max(MINS.raw_purchase_date,   80),
    date_listed:       Math.max(MINS.date_listed,         75),
    date_sold:         Math.max(MINS.date_sold,           75),
    roi_pct:           Math.max(MINS.roi_pct,             65),
    notes:             Math.max(MINS.notes,              500),
  });

  // Summary cols
  const SMINS = {
    part:      colMinWidth('Part #',    true, false),
    card:      colMinWidth('Card Name', true, false),
    set:       colMinWidth('Set',       true, false),
    cardnum:   colMinWidth('Card #',    true, false),
    total:     colMinWidth('Total',     true, false),
    for_sale:  colMinWidth('For Sale',  true, false),
    sold:      colMinWidth('Sold',      true, false),
    to_grade:  colMinWidth('To Grade',  true, false),
    submitted: colMinWidth('Submitted', true, false),
    returned:  colMinWidth('Returned',  true, false),
    notes:     colMinWidth('Notes',     false, false),
  };
  const { rz: srz, totalWidth: sTotalWidth } = useColWidths({
    part:      Math.max(SMINS.part,      190),
    card:      Math.max(SMINS.card,      220),
    set:       Math.max(SMINS.set,       150),
    cardnum:   Math.max(SMINS.cardnum,    70),
    total:     Math.max(SMINS.total,      60),
    for_sale:  Math.max(SMINS.for_sale,   70),
    sold:      Math.max(SMINS.sold,       60),
    to_grade:  Math.max(SMINS.to_grade,   70),
    submitted: Math.max(SMINS.submitted,  80),
    returned:  Math.max(SMINS.returned,   80),
    notes:     Math.max(SMINS.notes,     500),
  });

  const [fCondition, setFCondition] = useState<string[] | null>(saved.fCondition);
  const [fListed, setFListed]       = useState<string[] | null>(saved.fListed);
  const [fPurchYear, setFPurchYear] = useState<string[] | null>(saved.fPurchYear);
  const [fListYear, setFListYear]   = useState<string[] | null>(saved.fListYear);
  const [fSoldYear, setFSoldYear]   = useState<string[] | null>(saved.fSoldYear);
  const [fPurchDate, setFPurchDate] = useState(saved.fPurchDate);
  const [fListDate, setFListDate]   = useState(saved.fListDate);
  const [fSoldDate, setFSoldDate]   = useState(saved.fSoldDate);

  useEffect(() => {
    saveFilters(filterKey, { sortCol, sortDir, statusFilter, fCondition, fListed, fPurchYear, fListYear, fSoldYear, fPurchDate, fListDate, fSoldDate, search });
  }, [sortCol, sortDir, statusFilter, fCondition, fListed, fPurchYear, fListYear, fSoldYear, fPurchDate, fListDate, fSoldDate, search]);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const handleSearchChange = useCallback((val: string) => {
    setSearch(val);
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => { setDebouncedSearch(val); setPage(1); }, 300);
  }, []);

  const handleSort = useCallback((col: string) => {
    setSortCol((prev) => { if (prev === col) return prev; return col; });
    setSortDir((prev) => sortCol === col ? (prev === 'asc' ? 'desc' : 'asc') : 'desc');
    setPage(1);
  }, [sortCol]);

  const { data: filterOptions } = useQuery<FilterOptions>({
    queryKey: ['raw-flat-filter-options'],
    queryFn: () => api.get('/cards/raw-flat/filters').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  function activeFilter(sel: string[] | null, opts?: string[]): string[] | undefined {
    if (sel === null) return undefined;
    if (sel.length >= (opts?.length ?? Infinity)) return undefined;
    return sel;
  }

  const flatParams = {
    page, limit: 100,
    search: debouncedSearch || undefined,
    status: statusFilter,
    sort_by: sortCol ?? undefined,
    sort_dir: sortDir,
    conditions:     activeFilter(fCondition, filterOptions?.conditions)?.join(','),
    is_listed:      activeFilter(fListed,    filterOptions?.listed)?.[0]?.toLowerCase(),
    purchase_years: activeFilter(fPurchYear, filterOptions?.purchase_years)?.join(','),
    listed_years:   activeFilter(fListYear,  filterOptions?.listed_years)?.join(','),
    sold_years:     activeFilter(fSoldYear,  filterOptions?.sold_years)?.join(','),
    purchase_date:  fPurchDate || undefined,
    listed_date:    fListDate  || undefined,
    sold_date:      fSoldDate  || undefined,
  };

  const { data, isLoading } = useQuery<PaginatedResult<RawRow>>({
    queryKey: ['raw-overall', flatParams],
    queryFn: () => api.get('/cards/raw-flat', { params: flatParams }).then((r) => r.data),
    enabled: !isSummary,
  });

  const { data: summaryData, isLoading: summaryLoading } = useQuery<CardGroup[]>({
    queryKey: ['raw-inventory-grouped', debouncedSearch],
    queryFn: () => api.get('/cards/by-part', { params: debouncedSearch ? { search: debouncedSearch } : undefined }).then((r) => r.data),
    enabled: isSummary,
  });

  const filteredSummary = useMemo(() => {
    if (!summaryData) return [];
    return summaryData;
  }, [summaryData]);

  const hasActiveFilters = !isSummary && (fPurchDate || fListDate || fSoldDate ||
    [fCondition, fListed, fPurchYear, fListYear, fSoldYear].some((f) => f !== null && f.length > 0));

  function clearAllFilters() {
    setFCondition(null); setFListed(null);
    setFPurchYear(null); setFListYear(null); setFSoldYear(null);
    setFPurchDate(''); setFListDate(''); setFSoldDate('');
    setPage(1);
  }

  function toggleExpand(key: string) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); } else { next.add(key); }
      return next;
    });
  }

  const sh = { sortCol, sortDir, onSort: handleSort };
  const ssh = { sortCol: null, sortDir: 'asc' as SortDir, onSort: () => {} };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-100">Raw Overall</h1>
        <div className="flex items-center gap-3">
          {hasActiveFilters && (
            <button onClick={clearAllFilters} className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
              <X size={12} /> Clear filters
            </button>
          )}
          <div className="flex items-center gap-1">
            {STATUS_TABS.map(({ value, label }, i) => (
              <React.Fragment key={value}>
                {i === 1 && <div className="w-px h-4 bg-zinc-700 mx-1" />}
                <button onClick={() => { setStatusFilter(value); setPage(1); }}
                  className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${statusFilter === value ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                  {label}
                </button>
              </React.Fragment>
            ))}
          </div>
          <input
            type="text"
            placeholder="Search card or ID…"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-64 px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
          />
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus size={14} /> Add Card
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {isSummary ? (
          summaryLoading ? (
            <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">Loading…</div>
          ) : !filteredSummary.length ? (
            <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">No raw cards found.</div>
          ) : (
            <table className="text-xs border-collapse" style={{ tableLayout: 'fixed', width: sTotalWidth + 32 + 'px' }}>
              <thead className="sticky top-0 bg-zinc-950 z-10">
                <tr className="border-b border-zinc-700 text-zinc-300 uppercase tracking-wide">
                  <th style={{ width: 32 }} />
                  <ColHeader label="Part #"    col="sku"         {...ssh} {...srz('part')}      minWidth={SMINS.part} />
                  <ColHeader label="Card Name" col="card_name"   {...ssh} {...srz('card')}      minWidth={SMINS.card} />
                  <ColHeader label="Set"       col="set_name"    {...ssh} {...srz('set')}       minWidth={SMINS.set} />
                  <ColHeader label="Card #"    col="card_number" {...ssh} {...srz('cardnum')}   minWidth={SMINS.cardnum} />
                  <ColHeader label="Total"     col="total"       {...ssh} {...srz('total')}     minWidth={SMINS.total}     align="right" />
                  <ColHeader label="For Sale"  col="for_sale"    {...ssh} {...srz('for_sale')}  minWidth={SMINS.for_sale}  align="right" />
                  <ColHeader label="Sold"      col="sold"        {...ssh} {...srz('sold')}      minWidth={SMINS.sold}      align="right" />
                  <ColHeader label="To Grade"  col="to_grade"    {...ssh} {...srz('to_grade')}  minWidth={SMINS.to_grade}  align="right" />
                  <ColHeader label="Submitted" col="submitted"   {...ssh} {...srz('submitted')} minWidth={SMINS.submitted} align="right" />
                  <ColHeader label="Returned"  col="returned"    {...ssh} {...srz('returned')}  minWidth={SMINS.returned}  align="right" />
                  <ColHeader label="Notes"                       {...ssh} {...srz('notes')}     minWidth={SMINS.notes} />
                </tr>
              </thead>
              <tbody>
                {filteredSummary.map((group) => {
                  const key = groupKey(group);
                  const expanded = expandedKeys.has(key);
                  return (
                    <React.Fragment key={key}>
                      <tr className="border-b border-zinc-800 hover:bg-zinc-800/30 cursor-pointer transition-colors" onClick={() => toggleExpand(key)}>
                        <td className="pl-3 text-zinc-500">
                          <ChevronRight size={12} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
                        </td>
                        <td className="px-3 py-2 font-mono text-zinc-400 text-[11px]">{group.sku ?? '—'}</td>
                        <td className="px-3 py-2 text-zinc-100 font-medium whitespace-normal break-words">{group.card_name}</td>
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
                          <td className="pl-3"><div className="w-px h-3 bg-zinc-700 mx-auto" /></td>
                          <td className="px-3 py-1.5">
                            <span className="text-[10px] text-zinc-600 mr-1">ID</span>
                            <span className="font-mono text-[11px] text-indigo-300/70">{inst.raw_purchase_label ?? '—'}</span>
                          </td>
                          <td className="px-3 py-1.5 pl-5">
                            <span className="text-[10px] text-zinc-600 mr-1">Cond</span>
                            <span className="text-zinc-400 text-[11px]">{inst.condition ?? '—'}</span>
                            {inst.location_name && <><span className="ml-3 text-[10px] text-zinc-600 mr-1">Loc</span><span className="text-zinc-400 text-[11px]">{inst.location_name}</span></>}
                          </td>
                          <td className="px-3 py-1.5">
                            <span className="text-[10px] text-zinc-600 mr-1">Cost</span>
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
          )
        ) : isLoading ? (
          <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">Loading…</div>
        ) : (
          <table className="text-xs whitespace-nowrap border-collapse" style={{ tableLayout: 'fixed', width: totalWidth + 'px' }}>
            <thead className="sticky top-0 bg-zinc-950 z-10">
              <tr className="border-b border-zinc-700 text-zinc-300 uppercase tracking-wide">
                <ColHeader label="Part #"           col="sku"                {...sh} {...rz('sku')}               minWidth={MINS.sku} />
                <ColHeader label="ID"               col="raw_purchase_label" {...sh} {...rz('id')}               minWidth={MINS.id} />
                <ColHeader label="Card"             col="card_name"          {...sh} {...rz('card_name')}         minWidth={MINS.card_name} />
                <ColHeader label="Condition"        col="condition"          {...sh} {...rz('condition')}         minWidth={MINS.condition}
                  filterOptions={filterOptions?.conditions} filterSelected={fCondition} onFilterChange={(v) => { setFCondition(v); setPage(1); }} />
                <ColHeader label="Location"                                  {...sh} {...rz('location')}          minWidth={MINS.location} />
                <ColHeader label="Listed?"          col="is_listed"          {...sh} {...rz('is_listed')}         minWidth={MINS.is_listed} align="center"
                  filterOptions={filterOptions?.listed} filterSelected={fListed} onFilterChange={(v) => { setFListed(v); setPage(1); }} />
                <ColHeader label="Listed Price"     col="listed_price"       {...sh} {...rz('listed_price')}      minWidth={MINS.listed_price} align="right" wrap />
                <ColHeader label="Link"                                      {...sh} {...rz('listing')}           minWidth={MINS.listing} align="center" />
                <ColHeader label="Cost"             col="raw_cost"           {...sh} {...rz('raw_cost')}          minWidth={MINS.raw_cost} align="right" />
                <ColHeader label="Strike Price"     col="strike_price"       {...sh} {...rz('strike_price')}      minWidth={MINS.strike_price} align="right" wrap />
                <ColHeader label="After Fees"       col="after_ebay"         {...sh} {...rz('after_ebay')}        minWidth={MINS.after_ebay} align="right" wrap />
                <ColHeader label="Net"              col="net"                {...sh} {...rz('net')}               minWidth={MINS.net} align="right" />
                <ColHeader label="Date Added"        col="raw_purchase_date" {...sh} {...rz('raw_purchase_date')} minWidth={MINS.raw_purchase_date} wrap
                  filterOptions={filterOptions?.purchase_years} filterSelected={fPurchYear} onFilterChange={(v) => { setFPurchYear(v); setPage(1); }}
                  filterDateValue={fPurchDate} onFilterDateChange={(d) => { setFPurchDate(d); setPage(1); }} />
                <ColHeader label="Date Listed"      col="date_listed"        {...sh} {...rz('date_listed')}       minWidth={MINS.date_listed} wrap
                  filterOptions={filterOptions?.listed_years} filterSelected={fListYear} onFilterChange={(v) => { setFListYear(v); setPage(1); }}
                  filterDateValue={fListDate} onFilterDateChange={(d) => { setFListDate(d); setPage(1); }} />
                <ColHeader label="Date Sold"        col="date_sold"          {...sh} {...rz('date_sold')}         minWidth={MINS.date_sold} wrap
                  filterOptions={filterOptions?.sold_years} filterSelected={fSoldYear} onFilterChange={(v) => { setFSoldYear(v); setPage(1); }}
                  filterDateValue={fSoldDate} onFilterDateChange={(d) => { setFSoldDate(d); setPage(1); }} />
                <ColHeader label="% ROI"            col="roi_pct"            {...sh} {...rz('roi_pct')}           minWidth={MINS.roi_pct} align="right" />
                <ColHeader label="Notes"                                     {...sh} {...rz('notes')}             minWidth={MINS.notes} />
              </tr>
            </thead>
            <tbody>
              {!data?.data.length ? (
                <tr><td colSpan={17} className="px-3 py-10 text-center text-zinc-500">No records found.</td></tr>
              ) : data.data.map((row) => (
                <tr key={row.id} onClick={() => setSelectedRow(row)} className="border-b border-zinc-800/40 hover:bg-zinc-800/20 transition-colors cursor-pointer">
                  <td className="px-3 py-1 font-mono text-[11px] text-zinc-400">{row.sku ?? '—'}</td>
                  <td className="px-3 py-1 font-mono text-[11px] text-indigo-300/70">{row.raw_purchase_label ?? ''}</td>
                  <td className="px-3 py-1 text-zinc-200 whitespace-normal break-words">{row.card_name ?? ''}</td>
                  <td className="px-3 py-1 text-zinc-300">{row.condition ?? ''}</td>
                  <td className="px-3 py-1 text-zinc-400 truncate" title={row.location_name ?? ''}>{row.location_name ?? ''}</td>
                  <td className="px-3 py-1 text-center">
                    {row.is_listed ? <span className="text-green-400">Yes</span> : <span className="text-zinc-600">No</span>}
                  </td>
                  <td className="px-3 py-1 text-right text-zinc-300">{fmt(row.listed_price)}</td>
                  <td className="px-3 py-1 text-center" onClick={(e) => e.stopPropagation()}>
                    {row.order_details_link ? (
                      <a href={row.order_details_link} target="_blank" rel="noopener noreferrer" className="inline-flex text-indigo-400 hover:text-indigo-300 transition-colors" title="Order details"><ExternalLink size={11} /></a>
                    ) : row.listing_url ? (
                      <a href={row.listing_url} target="_blank" rel="noopener noreferrer" className="inline-flex text-indigo-400 hover:text-indigo-300 transition-colors" title="eBay listing"><ExternalLink size={11} /></a>
                    ) : ''}
                  </td>
                  <td className="px-3 py-1 text-right text-zinc-400">{fmt(row.raw_cost)}</td>
                  <td className="px-3 py-1 text-right text-zinc-300">{fmt(row.strike_price)}</td>
                  <td className="px-3 py-1 text-right text-zinc-300">{fmt(row.after_ebay)}</td>
                  <td className="px-3 py-1 text-right"><NetCell afterEbay={row.after_ebay} raw={row.raw_cost} /></td>
                  <td className="px-3 py-1 text-zinc-500">{fmtDate(row.raw_purchase_date)}</td>
                  <td className="px-3 py-1 text-zinc-500">{fmtDate(row.date_listed)}</td>
                  <td className="px-3 py-1 text-zinc-500">{fmtDate(row.date_sold)}</td>
                  <td className="px-3 py-1 text-right"><RoiCell roi={row.roi_pct} afterEbay={row.after_ebay} raw={row.raw_cost} /></td>
                  <td className="px-3 py-1 text-zinc-500 truncate" title={row.notes ?? ''}>{row.notes ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedRow && (
        <CardDetailModal
          cardId={selectedRow.id}
          onClose={() => setSelectedRow(null)}
          onDelete={() => { setSelectedRow(null); qc.invalidateQueries({ queryKey: ['raw-overall'] }); }}
        />
      )}
      {selectedId && (
        <CardDetailModal
          cardId={selectedId}
          onClose={() => setSelectedId(null)}
          onDelete={() => { setSelectedId(null); qc.invalidateQueries({ queryKey: ['raw-inventory-grouped'] }); }}
        />
      )}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Card">
        <AddCardForm onSuccess={() => { setAddOpen(false); qc.invalidateQueries({ queryKey: ['raw-overall', 'raw-inventory-grouped'] }); }} />
      </Modal>

      {!isSummary && data && (
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
