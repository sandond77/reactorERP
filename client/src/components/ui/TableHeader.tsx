import { useState, useRef, useEffect } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown, ListFilter, X } from 'lucide-react';

// ─── ColumnFilter ─────────────────────────────────────────────────────────────
// null  = Select All active (default, no filter)
// []    = explicitly cleared (nothing checked)
// [...] = specific items selected (filter active)

interface ColumnFilterProps {
  options: string[];
  selected: string[] | null;
  onChange: (vals: string[] | null) => void;
  align?: 'left' | 'right';
  dateValue?: string;
  onDateChange?: (date: string) => void;
}

export function ColumnFilter({ options, selected, onChange, align = 'left', dateValue, onDateChange }: ColumnFilterProps) {
  const [open, setOpen] = useState(false);
  const [filterSearch, setFilterSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Active = some (not null/all, not empty) items are selected
  const active = selected !== null && selected.length > 0 && selected.length < options.length;
  // Select All is checked when null (default) or all explicitly selected
  const allChecked = selected === null || selected.length === options.length;

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !e.composedPath().includes(ref.current as EventTarget)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const visible = options.filter((o) => o.toLowerCase().includes(filterSearch.toLowerCase()));

  function toggleAll() {
    // null → [] (deselect all);  [] or [...all] → null (select all)
    onChange(selected === null ? [] : null);
  }

  function toggle(val: string) {
    // null means all are implicitly selected — expand to full list first
    const base = selected === null ? [...options] : selected;
    const next = base.includes(val) ? base.filter((v) => v !== val) : [...base, val];
    // If all options are checked, collapse back to null (Select All state)
    onChange(next.length === options.length ? null : next);
  }

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className={`p-0.5 rounded transition-colors ${active ? 'text-indigo-400' : 'text-zinc-400 hover:text-zinc-200'}`}
        title="Filter"
      >
        <ListFilter size={11} />
      </button>

      {open && (
        <div className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full mt-1 z-50 w-max min-w-[14rem] max-w-[44rem] bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl`}>
          {onDateChange && (
            <div className="px-3 pt-3 pb-2 border-b border-zinc-800">
              <label className="block text-[10px] text-zinc-500 mb-1 uppercase tracking-wide">Exact date</label>
              <input
                type="date"
                value={dateValue ?? ''}
                onChange={(e) => {
                  const v = e.target.value;
                  // Only fire when complete (YYYY-MM-DD = 10 chars) or cleared
                  if (v === '' || v.length === 10) onDateChange(v);
                }}
                className="w-full px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:border-indigo-500 [color-scheme:dark]"
              />
            </div>
          )}
          {options.length > 8 && (
            <div className="px-3 pt-3 pb-1">
              <input
                autoFocus
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                placeholder="Search…"
                className="w-full px-3 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder:text-zinc-500 focus:outline-none"
              />
            </div>
          )}
          <div className="p-1.5 max-h-60 overflow-y-auto">
            <label className="flex items-center gap-2.5 px-3 py-1.5 rounded hover:bg-zinc-800 cursor-pointer text-xs text-zinc-400">
              <input type="checkbox" checked={allChecked} onChange={toggleAll} className="accent-indigo-500 shrink-0" />
              (Select All)
            </label>
            {visible.map((opt) => (
              <label key={opt} className="flex items-center gap-2.5 px-3 py-1.5 rounded hover:bg-zinc-800 cursor-pointer text-xs text-zinc-300">
                <input
                  type="checkbox"
                  checked={selected === null || selected.includes(opt)}
                  onChange={() => toggle(opt)}
                  className="accent-indigo-500 shrink-0"
                />
                {opt}
              </label>
            ))}
          </div>
          {active && (
            <div className="border-t border-zinc-800 px-3 py-2">
              <button onClick={() => onChange(null)} className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
                <X size={10} /> Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── colMinWidth ──────────────────────────────────────────────────────────────
// Computes minimum column width needed to fit label + sort/filter icons + padding.
// Uses approximate char widths for uppercase text-xs font-medium with tracking-wide.

// eslint-disable-next-line react-refresh/only-export-components
export function colMinWidth(label: string, hasSort: boolean, hasFilter: boolean): number {
  let textW = 0;
  for (const c of label.toUpperCase()) {
    if (c === 'M' || c === 'W') textW += 10;
    else if (c === 'I' || c === 'J' || c === 'L') textW += 6;
    else if (c === ' ') textW += 4;
    else textW += 8;
  }
  textW += label.length * 0.6; // tracking-wide ≈ 0.05em at 12px
  const padding = 32;           // px-4 on both sides (16px × 2)
  const sortW   = hasSort   ? 4 + 11 : 0; // gap-1 + icon
  const filterW = hasFilter ? 4 + 15 : 0; // gap-1 + p-0.5×2 + icon
  return Math.ceil(padding + textW + sortW + filterW);
}

// ─── ColHeader ────────────────────────────────────────────────────────────────

export interface ColHeaderProps {
  label: string;
  col?: string;
  sortCol: string | null;
  sortDir: 'asc' | 'desc';
  onSort: (col: string) => void;
  filterOptions?: string[];
  filterSelected?: string[] | null;
  onFilterChange?: (vals: string[] | null) => void;
  filterAlign?: 'left' | 'right';
  filterDateValue?: string;
  onFilterDateChange?: (date: string) => void;
  align?: 'left' | 'right' | 'center';
  wrap?: boolean;
  className?: string;
  width?: number;
  minWidth?: number;
  onWidthChange?: (newWidth: number) => void;
}

export function ColHeader({
  label, col, sortCol, sortDir, onSort,
  filterOptions, filterSelected, onFilterChange, filterAlign = 'left',
  filterDateValue, onFilterDateChange,
  align = 'left', wrap = false, className = '', width, minWidth = 40, onWidthChange,
}: ColHeaderProps) {
  const isActive = col && sortCol === col;
  const SortBtn = col ? (
    <button onClick={() => onSort(col)} className="hover:text-white transition-colors shrink-0">
      {isActive
        ? (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)
        : <ChevronsUpDown size={11} className="opacity-50" />}
    </button>
  ) : null;

  const filterActive = (filterDateValue ?? '') !== '' || (filterSelected !== null && (filterSelected?.length ?? 0) > 0 && (filterSelected?.length ?? 0) < (filterOptions?.length ?? 0));
  const FilterBtn = (filterOptions?.length && onFilterChange) || onFilterDateChange
    ? <span className="shrink-0"><ColumnFilter options={filterOptions ?? []} selected={filterSelected ?? null} onChange={onFilterChange ?? (() => {})} align={filterAlign} dateValue={filterDateValue} onDateChange={onFilterDateChange} /></span>
    : null;

  const labelActive = filterActive;

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = width ?? 100;
    function onMove(ev: PointerEvent) { onWidthChange!(Math.max(minWidth, startWidth + (ev.clientX - startX))); }
    function onUp() { el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); }
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  }

  return (
    <th
      className={`px-4 py-2 font-medium relative select-none ${wrap ? 'whitespace-normal leading-tight' : ''} ${className}`}
      style={width ? { width: `${width}px` } : undefined}
    >
      <div className={`flex items-center gap-2 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : ''}`}>
        <span className={`${wrap ? 'min-w-0 whitespace-normal leading-tight' : ''} ${labelActive ? 'text-indigo-400' : ''}`}>{label}</span>
        {SortBtn}
        {FilterBtn}
      </div>
      {onWidthChange && (
        <div
          onPointerDown={handlePointerDown}
          className="absolute top-0 h-full w-4 cursor-col-resize group flex items-center justify-center"
          style={{ right: '-8px' }}
        >
          <div className="h-full w-0.5 group-hover:bg-indigo-500/70 group-active:bg-indigo-500" />
        </div>
      )}
    </th>
  );
}

// ─── useColWidths hook ────────────────────────────────────────────────────────

// eslint-disable-next-line react-refresh/only-export-components
export function useColWidths(defaults: Record<string, number>) {
  const [colWidths, setColWidths] = useState<Record<string, number>>(defaults);

  function rz(col: string) {
    return {
      width: colWidths[col],
      onWidthChange: (w: number) => setColWidths(prev => ({ ...prev, [col]: w })),
    };
  }

  const totalWidth = Object.values(colWidths).reduce((a, b) => a + b, 0);

  return { rz, totalWidth };
}
