import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  Tooltip, Legend, ResponsiveContainer, LabelList,
} from 'recharts';
import type { TooltipProps } from 'recharts';
import { Package, TrendingUp, Star, DollarSign } from 'lucide-react';
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
interface SalesRow { count: number; total_net: number; total_profit: number }

interface Purchases {
  orders_made: number; orders_pending: number; orders_received: number;
  orders_canceled: number; cards_received: number;
  bulk_cards_received: number; raw_cards_received: number;
}
interface RawsAndBulk {
  bulk_inspected: number; raws_inspected: number; ungradable_to_sell: number;
  sellable_ungradable_raws: number; sellable_ungradable_bulk: number;
  ungradable_raws_sold: number; ungradable_bulk_sold: number;
}
interface Grading {
  total_for_grading: number; bulk_for_grading: number; raw_for_grading: number;
  unsubmitted_raw: number; unsubmitted_bulk: number;
  submitted_raws: number; submitted_bulk: number;
}
interface Turnover {
  avg_days_sell_raw: number | null; avg_days_sell_bulk: number | null;
  avg_days_grade_raw: number | null; avg_days_grade_bulk: number | null;
}
interface CashFlow {
  gross_revenue_cents: number; cogs_sold_cents: number; net_profit_sold_cents: number;
  cogs_unsold_cents: number; cogs_unsold_raw_cents: number; cogs_unsold_bulk_cents: number;
  overall_gain_loss_cents: number; avg_cost_unsold_raw_cents: number;
  avg_cost_unsold_bulk_cents: number; avg_profit_sold_raw_cents: number;
  avg_profit_sold_bulk_cents: number; net_gain_loss_sold_raw_cents: number;
  net_gain_loss_sold_bulk_cents: number;
}
interface RawDashboard {
  purchases: Purchases; raws_and_bulk: RawsAndBulk;
  grading: Grading; turnover: Turnover; cash_flow: CashFlow;
}
interface PieEntry  { name: string; value: number; color: string }
interface VelocityEntry { name: string; days: number | null; fill: string }
interface PnlEntry  { name: string; value: number; fill: string }

// ── Shared helpers ───────────────────────────────────────────────────────────
function fmtDays(v: number | null | undefined) { return v == null ? '—' : `${v}d`; }

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
type RcPayload = { name?: string; value?: number; fill?: string; color?: string };

function CurrencyTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-zinc-100 mb-1">{label}</p>
      {(payload as RcPayload[]).map((p, i) => (
        <p key={i} style={{ color: p.fill || p.color }}>{p.name}: {formatCurrency(p.value ?? 0)}</p>
      ))}
    </div>
  );
}

function DaysTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-zinc-100 mb-1">{label}</p>
      {(payload as RcPayload[]).map((p, i) => (
        <p key={i} style={{ color: p.fill || p.color }}>{p.value != null ? `${p.value}d` : '—'}</p>
      ))}
    </div>
  );
}

function PieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent, value }: {
  cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number; percent: number; value: number;
}) {
  if (percent < 0.05) return null;
  const RADIAN = Math.PI / 180;
  const r = outerRadius + 18;
  const x = cx + r * Math.cos(-midAngle * RADIAN);
  const y = cy + r * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#a1a1aa" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={10}>
      {value} ({(percent * 100).toFixed(0)}%)
    </text>
  );
}

function DonutChart({ pieData }: { pieData: PieEntry[] }) {
  if (!pieData.length) return <div className="flex items-center justify-center h-[170px] text-zinc-600 text-xs">No data yet</div>;
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={pieData}
          innerRadius={46}
          outerRadius={72}
          paddingAngle={2}
          dataKey="value"
          labelLine={false}
          label={PieLabel}
        >
          {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
        </Pie>
        <Legend iconType="circle" iconSize={8} formatter={(v) => <span className="text-zinc-400 text-xs">{v}</span>} />
        <Tooltip formatter={(v: number) => [v, '']} contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 6, fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function VelocityChart({ data }: { data: VelocityEntry[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 16, right: 8, left: -20, bottom: 0 }}>
        <XAxis dataKey="name" tick={{ fill: '#a1a1aa', fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: '#a1a1aa', fontSize: 10 }} axisLine={false} tickLine={false} />
        <Tooltip content={<DaysTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <Bar dataKey="days" name="Days" radius={[4, 4, 0, 0]}>
          {data.map((e, i) => <Cell key={i} fill={e.fill} />)}
          <LabelList dataKey="days" position="top" formatter={(v: number | null) => v != null ? `${v}d` : ''} style={{ fill: '#d4d4d8', fontSize: 10 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function PnlBarChart({ data, title }: { data: PnlEntry[]; title: string }) {
  return (
    <div>
      <p className="text-xs text-zinc-500 mb-2 text-center font-medium">{title}</p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 24, right: 16, left: 8, bottom: 0 }} barCategoryGap="40%">
          <XAxis dataKey="name" tick={{ fill: '#a1a1aa', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: '#a1a1aa', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${Math.abs(v / 100).toFixed(0)}`} width={60} padding={{ top: 20, bottom: 20 }} />
          <Tooltip content={<CurrencyTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Bar dataKey="value" name="Amount" radius={[4, 4, 0, 0]}>
            {data.map((e, i) => <Cell key={i} fill={e.fill} />)}
            <LabelList dataKey="value" position="top" formatter={(v: number) => formatCurrency(Math.abs(v))} style={{ fill: '#d4d4d8', fontSize: 10 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Tab: Overview ─────────────────────────────────────────────────────────────
function OverviewTab() {
  const { data: inventory } = useQuery<InventoryRow[]>({
    queryKey: ['inventory-value'],
    queryFn: () => api.get('/reports/inventory-value').then((r) => r.data),
  });
  const { data: sales } = useQuery<{ last_30_days: SalesRow }>({
    queryKey: ['sales-summary'],
    queryFn: () => api.get('/reports/summary').then((r) => r.data),
  });

  const totalCards   = inventory?.reduce((s, r) => s + (r.count ?? 0), 0) ?? 0;
  const totalCost    = inventory?.reduce((s, r) => s + (r.total_cost ?? 0), 0) ?? 0;
  const gradingCount = inventory?.find((r) => r.status === 'grading_submitted')?.count ?? 0;
  const salesProfit  = sales?.last_30_days?.total_profit ?? 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: Package,    label: 'Total Cards',  value: String(totalCards),          sub: 'in inventory' },
          { icon: DollarSign, label: 'Cost Basis',   value: formatCurrency(totalCost),   sub: 'total invested' },
          { icon: Star,       label: 'At Graders',   value: String(gradingCount),        sub: 'cards submitted' },
          { icon: TrendingUp, label: '30-Day Profit', value: formatCurrency(salesProfit), sub: 'net of fees & cost' },
        ].map(({ icon: Icon, label, value, sub }) => (
          <Card key={label} className="flex items-start gap-4">
            <div className="p-2 rounded-lg bg-indigo-600/20"><Icon size={18} className="text-indigo-400" /></div>
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
              <p className="text-xl font-semibold text-zinc-100 mt-0.5">{value}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{sub}</p>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <h2 className="text-sm font-semibold text-zinc-100 mb-3">Inventory by Status</h2>
        {inventory?.length ? (
          <div className="space-y-2">
            {inventory.map((row) => (
              <div key={row.status} className="flex items-center justify-between text-sm">
                <span className="text-zinc-400 capitalize">{row.status.replace(/_/g, ' ')}</span>
                <div className="flex gap-4 text-right">
                  <span className="text-zinc-300">{row.count} cards</span>
                  <span className="text-zinc-500 w-24">{formatCurrency(row.total_cost ?? 0)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-zinc-600">No inventory yet.</p>
        )}
      </Card>
    </div>
  );
}

// ── Tab: Raw Cards ────────────────────────────────────────────────────────────
function RawCardsTab() {
  const { data, isLoading } = useQuery<RawDashboard>({
    queryKey: ['raw-dashboard'],
    queryFn: () => api.get('/reports/raw-dashboard').then((r) => r.data),
  });

  if (isLoading || !data) return <div className="text-zinc-500 text-sm py-8">Loading…</div>;

  const { purchases: P, raws_and_bulk: R, grading: G, turnover: T, cash_flow: CF } = data;

  const orderStatusPie: PieEntry[] = [
    { name: 'Pending',  value: P.orders_pending,  color: C.amber  },
    { name: 'Canceled', value: P.orders_canceled, color: C.red    },
    { name: 'Received', value: P.orders_received, color: C.indigo },
  ].filter(d => d.value > 0);

  const rawsBulkPie: PieEntry[] = [
    { name: 'Ungradable Raws', value: Math.max(0, R.ungradable_to_sell - R.sellable_ungradable_bulk), color: C.amber  },
    { name: 'Ungradable Bulk', value: R.sellable_ungradable_bulk,  color: C.yellow },
    { name: 'Sellable Raw',    value: R.sellable_ungradable_raws,  color: C.teal   },
    { name: 'Bulk Sold',       value: R.ungradable_bulk_sold,      color: C.blue   },
  ].filter(d => d.value > 0);

  const gradingPie: PieEntry[] = [
    { name: 'Unsubmitted Raw',  value: G.unsubmitted_raw,  color: C.red   },
    { name: 'Unsubmitted Bulk', value: G.unsubmitted_bulk, color: C.amber },
    { name: 'Submitted Raws',   value: G.submitted_raws,   color: C.teal  },
    { name: 'Submitted Bulk',   value: G.submitted_bulk,   color: C.green },
  ].filter(d => d.value > 0);

  const velocityData: VelocityEntry[] = [
    { name: 'Sell Raw',   days: T.avg_days_sell_raw,   fill: C.teal   },
    { name: 'Sell Bulk',  days: T.avg_days_sell_bulk,  fill: C.blue   },
    { name: 'Grade Bulk', days: T.avg_days_grade_bulk, fill: C.amber  },
    { name: 'Grade Raw',  days: T.avg_days_grade_raw,  fill: C.indigo },
  ];

  const overallPnlData: PnlEntry[] = [
    { name: 'Overall COGs',      value: -CF.cogs_unsold_cents,      fill: C.red   },
    { name: 'Gross Revenue',     value: CF.gross_revenue_cents,     fill: C.green },
    { name: 'Overall G/L',       value: CF.overall_gain_loss_cents, fill: CF.overall_gain_loss_cents >= 0 ? C.green : C.red },
  ];

  const soldPnlData: PnlEntry[] = [
    { name: 'COGs Sold',     value: -CF.cogs_sold_cents,      fill: C.red   },
    { name: 'Gross Revenue', value: CF.gross_revenue_cents,   fill: C.green },
    { name: 'Total G/L',     value: CF.net_profit_sold_cents, fill: CF.net_profit_sold_cents >= 0 ? C.green : C.red },
  ];

  return (
    <div className="space-y-6">
      {/* Overview */}
      <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest border-b border-zinc-800 pb-1">Overview</p>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Inventory</h3>
          <DonutChart pieData={orderStatusPie} />
          <div className="mt-3 space-y-0.5">
            <StatRow label="Orders Made"         value={String(P.orders_made)} />
            <StatRow label="Orders Pending"      value={String(P.orders_pending)} />
            <StatRow label="Orders Canceled"     value={String(P.orders_canceled)} />
            <StatRow label="Orders Received"     value={String(P.orders_received)} />
            <StatRow label="Cards Received"      value={String(P.cards_received)} />
            <StatRow label="Bulk Cards Received" value={String(P.bulk_cards_received)} />
            <StatRow label="Raw Cards Received"  value={String(P.raw_cards_received)} />
          </div>
        </Card>

        <Card>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Raws &amp; Bulk</h3>
          <DonutChart pieData={rawsBulkPie} />
          <div className="mt-3 space-y-0.5">
            <StatRow label="Bulk Inspected"             value={String(R.bulk_inspected)} />
            <StatRow label="Raws Inspected"             value={String(R.raws_inspected)} />
            <StatRow label="Ungradable to Sell (total)" value={String(R.ungradable_to_sell)} />
            <StatRow label="Sellable Ungradable Raws"   value={String(R.sellable_ungradable_raws)} />
            <StatRow label="Sellable Ungradable Bulk"   value={String(R.sellable_ungradable_bulk)} />
            <StatRow label="Ungradable Raws Sold"       value={String(R.ungradable_raws_sold)} />
            <StatRow label="Ungradable Bulk Sold"       value={String(R.ungradable_bulk_sold)} />
          </div>
        </Card>

        <Card>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Grading</h3>
          <DonutChart pieData={gradingPie} />
          <div className="mt-3 space-y-0.5">
            <StatRow label="Total for Grading" value={String(G.total_for_grading)} />
            <StatRow label="Bulk for Grading"  value={String(G.bulk_for_grading)} />
            <StatRow label="Raw for Grading"   value={String(G.raw_for_grading)} />
            <StatRow label="Unsubmitted Raw"   value={String(G.unsubmitted_raw)} />
            <StatRow label="Unsubmitted Bulk"  value={String(G.unsubmitted_bulk)} />
            <StatRow label="Submitted Raws"    value={String(G.submitted_raws)} />
            <StatRow label="Submitted Bulk"    value={String(G.submitted_bulk)} />
          </div>
        </Card>
      </div>

      {/* Turnover + Cash Flow */}
      <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest border-b border-zinc-800 pb-1">Turnover Time &amp; Cash Flow</p>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Card Velocity</h3>
          <VelocityChart data={velocityData} />
          <div className="mt-3 space-y-0.5">
            <StatRow label="Avg Days — Sell Raw"   value={fmtDays(T.avg_days_sell_raw)} />
            <StatRow label="Avg Days — Sell Bulk"  value={fmtDays(T.avg_days_sell_bulk)} />
            <StatRow label="Avg Days — Grade Raw"  value={fmtDays(T.avg_days_grade_raw)} />
            <StatRow label="Avg Days — Grade Bulk" value={fmtDays(T.avg_days_grade_bulk)} />
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Cash Flow</h3>
          <div className="grid grid-cols-2 gap-2 mb-4">
            <PnlBarChart data={overallPnlData} title="Overall P&L" />
            <PnlBarChart data={soldPnlData}    title="P/L on Sold Cards" />
          </div>
          <div className="grid grid-cols-2 gap-x-6">
            <div className="space-y-0.5">
              <StatRow label="Net Gain/Loss"    value={formatCurrency(CF.net_profit_sold_cents)}    highlight={CF.net_profit_sold_cents >= 0 ? 'pos' : 'neg'} />
              <StatRow label="COGs on Unsold"   value={formatCurrency(CF.cogs_unsold_cents)} />
              <StatRow label="COGs Unsold Raw"  value={formatCurrency(CF.cogs_unsold_raw_cents)} />
              <StatRow label="COGs Unsold Bulk" value={formatCurrency(CF.cogs_unsold_bulk_cents)} />
              <StatRow label="COGs Sold"        value={formatCurrency(CF.cogs_sold_cents)} />
              <StatRow label="Gross Revenue"    value={formatCurrency(CF.gross_revenue_cents)}      highlight="pos" />
              <StatRow label="Overall Gain/Loss" value={formatCurrency(CF.overall_gain_loss_cents)} highlight={CF.overall_gain_loss_cents >= 0 ? 'pos' : 'neg'} />
            </div>
            <div className="space-y-0.5">
              <StatRow label="Avg Cost Unsold Raw"  value={formatCurrency(CF.avg_cost_unsold_raw_cents)} />
              <StatRow label="Avg Cost Unsold Bulk" value={formatCurrency(CF.avg_cost_unsold_bulk_cents)} />
              <StatRow label="Avg Profit Sold Bulk" value={formatCurrency(CF.avg_profit_sold_bulk_cents)} />
              <StatRow label="Avg Profit Sold Raw"  value={formatCurrency(CF.avg_profit_sold_raw_cents)} />
              <StatRow label="Net G/L Sold Bulk"    value={formatCurrency(CF.net_gain_loss_sold_bulk_cents)} highlight={CF.net_gain_loss_sold_bulk_cents >= 0 ? 'pos' : 'neg'} />
              <StatRow label="Net G/L Sold Raw"     value={formatCurrency(CF.net_gain_loss_sold_raw_cents)}  highlight={CF.net_gain_loss_sold_raw_cents >= 0 ? 'pos' : 'neg'} />
              <StatRow label="Total G/L on Sold"    value={formatCurrency(CF.net_profit_sold_cents)}         highlight={CF.net_profit_sold_cents >= 0 ? 'pos' : 'neg'} />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── Types: Graded Dashboard ───────────────────────────────────────────────────
interface GradedInventory {
  total: number;
  total_cost_cents: number;
  by_company: Array<{ company: string; count: number; cost_cents: number }>;
  by_grade: Array<{ grade: string; count: number }>;
}
interface GradedPipeline { at_graders: number; unsubmitted: number }
interface GradedSales {
  total_sold: number;
  avg_raw_cost_cents: number;
  avg_grading_cost_cents: number;
  avg_total_cost_cents: number;
  avg_sale_price_cents: number;
  avg_profit_cents: number;
  avg_profit_pct: number;
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
const GRADE_ORDER = ['1-6', '7', '8', '9', '9.5', '10'];
const COMPANY_COLORS = [C.indigo, C.teal, C.amber, C.blue, C.green, C.red, C.yellow];

function GradedTab() {
  const { data, isLoading } = useQuery<GradedDashboard>({
    queryKey: ['graded-dashboard'],
    queryFn: () => api.get('/reports/graded-dashboard').then((r) => r.data),
  });

  if (isLoading || !data) return <div className="text-zinc-500 text-sm py-8">Loading…</div>;

  const { inventory: INV, pipeline: PL, sales: S, by_company: BC, listing_vs_sale: LVS } = data;

  const companyPie: PieEntry[] = INV.by_company.map((r, i) => ({
    name: r.company,
    value: r.count,
    color: COMPANY_COLORS[i % COMPANY_COLORS.length],
  }));

  const gradeBarData = GRADE_ORDER.map((g) => {
    const found = INV.by_grade.find((r) => r.grade === g);
    return { name: g, count: found?.count ?? 0 };
  });

  const fmtPct = (n: number) => `${n.toFixed(1)}%`;

  return (
    <div className="space-y-6">
      {/* Inventory & Pipeline */}
      <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest border-b border-zinc-800 pb-1">Inventory &amp; Pipeline</p>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Col 1 — In Hand */}
        <Card>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">In Hand</h3>
          <DonutChart pieData={companyPie} />
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
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Grade Distribution</h3>
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
          <div className="mt-3 space-y-0.5">
            {gradeBarData.map((r) => (
              <StatRow key={r.name} label={`Grade ${r.name}`} value={String(r.count)} />
            ))}
          </div>
        </Card>

        {/* Col 3 — Pipeline */}
        <Card>
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Pipeline</h3>
          <div className="mt-3 space-y-0.5">
            <StatRow label="At Graders"              value={String(PL.at_graders)} />
            <StatRow label="Unsubmitted (awaiting)"  value={String(PL.unsubmitted)} />
          </div>
        </Card>
      </div>

      {/* Sales Performance */}
      <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest border-b border-zinc-800 pb-1">Sales Performance</p>

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Avg Raw Cost',     value: formatCurrency(S.avg_raw_cost_cents) },
          { label: 'Avg Grading Cost', value: formatCurrency(S.avg_grading_cost_cents) },
          { label: 'Avg Sale Price',   value: formatCurrency(S.avg_sale_price_cents) },
          { label: 'Avg Profit %',     value: fmtPct(S.avg_profit_pct), profit: S.avg_profit_pct },
        ].map(({ label, value, profit }) => (
          <Card key={label}>
            <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
            <p className={cn(
              'text-xl font-semibold mt-0.5',
              profit != null
                ? profit >= 0 ? 'text-emerald-400' : 'text-red-400'
                : 'text-zinc-100'
            )}>
              {value}
            </p>
          </Card>
        ))}
      </div>

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
          {S.total_sold > 0 && (
            <div className="mt-4 space-y-0.5">
              <StatRow label="Total Sold"       value={String(S.total_sold)} />
              <StatRow label="Total Revenue"    value={formatCurrency(S.total_revenue_cents)} highlight="pos" />
              <StatRow label="Total Profit"     value={formatCurrency(S.total_profit_cents)} highlight={S.total_profit_cents >= 0 ? 'pos' : 'neg'} />
              <StatRow label="Avg Total Cost"   value={formatCurrency(S.avg_total_cost_cents)} />
              <StatRow label="Avg Profit"       value={formatCurrency(S.avg_profit_cents)} highlight={S.avg_profit_cents >= 0 ? 'pos' : 'neg'} />
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
            <StatRow label="Avg % of Asking Achieved" value={fmtPct(LVS.avg_pct_of_asking)} highlight={LVS.avg_pct_of_asking >= 95 ? 'pos' : undefined} />
            <StatRow label="Avg Discount %"           value={fmtPct(LVS.avg_discount_pct)} highlight={LVS.avg_discount_pct > 0 ? 'neg' : 'pos'} />
          </div>
        </Card>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
const TABS = ['Overview', 'Raw Cards', 'Graded'] as const;
type Tab = typeof TABS[number];

export function Dashboard() {
  const [tab, setTab] = useState<Tab>('Overview');

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
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

      {tab === 'Overview'   && <OverviewTab />}
      {tab === 'Raw Cards'  && <RawCardsTab />}
      {tab === 'Graded'     && <GradedTab />}
    </div>
  );
}
