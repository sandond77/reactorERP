import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, ExternalLink } from 'lucide-react';
import { api } from '../../lib/api';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { formatCurrency, formatDate, STATUS_LABELS, STATUS_COLORS } from '../../lib/utils';

interface CardDetailModalProps {
  cardId: string;
  onClose: () => void;
  onDelete: (id: string) => void;
}

export function CardDetailModal({ cardId, onClose, onDelete }: CardDetailModalProps) {
  const qc = useQueryClient();
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [deleting, setDeleting] = useState(false);

  const { data: card, isLoading } = useQuery({
    queryKey: ['card', cardId],
    queryFn: () => api.get(`/cards/${cardId}`).then((r) => r.data.data),
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
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div><span className="text-zinc-500">Game:</span> <span className="text-zinc-300">{card.card_game}</span></div>
                <div><span className="text-zinc-500">Language:</span> <span className="text-zinc-300">{card.language}</span></div>
                <div><span className="text-zinc-500">Cost:</span> <span className="text-zinc-300">{formatCurrency(card.purchase_cost, card.currency)}</span></div>
                <div><span className="text-zinc-500">Condition:</span> <span className="text-zinc-300">{card.condition ?? '—'}</span></div>
                {card.grade && (
                  <>
                    <div><span className="text-zinc-500">Grade:</span> <span className="text-zinc-300">{card.grading_company} {card.grade_label ?? card.grade}</span></div>
                    <div><span className="text-zinc-500">Cert #:</span> <span className="text-zinc-300">{card.cert_number ?? '—'}</span></div>
                  </>
                )}
                <div><span className="text-zinc-500">Purchased:</span> <span className="text-zinc-300">{formatDate(card.purchased_at)}</span></div>
              </div>
              {card.notes && (
                <p className="text-xs text-zinc-500 bg-zinc-800 rounded-lg px-3 py-2">{card.notes}</p>
              )}
            </div>
          </div>

          <div className="flex justify-between pt-2 border-t border-zinc-800">
            <div className="flex items-center gap-2">
              <Button
                variant="danger"
                size="sm"
                onClick={handleDelete}
                disabled={deleting}
              >
                <Trash2 size={14} /> {deleteLabel}
              </Button>
              {deleteStep > 0 && (
                <button
                  onClick={() => setDeleteStep(0)}
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                >
                  Cancel
                </button>
              )}
            </div>
            <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
