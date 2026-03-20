import { useQuery } from '@tanstack/react-query';
import { Package, TrendingUp, Star, DollarSign } from 'lucide-react';
import { api } from '../lib/api';
import { Card } from '../components/ui/Card';
import { formatCurrency } from '../lib/utils';

interface InventoryRow { status: string; count: number; total_cost: number }
interface SalesRow { count: number; total_net: number; total_profit: number }

function StatCard({ icon: Icon, label, value, sub }: {
  icon: React.ElementType; label: string; value: string; sub?: string;
}) {
  return (
    <Card className="flex items-start gap-4">
      <div className="p-2 rounded-lg bg-indigo-600/20">
        <Icon size={18} className="text-indigo-400" />
      </div>
      <div>
        <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
        <p className="text-xl font-semibold text-zinc-100 mt-0.5">{value}</p>
        {sub && <p className="text-xs text-zinc-500 mt-0.5">{sub}</p>}
      </div>
    </Card>
  );
}

export function Dashboard() {
  const { data: inventory } = useQuery<InventoryRow[]>({
    queryKey: ['inventory-value'],
    queryFn: () => api.get('/reports/inventory-value').then((r) => r.data),
  });

  const { data: sales } = useQuery<{ last_30_days: SalesRow }>({
    queryKey: ['sales-summary'],
    queryFn: () => api.get('/reports/summary').then((r) => r.data),
  });

  const totalCards = inventory?.reduce((s, r) => s + (r.count ?? 0), 0) ?? 0;
  const totalCost = inventory?.reduce((s, r) => s + (r.total_cost ?? 0), 0) ?? 0;
  const gradingCount = inventory?.find((r) => r.status === 'grading_submitted')?.count ?? 0;
  const salesProfit = sales?.last_30_days?.total_profit ?? 0;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold text-zinc-100">Dashboard</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Package} label="Total Cards" value={String(totalCards)} sub="in inventory" />
        <StatCard icon={DollarSign} label="Cost Basis" value={formatCurrency(totalCost)} sub="total invested" />
        <StatCard icon={Star} label="At Graders" value={String(gradingCount)} sub="cards submitted" />
        <StatCard
          icon={TrendingUp}
          label="30-Day Profit"
          value={formatCurrency(salesProfit)}
          sub="net of fees & cost"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
    </div>
  );
}
