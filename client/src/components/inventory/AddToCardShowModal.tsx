import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Check, ArrowRight } from 'lucide-react';
import { api, type PaginatedResult } from '../../lib/api';
import { formatCurrency, cn } from '../../lib/utils';
import { Button } from '../ui/Button';

interface SlabOption {
  id: string;
  card_name: string | null;
  cert_number: string | null;
  grade_label: string | null;
  company: string;
  is_listed: boolean;
  listed_price: number | null;
  card_show_price: number | null;
  raw_cost: number;
}

interface RawOption {
  id: string;
  card_name: string | null;
  set_name: string | null;
  condition: string | null;
  quantity: number;
  purchase_cost: number | null;
  card_show_price: number | null;
  raw_purchase_label: string | null;
}

interface SelectedCard {
  id: string;
  card_name: string | null;
  label: string;
  listed_price: number | null;
  card_show_price_input: string;
  _type: 'graded' | 'raw';
}

function toCents(val: string): number {
  return Math.round(parseFloat(val) * 100);
}

export function AddToCardShowModal({ onSuccess }: { onSuccess: () => void }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<'select' | 'price'>('select');
  const [tab, setTab] = useState<'graded' | 'raw'>('graded');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selected, setSelected] = useState<Map<string, SelectedCard>>(new Map());

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const handleSearch = useCallback((val: string) => {
    setSearch(val);
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => setDebouncedSearch(val), 300);
  }, []);

  const { data, isLoading } = useQuery<PaginatedResult<SlabOption>>({
    queryKey: ['slab-card-show-picker', debouncedSearch],
    queryFn: () => api.get('/grading/slabs', {
      params: { status: 'unsold', is_card_show: 'no', personal_collection: 'no', search: debouncedSearch || undefined, limit: 50, page: 1 },
    }).then((r) => r.data),
    enabled: tab === 'graded',
  });

  const { data: rawData, isLoading: isRawLoading } = useQuery<PaginatedResult<RawOption>>({
    queryKey: ['raw-card-show-picker', debouncedSearch],
    queryFn: () => api.get('/cards', {
      params: {
        is_card_show: 'no',
        is_personal_collection: 'no',
        status: 'raw_for_sale',
        search: debouncedSearch || undefined,
        limit: 50,
        page: 1,
      },
    }).then((r) => r.data),
    enabled: tab === 'raw',
  });

  const rows = data?.data ?? [];
  const rawRows = rawData?.data ?? [];

  function toggleGradedRow(row: SlabOption) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(row.id)) {
        next.delete(row.id);
      } else {
        next.set(row.id, {
          id: row.id,
          card_name: row.card_name,
          label: `${row.grade_label ?? ''} · ${row.company} · #${row.cert_number}`,
          listed_price: row.listed_price,
          card_show_price_input: row.listed_price ? (row.listed_price / 100).toFixed(2) : '',
          _type: 'graded',
        });
      }
      return next;
    });
  }

  function toggleRawRow(row: RawOption) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(row.id)) {
        next.delete(row.id);
      } else {
        next.set(row.id, {
          id: row.id,
          card_name: row.card_name,
          label: `${row.condition ?? 'Raw'}${row.raw_purchase_label ? ` · ${row.raw_purchase_label}` : ''}`,
          listed_price: null,
          card_show_price_input: '',
          _type: 'raw',
        });
      }
      return next;
    });
  }

  function updatePrice(id: string, val: string) {
    setSelected((prev) => {
      const next = new Map(prev);
      const card = next.get(id);
      if (card) next.set(id, { ...card, card_show_price_input: val });
      return next;
    });
  }

  const mutation = useMutation({
    mutationFn: () => {
      const cards = Array.from(selected.values()).map((c) => ({
        id: c.id,
        card_show_price: toCents(c.card_show_price_input),
      }));
      return api.post('/card-shows/add-inventory', { cards });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['overall'] });
      qc.invalidateQueries({ queryKey: ['stale-card-show'] });
      onSuccess();
    },
  });

  const selectedList = Array.from(selected.values());
  const allValid = selectedList.length > 0 && selectedList.every((c) => {
    const n = parseFloat(c.card_show_price_input);
    return !isNaN(n) && n >= 0;
  });

  if (step === 'price') {
    return (
      <div className="flex flex-col gap-5">
        <p className="text-sm text-zinc-400">Enter the card show asking price for each card. Strike price will record the actual sale price when sold.</p>

        <div className="rounded-xl border border-zinc-700 overflow-hidden">
          <div className="grid grid-cols-[1fr_8rem_10rem_2.5rem] gap-x-4 px-4 py-3 bg-zinc-800/60 border-b border-zinc-700">
            <span className="text-xs text-zinc-400 uppercase tracking-widest font-medium">Card</span>
            <span className="text-xs text-zinc-400 uppercase tracking-widest font-medium text-right">eBay Price</span>
            <span className="text-xs text-zinc-400 uppercase tracking-widest font-medium text-right">CS Price</span>
            <span />
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {selectedList.map((card) => (
              <div key={card.id} className="grid grid-cols-[1fr_8rem_10rem_2.5rem] gap-x-4 px-4 py-3.5 border-b border-zinc-800/60 last:border-0 items-center">
                <div className="min-w-0">
                  <p className="text-sm text-zinc-100 truncate font-medium">{card.card_name ?? '—'}</p>
                  <p className="text-xs text-zinc-500 mt-0.5">{card.label}</p>
                </div>
                <span className="text-sm text-zinc-400 text-right block">
                  {card.listed_price ? formatCurrency(card.listed_price) : '—'}
                </span>
                <div className="flex items-center justify-end">
                  <span className="text-sm text-zinc-500 mr-1.5">$</span>
                  <input
                    type="number" min="0" step="0.01"
                    value={card.card_show_price_input}
                    onChange={(e) => updatePrice(card.id, e.target.value)}
                    className="w-24 px-2.5 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 text-right focus:outline-none focus:border-indigo-500"
                    placeholder="0.00"
                  />
                </div>
                <button onClick={() => setSelected((prev) => { const next = new Map(prev); next.delete(card.id); return next; })}
                  className="text-sm text-zinc-600 hover:text-red-400 transition-colors px-1">✕</button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <button onClick={() => setStep('select')} className="text-sm text-indigo-400 hover:text-indigo-300">← Back</button>
          <Button onClick={() => mutation.mutate()} disabled={!allValid || mutation.isPending}>
            {mutation.isPending ? 'Adding…' : `Add ${selectedList.length} to Card Show`}
          </Button>
        </div>
        {mutation.isError && <p className="text-sm text-red-400">Something went wrong. Please try again.</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Graded / Raw tabs */}
      <div className="flex gap-1 border-b border-zinc-800 pb-2">
        {(['graded', 'raw'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`px-3 py-1 text-xs rounded-md font-medium capitalize transition-colors ${tab === t ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder={tab === 'graded' ? 'Search by card name or cert…' : 'Search by card name…'}
          className="w-full pl-10 pr-4 py-2.5 text-sm bg-zinc-800 border border-zinc-700 rounded-xl text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
          autoFocus
        />
      </div>

      {tab === 'graded' ? (
        <div className="rounded-xl border border-zinc-700 overflow-hidden">
          <div className="grid grid-cols-[2.5rem_1fr_10rem_6rem] gap-x-4 px-4 py-3 bg-zinc-800/60 border-b border-zinc-700">
            <span />
            <span className="text-xs text-zinc-400 uppercase tracking-widest font-medium">Card</span>
            <span className="text-xs text-zinc-400 uppercase tracking-widest font-medium text-right">Grade</span>
            <span className="text-xs text-zinc-400 uppercase tracking-widest font-medium text-right">eBay</span>
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {isLoading ? (
              <p className="px-4 py-8 text-center text-sm text-zinc-500">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-zinc-500">No unsold graded cards available.</p>
            ) : rows.map((row) => {
              const isChecked = selected.has(row.id);
              return (
                <div key={row.id} onClick={() => toggleGradedRow(row)}
                  className={cn('grid grid-cols-[2.5rem_1fr_10rem_6rem] gap-x-4 px-4 py-3.5 border-b border-zinc-800/60 last:border-0 items-center cursor-pointer transition-colors', isChecked ? 'bg-indigo-600/10' : 'hover:bg-zinc-800/40')}>
                  <div className={cn('w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors', isChecked ? 'bg-indigo-600 border-indigo-600' : 'border-zinc-600')}>
                    {isChecked && <Check size={12} className="text-white" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-100 truncate font-medium">{row.card_name ?? '—'}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">#{row.cert_number} · {row.company}</p>
                  </div>
                  <span className="text-sm text-zinc-400 text-right">{row.grade_label ?? '—'}</span>
                  <span className={cn('text-xs font-medium text-right', row.is_listed ? 'text-emerald-400' : 'text-zinc-600')}>
                    {row.is_listed ? 'Listed' : 'Not listed'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-700 overflow-hidden">
          <div className="grid grid-cols-[2.5rem_1fr_8rem_6rem] gap-x-4 px-4 py-3 bg-zinc-800/60 border-b border-zinc-700">
            <span />
            <span className="text-xs text-zinc-400 uppercase tracking-widest font-medium">Card</span>
            <span className="text-xs text-zinc-400 uppercase tracking-widest font-medium text-right">Condition</span>
            <span className="text-xs text-zinc-400 uppercase tracking-widest font-medium text-right">Cost</span>
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {isRawLoading ? (
              <p className="px-4 py-8 text-center text-sm text-zinc-500">Loading…</p>
            ) : rawRows.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-zinc-500">No raw cards designated for sale.</p>
            ) : rawRows.map((row) => {
              const isChecked = selected.has(row.id);
              return (
                <div key={row.id} onClick={() => toggleRawRow(row)}
                  className={cn('grid grid-cols-[2.5rem_1fr_8rem_6rem] gap-x-4 px-4 py-3.5 border-b border-zinc-800/60 last:border-0 items-center cursor-pointer transition-colors', isChecked ? 'bg-indigo-600/10' : 'hover:bg-zinc-800/40')}>
                  <div className={cn('w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors', isChecked ? 'bg-indigo-600 border-indigo-600' : 'border-zinc-600')}>
                    {isChecked && <Check size={12} className="text-white" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-100 truncate font-medium">{row.card_name ?? '—'}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{row.set_name ?? ''}{row.raw_purchase_label ? ` · ${row.raw_purchase_label}` : ''}</p>
                  </div>
                  <span className="text-sm text-zinc-400 text-right">{row.condition ?? '—'}</span>
                  <span className="text-xs text-zinc-500 text-right">{row.purchase_cost ? formatCurrency(row.purchase_cost) : '—'}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <span className="text-sm text-zinc-400">
          {selected.size > 0 ? `${selected.size} selected` : 'Select cards to add'}
        </span>
        <Button onClick={() => setStep('price')} disabled={selected.size === 0}>
          Set Prices <ArrowRight size={15} />
        </Button>
      </div>
    </div>
  );
}
