import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckSquare, X, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../ui/Button';
import { VariantCodeSelect } from '../catalog/VariantCodeSelect';
import toast from 'react-hot-toast';

// Action Items surface: a small pill in the Dashboard header, hidden entirely
// when there are none. Click opens a modal listing categorized one-time chores
// (legacy variants today, future migrations later). Each source renders its
// own resolver inline in the modal — no separate page needed.

interface LegacyVariantEntry {
  id: string;
  card_name: string;
  set_name: string | null;
  card_number: string | null;
  game: string;
  variant: string;
  sku: string | null;
}

// Preview the SKU the server would produce for a legacy row when the user
// picks a code. Legacy row SKUs are always 4-segment (the pre-migration
// generatePartNumber stripped letter suffixes and never wrote a 5th segment)
// so we can safely append. Returned as {base, tail} so the tail can be
// visually distinguished as the new part of the SKU.
function previewSku(currentSku: string | null, pickedCode: string | null): { base: string; tail: string | null } | null {
  if (!currentSku) return null;
  if (pickedCode === null) return { base: currentSku, tail: null };
  return { base: currentSku, tail: pickedCode };
}

interface ActionItemGroup {
  type: string;
  title: string;
  description: string;
  count: number;
  entries: unknown[];
}

export function ActionItemsPill() {
  const [open, setOpen] = useState(false);
  const { data: items = [] } = useQuery<ActionItemGroup[]>({
    queryKey: ['action-items'],
    queryFn: () => api.get('/action-items').then(r => r.data.data),
  });
  const total = items.reduce((sum, g) => sum + g.count, 0);
  if (total === 0) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 transition-colors text-[11px] font-semibold uppercase tracking-wider"
      >
        <CheckSquare size={11} />
        {total} Action Item{total !== 1 ? 's' : ''}
      </button>
      {open && <ActionItemsModal items={items} onClose={() => setOpen(false)} />}
    </>
  );
}

function ActionItemsModal({ items, onClose }: { items: ActionItemGroup[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2">
            <CheckSquare size={15} className="text-amber-400" />
            <h2 className="text-base font-semibold text-zinc-100">Action Items</h2>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {items.map((group) => (
            <div key={group.type} className="border-b border-zinc-800 last:border-b-0">
              {group.type === 'legacy_variants' && (
                <LegacyVariantsResolver
                  title={group.title}
                  description={group.description}
                  entries={group.entries as LegacyVariantEntry[]}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LegacyVariantsResolver({
  title,
  description,
  entries,
}: {
  title: string;
  description: string;
  entries: LegacyVariantEntry[];
}) {
  const qc = useQueryClient();
  // Local picks: entry.id → chosen enum code (or null = clear it, or undefined = untouched)
  const [picks, setPicks] = useState<Record<string, string | null | undefined>>({});
  const [saving, setSaving] = useState(false);

  const dirtyIds = Object.keys(picks).filter((id) => picks[id] !== undefined);
  const dirtyCount = dirtyIds.length;

  const saveMut = useMutation({
    mutationFn: async () => {
      // Sequential to keep error handling simple; there are typically <20 of these.
      for (const id of dirtyIds) {
        const code = picks[id];
        await api.patch(`/catalog/${id}`, { variant: code ?? null });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['action-items'] });
      qc.invalidateQueries({ queryKey: ['inventory-summary'] });
      qc.invalidateQueries({ queryKey: ['catalog-search'] });
      setPicks({});
      toast.success(`Migrated ${dirtyCount} entr${dirtyCount === 1 ? 'y' : 'ies'}`);
    },
    onError: () => toast.error('Failed to save. Try again.'),
    onSettled: () => setSaving(false),
  });

  async function handleSave() {
    if (dirtyCount === 0) return;
    setSaving(true);
    saveMut.mutate();
  }

  return (
    <div className="p-5 space-y-4">
      <div>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
          <span className="text-[10px] font-semibold text-amber-300 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-full">
            {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}
          </span>
        </div>
        <p className="text-xs text-zinc-500 leading-relaxed">{description}</p>
      </div>

      <div className="space-y-2">
        {entries.map((e) => {
          const picked = picks[e.id];
          const preview = picked === undefined ? null : previewSku(e.sku, picked);
          return (
            <div key={e.id} className="grid grid-cols-[1fr_14rem] gap-3 items-start p-3 rounded-lg border border-zinc-800 bg-zinc-900/40">
              <div className="min-w-0">
                <p className="text-sm text-zinc-100 truncate">{e.card_name}</p>
                <p className="text-[11px] text-zinc-500 truncate">
                  {e.set_name ?? '—'}{e.card_number ? ` · #${e.card_number}` : ''} · <span className="text-zinc-600 capitalize">{e.game.replace(/_/g, ' ')}</span>
                </p>
                <p className="text-[11px] text-zinc-400 mt-1">
                  Current: <span className="italic text-zinc-300">"{e.variant}"</span>
                </p>
                {e.sku && (
                  <p className="text-[11px] text-zinc-600 font-mono mt-0.5">
                    {e.sku}
                  </p>
                )}
              </div>
              <div>
                <VariantCodeSelect
                  game={e.game}
                  value={picked}
                  onChange={(code) => setPicks((prev) => ({ ...prev, [e.id]: code }))}
                  placeholder="— Pick a code —"
                />
                {picked !== undefined && preview && (
                  <div className="mt-1.5 flex items-baseline gap-1 text-[11px] font-mono">
                    <span className="text-emerald-400">→</span>
                    <span className="text-zinc-500">{preview.base}</span>
                    {preview.tail && (
                      <span className="text-emerald-300 font-semibold bg-emerald-500/10 border border-emerald-500/30 px-1 rounded">-{preview.tail}</span>
                    )}
                  </div>
                )}
                {picked === null && (
                  <p className="text-[10px] text-zinc-500 mt-1">
                    Clears the variant · SKU stays 4-segment
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
        <p className="text-[11px] text-zinc-500">
          {dirtyCount === 0 ? 'Pick a code (or none) for each entry, then save.' : `${dirtyCount} fix${dirtyCount === 1 ? '' : 'es'} pending`}
        </p>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || dirtyCount === 0}
        >
          {saving ? <><Loader2 size={12} className="animate-spin mr-1.5" />Saving…</> : `Save ${dirtyCount || ''} fix${dirtyCount === 1 ? '' : 'es'}`.trim()}
        </Button>
      </div>
    </div>
  );
}
