import React, { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid, Scatter,
} from 'recharts';
import { X, TrendingUp } from 'lucide-react';
import { api } from '../lib/api';
import { formatCurrency, cn } from '../lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CatalogResult {
  catalog_id: string;
  card_name: string;
  set_name: string;
  card_number: string | null;
  sku: string | null;
}

interface SalePoint {
  id: string;
  sold_at: string;
  sale_price: number;
  net_proceeds: number;
  total_cost_basis: number;
  platform: string;
  is_graded: boolean;
  grade: number | null;
  grade_label: string | null;
  company: string | null;
  condition: string | null;
}

interface CostPoint {
  id: string;
  purchased_at: string;
  purchase_cost: number;
  quantity: number;
  is_graded: boolean;
  grade: number | null;
  grade_label: string | null;
  company: string | null;
  condition: string | null;
}

interface TrendData {
  sales: SalePoint[];
  costs: CostPoint[];
}

type PriceView = 'sale_price' | 'net_proceeds' | 'cost_basis';

// ── Helpers ───────────────────────────────────────────────────────────────────

function seriesKey(point: { is_graded: boolean; grade_label: string | null; company: string | null; condition: string | null }): string {
  if (point.is_graded) {
    const label = point.grade_label ?? (point.grade != null ? String(point.grade) : '?');
    return `${point.company ?? 'Graded'} ${label}`;
  }
  return `Raw${point.condition ? ` (${point.condition})` : ''}`;
}

const SERIES_COLORS = [
  '#6366f1', '#f59e0b', '#22c55e', '#ef4444', '#14b8a6',
  '#a855f7', '#3b82f6', '#f97316', '#ec4899', '#84cc16',
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}

function linearRegression(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (points.length < 2) return [];
  const n = points.length;
  const sumX = points.reduce((a, p) => a + p.x, 0);
  const sumY = points.reduce((a, p) => a + p.y, 0);
  const sumXY = points.reduce((a, p) => a + p.x * p.y, 0);
  const sumX2 = points.reduce((a, p) => a + p.x * p.x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return [];
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const xs = points.map((p) => p.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  return [
    { x: minX, y: slope * minX + intercept },
    { x: maxX, y: slope * maxX + intercept },
  ];
}

// ── Search box ────────────────────────────────────────────────────────────────

function CatalogSearch({ onSelect }: { onSelect: (card: CatalogResult) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data } = useQuery<{ data: CatalogResult[] }>({
    queryKey: ['card-trend-search', q],
    queryFn: () => api.get('/reports/card-trend-search', { params: { q } }).then((r) => r.data),
    enabled: q.length >= 2,
  });

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const results = data?.data ?? [];

  return (
    <div ref={ref} className="relative w-full">
      <input
        type="text"
        placeholder="Search by part number or card name…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        className="w-full text-sm bg-zinc-800/60 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 focus:bg-zinc-800 transition-colors"
      />
      {open && results.length > 0 && (
        <div className="absolute z-50 top-full mt-1 w-full border border-zinc-700 rounded-xl bg-zinc-900 shadow-xl overflow-hidden">
          {results.map((r) => (
            <button
              key={r.catalog_id}
              onMouseDown={() => { onSelect(r); setQ(''); setOpen(false); }}
              className="w-full text-left px-4 py-3 hover:bg-zinc-800 transition-colors border-b border-zinc-800 last:border-0"
            >
              <p className="text-sm text-zinc-200 font-medium">{r.card_name}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{r.sku ?? '—'} &nbsp;·&nbsp; {r.set_name}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Chart ─────────────────────────────────────────────────────────────────────

function TrendChart({ data, view, showTrendLine }: { data: TrendData; view: PriceView; showTrendLine: boolean }) {
  const { sales, costs } = data;

  const allSeries = new Set<string>();
  sales.forEach((s) => allSeries.add(seriesKey(s)));

  const seriesArr = Array.from(allSeries).sort();
  const colorMap: Record<string, string> = {};
  seriesArr.forEach((s, i) => { colorMap[s] = SERIES_COLORS[i % SERIES_COLORS.length]; });

  const chartPoints: Array<Record<string, unknown>> = sales.map((s) => ({
    date: new Date(s.sold_at).getTime(),
    series: seriesKey(s),
    value: view === 'sale_price' ? s.sale_price / 100
      : view === 'net_proceeds' ? s.net_proceeds / 100
      : s.total_cost_basis / 100,
  }));

  const costPoints = view === 'cost_basis'
    ? costs.map((c) => ({
        date: new Date(c.purchased_at).getTime(),
        series: `Cost: ${seriesKey(c)}`,
        value: c.purchase_cost / 100 / (c.quantity || 1),
      }))
    : [];

  const allPoints = [...chartPoints, ...costPoints];

  if (!allPoints.length) {
    return <div className="flex items-center justify-center h-64 text-zinc-600 text-sm">No data for this view.</div>;
  }

  const bySeries: Record<string, Array<{ x: number; y: number }>> = {};
  allPoints.forEach((p) => {
    const s = p.series as string;
    if (!bySeries[s]) bySeries[s] = [];
    bySeries[s].push({ x: p.date as number, y: p.value as number });
  });

  // Compute overall trend line across all sale points (excluding cost series)
  const allSalePoints = chartPoints.map((p) => ({ x: p.date as number, y: p.value as number }));
  const trendData = showTrendLine ? linearRegression(allSalePoints) : [];

  const allSeriesKeys = Object.keys(bySeries);

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
        <XAxis
          dataKey="x"
          type="number"
          domain={['auto', 'auto']}
          scale="time"
          tickFormatter={(v) => new Date(v).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
          tick={{ fill: '#71717a', fontSize: 11 }}
          axisLine={{ stroke: '#3f3f46' }}
          tickLine={false}
        />
        <YAxis
          dataKey="y"
          tickFormatter={(v) => `$${v}`}
          tick={{ fill: '#71717a', fontSize: 11 }}
          axisLine={{ stroke: '#3f3f46' }}
          tickLine={false}
          width={60}
        />
        <Tooltip
          cursor={{ strokeDasharray: '3 3', stroke: '#52525b' }}
          contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 12 }}
          formatter={(value: number) => [formatCurrency(Math.round(value * 100)), '']}
          labelFormatter={(label) => formatDate(new Date(label).toISOString())}
        />
        <Legend
          iconType="circle"
          iconSize={7}
          formatter={(v) => <span className="text-zinc-400 text-[11px]">{v}</span>}
        />
        {allSeriesKeys.map((s, i) => (
          <Scatter
            key={s}
            name={s}
            data={bySeries[s]}
            fill={s.startsWith('Cost:') ? '#52525b' : (colorMap[s] ?? SERIES_COLORS[i % SERIES_COLORS.length])}
          />
        ))}
        {showTrendLine && trendData.length === 2 && (
          <Line
            data={trendData}
            dataKey="y"
            dot={false}
            activeDot={false}
            stroke="#6366f1"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            name="Trend"
            legendType="none"
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Stats summary ─────────────────────────────────────────────────────────────

function StatBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">{label}</p>
      {children}
    </div>
  );
}

function TrendStats({ data, view }: { data: TrendData; view: PriceView }) {
  const { sales } = data;
  if (!sales.length) return null;

  const valueOf = (s: SalePoint) =>
    view === 'sale_price' ? s.sale_price
    : view === 'net_proceeds' ? s.net_proceeds
    : s.total_cost_basis;

  // Channel breakdown — fixed order
  const CHANNEL_ORDER = ['eBay', 'Card Show', 'Other'] as const;
  const channels: Record<string, { count: number; total: number }> = {};
  sales.forEach((s) => {
    const ch = s.platform === 'ebay' ? 'eBay' : s.platform === 'card_show' ? 'Card Show' : 'Other';
    if (!channels[ch]) channels[ch] = { count: 0, total: 0 };
    channels[ch].count++;
    channels[ch].total += valueOf(s);
  });

  // Grade/condition breakdown
  const grades: Record<string, { count: number; total: number }> = {};
  sales.forEach((s) => {
    const key = seriesKey(s);
    if (!grades[key]) grades[key] = { count: 0, total: 0 };
    grades[key].count++;
    grades[key].total += valueOf(s);
  });
  const gradeEntries = Object.entries(grades).sort((a, b) => a[0].localeCompare(b[0]));

  // Price change
  const sorted = [...sales].sort((a, b) => new Date(a.sold_at).getTime() - new Date(b.sold_at).getTime());
  const first = valueOf(sorted[0]);
  const last  = valueOf(sorted[sorted.length - 1]);
  const pctChange = first > 0 ? ((last - first) / first) * 100 : null;

  // Overall avg + range
  const total = sales.reduce((s, p) => s + valueOf(p), 0);
  const avg = total / sales.length;
  const values = sales.map(valueOf);

  return (
    <div className="mt-4 pt-4 border-t border-zinc-800 space-y-4">
      {/* Row 1: channel + summary stats */}
      <div className="flex items-start gap-0 divide-x divide-zinc-800">
        {/* By channel */}
        <div className="pr-6">
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">By Channel</p>
          <div className="flex gap-5">
            {CHANNEL_ORDER.filter((ch) => channels[ch]).map((ch) => (
              <div key={ch}>
                <p className="text-[10px] text-zinc-500">{ch}</p>
                <p className="text-sm font-semibold text-zinc-200">{channels[ch].count} <span className="text-zinc-500 font-normal text-xs">sales</span></p>
                <p className="text-xs text-zinc-400">avg {formatCurrency(Math.round(channels[ch].total / channels[ch].count))}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Summary */}
        <div className="pl-6 flex gap-6">
          <StatBlock label="Overall Avg">
            <p className="text-sm font-semibold text-zinc-200">{formatCurrency(Math.round(avg))}</p>
            <p className="text-xs text-zinc-500">{sales.length} total sales</p>
          </StatBlock>

          {pctChange !== null && sorted.length >= 2 && (
            <StatBlock label="Price Change">
              <p className={cn('text-sm font-semibold', pctChange >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                {pctChange >= 0 ? '+' : ''}{pctChange.toFixed(1)}%
              </p>
              <p className="text-xs text-zinc-500">first → last sale</p>
            </StatBlock>
          )}

          <StatBlock label="Range">
            <p className="text-sm text-zinc-300">
              {formatCurrency(Math.round(Math.min(...values)))}
              <span className="text-zinc-600 mx-1">→</span>
              {formatCurrency(Math.round(Math.max(...values)))}
            </p>
            <p className="text-xs text-zinc-500">low / high</p>
          </StatBlock>
        </div>
      </div>

      {/* Row 2: by grade/condition */}
      {gradeEntries.length > 1 && (
        <div className="pt-3 border-t border-zinc-800/60">
          <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-2">By Grade / Condition</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {gradeEntries.map(([key, { count, total }]) => (
              <div key={key} className="flex items-baseline gap-2">
                <span className="text-xs text-zinc-300 font-medium">{key}</span>
                <span className="text-xs text-zinc-500">{count} sales</span>
                <span className="text-xs text-zinc-400">avg {formatCurrency(Math.round(total / count))}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Modal content ─────────────────────────────────────────────────────────────

import { Modal } from './ui/Modal';

function CardTrendContent() {
  const [selected, setSelected] = useState<CatalogResult | null>(null);
  const [view, setView] = useState<PriceView>('sale_price');
  const [showTrendLine, setShowTrendLine] = useState(false);

  const { data, isLoading } = useQuery<TrendData>({
    queryKey: ['card-trend', selected?.catalog_id],
    queryFn: () => api.get('/reports/card-trend', { params: { catalog_id: selected!.catalog_id } }).then((r) => r.data),
    enabled: !!selected,
  });

  return (
    <div>
      {/* Search */}
      <CatalogSearch onSelect={(c) => { setSelected(c); setView('sale_price'); }} />

      {/* Selected card header + controls */}
      {selected && (
        <div className="flex items-center justify-between mt-4 mb-1">
          <div>
            <p className="text-sm font-semibold text-zinc-200">{selected.card_name}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{selected.sku ?? '—'} · {selected.set_name}</p>
          </div>
          <div className="flex items-center gap-3">
            {/* Trend line toggle */}
            <button
              onClick={() => setShowTrendLine((v) => !v)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors border',
                showTrendLine
                  ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300'
                  : 'border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
              )}
            >
              <TrendingUp size={12} />
              Trend Line
            </button>
            {/* View toggles */}
            <div className="flex gap-1 bg-zinc-800 rounded-lg p-1">
              {([
                { key: 'sale_price',   label: 'Sale Price' },
                { key: 'net_proceeds', label: 'Net Proceeds' },
                { key: 'cost_basis',   label: 'Cost' },
              ] as { key: PriceView; label: string }[]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setView(key)}
                  className={cn(
                    'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                    view === key ? 'bg-indigo-600 text-white shadow' : 'text-zinc-400 hover:text-zinc-200'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {!selected ? (
        <div className="flex flex-col items-center justify-center h-52 gap-2 text-zinc-600">
          <TrendingUp size={28} className="opacity-30" />
          <p className="text-sm">Search for a card to view its price history.</p>
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center h-52 text-zinc-600 text-sm">Loading…</div>
      ) : !data ? null : (
        <>
          <TrendChart data={data} view={view} showTrendLine={showTrendLine} />
          <TrendStats data={data} view={view} />
        </>
      )}
    </div>
  );
}

export function CardTrendModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Card Trend" className="max-w-4xl">
      <CardTrendContent />
    </Modal>
  );
}
