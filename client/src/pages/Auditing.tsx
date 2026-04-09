import { ShieldCheck } from 'lucide-react';

export function Auditing() {
  return (
    <div className="p-6 max-w-3xl mx-auto h-full overflow-y-auto">
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center">
          <ShieldCheck size={22} className="text-zinc-500" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-zinc-200">Inventory Audit</h1>
          <p className="text-sm text-zinc-500 mt-1">Coming soon — advanced compliance auditing and reporting.</p>
        </div>
        <span className="text-xs px-3 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-500">Disabled</span>
      </div>
    </div>
  );
}
