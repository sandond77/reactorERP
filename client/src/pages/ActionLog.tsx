import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, User, ChevronDown, ChevronRight, RotateCcw, Loader2 } from 'lucide-react';
import { api } from '../lib/api';
import { formatDate } from '../lib/utils';
import toast from 'react-hot-toast';

interface AuditEntry {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor: string;
  actor_name: string | null;
  old_data: unknown;
  new_data: unknown;
  created_at: string;
}

interface AuditResponse {
  data: AuditEntry[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

const ACTION_LABELS: Record<string, string> = {
  created: 'Created',
  updated: 'Updated',
  deleted: 'Deleted',
  restored: 'Restored',
  status_changed: 'Status Changed',
};

const ENTITY_LABELS: Record<string, string> = {
  card_instances: 'Card',
  sales: 'Sale',
  raw_purchases: 'Raw Purchase',
  expenses: 'Expense',
  grading_batches: 'Grading Batch',
  listings: 'Listing',
  trades: 'Trade',
  card_shows: 'Card Show',
};

function actionColor(action: string) {
  if (action === 'deleted') return 'text-red-400 bg-red-400/10';
  if (action === 'created') return 'text-green-400 bg-green-400/10';
  if (action === 'restored') return 'text-blue-400 bg-blue-400/10';
  if (action === 'status_changed') return 'text-yellow-400 bg-yellow-400/10';
  return 'text-zinc-400 bg-zinc-700/40';
}

function EntityName({ entry }: { entry: AuditEntry }) {
  const data = (entry.old_data ?? entry.new_data) as Record<string, unknown> | null;
  // Try various display name fields depending on entity type
  const name = data?.card_name_override ?? data?.card_name ?? data?.description
    ?? data?.expense_id ?? data?.purchase_id ?? data?.batch_id ?? data?.trade_label
    ?? data?.name ?? null;
  if (name) return <span className="text-zinc-200 font-medium">{name as string}</span>;
  return <span className="text-zinc-500 font-mono text-xs">{entry.entity_id.slice(0, 8)}…</span>;
}

function DataDiff({ entry, open }: { entry: AuditEntry; open: boolean }) {
  if (!open) return null;
  const data = entry.action === 'deleted' ? entry.old_data : entry.new_data ?? entry.old_data;
  if (!data) return null;
  return (
    <pre className="mt-2 text-xs text-zinc-400 bg-zinc-900 rounded-lg p-3 overflow-x-auto max-h-60 leading-relaxed">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

// Double-confirm revert button — step 0: idle, step 1: first confirm, step 2: loading
function RevertButton({ entry, onReverted }: { entry: AuditEntry; onReverted: () => void }) {
  const [step, setStep] = useState<0 | 1 | 2>(0);

  async function handleRevert() {
    if (step === 0) { setStep(1); return; }
    setStep(2);
    try {
      await api.post(`/audit/revert/${entry.id}`);
      toast.success('Record restored to inventory');
      onReverted();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? 'Failed to restore record';
      toast.error(msg);
      setStep(0);
    }
  }

  if (step === 0) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); handleRevert(); }}
        className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-blue-400 transition-colors"
      >
        <RotateCcw size={11} />
        Revert
      </button>
    );
  }

  if (step === 2) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
        <Loader2 size={11} className="animate-spin" />
        Restoring…
      </span>
    );
  }

  // step === 1: confirm
  return (
    <span className="inline-flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <span className="text-xs text-yellow-400">Restore this record?</span>
      <button
        onClick={(e) => { e.stopPropagation(); setStep(0); }}
        className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        Cancel
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); handleRevert(); }}
        className="text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors"
      >
        Confirm Restore
      </button>
    </span>
  );
}

interface AuditActor {
  actor: string;
  name: string;
}

export function ActionLog() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [actorName, setActorName] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data: actorsData } = useQuery<{ data: AuditActor[] }>({
    queryKey: ['audit-actors'],
    queryFn: () => api.get('/audit/actors').then(r => r.data),
    staleTime: 60_000,
  });
  const actors = actorsData?.data ?? [];

  const { data, isLoading } = useQuery<{ data: AuditResponse }>({
    queryKey: ['audit-log', page, actorName, action, entityType],
    queryFn: () => api.get('/audit/log', { params: { page, limit: 50, actor_name: actorName || undefined, action: action || undefined, entity_type: entityType || undefined } }).then(r => r.data),
  });

  const result = data?.data;
  const entries = result?.data ?? [];
  const totalPages = result?.total_pages ?? 1;
  const total = result?.total ?? 0;

  // Map of entity_id → most recent restored timestamp, to check per-deletion
  const lastRestoredAt = new Map<string, string>();
  entries.filter(e => e.action === 'restored').forEach(e => {
    const existing = lastRestoredAt.get(e.entity_id);
    if (!existing || e.created_at > existing) lastRestoredAt.set(e.entity_id, e.created_at);
  });

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }

  function onReverted() {
    qc.invalidateQueries({ queryKey: ['audit-log'] });
    // Invalidate inventory queries so the restored card shows up
    qc.invalidateQueries({ queryKey: ['raw-overall'] });
    qc.invalidateQueries({ queryKey: ['inventory-slabs'] });
    qc.invalidateQueries({ queryKey: ['card-copies'] });
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5 h-full overflow-y-auto">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Action Log</h1>
        <p className="text-sm text-zinc-500 mt-0.5">All actions performed by you or the AI agent. Deleted records can be restored.</p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={actorName}
          onChange={(e) => { setActorName(e.target.value); setPage(1); }}
          className="h-8 w-40 px-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300 focus:outline-none focus:border-indigo-500"
        >
          <option value="">All actors</option>
          {actors.map((a) => (
            <option key={`${a.actor}:${a.name}`} value={a.name}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(1); }}
          className="h-8 w-36 px-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300 focus:outline-none focus:border-indigo-500"
        >
          <option value="">All actions</option>
          <option value="created">Created</option>
          <option value="updated">Updated</option>
          <option value="deleted">Deleted</option>
          <option value="restored">Restored</option>
          <option value="status_changed">Status Changed</option>
        </select>
        <select
          value={entityType}
          onChange={(e) => { setEntityType(e.target.value); setPage(1); }}
          className="h-8 w-36 px-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300 focus:outline-none focus:border-indigo-500"
        >
          <option value="">All types</option>
          <option value="card_instances">Card</option>
          <option value="sales">Sale</option>
          <option value="raw_purchases">Raw Purchase</option>
          <option value="expenses">Expense</option>
          <option value="grading_batches">Grading Batch</option>
          <option value="listings">Listing</option>
          <option value="trades">Trade</option>
        </select>
        {(actorName || action || entityType) && (
          <button
            onClick={() => { setActorName(''); setAction(''); setEntityType(''); setPage(1); }}
            className="h-8 px-3 text-xs text-zinc-400 hover:text-zinc-100 bg-zinc-800 border border-zinc-700 rounded-lg transition-colors"
          >
            Clear Filters
          </button>
        )}
        {total > 0 && <span className="text-xs text-zinc-500 ml-auto">{total.toLocaleString()} entries</span>}
      </div>

      {/* Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="px-5 py-10 text-center text-zinc-500 text-sm">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="px-5 py-10 text-center text-zinc-500 text-sm">No log entries found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-xs text-zinc-500 uppercase tracking-wide">
                <th className="px-4 py-3 text-left w-6"></th>
                <th className="px-4 py-3 text-left">Date/Time</th>
                <th className="px-4 py-3 text-left w-36">By</th>
                <th className="px-4 py-3 text-left">Action</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Record</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const isOpen = expanded.has(entry.id);
                const lastRestore = lastRestoredAt.get(entry.entity_id);
                const canRevert = entry.action === 'deleted' && entry.entity_type === 'card_instances'
                  && (!lastRestore || lastRestore < entry.created_at);
                return (
                  <>
                    <tr
                      key={entry.id}
                      onClick={() => toggleExpand(entry.id)}
                      className="border-b border-zinc-800/60 last:border-0 hover:bg-zinc-800/40 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 text-zinc-600">
                        {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                      </td>
                      <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">
                        {formatDate(entry.created_at)}
                        <span className="ml-1.5 text-zinc-600 text-xs">
                          {new Date(entry.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${entry.actor === 'agent' ? 'text-indigo-400 bg-indigo-400/10' : 'text-zinc-300 bg-zinc-700/50'}`}>
                          {entry.actor === 'agent' ? <Bot size={11} /> : <User size={11} />}
                          {entry.actor_name ?? (entry.actor === 'agent' ? 'AI Agent' : 'User')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${actionColor(entry.action)}`}>
                          {ACTION_LABELS[entry.action] ?? entry.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-500 text-xs">
                        {ENTITY_LABELS[entry.entity_type] ?? entry.entity_type}
                      </td>
                      <td className="px-4 py-3">
                        <EntityName entry={entry} />
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={`${entry.id}-detail`} className="border-b border-zinc-800/60 last:border-0 bg-zinc-800/20">
                        <td colSpan={6} className="px-8 pb-4 pt-1">
                          <DataDiff entry={entry} open={isOpen} />
                          {canRevert && (
                            <div className="mt-3">
                              <RevertButton entry={entry} onReverted={onReverted} />
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 text-sm rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 disabled:opacity-40 hover:bg-zinc-700 transition-colors"
          >
            Previous
          </button>
          <span className="text-xs text-zinc-500">Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1.5 text-sm rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 disabled:opacity-40 hover:bg-zinc-700 transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
