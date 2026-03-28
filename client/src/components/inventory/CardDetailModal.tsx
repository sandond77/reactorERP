import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Pencil } from 'lucide-react';
import { api } from '../../lib/api';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { formatCurrency, formatDate, STATUS_LABELS, STATUS_COLORS } from '../../lib/utils';

const CONDITIONS = ['NM', 'LP', 'MP', 'HP', 'DMG'];

interface CardDetailModalProps {
  cardId: string;
  onClose: () => void;
  onDelete: (id: string) => void;
}

export function CardDetailModal({ cardId, onClose, onDelete }: CardDetailModalProps) {
  const qc = useQueryClient();
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);

  const { data: card, isLoading } = useQuery({
    queryKey: ['card', cardId],
    queryFn: () => api.get(`/cards/${cardId}`).then((r) => r.data.data),
  });

  // Edit state — initialized when editing starts
  const [editDecision,    setEditDecision]    = useState('');
  const [editCondition,   setEditCondition]   = useState('');
  const [editQuantity,    setEditQuantity]     = useState('');
  const [editPurchasedAt, setEditPurchasedAt] = useState('');
  const [editCost,        setEditCost]         = useState('');
  const [editNotes,       setEditNotes]        = useState('');

  function startEdit() {
    setEditDecision(card.decision ?? '');
    setEditCondition(card.condition ?? '');
    setEditQuantity(String(card.quantity ?? 1));
    setEditPurchasedAt(card.purchased_at ? card.purchased_at.slice(0, 10) : '');
    setEditCost(card.purchase_cost != null ? String(card.purchase_cost / 100) : '');
    setEditNotes(card.notes ?? '');
    setEditing(true);
  }

  const saveMut = useMutation({
    mutationFn: () => api.patch(`/cards/${card.id}`, {
      decision:     editDecision    || undefined,
      condition:    editCondition   || undefined,
      quantity:     parseInt(editQuantity) || undefined,
      purchased_at: editPurchasedAt || undefined,
      purchase_cost: editCost ? Math.round(parseFloat(editCost) * 100) : undefined,
      notes: editNotes || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['card', cardId] });
      qc.invalidateQueries({ queryKey: ['ungraded-inventory'] });
      qc.invalidateQueries({ queryKey: ['raw-inventory'] });
      setEditing(false);
    },
  });

  async function handleDelete() {
    if (deleteStep === 0) { setDeleteStep(1); return; }
    if (deleteStep === 1) { setDeleteStep(2); return; }
    setDeleting(true);
    try {
      await api.delete(`/cards/${card.id}`);
      qc.invalidateQueries({ queryKey: ['inventory-slabs'] });
      onDelete(card.id);
      onClose();
    } catch {
      setDeleting(false);
      setDeleteStep(0);
    }
  }

  const deleteLabel = deleteStep === 0 ? 'Remove' : deleteStep === 1 ? 'Are you sure?' : 'Confirm Delete';

  const inputCls = 'w-full px-2.5 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500';

  return (
    <Modal open title={card?.card_name ?? 'Card Details'} onClose={onClose} className="max-w-2xl">
      {isLoading ? (
        <div className="h-40 flex items-center justify-center text-zinc-600 text-sm">Loading…</div>
      ) : card ? (
        <div className="space-y-4">
          <div className="flex gap-4">
            {(card.image_front_url || card.catalog_image_url) && (
              <img
                src={card.image_front_url ?? card.catalog_image_url}
                alt={card.card_name}
                className="w-24 h-32 object-contain rounded-lg bg-zinc-800"
              />
            )}
            <div className="flex-1 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-zinc-100">{card.card_name ?? 'Unknown'}</h3>
                  <p className="text-sm text-zinc-500">{card.set_name} {card.card_number ? `· #${card.card_number}` : ''}</p>
                </div>
                <Badge className={STATUS_COLORS[card.status]}>{STATUS_LABELS[card.status]}</Badge>
              </div>

              {editing ? (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">Intent</label>
                    <select value={editDecision} onChange={(e) => setEditDecision(e.target.value)} className={inputCls}>
                      <option value="">—</option>
                      <option value="sell_raw">For Sale</option>
                      <option value="grade">To Grade</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">Condition</label>
                    <select value={editCondition} onChange={(e) => setEditCondition(e.target.value)} className={inputCls}>
                      <option value="">—</option>
                      {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">Quantity</label>
                    <input
                      type="number" min={1} value={editQuantity}
                      onChange={(e) => setEditQuantity(e.target.value)}
                      className={inputCls + ' [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">Purchase Date</label>
                    <input
                      type="date" value={editPurchasedAt}
                      onChange={(e) => setEditPurchasedAt(e.target.value)}
                      className={inputCls + ' [color-scheme:dark]'}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1">Cost (USD)</label>
                    <input
                      type="number" step="0.01" min="0" value={editCost}
                      onChange={(e) => setEditCost(e.target.value)}
                      placeholder="0.00"
                      className={inputCls + ' [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-zinc-500 mb-1">Notes</label>
                    <input
                      type="text" value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder="Optional notes…"
                      className={inputCls}
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <div><span className="text-zinc-500">Game:</span> <span className="text-zinc-300">{card.card_game}</span></div>
                  <div><span className="text-zinc-500">Language:</span> <span className="text-zinc-300">{card.language}</span></div>
                  <div><span className="text-zinc-500">Cost:</span> <span className="text-zinc-300">{formatCurrency(card.purchase_cost, card.currency)}</span></div>
                  <div><span className="text-zinc-500">Intent:</span> <span className="text-zinc-300">{card.decision === 'sell_raw' ? 'For Sale' : card.decision === 'grade' ? 'To Grade' : '—'}</span></div>
                  <div><span className="text-zinc-500">Condition:</span> <span className="text-zinc-300">{card.condition ?? '—'}</span></div>
                  {card.grade && (
                    <>
                      <div><span className="text-zinc-500">Grade:</span> <span className="text-zinc-300">{card.grading_company} {card.grade_label ?? card.grade}</span></div>
                      <div><span className="text-zinc-500">Cert #:</span> <span className="text-zinc-300">{card.cert_number ?? '—'}</span></div>
                    </>
                  )}
                  <div><span className="text-zinc-500">Purchased:</span> <span className="text-zinc-300">{formatDate(card.purchased_at)}</span></div>
                  <div><span className="text-zinc-500">Quantity:</span> <span className="text-zinc-300">{card.quantity}</span></div>
                  {card.raw_purchase_label && (
                    <div><span className="text-zinc-500">ID:</span> <span className="font-mono text-zinc-300">{card.raw_purchase_label}</span></div>
                  )}
                </div>
              )}

              {card.notes && !editing && (
                <p className="text-xs text-zinc-500 bg-zinc-800 rounded-lg px-3 py-2">{card.notes}</p>
              )}
            </div>
          </div>

          <div className="flex justify-between pt-2 border-t border-zinc-800">
            <div className="flex items-center gap-2">
              {!editing && (
                <Button variant="danger" size="sm" onClick={handleDelete} disabled={deleting}>
                  <Trash2 size={14} /> {deleteLabel}
                </Button>
              )}
              {deleteStep > 0 && !editing && (
                <button onClick={() => setDeleteStep(0)} className="text-xs text-zinc-500 hover:text-zinc-300">
                  Cancel
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {editing ? (
                <>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
                  <Button size="sm" disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
                    {saveMut.isPending ? 'Saving…' : 'Save Changes'}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" size="sm" onClick={startEdit}>
                    <Pencil size={13} /> Edit
                  </Button>
                  <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
