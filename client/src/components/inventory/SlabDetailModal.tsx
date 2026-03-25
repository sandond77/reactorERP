import { useState } from 'react';
import { ExternalLink, Trash2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { formatCurrency, formatDate } from '../../lib/utils';
import { api } from '../../lib/api';
import toast from 'react-hot-toast';

function certLink(company: string, cert: string): string | null {
  switch (company) {
    case 'PSA': return `https://www.psacard.com/cert/${cert}`;
    case 'CGC': return `https://www.cgccards.com/certlookup/${cert}`;
    case 'SGC': return `https://sgccard.com/cert/${cert}`;
    default:    return null;
  }
}

function fmt(cents: number | null | undefined) {
  if (cents == null) return '—';
  return formatCurrency(cents);
}

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return formatDate(d);
}

interface SlabRow {
  id: string;
  card_name: string | null;
  cert_number: string | null;
  grade_label: string | null;
  numeric_grade: number | null;
  company: string;
  is_listed: boolean;
  listed_price: number | null;
  listing_url: string | null;
  raw_cost: number;
  grading_cost: number;
  strike_price: number | null;
  after_ebay: number | null;
  raw_purchase_date: string | null;
  date_listed: string | null;
  date_sold: string | null;
  roi_pct: number | null;
  notes: string | null;
  is_card_show: boolean;
}

interface Props {
  slab: SlabRow;
  onClose: () => void;
  onDeleted?: () => void;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-1.5 border-b border-zinc-800/60 last:border-0">
      <span className="text-zinc-500 text-sm shrink-0 w-40">{label}</span>
      <span className="text-zinc-200 text-sm text-right">{value}</span>
    </div>
  );
}

function MoneyRow({ label, value, color }: { label: string; value: number | null; color?: string }) {
  return (
    <Row
      label={label}
      value={
        <span className={color ?? (value != null && value >= 0 ? 'text-zinc-200' : 'text-red-400')}>
          {fmt(value)}
        </span>
      }
    />
  );
}

export function SlabDetailModal({ slab, onClose, onDeleted }: Props) {
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const link = slab.cert_number ? certLink(slab.company, slab.cert_number) : null;

  const deleteMut = useMutation({
    mutationFn: () => api.delete(`/cards/${slab.id}`),
    onSuccess: () => {
      toast.success('Slab deleted');
      qc.invalidateQueries({ queryKey: ['overall'] });
      onDeleted?.();
      onClose();
    },
    onError: () => toast.error('Failed to delete'),
  });
  const costBasis = slab.raw_cost + slab.grading_cost;
  const net = slab.after_ebay != null ? slab.after_ebay - costBasis : null;
  const roi = slab.roi_pct != null
    ? Number(slab.roi_pct)
    : (slab.after_ebay != null && costBasis > 0 ? ((slab.after_ebay - costBasis) / costBasis) * 100 : null);
  const isSold = !!slab.date_sold;

  return (
    <Modal open title={slab.card_name ?? 'Slab Details'} onClose={onClose} className="max-w-lg">
      <div className="space-y-5">

        {/* Identity */}
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-wide font-medium mb-2">Card</p>
          <div className="bg-zinc-900 rounded-lg px-4 py-1">
            <Row label="Name" value={slab.card_name ?? '—'} />
            <Row
              label="Cert #"
              value={
                link ? (
                  <a href={link} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-blue-400 hover:text-blue-300 font-mono">
                    {slab.cert_number}
                    <ExternalLink size={12} />
                  </a>
                ) : (
                  <span className="font-mono text-zinc-300">{slab.cert_number ?? '—'}</span>
                )
              }
            />
            <Row label="Company" value={slab.company} />
            <Row label="Grade" value={slab.grade_label ?? '—'} />
          </div>
        </div>

        {/* Costs */}
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-wide font-medium mb-2">Cost Basis</p>
          <div className="bg-zinc-900 rounded-lg px-4 py-1">
            <Row label="Raw Purchase Date" value={fmtDate(slab.raw_purchase_date)} />
            <MoneyRow label="Raw Cost" value={slab.raw_cost} />
            <MoneyRow label="Grading Cost" value={slab.grading_cost > 0 ? slab.grading_cost : null} />
            <Row
              label="Total Cost Basis"
              value={<span className="font-medium">{fmt(costBasis)}</span>}
            />
          </div>
        </div>

        {/* Listing / Sale */}
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-wide font-medium mb-2">
            {isSold ? 'Sale' : 'Listing'}
          </p>
          <div className="bg-zinc-900 rounded-lg px-4 py-1">
            <Row label="Listed?" value={slab.is_listed ? 'Yes' : 'No'} />
            {slab.listed_price != null && (
              <MoneyRow label="Listed Price" value={slab.listed_price} />
            )}
            {slab.listing_url && (
              <Row
                label="Listing"
                value={
                  <a href={slab.listing_url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-blue-400 hover:text-blue-300 truncate max-w-[220px]">
                    View listing <ExternalLink size={12} className="shrink-0" />
                  </a>
                }
              />
            )}
            {slab.date_listed && <Row label="Date Listed" value={fmtDate(slab.date_listed)} />}
            {slab.is_card_show && <Row label="Card Show?" value={<span className="text-yellow-400">Yes</span>} />}

            {isSold && (
              <>
                <Row label="Date Sold" value={fmtDate(slab.date_sold)} />
                {slab.strike_price != null && <MoneyRow label="Strike Price" value={slab.strike_price} />}
                {slab.after_ebay != null && <MoneyRow label="After eBay" value={slab.after_ebay} />}
              </>
            )}
          </div>
        </div>

        {/* P&L */}
        {isSold && (
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wide font-medium mb-2">P&amp;L</p>
            <div className="bg-zinc-900 rounded-lg px-4 py-1">
              <Row
                label="Net Profit"
                value={
                  <span className={net != null && net >= 0 ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>
                    {fmt(net)}
                  </span>
                }
              />
              <Row
                label="% ROI"
                value={
                  roi != null ? (
                    <span className={roi >= 0 ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>
                      {roi.toFixed(2)}%
                    </span>
                  ) : '—'
                }
              />
            </div>
          </div>
        )}

        {/* Notes */}
        {slab.notes && (
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wide font-medium mb-2">Notes</p>
            <p className="text-sm text-zinc-300 bg-zinc-900 rounded-lg px-4 py-3">{slab.notes}</p>
          </div>
        )}

        {/* Delete */}
        <div className="pt-2 border-t border-zinc-800">
          {confirmDelete ? (
            <div className="flex items-center justify-between gap-3 bg-red-950/30 border border-red-800/40 rounded-lg px-4 py-3">
              <p className="text-sm text-red-300">Permanently delete this slab? This cannot be undone.</p>
              <div className="flex items-center gap-2 shrink-0">
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                <Button
                  size="sm"
                  className="bg-red-600 hover:bg-red-500 text-white border-0"
                  disabled={deleteMut.isPending}
                  onClick={() => deleteMut.mutate()}
                >
                  <Trash2 size={13} />
                  {deleteMut.isPending ? 'Deleting…' : 'Delete'}
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 text-xs text-zinc-600 hover:text-red-400 transition-colors"
            >
              <Trash2 size={13} />
              Delete slab
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
