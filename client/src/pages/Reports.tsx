import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, TrendingUp } from 'lucide-react';
import { api } from '../lib/api';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { formatCurrency, cn } from '../lib/utils';
import { CardTrendModal } from '../components/CardTrendPanel';

type Channel = 'all' | 'ebay' | 'card_show' | 'other';
type CardType = 'all' | 'graded' | 'ungraded';

interface PnlRow {
  label: string;
  show_id?: string | null;
  num_sales: number;
  total_revenue: number;
  total_fees: number;
  total_net: number;
  total_cost_basis: number;
  total_profit: number;
}

interface CardShowBreakdown {
  slab_count: number;
  slab_revenue: number;
  slab_fees: number;
  slab_net: number;
  slab_cost: number;
  raw_count: number;
  raw_revenue: number;
  raw_fees: number;
  raw_net: number;
  raw_cost: number;
}

interface YearRow {
  year: string;
  num_sales: number;
  total_revenue: number;
  total_fees: number;
  total_net: number;
  total_cost_basis: number;
  total_profit: number;
}

function fmtProfit(n: number) {
  return (n >= 0 ? '+' : '') + formatCurrency(n);
}

function roi(profit: number, cost: number) {
  if (!cost) return null;
  return ((profit / cost) * 100).toFixed(1) + '%';
}

function profitPct(profit: number, revenue: number) {
  if (!revenue) return '—';
  return ((profit / revenue) * 100).toFixed(1) + '%';
}

function ProfitCell({ value }: { value: number }) {
  return (
    <span className={value >= 0 ? 'text-green-400' : 'text-red-400'}>
      {fmtProfit(value)}
    </span>
  );
}

function pct(a: number, b: number) {
  if (!b) return '—';
  return ((a / b) * 100).toFixed(1) + '%';
}

function CardShowBreakdownRow({ showId, colSpan }: { showId: string; colSpan: number }) {
  const { data, isLoading } = useQuery<CardShowBreakdown>({
    queryKey: ['card-show-breakdown', showId],
    queryFn: () => api.get(`/reports/card-show-breakdown/${showId}`).then((r) => r.data),
  });

  if (isLoading) {
    return (
      <tr><td colSpan={colSpan} className="py-3 pl-6 text-xs text-zinc-600">Loading breakdown…</td></tr>
    );
  }
  if (!data) return null;

  const slabCount  = Number(data.slab_count);
  const rawCount   = Number(data.raw_count);
  const slabRev    = Number(data.slab_revenue);
  const slabCost   = Number(data.slab_cost);
  const slabNet    = Number(data.slab_net);
  const rawRev     = Number(data.raw_revenue);
  const rawCost    = Number(data.raw_cost);
  const rawNet     = Number(data.raw_net);
  const slabProfit = slabNet - slabCost;
  const rawProfit  = rawNet  - rawCost;
  const totalCount = slabCount + rawCount;
  const stat = (label: string, value: string) => (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-zinc-600 uppercase tracking-wide">{label}</span>
      <span className="text-xs font-medium text-zinc-300">{value}</span>
    </div>
  );

  return (
    <tr className="bg-zinc-900/60">
      <td colSpan={colSpan} className="pb-4 pt-2 pl-8 pr-4">
        <div className="space-y-3">
          {/* Graded | Ungraded | Percentages all in one row */}
          <div className="flex">
            <div className="flex-1 space-y-1.5">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Graded</p>
              <div className="flex gap-6">
                {stat('# Slabs Sold', String(slabCount))}
                {stat('Gross', formatCurrency(slabRev))}
                {stat('Slab Cost', formatCurrency(slabCost))}
                {stat('Net', formatCurrency(slabNet))}
              </div>
            </div>
            <div className="w-px self-stretch bg-zinc-800 mx-6" />
            <div className="flex-1 space-y-1.5">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Ungraded</p>
              <div className="flex gap-6">
                {stat('# Cards Sold', String(rawCount))}
                {stat('Gross Raw', formatCurrency(rawRev))}
                {stat('Raw Cost', formatCurrency(rawCost))}
                {stat('Net Raw', formatCurrency(rawNet))}
              </div>
            </div>
            <div className="w-px self-stretch bg-zinc-800 mx-6" />
            <div className="flex-1 space-y-1.5">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Stats</p>
              <div className="flex gap-6">
                {stat('Slab ROI %', pct(slabProfit, slabCost))}
                {stat('Raw ROI %', pct(rawProfit, rawCost))}
                {stat('Slab % Profit', pct(slabProfit, slabProfit + rawProfit))}
                {stat('Raw % Profit', pct(rawProfit, slabProfit + rawProfit))}
                {stat('% Slabs', pct(slabCount, totalCount))}
                {stat('% Raw', pct(rawCount, totalCount))}
              </div>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

export function Reports() {
  const [groupBy] = useState<'month' | 'platform' | 'game'>('month');
  const [channel, setChannel] = useState<Channel>('all');
  const [cardType, setCardType] = useState<CardType>('all');
  const [expandedYears, setExpandedYears] = useState<Set<string>>(new Set());
  const [expandedShows, setExpandedShows] = useState<Set<string>>(new Set());
  const [showTrend, setShowTrend] = useState(false);

  const { data: yearlyData, isLoading: yearlyLoading } = useQuery<{ rows: YearRow[]; totals: YearRow }>({
    queryKey: ['yearly-summary', channel, cardType],
    queryFn: () => api.get('/reports/yearly', { params: { channel, cardType } }).then((r) => r.data),
  });

  const { data: monthlyData, isLoading: monthlyLoading } = useQuery<{ rows: PnlRow[]; totals: PnlRow }>({
    queryKey: ['pnl', groupBy, channel, cardType],
    queryFn: () => api.get('/reports/pnl', { params: { groupBy, channel, cardType } }).then((r) => r.data),
  });

  const toggleYear = (year: string) => {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };

  const toggleShow = (id: string) => {
    setExpandedShows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Group monthly rows by year for the collapsible view
  const monthsByYear: Record<string, PnlRow[]> = {};
  if (groupBy === 'month' && monthlyData?.rows) {
    for (const row of monthlyData.rows) {
      const year = row.label.slice(0, 4);
      if (!monthsByYear[year]) monthsByYear[year] = [];
      monthsByYear[year].push(row);
    }
  }

  const tableHeaders = (
    <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500 uppercase tracking-wide">
      <th className="py-2 font-medium">Period</th>
      <th className="py-2 font-medium text-right"># Sales</th>
      <th className="py-2 font-medium text-right">Revenue</th>
      <th className="py-2 font-medium text-right">Fees</th>
      <th className="py-2 font-medium text-right">Net</th>
      <th className="py-2 font-medium text-right">Cost Basis</th>
      <th className="py-2 font-medium text-right">Profit</th>
      <th className="py-2 font-medium text-right">Profit %</th>
      <th className="py-2 font-medium text-right">ROI</th>
    </tr>
  );

  return (
    <div className="p-6 space-y-6 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-zinc-100">Reports</h1>
        <button
          onClick={() => setShowTrend((v) => !v)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
            showTrend ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
          )}
        >
          <TrendingUp size={14} />
          Card Trend
        </button>
        {/* groupBy selector — hidden for now, keep for future use
        <Select
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}
          className="w-36"
        >
          <option value="month">By Month</option>
          <option value="platform">By Platform</option>
          <option value="game">By Game</option>
        </Select>
        */}
      </div>

      <CardTrendModal open={showTrend} onClose={() => setShowTrend(false)} />

      {/* Channel filter */}
      <div className="border-b border-zinc-800 pb-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Channel</p>
          <div className="flex gap-1">
            {([
              { value: 'all',       label: 'All' },
              { value: 'ebay',      label: 'eBay' },
              { value: 'card_show', label: 'Card Shows' },
              { value: 'other',     label: 'Other' },
            ] as { value: Channel; label: string }[]).map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setChannel(value)}
                className={cn(
                  'px-3 py-0.5 rounded text-xs font-medium transition-colors',
                  channel === value ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Card type filter — below the hr, hidden for card show channel */}
      {channel !== 'card_show' && (
        <div className="flex items-center justify-between -mt-3">
          <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Card Type</p>
          <div className="flex gap-1">
            {([
              { value: 'all',      label: 'All' },
              { value: 'graded',   label: 'Graded' },
              { value: 'ungraded', label: 'Ungraded' },
            ] as { value: CardType; label: string }[]).map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setCardType(value)}
                className={cn(
                  'px-3 py-0.5 rounded text-xs font-medium transition-colors',
                  cardType === value ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* All-time summary cards */}
      {yearlyData?.totals && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {[
            { label: 'Sales', value: String(yearlyData.totals.num_sales) },
            { label: 'Revenue', value: formatCurrency(yearlyData.totals.total_revenue) },
            { label: 'Fees', value: formatCurrency(yearlyData.totals.total_fees) },
            { label: 'Net', value: formatCurrency(yearlyData.totals.total_net) },
            { label: 'Cost Basis', value: formatCurrency(yearlyData.totals.total_cost_basis) },
            { label: 'Total Profit', value: fmtProfit(yearlyData.totals.total_profit), profit: yearlyData.totals.total_profit },
          ].map(({ label, value, profit }) => (
            <Card key={label} className="text-center">
              <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
              <p className={`text-lg font-semibold mt-1 ${profit != null ? (profit >= 0 ? 'text-green-400' : 'text-red-400') : 'text-zinc-100'}`}>{value}</p>
            </Card>
          ))}
        </div>
      )}

      {/* Annual Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Annual Summary</CardTitle>
        </CardHeader>
        {yearlyLoading ? (
          <div className="text-center py-8 text-zinc-600 text-sm">Loading…</div>
        ) : !yearlyData?.rows.length ? (
          <div className="text-center py-8 text-zinc-600 text-sm">No sales data.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500 uppercase tracking-wide">
                <th className="py-2 font-medium">Year</th>
                <th className="py-2 font-medium text-right"># Sales</th>
                <th className="py-2 font-medium text-right">Revenue</th>
                <th className="py-2 font-medium text-right">Fees</th>
                <th className="py-2 font-medium text-right">Net</th>
                <th className="py-2 font-medium text-right">Cost Basis</th>
                <th className="py-2 font-medium text-right">Profit</th>
                <th className="py-2 font-medium text-right">Profit %</th>
                <th className="py-2 font-medium text-right">ROI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {yearlyData.rows.map((row) => (
                <tr key={row.year} className="font-medium">
                  <td className="py-2 text-zinc-200">{row.year}</td>
                  <td className="py-2 text-right text-zinc-400">{row.num_sales}</td>
                  <td className="py-2 text-right text-zinc-300">{formatCurrency(row.total_revenue)}</td>
                  <td className="py-2 text-right text-zinc-500">{formatCurrency(row.total_fees)}</td>
                  <td className="py-2 text-right text-zinc-300">{formatCurrency(row.total_net)}</td>
                  <td className="py-2 text-right text-zinc-500">{formatCurrency(row.total_cost_basis)}</td>
                  <td className="py-2 text-right"><ProfitCell value={row.total_profit} /></td>
                  <td className="py-2 text-right text-zinc-400">{profitPct(row.total_profit, row.total_revenue)}</td>
                  <td className="py-2 text-right text-zinc-400">{roi(row.total_profit, row.total_cost_basis) ?? '—'}</td>
                </tr>
              ))}
              {/* All-time totals row */}
              <tr className="border-t-2 border-zinc-700 bg-zinc-900/60 font-semibold">
                <td className="py-2 text-zinc-100">All Time</td>
                <td className="py-2 text-right text-zinc-300">{yearlyData.totals.num_sales}</td>
                <td className="py-2 text-right text-zinc-100">{formatCurrency(yearlyData.totals.total_revenue)}</td>
                <td className="py-2 text-right text-zinc-400">{formatCurrency(yearlyData.totals.total_fees)}</td>
                <td className="py-2 text-right text-zinc-100">{formatCurrency(yearlyData.totals.total_net)}</td>
                <td className="py-2 text-right text-zinc-400">{formatCurrency(yearlyData.totals.total_cost_basis)}</td>
                <td className="py-2 text-right"><ProfitCell value={yearlyData.totals.total_profit} /></td>
                <td className="py-2 text-right text-zinc-300">{profitPct(yearlyData.totals.total_profit, yearlyData.totals.total_revenue)}</td>
                <td className="py-2 text-right text-zinc-300">{roi(yearlyData.totals.total_profit, yearlyData.totals.total_cost_basis) ?? '—'}</td>
              </tr>
            </tbody>
          </table>
        )}
      </Card>

      {/* Monthly / Platform / Game breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>
            {channel === 'card_show' ? 'By Card Show' : groupBy === 'month' ? 'Monthly Breakdown' : groupBy === 'platform' ? 'By Platform' : 'By Game'}
          </CardTitle>
        </CardHeader>
        {monthlyLoading ? (
          <div className="text-center py-8 text-zinc-600 text-sm">Loading…</div>
        ) : !monthlyData?.rows.length ? (
          <div className="text-center py-8 text-zinc-600 text-sm">No sales data.</div>
        ) : channel === 'card_show' ? (
          <table className="w-full text-sm">
            <thead>{tableHeaders}</thead>
            <tbody className="divide-y divide-zinc-800/60">
              {monthlyData.rows.map((row) => {
                const isExpanded = row.show_id ? expandedShows.has(row.show_id) : false;
                return [
                  <tr
                    key={row.label}
                    className={cn('cursor-pointer transition-colors', row.show_id ? 'hover:bg-zinc-800/40' : '')}
                    onClick={() => row.show_id && toggleShow(row.show_id)}
                  >
                    <td className="py-2 text-zinc-200 font-medium">
                      <span className="inline-flex items-center gap-1">
                        {row.show_id ? (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span className="w-[14px]" />}
                        {row.label}
                      </span>
                    </td>
                    <td className="py-2 text-right text-zinc-400">{row.num_sales}</td>
                    <td className="py-2 text-right text-zinc-300">{formatCurrency(row.total_revenue)}</td>
                    <td className="py-2 text-right text-zinc-500">{formatCurrency(row.total_fees)}</td>
                    <td className="py-2 text-right text-zinc-300">{formatCurrency(row.total_net)}</td>
                    <td className="py-2 text-right text-zinc-500">{formatCurrency(row.total_cost_basis)}</td>
                    <td className="py-2 text-right"><ProfitCell value={row.total_profit} /></td>
                    <td className="py-2 text-right text-zinc-400">{profitPct(row.total_profit, row.total_revenue)}</td>
                    <td className="py-2 text-right text-zinc-400">{roi(row.total_profit, row.total_cost_basis) ?? '—'}</td>
                  </tr>,
                  ...(isExpanded && row.show_id
                    ? [<CardShowBreakdownRow key={`bd-${row.show_id}`} showId={row.show_id} colSpan={9} />]
                    : []),
                ];
              })}
            </tbody>
          </table>
        ) : groupBy === 'month' ? (
          <table className="w-full text-sm">
            <thead>{tableHeaders}</thead>
            <tbody className="divide-y divide-zinc-800/60">
              {Object.entries(monthsByYear)
                .sort(([a], [b]) => b.localeCompare(a))
                .map(([year, months]) => {
                  const isExpanded = expandedYears.has(year);
                  const yTotals = months.reduce(
                    (acc, m) => ({
                      num_sales: acc.num_sales + m.num_sales,
                      total_revenue: acc.total_revenue + m.total_revenue,
                      total_fees: acc.total_fees + m.total_fees,
                      total_net: acc.total_net + m.total_net,
                      total_cost_basis: acc.total_cost_basis + m.total_cost_basis,
                      total_profit: acc.total_profit + m.total_profit,
                    }),
                    { num_sales: 0, total_revenue: 0, total_fees: 0, total_net: 0, total_cost_basis: 0, total_profit: 0 }
                  );
                  return [
                    // Year header row (clickable to expand/collapse)
                    <tr
                      key={`year-${year}`}
                      className="bg-zinc-800/50 cursor-pointer hover:bg-zinc-800/80 transition-colors"
                      onClick={() => toggleYear(year)}
                    >
                      <td className="py-2 font-semibold text-zinc-100">
                        <span className="inline-flex items-center gap-1">
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          {year}
                        </span>
                      </td>
                      <td className="py-2 text-right text-zinc-300 font-medium">{yTotals.num_sales}</td>
                      <td className="py-2 text-right text-zinc-200 font-medium">{formatCurrency(yTotals.total_revenue)}</td>
                      <td className="py-2 text-right text-zinc-400">{formatCurrency(yTotals.total_fees)}</td>
                      <td className="py-2 text-right text-zinc-200 font-medium">{formatCurrency(yTotals.total_net)}</td>
                      <td className="py-2 text-right text-zinc-400">{formatCurrency(yTotals.total_cost_basis)}</td>
                      <td className="py-2 text-right font-semibold"><ProfitCell value={yTotals.total_profit} /></td>
                      <td className="py-2 text-right text-zinc-400">{profitPct(yTotals.total_profit, yTotals.total_revenue)}</td>
                      <td className="py-2 text-right text-zinc-400">{roi(yTotals.total_profit, yTotals.total_cost_basis) ?? '—'}</td>
                    </tr>,
                    // Month rows (only when expanded)
                    ...(isExpanded
                      ? months
                          .slice()
                          .sort((a, b) => b.label.localeCompare(a.label))
                          .map((row) => (
                            <tr key={row.label} className="hover:bg-zinc-800/20">
                              <td className="py-1.5 pl-6 text-zinc-400">{row.label}</td>
                              <td className="py-1.5 text-right text-zinc-500">{row.num_sales}</td>
                              <td className="py-1.5 text-right text-zinc-300">{formatCurrency(row.total_revenue)}</td>
                              <td className="py-1.5 text-right text-zinc-500">{formatCurrency(row.total_fees)}</td>
                              <td className="py-1.5 text-right text-zinc-300">{formatCurrency(row.total_net)}</td>
                              <td className="py-1.5 text-right text-zinc-500">{formatCurrency(row.total_cost_basis)}</td>
                              <td className="py-1.5 text-right"><ProfitCell value={row.total_profit} /></td>
                              <td className="py-1.5 text-right text-zinc-500">{profitPct(row.total_profit, row.total_revenue)}</td>
                              <td className="py-1.5 text-right text-zinc-500">{roi(row.total_profit, row.total_cost_basis) ?? '—'}</td>
                            </tr>
                          ))
                      : []),
                  ];
                })}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500 uppercase tracking-wide">
                <th className="py-2 font-medium">{groupBy === 'platform' ? 'Platform' : 'Game'}</th>
                <th className="py-2 font-medium text-right"># Sales</th>
                <th className="py-2 font-medium text-right">Revenue</th>
                <th className="py-2 font-medium text-right">Fees</th>
                <th className="py-2 font-medium text-right">Net</th>
                <th className="py-2 font-medium text-right">Cost Basis</th>
                <th className="py-2 font-medium text-right">Profit</th>
                <th className="py-2 font-medium text-right">Profit %</th>
                <th className="py-2 font-medium text-right">ROI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {monthlyData.rows.map((row) => (
                <tr key={row.label} className="hover:bg-zinc-800/20">
                  <td className="py-2 text-zinc-300">{row.label ?? '—'}</td>
                  <td className="py-2 text-right text-zinc-400">{row.num_sales}</td>
                  <td className="py-2 text-right text-zinc-300">{formatCurrency(row.total_revenue)}</td>
                  <td className="py-2 text-right text-zinc-500">{formatCurrency(row.total_fees)}</td>
                  <td className="py-2 text-right text-zinc-300">{formatCurrency(row.total_net)}</td>
                  <td className="py-2 text-right text-zinc-500">{formatCurrency(row.total_cost_basis)}</td>
                  <td className="py-2 text-right"><ProfitCell value={row.total_profit} /></td>
                  <td className="py-2 text-right text-zinc-400">{profitPct(row.total_profit, row.total_revenue)}</td>
                  <td className="py-2 text-right text-zinc-400">{roi(row.total_profit, row.total_cost_basis) ?? '—'}</td>
                </tr>
              ))}
              {/* Totals */}
              {monthlyData.totals && (
                <tr className="border-t-2 border-zinc-700 bg-zinc-900/60 font-semibold">
                  <td className="py-2 text-zinc-100">Total</td>
                  <td className="py-2 text-right text-zinc-300">{monthlyData.totals.num_sales}</td>
                  <td className="py-2 text-right text-zinc-100">{formatCurrency(monthlyData.totals.total_revenue)}</td>
                  <td className="py-2 text-right text-zinc-400">{formatCurrency(monthlyData.totals.total_fees)}</td>
                  <td className="py-2 text-right text-zinc-100">{formatCurrency(monthlyData.totals.total_net)}</td>
                  <td className="py-2 text-right text-zinc-400">{formatCurrency(monthlyData.totals.total_cost_basis)}</td>
                  <td className="py-2 text-right"><ProfitCell value={monthlyData.totals.total_profit} /></td>
                  <td className="py-2 text-right text-zinc-300">{profitPct(monthlyData.totals.total_profit, monthlyData.totals.total_revenue)}</td>
                  <td className="py-2 text-right text-zinc-300">{roi(monthlyData.totals.total_profit, monthlyData.totals.total_cost_basis) ?? '—'}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
