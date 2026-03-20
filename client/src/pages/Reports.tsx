import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { Card, CardHeader, CardTitle } from '../components/ui/Card';
import { Select } from '../components/ui/Select';
import { formatCurrency } from '../lib/utils';

interface PnlRow {
  label: string;
  num_sales: number;
  total_revenue: number;
  total_fees: number;
  total_net: number;
  total_cost_basis: number;
  total_profit: number;
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

function ProfitCell({ value }: { value: number }) {
  return (
    <span className={value >= 0 ? 'text-green-400' : 'text-red-400'}>
      {fmtProfit(value)}
    </span>
  );
}

export function Reports() {
  const [groupBy, setGroupBy] = useState<'month' | 'platform' | 'game'>('month');
  const [expandedYears, setExpandedYears] = useState<Set<string>>(new Set());

  const { data: yearlyData, isLoading: yearlyLoading } = useQuery<{ rows: YearRow[]; totals: YearRow }>({
    queryKey: ['yearly-summary'],
    queryFn: () => api.get('/reports/yearly').then((r) => r.data),
  });

  const { data: monthlyData, isLoading: monthlyLoading } = useQuery<{ rows: PnlRow[]; totals: PnlRow }>({
    queryKey: ['pnl', groupBy],
    queryFn: () => api.get('/reports/pnl', { params: { groupBy } }).then((r) => r.data),
  });

  const toggleYear = (year: string) => {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
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
      <th className="py-2 font-medium text-right">ROI</th>
    </tr>
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-zinc-100">Reports</h1>
        <Select
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value as typeof groupBy)}
          className="w-36"
        >
          <option value="month">By Month</option>
          <option value="platform">By Platform</option>
          <option value="game">By Game</option>
        </Select>
      </div>

      {/* All-time summary cards */}
      {yearlyData?.totals && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {[
            { label: 'All-Time Sales', value: String(yearlyData.totals.num_sales) },
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
            {groupBy === 'month' ? 'Monthly Breakdown' : groupBy === 'platform' ? 'By Platform' : 'By Game'}
          </CardTitle>
        </CardHeader>
        {monthlyLoading ? (
          <div className="text-center py-8 text-zinc-600 text-sm">Loading…</div>
        ) : !monthlyData?.rows.length ? (
          <div className="text-center py-8 text-zinc-600 text-sm">No sales data.</div>
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
