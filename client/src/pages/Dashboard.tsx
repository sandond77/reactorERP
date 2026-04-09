import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  Tooltip, Legend, ResponsiveContainer, LabelList,
} from 'recharts';
import { Package, TrendingUp, Star, DollarSign, AlertTriangle, BellOff, EyeOff, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Card } from '../components/ui/Card';
import { formatCurrency, cn } from '../lib/utils';

// ── Color palette ────────────────────────────────────────────────────────────
const C = {
  indigo:  '#6366f1',
  amber:   '#f59e0b',
  red:     '#ef4444',
  teal:    '#14b8a6',
  blue:    '#3b82f6',
  green:   '#22c55e',
  yellow:  '#eab308',
};

// ── Types ────────────────────────────────────────────────────────────────────
interface InventoryRow { status: string; count: number; total_cost: number }
interface SalesRow { count: number; total_gross: number; total_net: number; total_cost: number; total_profit: number; total_expenses: number }
interface ChannelRow { count: number; total_profit: number }
interface ChannelBreakdown { ebay: ChannelRow; card_show: ChannelRow; other: ChannelRow }
interface SalesSummary {
  last_30_days: SalesRow;
  last_60_days: SalesRow;
  last_90_days: SalesRow;
  this_year: SalesRow;
  lifetime: SalesRow;
  by_channel: { last_30_days: ChannelBreakdown; last_60_days: ChannelBreakdown; last_90_days: ChannelBreakdown; this_year: ChannelBreakdown; lifetime: ChannelBreakdown };
  grading: { sub_count: number; card_count: number };
  cards: {
    total:     { all: number; graded: number; raw: number };
    unsold:    { all: number; graded: number; raw: number };
    sold:      { all: number; graded: number; raw: number };
    listed:    { all: number; graded: number; raw: number };
    card_show: { all: number; unsold: number };
  };
  pipeline: {
    needs_inspection:    number;
    inspected:           number;
    pending_grading_sub: number;
    grading_submitted:   number;
  };
  performance: {
    avg_hold_days:  number | null;
    listings_value: number;
    pending_orders: number;
  };
}

interface RawInventory {
  total: number;
  total_cost_cents: number;
  by_type: Array<{ type: string; count: number; cost_cents: number }>;
}
interface RawOrders {
  total: number;
  pending: number;
  received: number;
  canceled: number;
  cards_received: number;
}
interface RawPipeline {
  purchased_raw: number; inspected: number; raw_for_sale: number; grading_submitted: number;
  purchased_raw_cost: number; inspected_cost: number; raw_for_sale_cost: number; grading_submitted_cost: number;
  routed_sell_raw: number; routed_grade: number;
}
interface RawSales {
  total_sold: number;
  total_revenue_cents: number;
  total_profit_cents: number;
  avg_sale_price_cents: number;
  avg_profit_cents: number;
  avg_profit_pct: number;
  avg_fees_cents: number;
  avg_fees_pct: number;
}
interface RawTurnover {
  avg_days_raw: number | null;
  avg_days_bulk: number | null;
}
interface RawDashboard {
  inventory: RawInventory;
  orders: RawOrders;
  pipeline: RawPipeline;
  sales: RawSales;
  turnover: RawTurnover;
  by_condition: Array<{ condition: string; count: number }>;
}
interface PieEntry  { name: string; value: number; color: string }

function StatRow({ label, value, highlight }: { label: string; value: string; highlight?: 'pos' | 'neg' }) {
  return (
    <div className="flex justify-between items-center py-1 text-xs border-b border-zinc-800/60 last:border-0">
      <span className="text-zinc-400">{label}</span>
      <span className={cn('text-zinc-200', highlight === 'pos' && 'text-emerald-400 font-semibold', highlight === 'neg' && 'text-red-400 font-semibold')}>
        {value}
      </span>
    </div>
  );
}

// ── Chart sub-components ─────────────────────────────────────────────────────

function MiniDonutChart({ pieData, formatter }: { pieData: PieEntry[]; formatter: (v: number) => string }) {
  if (!pieData.length) return <div className="flex items-center justify-center h-[170px] text-zinc-600 text-xs">No data yet</div>;
  const RADIAN = Math.PI / 180;
  const renderLabel = ({ cx, cy, midAngle, outerRadius, percent, value }: {
    cx: number; cy: number; midAngle: number; outerRadius: number; percent: number; value: number;
  }) => {
    void percent;
    const r = outerRadius + 50;
    const x = cx + r * Math.cos(-midAngle * RADIAN);
    const y = cy + r * Math.sin(-midAngle * RADIAN);
    return (
      <text x={x} y={y} fill="#a1a1aa" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={13}>
        {formatter(value)}
      </text>
    );
  };
  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart margin={{ top: 20, right: 80, bottom: 20, left: 80 }}>
        <Pie data={pieData} innerRadius={60} outerRadius={90} paddingAngle={2} dataKey="value" labelLine={{ stroke: '#52525b', strokeWidth: 1 }} label={renderLabel}>
          {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
        </Pie>
        <Legend iconType="circle" iconSize={7} formatter={(v) => <span className="text-zinc-400 text-[10px]">{v}</span>} />
        <Tooltip formatter={(v: number) => [formatter(v), '']} contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ── Tab: Overview ─────────────────────────────────────────────────────────────
type SalesWindow = '30d' | '60d' | '90d' | 'this_year' | 'lifetime';
const SALES_WINDOWS: { key: SalesWindow; label: string }[] = [
  { key: '30d',       label: '30D' },
  { key: '60d',       label: '60D' },
  { key: '90d',       label: '90D' },
  { key: 'this_year', label: 'This Year' },
  { key: 'lifetime',  label: 'Lifetime' },
];

// ── Types ────────────────────────────────────────────────────────────────────

interface PendingGradingSubItem {
  id: string;
  card_name: string | null;
  set_name: string | null;
  condition: string | null;
  quantity: number;
  purchase_cost: number;
  raw_purchase_label: string | null;
}

interface ReorderAlert {
  threshold_id: string;
  catalog_id: string;
  card_name: string;
  set_name: string | null;
  sku: string | null;
  to_grade_quantity: number;
  inbound_quantity: number;
  min_quantity: number;
  is_ignored: boolean;
  muted_until: string | null;
}

interface StaleEbayListing {
  id: string;
  card_name: string | null;
  set_name: string | null;
  sku: string | null;
  card_number: string | null;
  list_price: number;
  listed_at: string | null;
  ebay_listing_url: string | null;
  days_listed: number;
  is_ignored: boolean;
  muted_until: string | null;
}

interface GradeMoreAlert {
  threshold_id: string;
  catalog_id: string;
  card_name: string;
  set_name: string | null;
  sku: string | null;
  unsold_graded: number;
  in_grading: number;
  min_quantity: number;
  is_ignored: boolean;
  muted_until: string | null;
}

interface StaleCardShowItem {
  id: string;
  card_name: string | null;
  set_name: string | null;
  sku: string | null;
  card_number: string | null;
  quantity: number;
  purchase_cost: number;
  card_show_added_at: string | null;
  days_held: number;
  is_ignored: boolean;
  muted_until: string | null;
}

// ── Order More section ────────────────────────────────────────────────────────

function OrderMoreSection() {
  const qc = useQueryClient();

  const { data: alertsData, isLoading } = useQuery<{ data: ReorderAlert[] }>({
    queryKey: ['reorder-alerts'],
    queryFn: () => api.get('/reorder/alerts').then((r) => r.data),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['reorder-alerts'] });

  const muteMutation = useMutation({
    mutationFn: (id: string) => api.post(`/reorder/thresholds/${id}/mute`),
    onSuccess: invalidate,
  });
  const ignoreMutation = useMutation({
    mutationFn: (id: string) => api.post(`/reorder/thresholds/${id}/ignore`),
    onSuccess: invalidate,
  });

  const alerts = alertsData?.data ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        {alerts.length > 0 && (
          <span className="text-[10px] font-semibold text-orange-300 bg-orange-500/20 border border-orange-500/30 px-2 py-0.5 rounded-full">
            {alerts.length} item{alerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {isLoading ? (
        <p className="text-xs text-zinc-500">Loading…</p>
      ) : alerts.length === 0 ? (
        <p className="text-xs text-zinc-600">No reorder alerts. Manage thresholds under <span className="text-zinc-500">Manage → Alerts</span>.</p>
      ) : (
        <div>
          <div className="grid grid-cols-[1fr_4rem_4rem_3.5rem_3rem_3.5rem] gap-x-3 pb-1.5 mb-1 border-b border-orange-500/20">
            <span className="text-[10px] text-orange-400/60 uppercase tracking-widest">Card</span>
            <span className="text-[10px] text-orange-400/60 uppercase tracking-widest text-right">Inbound</span>
            <span className="text-[10px] text-orange-400/60 uppercase tracking-widest text-right">To Grade</span>
            <span className="text-[10px] text-orange-400/60 uppercase tracking-widest text-right">Min</span>
            <span className="text-[10px] text-orange-400/60 uppercase tracking-widest text-center">Mute</span>
            <span className="text-[10px] text-orange-400/60 uppercase tracking-widest text-center">Ignore</span>
          </div>
          {alerts.map((alert) => (
            <div key={alert.threshold_id} className="grid grid-cols-[1fr_4rem_4rem_3.5rem_3rem_3.5rem] gap-x-3 py-1.5 border-b border-orange-500/10 last:border-0 items-center">
              <div className="min-w-0">
                <p className="text-sm text-zinc-200 truncate">{alert.card_name}</p>
                <p className="text-xs text-zinc-500 truncate">{alert.set_name ?? alert.sku ?? ''}</p>
              </div>
              <span className="text-sm text-right tabular-nums text-blue-400">
                {alert.inbound_quantity > 0 ? `+${alert.inbound_quantity}` : '—'}
              </span>
              <span className={cn('text-sm font-semibold text-right tabular-nums', alert.to_grade_quantity === 0 ? 'text-red-400' : 'text-amber-400')}>
                {alert.to_grade_quantity}
              </span>
              <span className="text-sm text-zinc-400 text-right tabular-nums">{alert.min_quantity}</span>
              <button onClick={() => muteMutation.mutate(alert.threshold_id)} title="Mute for 30 days" className="text-zinc-500 hover:text-zinc-300 transition-colors flex justify-center">
                <BellOff size={13} />
              </button>
              <button onClick={() => ignoreMutation.mutate(alert.threshold_id)} title="Ignore permanently" className="text-zinc-500 hover:text-red-400 transition-colors flex justify-center">
                <EyeOff size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Grade More section ────────────────────────────────────────────────────────

function GradeMoreSection() {
  const qc = useQueryClient();

  const { data: alertsData, isLoading } = useQuery<{ data: GradeMoreAlert[] }>({
    queryKey: ['grade-more-alerts'],
    queryFn: () => api.get('/grade-more/alerts').then((r) => r.data),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['grade-more-alerts'] });

  const muteMutation = useMutation({
    mutationFn: (id: string) => api.post(`/grade-more/${id}/mute`),
    onSuccess: invalidate,
  });
  const ignoreMutation = useMutation({
    mutationFn: (id: string) => api.post(`/grade-more/${id}/ignore`),
    onSuccess: invalidate,
  });

  const alerts = alertsData?.data ?? [];

  return (
    <div>
      {isLoading ? (
        <p className="text-xs text-zinc-500">Loading…</p>
      ) : alerts.length === 0 ? (
        <p className="text-xs text-zinc-600">No grade more alerts. Manage thresholds under <span className="text-zinc-500">Manage → Alerts</span>.</p>
      ) : (
        <div>
          <div className="grid grid-cols-[1fr_4rem_4rem_3.5rem_3rem_3.5rem] gap-x-3 pb-1.5 mb-1 border-b border-orange-500/20">
            <span className="text-[10px] text-orange-400/60 uppercase tracking-widest">Card</span>
            <span className="text-[10px] text-orange-400/60 uppercase tracking-widest text-right">Unsold</span>
            <span className="text-[10px] text-orange-400/60 uppercase tracking-widest text-right">Grading</span>
            <span className="text-[10px] text-orange-400/60 uppercase tracking-widest text-right">Min</span>
            <span className="text-[10px] text-orange-400/60 uppercase tracking-widest text-center">Mute</span>
            <span className="text-[10px] text-orange-400/60 uppercase tracking-widest text-center">Ignore</span>
          </div>
          {alerts.map((alert) => (
            <div key={alert.threshold_id} className="grid grid-cols-[1fr_4rem_4rem_3.5rem_3rem_3.5rem] gap-x-3 py-1.5 border-b border-orange-500/10 last:border-0 items-center">
              <div className="min-w-0">
                <p className="text-sm text-zinc-200 truncate">{alert.card_name}</p>
                <p className="text-xs text-zinc-500 truncate">{alert.set_name ?? alert.sku ?? ''}</p>
              </div>
              <span className={cn('text-sm font-semibold text-right tabular-nums', alert.unsold_graded === 0 ? 'text-red-400' : 'text-amber-400')}>
                {alert.unsold_graded}
              </span>
              <span className="text-sm text-blue-400 text-right tabular-nums">
                {alert.in_grading > 0 ? `+${alert.in_grading}` : '—'}
              </span>
              <span className="text-sm text-zinc-400 text-right tabular-nums">{alert.min_quantity}</span>
              <button onClick={() => muteMutation.mutate(alert.threshold_id)} title="Mute for 30 days" className="text-zinc-500 hover:text-zinc-300 transition-colors flex justify-center">
                <BellOff size={13} />
              </button>
              <button onClick={() => ignoreMutation.mutate(alert.threshold_id)} title="Ignore permanently" className="text-zinc-500 hover:text-red-400 transition-colors flex justify-center">
                <EyeOff size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Attention box (2×2 grid) ──────────────────────────────────────────────────

const STALE_DAYS = 30;

function AttentionBox({
  title, count, hasAlert, linkTo, children,
}: { title: string; count: number; hasAlert: boolean; linkTo?: string; children: React.ReactNode }) {
  return (
    <div className={cn(
      'rounded-lg border p-4 flex flex-col min-h-0',
      hasAlert ? 'border-orange-500/30 bg-orange-500/5' : 'border-zinc-800 bg-zinc-900'
    )}>
      <div className="flex items-center justify-between mb-3 shrink-0">
        <p className={cn('text-[10px] font-semibold uppercase tracking-wider', hasAlert ? 'text-orange-400' : 'text-zinc-500')}>
          {title}
        </p>
        <div className="flex items-center gap-2">
          {hasAlert && (
            <span className="text-[10px] font-semibold text-orange-300 bg-orange-500/20 border border-orange-500/30 px-2 py-0.5 rounded-full">
              {count}
            </span>
          )}
          {linkTo && (
            <Link to={linkTo} className="flex items-center gap-0.5 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors">
              View All <ArrowRight size={10} />
            </Link>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0 pr-1">
        {children}
      </div>
    </div>
  );
}

function AttentionCard() {
  const qc = useQueryClient();

  const { data: gradingData, isLoading: gradingLoading } = useQuery<{ data: PendingGradingSubItem[] }>({
    queryKey: ['pending-grading-sub'],
    queryFn: () => api.get('/reports/pending-grading-sub').then((r) => r.data),
  });
  const { data: alertsData } = useQuery<{ data: ReorderAlert[] }>({
    queryKey: ['reorder-alerts'],
    queryFn: () => api.get('/reorder/alerts').then((r) => r.data),
  });
  const { data: gradeMoreData } = useQuery<{ data: GradeMoreAlert[] }>({
    queryKey: ['grade-more-alerts'],
    queryFn: () => api.get('/grade-more/alerts').then((r) => r.data),
  });
  const { data: staleEbayData } = useQuery<{ data: StaleEbayListing[] }>({
    queryKey: ['stale-ebay-listings'],
    queryFn: () => api.get('/alerts/stale-ebay', { params: { days: STALE_DAYS } }).then((r) => r.data),
  });
  const { data: staleCardShowData } = useQuery<{ data: StaleCardShowItem[] }>({
    queryKey: ['stale-card-show'],
    queryFn: () => api.get('/alerts/stale-card-show', { params: { days: STALE_DAYS } }).then((r) => r.data),
  });

  const muteEbay = useMutation({
    mutationFn: (id: string) => api.post('/alerts/mute', { entity_type: 'ebay_listing', entity_id: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stale-ebay-listings'] }),
  });
  const ignoreEbay = useMutation({
    mutationFn: (id: string) => api.post('/alerts/ignore', { entity_type: 'ebay_listing', entity_id: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stale-ebay-listings'] }),
  });
  const muteCardShow = useMutation({
    mutationFn: (id: string) => api.post('/alerts/mute', { entity_type: 'card_show', entity_id: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stale-card-show'] }),
  });
  const ignoreCardShow = useMutation({
    mutationFn: (id: string) => api.post('/alerts/ignore', { entity_type: 'card_show', entity_id: id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stale-card-show'] }),
  });

  const gradingItems = gradingData?.data ?? [];
  const reorderAlerts = alertsData?.data ?? [];
  const gradeMoreAlerts = gradeMoreData?.data ?? [];
  const staleEbay = staleEbayData?.data ?? [];
  const staleCardShow = staleCardShowData?.data ?? [];

  const hasAny = gradingItems.length > 0 || reorderAlerts.length > 0 || gradeMoreAlerts.length > 0 || staleEbay.length > 0 || staleCardShow.length > 0;

  return (
    <div className="flex flex-col flex-1 min-h-[500px]">
      <div className="flex items-center gap-2 mb-2 shrink-0">
        <AlertTriangle size={13} className={hasAny ? 'text-orange-400' : 'text-zinc-600'} />
        <p className={cn('text-xs font-semibold uppercase tracking-wider', hasAny ? 'text-orange-300' : 'text-zinc-500')}>
          Alerts
        </p>
      </div>

      {/* Row 1: 3 equal boxes */}
      <div className="grid grid-cols-3 gap-3 flex-1 min-h-[180px]">
        <AttentionBox title="Order More" count={reorderAlerts.length} hasAlert={reorderAlerts.length > 0} linkTo="/reorder-thresholds?tab=reorder">
          <OrderMoreSection />
        </AttentionBox>

        <AttentionBox title="Grade More" count={gradeMoreAlerts.length} hasAlert={gradeMoreAlerts.length > 0} linkTo="/reorder-thresholds?tab=grade_more">
          <GradeMoreSection />
        </AttentionBox>

        <AttentionBox title="Needs Grading Submission" count={gradingItems.length} hasAlert={gradingItems.length > 0}>
          {gradingLoading ? (
            <p className="text-xs text-zinc-600">Loading…</p>
          ) : gradingItems.length === 0 ? (
            <p className="text-xs text-zinc-600">No cards pending submission.</p>
          ) : (
            <div>
              <div className="grid grid-cols-[5rem_1fr_2.5rem_4.5rem_3rem] gap-x-3 pb-2 mb-1 border-b border-orange-500/20 sticky top-0 bg-zinc-950">
                <span className="text-[10px] text-orange-400/60 uppercase tracking-widest">ID</span>
                <span className="text-[10px] text-orange-400/60 uppercase tracking-widest">Card</span>
                <span className="text-[10px] text-orange-400/60 uppercase tracking-widest text-right">Qty</span>
                <span className="text-[10px] text-orange-400/60 uppercase tracking-widest text-right">Cost</span>
                <span className="text-[10px] text-orange-400/60 uppercase tracking-widest text-right">Cond.</span>
              </div>
              {gradingItems.map((item) => (
                <div key={item.id} className="grid grid-cols-[5rem_1fr_2.5rem_4.5rem_3rem] gap-x-3 py-2 border-b border-orange-500/10 last:border-0 items-center">
                  <span className="text-xs font-mono text-orange-400/70 truncate">{item.raw_purchase_label ?? '—'}</span>
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-200 truncate">{item.card_name ?? '—'}</p>
                    {item.set_name && <p className="text-xs text-zinc-500 truncate">{item.set_name}</p>}
                  </div>
                  <span className="text-sm text-zinc-300 text-right tabular-nums">{item.quantity}</span>
                  <span className="text-sm text-zinc-300 text-right tabular-nums">{formatCurrency(item.purchase_cost)}</span>
                  <span className="text-xs text-zinc-500 text-right">{item.condition ?? '—'}</span>
                </div>
              ))}
            </div>
          )}
        </AttentionBox>
      </div>

      {/* Row 2: 2 equal boxes */}
      <div className="grid grid-cols-2 gap-3 flex-[1.5] min-h-[220px] mt-3">
        <AttentionBox title={`eBay Listings Unsold 30+ Days`} count={staleEbay.length} hasAlert={staleEbay.length > 0} linkTo="/reorder-thresholds?tab=ebay">
          {staleEbay.length === 0 ? (
            <p className="text-xs text-zinc-600">No stale listings.</p>
          ) : (
            <div>
              <div className="grid grid-cols-[0.8fr_0.8fr_3rem_3.5rem_3rem_3.5rem] gap-x-2 pb-2 mb-1 border-b border-orange-500/20 sticky top-0 bg-zinc-950">
                <span className="text-[10px] text-orange-400/60 uppercase tracking-widest">Card Name</span>
                <span className="text-[10px] text-orange-400/60 uppercase tracking-widest">Set</span>
                <span className="text-[10px] text-orange-400/60 uppercase tracking-widest text-right">Card #</span>
                <span className="text-[10px] text-orange-400/60 uppercase tracking-widest text-right">Days</span>
                <span className="text-[10px] text-orange-400/60 uppercase tracking-widest text-center">Mute</span>
                <span className="text-[10px] text-orange-400/60 uppercase tracking-widest text-center">Ignore</span>
              </div>
              {staleEbay.map((item) => (
                <div key={item.id} className="grid grid-cols-[0.8fr_0.8fr_3rem_3.5rem_3rem_3.5rem] gap-x-2 py-1.5 border-b border-orange-500/10 last:border-0 items-center">
                  <div className="min-w-0">
                    {item.ebay_listing_url ? (
                      <a href={item.ebay_listing_url} target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-400 hover:text-indigo-300 truncate block transition-colors">
                        {item.card_name ?? '—'}
                      </a>
                    ) : (
                      <p className="text-sm text-zinc-200 truncate">{item.card_name ?? '—'}</p>
                    )}
                  </div>
                  <span className="text-xs text-zinc-500 truncate">{item.set_name ?? '—'}</span>
                  <span className="text-xs text-zinc-400 text-right tabular-nums">{item.card_number ?? '—'}</span>
                  <span className="text-sm text-orange-400 text-right font-medium tabular-nums">{item.days_listed}d</span>
                  <button onClick={() => muteEbay.mutate(item.id)} title="Snooze 30 days" className="text-zinc-500 hover:text-zinc-300 transition-colors flex justify-center">
                    <BellOff size={13} />
                  </button>
                  <button onClick={() => ignoreEbay.mutate(item.id)} title="Ignore" className="text-zinc-500 hover:text-red-400 transition-colors flex justify-center">
                    <EyeOff size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </AttentionBox>

        {/* Box 4: Stale Card Show Inventory */}
        <AttentionBox title={`Card Show Inventory Unsold 30+ Days`} count={staleCardShow.length} hasAlert={staleCardShow.length > 0} linkTo="/reorder-thresholds?tab=card_show">
          {staleCardShow.length === 0 ? (
            <p className="text-xs text-zinc-600">No stale card show inventory.</p>
          ) : (
            <div>
              <div className="grid grid-cols-[0.8fr_0.8fr_3rem_2.5rem_3.5rem_3rem_3.5rem] gap-x-2 pb-2 mb-1 border-b border-orange-500/20 sticky top-0 bg-zinc-950">
                <span className="text-[10px] text-orange-400/60 uppercase tracking-widest">Card Name</span>
                <span className="text-[10px] text-orange-400/60 uppercase tracking-widest">Set</span>
                <span className="text-[10px] text-orange-400/60 uppercase tracking-widest text-right">Card #</span>
                <span className="text-[10px] text-orange-400/60 uppercase tracking-widest text-right">Qty</span>
                <span className="text-[10px] text-orange-400/60 uppercase tracking-widest text-right">Days</span>
                <span className="text-[10px] text-orange-400/60 uppercase tracking-widest text-center">Mute</span>
                <span className="text-[10px] text-orange-400/60 uppercase tracking-widest text-center">Ignore</span>
              </div>
              {staleCardShow.map((item) => (
                <div key={item.id} className="grid grid-cols-[0.8fr_0.8fr_3rem_2.5rem_3.5rem_3rem_3.5rem] gap-x-2 py-1.5 border-b border-orange-500/10 last:border-0 items-center">
                  <span className="text-sm text-zinc-200 truncate">{item.card_name ?? '—'}</span>
                  <span className="text-xs text-zinc-500 truncate">{item.set_name ?? '—'}</span>
                  <span className="text-xs text-zinc-400 text-right tabular-nums">{item.card_number ?? '—'}</span>
                  <span className="text-sm text-zinc-300 text-right tabular-nums">{item.quantity}</span>
                  <span className="text-sm text-orange-400 text-right font-medium tabular-nums">{item.days_held}d</span>
                  <button onClick={() => muteCardShow.mutate(item.id)} title="Snooze 30 days" className="text-zinc-500 hover:text-zinc-300 transition-colors flex justify-center">
                    <BellOff size={13} />
                  </button>
                  <button onClick={() => ignoreCardShow.mutate(item.id)} title="Ignore" className="text-zinc-500 hover:text-red-400 transition-colors flex justify-center">
                    <EyeOff size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </AttentionBox>
      </div>
    </div>
  );
}

function OverviewTab() {
  const { data: inventory } = useQuery<InventoryRow[]>({
    queryKey: ['inventory-value'],
    queryFn: () => api.get('/reports/inventory-value').then((r) => r.data),
  });
  const { data: summary } = useQuery<SalesSummary>({
    queryKey: ['sales-summary'],
    queryFn: () => api.get('/reports/summary').then((r) => r.data),
  });

  const [salesWindow, setSalesWindow] = useState<SalesWindow>('30d');

  const totalCost    = inventory?.reduce((s, r) => s + (r.total_cost ?? 0), 0) ?? 0;
  const grading      = summary?.grading     ?? { sub_count: 0, card_count: 0 };
  const cards        = summary?.cards       ?? { total: { all: 0, graded: 0, raw: 0 }, unsold: { all: 0, graded: 0, raw: 0 }, sold: { all: 0, graded: 0, raw: 0 }, listed: { all: 0, graded: 0, raw: 0 }, card_show: { all: 0, unsold: 0 } };
  const pipeline     = summary?.pipeline    ?? { needs_inspection: 0, inspected: 0, pending_grading_sub: 0, grading_submitted: 0 };
  const performance  = summary?.performance ?? { avg_hold_days: null, listings_value: 0, pending_orders: 0 };
  const lifetimeSales = summary?.lifetime   ?? { count: 0, total_gross: 0, total_net: 0, total_cost: 0, total_profit: 0, total_expenses: 0 };

  const sellThrough   = (cards.sold.all + cards.unsold.all) > 0
    ? ((cards.sold.all / (cards.sold.all + cards.unsold.all)) * 100).toFixed(1)
    : null;
  const avgProfitSale = lifetimeSales.count > 0
    ? lifetimeSales.total_profit / lifetimeSales.count
    : null;

  const EMPTY_ROW: SalesRow = { count: 0, total_gross: 0, total_net: 0, total_cost: 0, total_profit: 0, total_expenses: 0 };
  const windowData: SalesRow = salesWindow === '30d' ? (summary?.last_30_days ?? EMPTY_ROW)
    : salesWindow === '60d'      ? (summary?.last_60_days ?? EMPTY_ROW)
    : salesWindow === '90d'      ? (summary?.last_90_days ?? EMPTY_ROW)
    : salesWindow === 'this_year'? (summary?.this_year    ?? EMPTY_ROW)
    : lifetimeSales;

  const wk = salesWindow === '30d' ? 'last_30_days' : salesWindow === '60d' ? 'last_60_days' : salesWindow === '90d' ? 'last_90_days' : salesWindow === 'this_year' ? 'this_year' : 'lifetime';

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">

      <div className="flex flex-col gap-4 shrink-0">

        {/* Row 1: Revenue */}
        <Card>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Revenue</p>
            <div className="flex gap-1">
              {SALES_WINDOWS.map(({ key, label }) => (
                <button key={key} onClick={() => setSalesWindow(key)}
                  className={cn('px-2.5 py-0.5 rounded text-[10px] font-medium transition-colors',
                    salesWindow === key ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-zinc-300')}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {(() => {
            const netProfit = (windowData.total_profit ?? 0) - (windowData.total_expenses ?? 0);
            return (
              <div className="grid grid-cols-6 divide-x divide-zinc-800">
                {([
                  { label: 'Gross',                  value: formatCurrency(windowData.total_gross ?? 0),                              cls: 'text-zinc-100' },
                  { label: 'Cost',                   value: formatCurrency(windowData.total_cost ?? 0),                               cls: 'text-zinc-100' },
                  { label: 'Expenses',               value: formatCurrency(windowData.total_expenses ?? 0),                           cls: 'text-zinc-100' },
                  { label: 'Profit',                 value: (windowData.total_profit >= 0 ? '+' : '') + formatCurrency(windowData.total_profit), cls: windowData.total_profit >= 0 ? 'text-emerald-400' : 'text-red-400' },
                  { label: 'Net Profit (After Exp)', value: (netProfit >= 0 ? '+' : '') + formatCurrency(netProfit),                  cls: netProfit >= 0 ? 'text-emerald-400' : 'text-red-400' },
                  { label: '# of Sales',             value: String(windowData.count),                                                 cls: 'text-zinc-100' },
                ]).map(({ label, value, cls }, i) => (
                  <div key={label} className={i === 0 ? 'pr-6' : 'px-6'}>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">{label}</p>
                    <p className={cn('text-xl font-bold', cls)}>{value}</p>
                  </div>
                ))}
              </div>
            );
          })()}
        </Card>

        {/* Row 2: Inventory */}
        <Card>
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Inventory</p>
          <div className="grid grid-cols-3 divide-x divide-zinc-800">
            {([
              { label: 'Total Cards',  value: cards.total.all,  sub: `Graded ${cards.total.graded}  ·  Raw ${cards.total.raw}` },
              { label: 'Unsold Cards', value: cards.unsold.all, sub: `Graded ${cards.unsold.graded}  ·  Raw ${cards.unsold.raw}` },
              { label: 'Sold Cards',   value: cards.sold.all,   sub: `Graded ${cards.sold.graded}  ·  Raw ${cards.sold.raw}` },
            ]).map(({ label, value, sub }, i) => (
              <div key={label} className={i === 0 ? 'pr-6' : 'px-6'}>
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">{label}</p>
                <p className="text-xl font-bold text-zinc-100">{value}</p>
                <p className="text-xs text-zinc-600 mt-0.5">{sub}</p>
              </div>
            ))}
          </div>
        </Card>

        {/* Row 3: Sales by channel */}
        <div className="grid grid-cols-3 gap-4">
          {([
            { key: 'ebay',      label: 'eBay' },
            { key: 'card_show', label: 'Card Shows' },
            { key: 'other',     label: 'Other' },
          ] as { key: keyof ChannelBreakdown; label: string }[]).map(({ key, label }) => {
            const ch = summary?.by_channel?.[wk]?.[key] ?? { count: 0, total_profit: 0 };
            return (
              <Card key={key}>
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">{label}</p>
                <p className="text-xl font-bold text-zinc-100">{ch.count} <span className="text-sm font-normal text-zinc-500">sales</span></p>
                <p className={cn('text-sm font-semibold', ch.total_profit >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                  {(ch.total_profit >= 0 ? '+' : '') + formatCurrency(ch.total_profit)}
                </p>
                {key === 'ebay' && (
                  <p className="text-xs text-zinc-500 mt-0.5">{cards.listed.all} listed &nbsp;·&nbsp; {cards.listed.graded} Graded / {cards.listed.raw} Raw</p>
                )}
                {key === 'card_show' && (
                  <p className="text-xs text-zinc-500 mt-0.5">{cards.card_show.unsold} unsold &nbsp;·&nbsp; {cards.card_show.all} total inventory</p>
                )}
              </Card>
            );
          })}
        </div>

        {/* Row 4: Pipeline */}
        <Card>
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Pipeline</p>
          <div className="grid grid-cols-4 divide-x divide-zinc-800">
            <div className="pr-6">
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">Sell-Through</p>
              <p className="text-xl font-bold text-zinc-100">{sellThrough != null ? `${sellThrough}%` : '—'}</p>
              <p className="text-xs text-zinc-600 mt-0.5">sold / (sold + unsold)</p>
            </div>
            <div className="px-6">
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">Pending Orders</p>
              <p className={cn('text-xl font-bold', performance.pending_orders > 0 ? 'text-amber-400' : 'text-zinc-100')}>{performance.pending_orders}</p>
              <p className="text-xs text-zinc-600 mt-0.5">purchases ordered, not received</p>
            </div>
            <div className="px-6">
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">Needs Inspection</p>
              <p className={cn('text-xl font-bold', pipeline.needs_inspection > 0 ? 'text-amber-400' : 'text-zinc-100')}>{pipeline.needs_inspection}</p>
              <p className="text-xs text-zinc-600 mt-0.5">purchased, not yet inspected</p>
            </div>
            <div className="pl-6">
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">At Graders</p>
              <p className="text-xl font-bold text-zinc-100">{grading.card_count}</p>
              <p className="text-xs text-zinc-600 mt-0.5">{grading.sub_count} {grading.sub_count === 1 ? 'submission' : 'submissions'}</p>
            </div>
          </div>
        </Card>

      </div>{/* end shrink-0 stats block */}

      {/* Alerts — flex-1 min-h-0 always fills remaining space */}
      <AttentionCard />

    </div>
  );
}

// ── Tab: Raw Cards ────────────────────────────────────────────────────────────
type RawView = 'All' | 'Unsold' | 'Sold';
const RAW_VIEWS: RawView[] = ['All', 'Unsold', 'Sold'];

function RawCardsTab() {
  const [rawView, setRawView] = useState<RawView>('Unsold');
  const [rawType, setRawType] = useState<'both' | 'raw' | 'bulk'>('both');
  const [rawPieMode, setRawPieMode] = useState<'count' | 'value'>('count');

  const viewParam = rawView.toLowerCase();
  const { data, isLoading } = useQuery<RawDashboard>({
    queryKey: ['raw-dashboard', viewParam, rawType],
    queryFn: () => api.get(`/reports/raw-dashboard?view=${viewParam}&type=${rawType}`).then((r) => r.data),
  });

  if (isLoading || !data?.inventory) return <div className="text-zinc-500 text-sm py-8">Loading…</div>;

  const { inventory: INV, pipeline: PL, sales: S, turnover: T } = data;
  const ORD = data.orders ?? { total: 0, pending: 0, received: 0, canceled: 0, cards_received: 0 };

  const TYPE_COLORS: Record<string, string> = { raw: C.indigo, bulk: C.amber };

  const typePieCount: PieEntry[] = INV.by_type.map((r) => ({
    name: r.type.charAt(0).toUpperCase() + r.type.slice(1),
    value: r.count,
    color: TYPE_COLORS[r.type] ?? C.teal,
  }));

  const typePieValue: PieEntry[] = INV.by_type.map((r) => ({
    name: r.type.charAt(0).toUpperCase() + r.type.slice(1),
    value: r.cost_cents,
    color: TYPE_COLORS[r.type] ?? C.teal,
  }));

  const fmtPct = (n: number) => `${n.toFixed(1)}%`;
  const fmtDays = (n: number | null) => n != null ? `${n}d` : '—';

  const pipelineTotal = PL.purchased_raw + PL.inspected + PL.raw_for_sale + PL.grading_submitted;

  return (
    <div className="space-y-6">
      {/* Inventory & Pipeline header with type + view toggles */}
      <div className="border-b border-zinc-800 pb-1 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Inventory &amp; Pipeline</p>
          <div className="flex gap-1">
            {(['both', 'raw', 'bulk'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setRawType(t)}
                className={cn(
                  'w-14 py-0.5 rounded text-xs font-medium transition-colors text-center',
                  rawType === t ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
                )}
              >
                {t === 'both' ? 'Both' : t === 'raw' ? 'Raw' : 'Bulk'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-1">
          {RAW_VIEWS.map((v) => (
            <button
              key={v}
              onClick={() => setRawView(v)}
              className={cn(
                'w-14 py-0.5 rounded text-xs font-medium transition-colors text-center',
                rawView === v ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Col 1 — Inventory Value */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Inventory Value</h3>
            <div className="flex gap-1">
              {(['count', 'value'] as const).map((m) => (
                <button key={m} onClick={() => setRawPieMode(m)}
                  className={cn('px-2.5 py-0.5 rounded text-xs font-medium transition-colors',
                    rawPieMode === m ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200')}>
                  {m === 'count' ? 'Count' : 'Value'}
                </button>
              ))}
            </div>
          </div>
          <MiniDonutChart
            pieData={rawPieMode === 'count' ? typePieCount : typePieValue}
            formatter={rawPieMode === 'count' ? (v) => String(v) : formatCurrency}
          />
          <div className="mt-3 space-y-0.5">
            <StatRow label="Total Cards"     value={String(INV.total)} />
            <StatRow label="Total Cost"      value={formatCurrency(INV.total_cost_cents)} />
            {INV.by_type.map((r) => (
              <StatRow key={r.type} label={r.type.charAt(0).toUpperCase() + r.type.slice(1)} value={`${r.count} · ${formatCurrency(r.cost_cents)}`} />
            ))}
          </div>
        </Card>

        {/* Col 2 — Condition Distribution */}
        <Card>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Condition Distribution</h3>
          {data.by_condition.length === 0 ? (
            <div className="flex items-center justify-center h-[200px] text-zinc-600 text-xs">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.by_condition} margin={{ top: 16, right: 8, left: -20, bottom: 0 }}>
                <XAxis dataKey="condition" tick={{ fill: '#a1a1aa', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#a1a1aa', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 12 }}
                />
                <Bar dataKey="count" name="Cards" fill={C.indigo} radius={[4, 4, 0, 0]}>
                  <LabelList dataKey="count" position="top" style={{ fill: '#d4d4d8', fontSize: 10 }} formatter={(v: number) => v > 0 ? v : ''} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          {data.by_condition.length > 0 && (() => {
            const total = data.by_condition.reduce((s, r) => s + r.count, 0);
            return (
              <div className="mt-3">
                <div className="flex justify-between items-center py-1 text-xs text-zinc-500 border-b border-zinc-700 mb-1 pr-4">
                  <span className="flex-1">Condition</span>
                  <span className="w-10 text-right">Count</span>
                  <span className="w-10 text-right">%</span>
                </div>
                <div className="max-h-48 overflow-y-auto pr-4">
                  {data.by_condition.map((r) => (
                    <div key={r.condition} className="flex justify-between items-center py-1 text-xs border-b border-zinc-800/60 last:border-0">
                      <span className="flex-1 text-zinc-400">{r.condition}</span>
                      <span className="w-10 text-right text-zinc-200">{r.count}</span>
                      <span className="w-10 text-right text-zinc-400">{((r.count / total) * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </Card>

        {/* Col 3 — Pipeline */}
        <Card>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Pipeline</h3>
          {/* Orders section */}
          <div className="mb-3 pb-3 border-b border-zinc-800">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1.5">Orders</p>
            <div className="grid grid-cols-3 gap-1.5 mb-1.5">
              {[
                { label: 'Total', value: ORD.total },
                { label: 'Pending', value: ORD.pending },
                { label: 'Received', value: ORD.received },
              ].map(({ label, value }) => (
                <div key={label} className="bg-zinc-800/60 rounded p-1.5 text-center">
                  <p className="text-[10px] text-zinc-500">{label}</p>
                  <p className="text-sm font-semibold text-zinc-200">{value}</p>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-zinc-500">Cards received</span>
              <span className="text-zinc-300 font-medium">{ORD.cards_received}</span>
            </div>
            {ORD.canceled > 0 && (
              <div className="flex justify-between text-xs mt-0.5">
                <span className="text-zinc-500">Canceled</span>
                <span className="text-zinc-400">{ORD.canceled}</span>
              </div>
            )}
          </div>
          {/* Card stages */}
          <div className="flex items-center gap-1 mb-4">
            {[
              { label: 'Purchased', count: PL.purchased_raw,     cost: PL.purchased_raw_cost,     color: 'bg-zinc-600/20 border-zinc-600/40 text-zinc-300' },
              { label: 'Inspected', count: PL.inspected,         cost: PL.inspected_cost,         color: 'bg-blue-600/20 border-blue-600/40 text-blue-400' },
              { label: 'For Sale',  count: PL.raw_for_sale,      cost: PL.raw_for_sale_cost,      color: 'bg-teal-600/20 border-teal-600/40 text-teal-400' },
              { label: 'To Grade',  count: PL.grading_submitted, cost: PL.grading_submitted_cost, color: 'bg-amber-600/20 border-amber-600/40 text-amber-400' },
            ].map((stage, i) => (
              <>
                {i > 0 && <div key={`arrow-${i}`} className="text-zinc-600 text-xs shrink-0">→</div>}
                <div key={stage.label} className={cn('flex-1 border rounded-lg px-2 py-2.5 text-center', stage.color)}>
                  <p className="text-lg font-bold">{stage.count}</p>
                  <p className="text-[10px] mt-0.5 opacity-80">{stage.label}</p>
                  <p className="text-[10px] mt-1 opacity-60">{stage.cost > 0 ? formatCurrency(stage.cost) : '\u00a0'}</p>
                </div>
              </>
            ))}
          </div>
          {/* Inspection routing */}
          {(PL.routed_sell_raw > 0 || PL.routed_grade > 0) && (
            <div className="pt-3 border-t border-zinc-800">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-2">Inspection Routing</p>
              <div className="flex items-center gap-1">
                {[
                  { label: 'Sell Raw', count: PL.routed_sell_raw, color: 'bg-teal-600/20 border-teal-600/40 text-teal-400' },
                  { label: 'To Grade', count: PL.routed_grade,    color: 'bg-amber-600/20 border-amber-600/40 text-amber-400' },
                ].map((r) => (
                  <div key={r.label} className={cn('flex-1 border rounded-lg px-2 py-2.5 text-center', r.color)}>
                    <p className="text-lg font-bold">{r.count}</p>
                    <p className="text-[10px] mt-0.5 opacity-80">{r.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Statistics */}
      <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest border-b border-zinc-800 pb-1">Statistics</p>

      {rawView === 'Unsold' && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total Unsold', value: String(INV.total) },
            { label: 'Total Cost',   value: formatCurrency(INV.total_cost_cents) },
            { label: 'Avg Cost',     value: INV.total > 0 ? formatCurrency(Math.round(INV.total_cost_cents / INV.total)) : '—' },
          ].map(({ label, value }) => (
            <Card key={label} className="text-center">
              <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
              <p className="text-xl font-semibold mt-0.5 text-zinc-100">{value}</p>
            </Card>
          ))}
        </div>
      )}

      {rawView === 'Sold' && (
        <>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Total Sold',    value: String(S.total_sold) },
              { label: 'Total Revenue', value: formatCurrency(S.total_revenue_cents), color: 'text-emerald-400' },
              { label: 'Total Profit',  value: formatCurrency(S.total_profit_cents),  color: S.total_profit_cents >= 0 ? 'text-emerald-400' : 'text-red-400' },
            ].map(({ label, value, color }) => (
              <Card key={label} className="text-center">
                <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
                <p className={cn('text-xl font-semibold mt-0.5', color ?? 'text-zinc-100')}>{value}</p>
              </Card>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Avg Sale Price', value: formatCurrency(S.avg_sale_price_cents) },
              { label: 'Avg Profit',     value: formatCurrency(S.avg_profit_cents), color: S.avg_profit_cents >= 0 ? 'text-emerald-400' : 'text-red-400' },
              { label: 'Avg Profit %',   value: fmtPct(S.avg_profit_pct),           color: S.avg_profit_pct >= 0 ? 'text-emerald-400' : 'text-red-400' },
            ].map(({ label, value, color }) => (
              <Card key={label} className="text-center">
                <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
                <p className={cn('text-xl font-semibold mt-0.5', color ?? 'text-zinc-100')}>{value}</p>
              </Card>
            ))}
          </div>
          <Card>
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Sales Detail</h3>
            <div className="space-y-0.5">
              <StatRow label="Avg Fees"       value={`${formatCurrency(S.avg_fees_cents)} (${fmtPct(S.avg_fees_pct)})`} />
            </div>
            <div className="mt-3 pt-3 border-t border-zinc-800 space-y-0.5">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Avg Days to Sell</p>
              <StatRow label="Raw Cards"  value={fmtDays(T.avg_days_raw)} />
              <StatRow label="Bulk Cards" value={fmtDays(T.avg_days_bulk)} />
            </div>
          </Card>
        </>
      )}

      {rawView === 'All' && (
        <>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Total Cards',  value: String(INV.total) },
              { label: 'Sold Cards',   value: String(S.total_sold), color: 'text-emerald-400' },
              { label: 'Unsold Cards', value: String(PL.raw_for_sale + PL.inspected + PL.purchased_raw) },
            ].map(({ label, value, color }) => (
              <Card key={label} className="text-center">
                <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
                <p className={cn('text-xl font-semibold mt-0.5', color ?? 'text-zinc-100')}>{value}</p>
              </Card>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Total Cost',    value: formatCurrency(INV.total_cost_cents) },
              { label: 'Total Revenue', value: formatCurrency(S.total_revenue_cents), color: 'text-emerald-400' },
              { label: 'Total Profit',  value: formatCurrency(S.total_profit_cents),  color: S.total_profit_cents >= 0 ? 'text-emerald-400' : 'text-red-400' },
            ].map(({ label, value, color }) => (
              <Card key={label} className="text-center">
                <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
                <p className={cn('text-xl font-semibold mt-0.5', color ?? 'text-zinc-100')}>{value}</p>
              </Card>
            ))}
          </div>
          <Card>
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Sales Detail</h3>
            <div className="space-y-0.5">
              <StatRow label="Avg Sale Price" value={formatCurrency(S.avg_sale_price_cents)} />
              <StatRow label="Avg Profit"     value={formatCurrency(S.avg_profit_cents)} highlight={S.avg_profit_cents >= 0 ? 'pos' : 'neg'} />
              <StatRow label="Avg Profit %"   value={fmtPct(S.avg_profit_pct)}           highlight={S.avg_profit_pct >= 0 ? 'pos' : 'neg'} />
              <StatRow label="Avg Fees"       value={`${formatCurrency(S.avg_fees_cents)} (${fmtPct(S.avg_fees_pct)})`} />
            </div>
            <div className="mt-3 pt-3 border-t border-zinc-800 space-y-0.5">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Avg Days to Sell</p>
              <StatRow label="Raw Cards"  value={fmtDays(T.avg_days_raw)} />
              <StatRow label="Bulk Cards" value={fmtDays(T.avg_days_bulk)} />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

// ── Types: Graded Dashboard ───────────────────────────────────────────────────
interface GradedInventory {
  total: number;
  total_cost_cents: number;
  total_raw_cost_cents: number;
  by_company: Array<{ company: string; count: number; cost_cents: number }>;
  by_grade: Array<{ grade: number; grade_label: string | null; company: string; count: number }>;
}
interface ActiveBatch {
  id: string; batch_id: string; name: string | null; company: string; tier: string;
  submitted_at: string | null; status: string; card_count: number; days_elapsed: number;
  raw_cost: number; grading_cost: number; total_cost: number; estimated_total: number;
}
interface GradedPipeline {
  at_graders: number; at_graders_cost: number;
  unsubmitted: number; unsubmitted_cost: number;
  returned: number; avg_days_at_graders: number;
  active_batches: ActiveBatch[];
}
interface GradedSales {
  total_sold: number;
  avg_raw_cost_cents: number;
  avg_grading_cost_cents: number;
  avg_total_cost_cents: number;
  avg_sale_price_cents: number;
  avg_profit_cents: number;
  avg_profit_pct: number;
  avg_fees_cents: number;
  avg_fees_pct: number;
  total_revenue_cents: number;
  total_profit_cents: number;
}
interface GradedByCompany {
  company: string;
  count_sold: number;
  avg_sale_price_cents: number;
  avg_profit_pct: number;
}
interface GradedListingVsSale {
  count: number;
  avg_asking_price_cents: number;
  avg_sale_price_cents: number;
  avg_pct_of_asking: number;
  avg_discount_pct: number;
}
interface GradedDashboard {
  inventory: GradedInventory;
  pipeline: GradedPipeline;
  sales: GradedSales;
  by_company: GradedByCompany[];
  listing_vs_sale: GradedListingVsSale;
}

// ── Tab: Graded ───────────────────────────────────────────────────────────────
const COMPANY_COLORS = [C.indigo, C.teal, C.amber, C.blue, C.green, C.red, C.yellow];
const INV_VIEWS = ['All', 'Unsold', 'Sold'] as const;
type InvView = typeof INV_VIEWS[number];

function GradedTab() {
  const [invView, setInvView] = useState<InvView>('Unsold');
  const [gradeCompany, setGradeCompany] = useState<string>('');
  const [invPieMode, setInvPieMode] = useState<'count' | 'value'>('count');
  const viewParam = invView.toLowerCase() as 'unsold' | 'sold' | 'all';

  const { data, isLoading } = useQuery<GradedDashboard>({
    queryKey: ['graded-dashboard', viewParam],
    queryFn: () => api.get(`/reports/graded-dashboard?view=${viewParam}`).then((r) => r.data),
  });

  if (isLoading || !data?.inventory) return <div className="text-zinc-500 text-sm py-8">Loading…</div>;

  const { inventory: INV, pipeline: PL, sales: S, by_company: BC, listing_vs_sale: LVS } = data;
  const rawCostCents = INV.total_raw_cost_cents ?? 0;

  const companyPie: PieEntry[] = INV.by_company.map((r, i) => ({
    name: r.company,
    value: r.count,
    color: COMPANY_COLORS[i % COMPANY_COLORS.length],
  }));

  const companyValuePie: PieEntry[] = INV.by_company.map((r, i) => ({
    name: r.company,
    value: r.cost_cents,
    color: COMPANY_COLORS[i % COMPANY_COLORS.length],
  }));


  const fmtGrade = (g: number | string) => {
    const n = Number(g);
    if (n === 0) return 'Auth';
    return n % 1 === 0 ? String(Math.round(n)) : String(n);
  };
  const COMPANY_ORDER = ['PSA', 'CGC', 'ARS'];
  const gradeCompanies = Array.from(new Set(INV.by_grade.map((r) => r.company)))
    .sort((a, b) => {
      const ai = COMPANY_ORDER.indexOf(a);
      const bi = COMPANY_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  const activeGradeCompany = gradeCompany || gradeCompanies[0] || '';
  const filteredGrades = INV.by_grade.filter((r) => r.company === activeGradeCompany);
  // Build unique grade keys — use grade_label when present to keep ARS10 and ARS10+ separate
  const gradeKey = (r: { grade: number; grade_label: string | null }) =>
    r.grade_label ?? fmtGrade(r.grade);
  const allGradeKeys = Array.from(
    new Map(filteredGrades.map((r) => [gradeKey(r), Number(r.grade)])).entries()
  ).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([key]) => key);
  const gradeBarData = allGradeKeys.map((key) => ({
    name: key,
    count: filteredGrades.filter((r) => gradeKey(r) === key).reduce((s, r) => s + r.count, 0),
  }));

  const fmtPct = (n: number) => `${n.toFixed(1)}%`;

  return (
    <div className="space-y-6">
      {/* Inventory & Pipeline */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-1">
        <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Inventory &amp; Pipeline</p>
        <div className="flex gap-1">
          {INV_VIEWS.map((v) => (
            <button
              key={v}
              onClick={() => setInvView(v)}
              className={cn(
                'px-2.5 py-0.5 rounded text-xs font-medium transition-colors',
                invView === v ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Col 1 — In Hand */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Inventory Value</h3>
            <div className="flex gap-1">
              {(['count', 'value'] as const).map((m) => (
                <button key={m} onClick={() => setInvPieMode(m)}
                  className={cn('px-2.5 py-0.5 rounded text-xs font-medium transition-colors',
                    invPieMode === m ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200')}>
                  {m === 'count' ? 'Count' : 'Value'}
                </button>
              ))}
            </div>
          </div>
          <MiniDonutChart
            pieData={invPieMode === 'count' ? companyPie : companyValuePie}
            formatter={invPieMode === 'count' ? (v) => String(v) : formatCurrency}
          />
          <div className="mt-3 space-y-0.5">
            <StatRow label="Total Graded"    value={String(INV.total)} />
            <StatRow label="Total Cost Basis" value={formatCurrency(INV.total_cost_cents)} />
            {INV.by_company.map((r) => (
              <StatRow key={r.company} label={r.company} value={`${r.count} · ${formatCurrency(r.cost_cents)}`} />
            ))}
          </div>
        </Card>

        {/* Col 2 — Grade Distribution */}
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Grade Distribution</h3>
            {gradeCompanies.length > 1 && (
              <div className="flex gap-1">
                {gradeCompanies.map((co) => (
                  <button
                    key={co}
                    onClick={() => setGradeCompany(co)}
                    className={cn(
                      'px-2 py-0.5 rounded text-xs font-medium transition-colors',
                      activeGradeCompany === co ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
                    )}
                  >
                    {co}
                  </button>
                ))}
              </div>
            )}
          </div>
          {gradeBarData.length === 0 ? (
            <div className="flex items-center justify-center h-[200px] text-zinc-600 text-xs">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={gradeBarData} margin={{ top: 16, right: 8, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fill: '#a1a1aa', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#a1a1aa', fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 12 }}
                />
                <Bar dataKey="count" name="Cards" fill={C.indigo} radius={[4, 4, 0, 0]}>
                  <LabelList dataKey="count" position="top" style={{ fill: '#d4d4d8', fontSize: 10 }} formatter={(v: number) => v > 0 ? v : ''} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          {gradeBarData.some((r) => r.count > 0) && (() => {
            const total = gradeBarData.reduce((s, r) => s + r.count, 0);
            return (
              <div className="mt-3">
                <div className="flex justify-between items-center py-1 text-xs text-zinc-500 border-b border-zinc-700 mb-1 pr-4">
                  <span className="flex-1">Grade</span>
                  <span className="w-10 text-right">Count</span>
                  <span className="w-10 text-right">%</span>
                </div>
                <div className="max-h-48 overflow-y-auto pr-4">
                  {gradeBarData.filter((r) => r.count > 0).map((r) => (
                    <div key={r.name} className="flex justify-between items-center py-1 text-xs border-b border-zinc-800/60 last:border-0">
                      <span className="flex-1 text-zinc-400">{/^\d/.test(r.name) ? `${activeGradeCompany} ${r.name}` : r.name}</span>
                      <span className="w-10 text-right text-zinc-200">{r.count}</span>
                      <span className="w-10 text-right text-zinc-400">{((r.count / total) * 100).toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </Card>

        {/* Col 3 — Pipeline */}
        <Card>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-4">Grading Pipeline</h3>

          {/* Flow */}
          <div className="flex items-center gap-1 mb-5">
            {[
              { label: 'Unsubmitted', count: PL.unsubmitted, cost: PL.unsubmitted_cost, color: 'bg-amber-600/20 border-amber-600/40 text-amber-400' },
              { label: 'At Graders',  count: PL.at_graders,  cost: PL.at_graders_cost,  color: 'bg-indigo-600/20 border-indigo-600/40 text-indigo-400' },
              { label: 'Returned',    count: PL.returned,    cost: null,                 color: 'bg-emerald-600/20 border-emerald-600/40 text-emerald-400' },
            ].map((stage, i) => (
              <>
                {i > 0 && <div key={`arrow-${i}`} className="text-zinc-600 text-xs shrink-0">→</div>}
                <div key={stage.label} className={cn('flex-1 border rounded-lg px-2 py-2.5 text-center', stage.color)}>
                  <p className="text-lg font-bold">{stage.count}</p>
                  <p className="text-[10px] mt-0.5 opacity-80">{stage.label}</p>
                  <p className="text-[10px] mt-1 opacity-60">{stage.cost != null && stage.cost > 0 ? formatCurrency(stage.cost) : '\u00a0'}</p>
                </div>
              </>
            ))}
          </div>

          <div className="space-y-0.5 mb-4">
            <StatRow
              label="Avg days at graders"
              value={PL.at_graders > 0 ? `${PL.avg_days_at_graders}d` : '—'}
            />
          </div>

          {/* Active batches */}
          {(PL.active_batches ?? []).length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">Active Batches</p>
              <div className="flex justify-between items-center py-1 text-[10px] text-zinc-500 border-b border-zinc-700 mb-1 pr-4">
                <span className="flex-1">Batch</span>
                <span className="w-8 text-right">Cards</span>
                <span className="w-20 text-right">Raw Value</span>
                <span className="w-20 text-right">Est. Value</span>
                <span className="w-8 text-right">Days</span>
              </div>
              <div className="max-h-48 overflow-y-auto pr-4">
                {(PL.active_batches ?? []).map((b) => (
                  <div key={b.id} className="flex justify-between items-center py-1 text-xs border-b border-zinc-800/60 last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-zinc-200 truncate">{b.name ?? b.batch_id}</p>
                      <p className="text-[10px] text-zinc-500">{b.company} · {b.tier}</p>
                    </div>
                    <span className="w-8 text-right text-zinc-300">{b.card_count}</span>
                    <span className="w-20 text-right text-zinc-400">{formatCurrency(b.raw_cost)}</span>
                    <span className="w-20 text-right text-zinc-400">{b.estimated_total > 0 ? formatCurrency(b.estimated_total) : '—'}</span>
                    <span className="w-8 text-right text-zinc-400">{b.submitted_at ? `${b.days_elapsed}d` : '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Statistics */}
      <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest border-b border-zinc-800 pb-1">Statistics</p>

      {invView === 'Unsold' && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Total Unsold',     value: String(INV.total) },
            { label: 'Total Raw Cost',   value: formatCurrency(rawCostCents) },
            { label: 'Total Cost Basis', value: formatCurrency(INV.total_cost_cents) },
          ].map(({ label, value }) => (
            <Card key={label} className="text-center">
              <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
              <p className="text-xl font-semibold mt-0.5 text-zinc-100">{value}</p>
            </Card>
          ))}
        </div>
      )}

      {invView === 'Sold' && (
        <>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Total Sold',    value: String(INV.total) },
              { label: 'Total Revenue', value: formatCurrency(S.total_revenue_cents),  color: 'text-emerald-400' },
              { label: 'Total Profit',  value: formatCurrency(S.total_profit_cents),   color: S.total_profit_cents >= 0 ? 'text-emerald-400' : 'text-red-400' },
            ].map(({ label, value, color }) => (
              <Card key={label} className="text-center">
                <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
                <p className={cn('text-xl font-semibold mt-0.5', color ?? 'text-zinc-100')}>{value}</p>
              </Card>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Total Raw Cost',   value: formatCurrency(rawCostCents) },
              { label: 'Total Cost Basis', value: formatCurrency(INV.total_cost_cents) },
              { label: 'Avg Profit %',     value: fmtPct(S.avg_profit_pct), color: S.avg_profit_pct >= 0 ? 'text-emerald-400' : 'text-red-400' },
            ].map(({ label, value, color }) => (
              <Card key={label} className="text-center">
                <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
                <p className={cn('text-xl font-semibold mt-0.5', color ?? 'text-zinc-100')}>{value}</p>
              </Card>
            ))}
          </div>
        </>
      )}

      {invView === 'All' && (
        <>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Total Cards',  value: String(INV.total) },
              { label: 'Sold Cards',   value: String(S.total_sold), color: 'text-emerald-400' },
              { label: 'Unsold Cards', value: String(PL.returned) },
            ].map(({ label, value, color }) => (
              <Card key={label} className="text-center">
                <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
                <p className={cn('text-xl font-semibold mt-0.5', color ?? 'text-zinc-100')}>{value}</p>
              </Card>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Total Raw Cost',   value: formatCurrency(rawCostCents) },
              { label: 'Total Cost Basis', value: formatCurrency(INV.total_cost_cents) },
              { label: 'Total Profit',     value: formatCurrency(S.total_profit_cents), color: S.total_profit_cents >= 0 ? 'text-emerald-400' : 'text-red-400' },
            ].map(({ label, value, color }) => (
              <Card key={label} className="text-center">
                <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
                <p className={cn('text-xl font-semibold mt-0.5', color ?? 'text-zinc-100')}>{value}</p>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* By Company + Listing vs Sale */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* By Company table */}
        <Card>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">By Company</h3>
          {BC.length === 0 ? (
            <p className="text-xs text-zinc-600">No sales data yet.</p>
          ) : (
            <div>
              {/* Header */}
              <div className="flex justify-between items-center py-1 text-xs text-zinc-500 border-b border-zinc-700 mb-1">
                <span className="flex-1">Company</span>
                <span className="w-14 text-right">Sold</span>
                <span className="w-20 text-right">Avg Sale</span>
                <span className="w-20 text-right">Avg Profit%</span>
              </div>
              {BC.map((r) => (
                <div key={r.company} className="flex justify-between items-center py-1 text-xs border-b border-zinc-800/60 last:border-0">
                  <span className="flex-1 text-zinc-300">{r.company}</span>
                  <span className="w-14 text-right text-zinc-200">{r.count_sold}</span>
                  <span className="w-20 text-right text-zinc-200">{formatCurrency(r.avg_sale_price_cents)}</span>
                  <span className={cn('w-20 text-right font-semibold', r.avg_profit_pct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {fmtPct(r.avg_profit_pct)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Listing vs Sale */}
        <Card>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Listing vs Sale</h3>
          <div className="space-y-0.5">
            <StatRow label="Sales with Listing Data" value={String(LVS.count)} />
            <StatRow label="Avg Asking Price"         value={formatCurrency(LVS.avg_asking_price_cents)} />
            <StatRow label="Avg Sale Price"           value={formatCurrency(LVS.avg_sale_price_cents)} />
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
const TABS = ['Overview', 'Graded', 'Raw Cards'] as const;
type Tab = typeof TABS[number];

export function Dashboard() {
  const [tab, setTab] = useState<Tab>('Overview');

  return (
    <div className="p-6 h-full overflow-y-auto flex flex-col">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-zinc-100">Dashboard</h1>
        <div className="flex gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                tab === t
                  ? 'bg-indigo-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-100'
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {tab === 'Overview' && <OverviewTab />}
        {tab === 'Raw Cards' && <RawCardsTab />}
        {tab === 'Graded' && <GradedTab />}
      </div>
    </div>
  );
}
