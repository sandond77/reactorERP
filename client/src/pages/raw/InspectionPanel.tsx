import { useState, useRef } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Plus, ChevronLeft, Trash2, Pencil, ImagePlus, X } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { formatCurrency } from '../../lib/utils';
import toast from 'react-hot-toast';
import type { PurchaseRow, PurchaseDetail, InspectionLine, Decision } from './types';
import { CONDITIONS, DECISION_LABELS } from './types';

// ── Inspection line form ──────────────────────────────────────────────────────

type LineImages = { front?: File; back?: File };

function InspectionLineForm({
  purchase,
  initial,
  maxQuantity,
  onSave,
  onClose,
  showImages = true,
}: {
  purchase: PurchaseRow;
  initial?: Partial<InspectionLine>;
  maxQuantity: number;
  onSave: (data: Record<string, unknown>, images: LineImages) => void;
  onClose: () => void;
  showImages?: boolean;
}) {
  const avgUsd = purchase.avg_cost_usd ?? (purchase.total_cost_usd ?? 0);

  const [form, setForm] = useState({
    condition:     initial?.condition ?? 'NM',
    decision:      (initial?.decision ?? 'sell_raw') as Decision,
    quantity:      initial?.quantity ? String(initial.quantity) : '1',
    purchase_cost: initial?.purchase_cost
      ? String(initial.purchase_cost / 100)
      : String(avgUsd / 100),
    currency: initial?.currency ?? 'USD',
    notes:    initial?.notes ?? '',
  });

  function set(k: string, v: unknown) { setForm((f) => ({ ...f, [k]: v })); }

  const [qtyError, setQtyError] = useState('');
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [backFile,  setBackFile]  = useState<File | null>(null);
  const [frontPreview, setFrontPreview] = useState<string | null>(null);
  const [backPreview,  setBackPreview]  = useState<string | null>(null);
  const frontRef = useRef<HTMLInputElement>(null);
  const backRef  = useRef<HTMLInputElement>(null);

  function pickImage(side: 'front' | 'back', file: File) {
    const url = URL.createObjectURL(file);
    if (side === 'front') { setFrontFile(file); setFrontPreview(url); }
    else { setBackFile(file); setBackPreview(url); }
  }
  function clearImage(side: 'front' | 'back') {
    if (side === 'front') { if (frontPreview) URL.revokeObjectURL(frontPreview); setFrontFile(null); setFrontPreview(null); if (frontRef.current) frontRef.current.value = ''; }
    else { if (backPreview) URL.revokeObjectURL(backPreview); setBackFile(null); setBackPreview(null); if (backRef.current) backRef.current.value = ''; }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const qty = parseInt(form.quantity) || 1;
    if (qty > maxQuantity) {
      setQtyError(`Max ${maxQuantity} remaining`);
      return;
    }
    onSave({
      condition:     form.condition,
      decision:      form.decision,
      quantity:      qty,
      purchase_cost: Math.round(parseFloat(form.purchase_cost) * 100),
      currency:      form.currency,
      notes:         form.notes || undefined,
    }, { front: frontFile ?? undefined, back: backFile ?? undefined });
  }

  const inp   = 'w-full px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500';
  const label = 'block text-xs text-zinc-400 mb-1';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>Condition</label>
          <select value={form.condition} onChange={(e) => set('condition', e.target.value)} className={inp}>
            {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Decision</label>
          <select value={form.decision} onChange={(e) => set('decision', e.target.value)} className={inp}>
            <option value="sell_raw">Sell Raw</option>
            <option value="grade">Grade</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className={label}>
            Quantity
            {qtyError && <span className="ml-1 text-xs text-red-400">{qtyError}</span>}
          </label>
          <input type="number" min="1" max={maxQuantity} value={form.quantity}
            onChange={(e) => { set('quantity', e.target.value); setQtyError(''); }}
            className={`${inp} ${qtyError ? 'border-red-500/60' : ''}`} />
          <p className="text-[10px] text-zinc-600 mt-0.5">{maxQuantity} remaining</p>
        </div>
        <div>
          <label className={label}>Cost / Card (USD)</label>
          <input type="number" step="0.01" value={form.purchase_cost} onChange={(e) => set('purchase_cost', e.target.value)} className={inp} />
        </div>
        <div>
          <label className={label}>Currency</label>
          <select value={form.currency} onChange={(e) => set('currency', e.target.value)} className={inp}>
            <option value="USD">USD</option>
            <option value="JPY">JPY</option>
          </select>
        </div>
      </div>
      <div>
        <label className={label}>Notes</label>
        <input value={form.notes} onChange={(e) => set('notes', e.target.value)} className={inp} />
      </div>
      {showImages && (
        <div>
          <label className={label}>Card Images</label>
          <div className="flex gap-3">
            {(['front', 'back'] as const).map((side) => {
              const preview = side === 'front' ? frontPreview : backPreview;
              const ref = side === 'front' ? frontRef : backRef;
              return (
                <div key={side} className="relative">
                  <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) pickImage(side, f); }} />
                  {preview ? (
                    <div className="relative">
                      <img src={preview} alt={side} className="w-20 h-28 object-contain rounded-lg bg-zinc-800 border border-zinc-700 cursor-pointer" onClick={() => ref.current?.click()} />
                      <button type="button" onClick={() => clearImage(side)}
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-zinc-700 hover:bg-zinc-600 rounded-full flex items-center justify-center">
                        <X size={10} className="text-zinc-300" />
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => ref.current?.click()}
                      className="w-20 h-28 rounded-lg border border-dashed border-zinc-700 hover:border-indigo-500 flex flex-col items-center justify-center gap-1 text-zinc-600 hover:text-indigo-400 transition-colors">
                      <ImagePlus size={16} />
                      <span className="text-[10px] capitalize">{side}</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button type="submit" size="sm">Save</Button>
      </div>
    </form>
  );
}

// ── Inspection panel ──────────────────────────────────────────────────────────

export function InspectionPanel({
  purchase,
  onClose,
}: {
  purchase: PurchaseRow;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [addLineOpen, setAddLineOpen] = useState(false);
  const [editLine, setEditLine] = useState<InspectionLine | null>(null);

  const { data, isLoading } = useQuery<PurchaseDetail>({
    queryKey: ['raw-purchase', purchase.id],
    queryFn: () => api.get(`/raw-purchases/${purchase.id}`).then((r) => r.data),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['raw-purchase', purchase.id] });
    qc.invalidateQueries({ queryKey: ['raw-purchases'] });
  };

  const addMut = useMutation({
    mutationFn: async ({ body, images }: { body: Record<string, unknown>; images: LineImages }) => {
      const card = await api.post(`/raw-purchases/${purchase.id}/lines`, body).then((r) => r.data);
      const cardId = card?.id;
      if (cardId) {
        const uploads = ([['front', images.front], ['back', images.back]] as [string, File | undefined][]).filter(([, f]) => f);
        await Promise.all(uploads.map(([side, file]) => {
          const fd = new FormData(); fd.append('image', file!);
          return api.post(`/cards/${cardId}/image?side=${side}`, fd).catch(() => {});
        }));
      }
      return card;
    },
    onSuccess: () => { invalidate(); setAddLineOpen(false); toast.success('Line added'); },
    onError: () => toast.error('Failed to add line'),
  });

  const updateMut = useMutation({
    mutationFn: ({ cardId, body }: { cardId: string; body: Record<string, unknown> }) =>
      api.patch(`/raw-purchases/${purchase.id}/lines/${cardId}`, body).then((r) => r.data),
    onSuccess: () => { invalidate(); setEditLine(null); toast.success('Updated'); },
    onError: () => toast.error('Failed to update'),
  });

  const deleteMut = useMutation({
    mutationFn: (cardId: string) => api.delete(`/raw-purchases/${purchase.id}/lines/${cardId}`),
    onSuccess: () => { invalidate(); toast.success('Removed'); },
    onError: () => toast.error('Failed to remove'),
  });

  const allocated = data?.cards.reduce((s, c) => s + c.quantity, 0) ?? 0;
  const remaining = purchase.card_count - allocated;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <ChevronLeft size={16} />
          </button>
          <div>
            <h2 className="text-base font-bold text-zinc-100">{purchase.purchase_id}</h2>
            <p className="text-xs text-zinc-500">
              {purchase.card_name ?? 'Unknown'}
              {purchase.set_name ? ` · ${purchase.set_name}` : ''}
              {purchase.card_number ? ` #${purchase.card_number}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500">
            {allocated}/{purchase.card_count} allocated
            {remaining > 0 ? ` · ${remaining} remaining` : ''}
          </span>
          {remaining > 0 && (
            <Button size="sm" onClick={() => setAddLineOpen(true)}>
              <Plus size={14} /> Add Line
            </Button>
          )}
        </div>
      </div>

      {/* Summary strip */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 px-6 py-3 border-b border-zinc-800/60 text-xs text-zinc-400">
        <span>Source: <span className="text-zinc-200">{purchase.source ?? '—'}</span></span>
        <span>Order #: <span className="text-zinc-200">{purchase.order_number ?? '—'}</span></span>
        <span>Language: <span className="text-zinc-200">{purchase.language}</span></span>
        {purchase.total_cost_yen != null && (
          <span>Cost: <span className="text-zinc-200">¥{purchase.total_cost_yen.toLocaleString()}</span></span>
        )}
        {purchase.fx_rate != null && (
          <span>Rate: <span className="text-zinc-200">{purchase.fx_rate}</span></span>
        )}
        {purchase.total_cost_usd != null && (
          <span>USD: <span className="text-zinc-200">{formatCurrency(purchase.total_cost_usd, 'USD')}</span></span>
        )}
        {purchase.avg_cost_usd != null && (
          <span>Avg/card: <span className="text-zinc-200">{formatCurrency(purchase.avg_cost_usd, 'USD')}</span></span>
        )}
      </div>

      {/* Lines table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">Loading…</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-zinc-950 z-10">
              <tr className="border-b border-zinc-700 text-zinc-400 uppercase tracking-wide text-left">
                <th className="px-4 py-2">Part #</th>
                <th className="px-4 py-2">Condition</th>
                <th className="px-4 py-2">Decision</th>
                <th className="px-4 py-2 text-right">Qty</th>
                <th className="px-4 py-2 text-right">Cost/Card</th>
                <th className="px-4 py-2">Notes</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {!data?.cards.length ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-zinc-500">
                    No inspection lines yet. Add one to allocate cards.
                  </td>
                </tr>
              ) : data.cards.map((line) => (
                <tr key={line.id} className="hover:bg-zinc-800/25 transition-colors">
                  <td className="px-4 py-2 text-zinc-400 font-mono">{line.part_number ?? '—'}</td>
                  <td className="px-4 py-2 text-zinc-300">{line.condition ?? '—'}</td>
                  <td className="px-4 py-2">
                    {line.decision ? (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        line.decision === 'grade'
                          ? 'bg-indigo-500/15 text-indigo-300'
                          : 'bg-emerald-500/15 text-emerald-300'
                      }`}>
                        {DECISION_LABELS[line.decision]}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-300">{line.quantity}</td>
                  <td className="px-4 py-2 text-right text-zinc-300">{formatCurrency(line.purchase_cost, line.currency)}</td>
                  <td className="px-4 py-2 text-zinc-500 max-w-[200px] truncate">{line.notes ?? '—'}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => setEditLine(line)} className="text-zinc-600 hover:text-zinc-300 transition-colors">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => deleteMut.mutate(line.id)} className="text-zinc-600 hover:text-red-400 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={addLineOpen} onClose={() => setAddLineOpen(false)} title="Add Inspection Line">
        <InspectionLineForm
          purchase={purchase}
          maxQuantity={remaining}
          onSave={(body, images) => addMut.mutate({ body, images })}
          onClose={() => setAddLineOpen(false)}
        />
      </Modal>

      <Modal open={!!editLine} onClose={() => setEditLine(null)} title="Edit Inspection Line">
        {editLine && (
          <InspectionLineForm
            purchase={purchase}
            initial={editLine}
            maxQuantity={remaining + editLine.quantity}
            showImages={false}
            onSave={(body) => updateMut.mutate({ cardId: editLine.id, body })}
            onClose={() => setEditLine(null)}
          />
        )}
      </Modal>
    </div>
  );
}
