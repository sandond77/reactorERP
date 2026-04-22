import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Plus, ArrowLeft, Loader2, Trash2 } from 'lucide-react';
import { api, type PaginatedResult } from '../lib/api';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { formatCurrency, formatDate } from '../lib/utils';
import toast from 'react-hot-toast';

const GRADING_COMPANIES = ['PSA', 'BGS', 'CGC', 'SGC', 'HGA', 'ACE', 'ARS', 'OTHER'] as const;

const BATCH_STATUS_COLORS: Record<string, string> = {
  pending:   'bg-zinc-700/50 text-zinc-400',
  submitted: 'bg-amber-500/20 text-amber-300',
  returned:  'bg-green-500/20 text-green-300',
  cancelled: 'bg-zinc-700/50 text-zinc-400',
};

// ── Types ────────────────────────────────────────────────────────────────────

interface Batch {
  id: string;
  batch_id: string;
  name: string | null;
  company: string;
  tier: string;
  submitted_at: string | null;
  grading_cost: number;
  status: string;
  notes: string | null;
  submission_number: string | null;
  created_at: string;
  item_count: number;
  total_qty: number;
  raw_cost: number;
  estimated_total: number;
}

interface BatchItem {
  id: string;
  card_instance_id: string;
  line_item_num: number;
  card_name: string | null;
  set_name: string | null;
  card_number: string | null;
  condition: string | null;
  quantity: number;           // qty submitted to this batch
  available_quantity: number; // total qty on the card instance
  purchase_cost: number;
  currency: string;
  estimated_value: number | null;
  expected_grade: number | null;
  item_total: number;
  rolling_total: number;
  raw_purchase_label: string | null;
}

interface BatchDetail extends Batch {
  items: BatchItem[];
  stats: {
    rawCost: number;
    gradingCost: number;
    totalCost: number;
    totalValue: number;
    maxGain: number;
    estimate80: number;
  };
}

interface CardToGrade {
  id: string;
  card_name: string | null;
  set_name: string | null;
  card_number: string | null;
  rarity: string | null;
  condition: string | null;
  quantity: number;
  raw_purchase_label: string | null;
}

// ── Create Batch Modal ───────────────────────────────────────────────────────

function buildName(submittedAt: string, company: string, tier: string): string {
  const date = submittedAt ? submittedAt.replace(/-/g, '') : '';
  return [date, company, tier].filter(Boolean).join(' ');
}

function CreateBatchModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [company, setCompany]           = useState('PSA');
  const [tier, setTier]                 = useState('');
  const [submittedAt, setSubmittedAt]   = useState('');
  const [costPerCard, setCostPerCard]   = useState('');
  const [notes, setNotes]               = useState('');
  const [name, setName]                 = useState('');
  const [saving, setSaving]             = useState(false);

  // Auto-generate name whenever the key fields change
  useEffect(() => {
    setName(buildName(submittedAt, company, tier));
  }, [submittedAt, company, tier]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!submittedAt)  { toast.error('Submitted date is required'); return; }
    if (!tier)         { toast.error('Tier / service level is required'); return; }
    if (!costPerCard)  { toast.error('Grading cost per card is required'); return; }
    setSaving(true);
    try {
      await api.post('/grading-subs', {
        name:          name || undefined,
        company,
        tier,
        submitted_at:  submittedAt || undefined,
        grading_cost:  costPerCard ? Math.round(parseFloat(costPerCard) * 100) : undefined,
        notes:         notes || undefined,
      });
      toast.success('Batch created');
      qc.invalidateQueries({ queryKey: ['grading-batches'] });
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to create batch');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Select label="Company" value={company} onChange={(e) => setCompany(e.target.value)}>
          {GRADING_COMPANIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <Input label="Tier / Service Level" placeholder="e.g. Bulk, Value, Regular" required
          value={tier} onChange={(e) => setTier(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Submitted Date" type="date" value={submittedAt} onChange={(e) => setSubmittedAt(e.target.value)} />
        <Input label="Grading Cost Per Card (USD)" type="number" step="0.01" min="0" placeholder="0.00"
          value={costPerCard} onChange={(e) => setCostPerCard(e.target.value)} />
      </div>
      <div>
        <div className="flex items-baseline gap-2 mb-1">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Submission Name</label>
          <span className="text-[10px] text-zinc-600">(auto generated)</span>
        </div>
        <p className="px-1 text-sm text-zinc-300 font-mono">
          {name || <span className="text-zinc-600">Fill in date, company &amp; tier first</span>}
        </p>
      </div>
      <Input label="Notes" placeholder="Optional notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 size={14} className="animate-spin" />}
          Create Batch
        </Button>
      </div>
    </form>
  );
}

// ── Add Card Modal ───────────────────────────────────────────────────────────

function AddCardModal({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [search, setSearch]                 = useState('');
  const [debounced, setDebounced]           = useState('');
  const [selected, setSelected]             = useState<CardToGrade | null>(null);
  const [qty, setQty]                       = useState<string>('');
  const [expectedGrade, setExpectedGrade]   = useState('');
  const [estimatedValue, setEstimatedValue] = useState('');
  const [saving, setSaving]                 = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset qty when card changes
  useEffect(() => { setQty(''); }, [selected]);

  const { data: cardResults, isLoading } = useQuery<PaginatedResult<CardToGrade>>({
    queryKey: ['card-picker-grading', debounced],
    queryFn:  () => api.get('/cards', {
      params: { search: debounced, limit: 50, status: 'inspected,grading_submitted', decision: 'grade' },
    }).then((r) => r.data),
    enabled: debounced.length >= 2,
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) { toast.error('Select a card'); return; }
    const qtyNum = parseInt(qty);
    if (!qty || isNaN(qtyNum) || qtyNum < 1 || qtyNum > selected.quantity) { toast.error(`Quantity must be between 1 and ${selected.quantity}`); return; }
    setSaving(true);
    try {
      await api.post(`/grading-subs/${batchId}/items`, {
        card_instance_id: selected.id,
        quantity:         qtyNum,
        expected_grade:   expectedGrade ? parseFloat(expectedGrade) : undefined,
        estimated_value:  estimatedValue ? Math.round(parseFloat(estimatedValue) * 100) : undefined,
      });
      toast.success('Card added to batch');
      qc.invalidateQueries({ queryKey: ['grading-batch', batchId] });
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to add card');
    } finally {
      setSaving(false);
    }
  }

  const cards = cardResults?.data ?? [];

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* Search */}
      <input
        type="text"
        placeholder="Search by card name or purchase ID…"
        value={search}
        onChange={(e) => { setSearch(e.target.value); setSelected(null); }}
        className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
        autoComplete="off"
      />

      {/* Card list */}
      <div className="border border-zinc-700 rounded-lg overflow-hidden">
        {debounced.length < 2 ? (
          <div className="px-4 py-6 text-center text-zinc-600 text-sm">Type For Search Results</div>
        ) : isLoading ? (
          <div className="px-4 py-6 text-center text-zinc-600 text-sm">Loading…</div>
        ) : cards.length === 0 ? (
          <div className="px-4 py-6 text-center text-zinc-500 text-sm">No cards found.</div>
        ) : (
          <div className="max-h-52 overflow-y-auto divide-y divide-zinc-800">
            {cards.map((card) => {
              const active = selected?.id === card.id;
              return (
                <button key={card.id} type="button"
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${active ? 'bg-indigo-600/20 border-l-2 border-indigo-500' : 'hover:bg-zinc-800/60'}`}
                  onClick={() => setSelected(active ? null : card)}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-medium truncate ${active ? 'text-indigo-300' : 'text-zinc-200'}`}>
                      {card.card_name ?? 'Unknown'}
                    </span>
                    <span className="text-xs font-mono font-semibold text-zinc-400 shrink-0">
                      {card.raw_purchase_label ?? '—'}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {card.set_name ?? '—'}{card.card_number ? ` · #${card.card_number}` : ''}{card.rarity ? ` · ${card.rarity}` : ''}{card.condition ? ` · ${card.condition}` : ''} · <span className="text-zinc-400">{card.quantity} available</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Qty + estimated value — only shown once a card is selected */}
      {selected && (
        <div className="space-y-3 pt-1 border-t border-zinc-800">
          <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr 1.4fr' }}>
            <div>
              <label className="block text-xs font-medium text-zinc-400 uppercase tracking-wide mb-1">
                Qty <span className="text-zinc-600 normal-case">(max {selected.quantity})</span>
              </label>
              <input
                type="number" min={1} max={selected.quantity} value={qty}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') { setQty(''); return; }
                  const n = parseInt(v);
                  if (!isNaN(n)) setQty(String(Math.min(selected.quantity, Math.max(1, n))));
                }}
                className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
            <Input label="Expected Grade" type="number" step="0.5" min="1" max="10" placeholder="e.g. 9"
              value={expectedGrade} onChange={(e) => setExpectedGrade(e.target.value)}
              className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
            <Input label="Est. Value / Card" type="number" step="0.01" min="0" placeholder="0.00"
              value={estimatedValue} onChange={(e) => setEstimatedValue(e.target.value)}
              className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={saving || !selected}>
          {saving && <Loader2 size={14} className="animate-spin" />}
          Add to Batch
        </Button>
      </div>
    </form>
  );
}

// ── Edit Item Modal ───────────────────────────────────────────────────────────

function EditItemModal({ item, batchId, onClose }: { item: BatchItem; batchId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [qty,            setQty]            = useState(String(item.quantity));
  const [expectedGrade,  setExpectedGrade]  = useState(item.expected_grade != null ? String(parseFloat(String(item.expected_grade))) : '');
  const [estimatedValue, setEstimatedValue] = useState(item.estimated_value != null ? String(item.estimated_value / 100) : '');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const qtyNum = parseInt(qty);
    if (!qty || isNaN(qtyNum) || qtyNum < 1 || qtyNum > item.available_quantity) {
      toast.error(`Qty must be 1–${item.available_quantity}`); return;
    }
    setSaving(true);
    try {
      await api.patch(`/grading-subs/${batchId}/items/${item.id}`, {
        quantity:        qtyNum,
        expected_grade:  expectedGrade ? parseFloat(expectedGrade) : null,
        estimated_value: estimatedValue ? Math.round(parseFloat(estimatedValue) * 100) : null,
      });
      qc.invalidateQueries({ queryKey: ['grading-batch', batchId] });
      onClose();
    } catch { toast.error('Failed to update'); }
    finally { setSaving(false); }
  }

  const noSpinner = '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-zinc-400">
        <span className="text-zinc-200 font-medium">{item.card_name ?? '—'}</span>
        {item.set_name ? <span className="text-zinc-500"> · {item.set_name}</span> : null}
        {item.card_number ? <span className="text-zinc-500"> #{item.card_number}</span> : null}
      </p>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-zinc-400 uppercase tracking-wide mb-1">
            Qty <span className="text-zinc-600 normal-case">(max {item.available_quantity})</span>
          </label>
          <input type="number" min={1} max={item.available_quantity} value={qty}
            onChange={(e) => { const v = e.target.value; if (v === '') { setQty(''); return; } const n = parseInt(v); if (!isNaN(n)) setQty(String(Math.min(item.available_quantity, Math.max(1, n)))); }}
            className={`w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500 ${noSpinner}`} />
        </div>
        <Input label="Expected Grade" type="number" step="0.5" min="1" max="10" placeholder="e.g. 9"
          value={expectedGrade} onChange={(e) => setExpectedGrade(e.target.value)} className={noSpinner} />
        <Input label="Est. Value / Card" type="number" step="0.01" min="0" placeholder="0.00"
          value={estimatedValue} onChange={(e) => setEstimatedValue(e.target.value)} className={noSpinner} />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 size={14} className="animate-spin" />} Save
        </Button>
      </div>
    </form>
  );
}

// ── Close Sub Modal ───────────────────────────────────────────────────────────

function CloseSubModal({ batch, onClose }: { batch: Batch; onClose: () => void }) {
  const qc = useQueryClient();
  const [submissionNumber, setSubmissionNumber] = useState(batch.submission_number ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/grading-subs/${batch.id}`, {
        status: 'submitted',
        submission_number: submissionNumber || null,
      });
      toast.success('Submission closed');
      qc.invalidateQueries({ queryKey: ['grading-batch', batch.id] });
      qc.invalidateQueries({ queryKey: ['grading-batches'] });
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to close sub');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-zinc-400">
        This will lock the batch and mark it as submitted. Cards can no longer be added or removed.
      </p>
      <Input
        label="Submission Number"
        placeholder="e.g. 12345678"
        value={submissionNumber}
        onChange={(e) => setSubmissionNumber(e.target.value)}
        autoFocus
      />
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 size={14} className="animate-spin" />}
          Close &amp; Lock Sub
        </Button>
      </div>
    </form>
  );
}

// ── Edit Batch Modal ──────────────────────────────────────────────────────────

function EditBatchModal({ batch, onClose }: { batch: Batch; onClose: () => void }) {
  const qc = useQueryClient();
  const [company,          setCompany]          = useState(batch.company);
  const [tier,             setTier]             = useState(batch.tier);
  const [submittedAt,      setSubmittedAt]      = useState(batch.submitted_at?.slice(0, 10) ?? '');
  const [costPerCard,      setCostPerCard]      = useState(batch.grading_cost ? String(batch.grading_cost / 100) : '');
  const [submissionNumber, setSubmissionNumber] = useState(batch.submission_number ?? '');
  const [notes,            setNotes]            = useState(batch.notes ?? '');
  const [saving,           setSaving]           = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.patch(`/grading-subs/${batch.id}`, {
        company,
        tier:              tier || undefined,
        submitted_at:      submittedAt || undefined,
        grading_cost:      costPerCard ? Math.round(parseFloat(costPerCard) * 100) : undefined,
        submission_number: submissionNumber || null,
        notes:             notes || undefined,
      });
      toast.success('Batch updated');
      qc.invalidateQueries({ queryKey: ['grading-batch', batch.id] });
      qc.invalidateQueries({ queryKey: ['grading-batches'] });
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to update');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Select label="Company" value={company} onChange={(e) => setCompany(e.target.value)}>
          {GRADING_COMPANIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <Input label="Tier / Service Level" placeholder="e.g. Bulk, Value, Regular"
          value={tier} onChange={(e) => setTier(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Submitted Date" type="date" value={submittedAt} onChange={(e) => setSubmittedAt(e.target.value)} />
        <Input label="Grading Cost Per Card (USD)" type="number" step="0.01" min="0" placeholder="0.00"
          value={costPerCard} onChange={(e) => setCostPerCard(e.target.value)} />
      </div>
      <Input
        label="Submission Number"
        placeholder="e.g. 12345678"
        value={submissionNumber}
        onChange={(e) => setSubmissionNumber(e.target.value)}
      />
      <Input label="Notes" placeholder="Optional notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 size={14} className="animate-spin" />}
          Save Changes
        </Button>
      </div>
    </form>
  );
}

// ── Batch Detail ─────────────────────────────────────────────────────────────

function BatchDetailPanel({ batchId, onBack }: { batchId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const [showAddCard, setShowAddCard]     = useState(false);
  const [confirmingId, setConfirmingId]   = useState<string | null>(null);
  const [showCloseSub, setShowCloseSub]   = useState(false);
  const [editingItem, setEditingItem]     = useState<BatchItem | null>(null);
  const [showEdit, setShowEdit]           = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data, isLoading } = useQuery<BatchDetail>({
    queryKey: ['grading-batch', batchId],
    queryFn:  () => api.get(`/grading-subs/${batchId}`).then((r) => r.data),
  });

  const removeItem = useMutation({
    mutationFn: (itemId: string) => api.delete(`/grading-subs/${batchId}/items/${itemId}`),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['grading-batch', batchId] }); toast.success('Removed'); },
    onError:    () => toast.error('Failed to remove'),
  });

  const deleteBatch = useMutation({
    mutationFn: () => api.delete(`/grading-subs/${batchId}`),
    onSuccess:  () => {
      toast.success('Batch deleted');
      qc.invalidateQueries({ queryKey: ['grading-batches'] });
      onBack();
    },
    onError: () => toast.error('Failed to delete batch'),
  });

  const setStatus = useMutation({
    mutationFn: (status: string) => api.patch(`/grading-subs/${batchId}`, { status }),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['grading-batch', batchId] });
      qc.invalidateQueries({ queryKey: ['grading-batches'] });
    },
    onError: () => toast.error('Failed to update status'),
  });

  if (isLoading) return (
    <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">Loading…</div>
  );
  if (!data) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-zinc-100">{data.name ?? data.batch_id}</h1>
            {data.name && <p className="text-[10px] text-zinc-600 font-mono">{data.batch_id}</p>}
          </div>
          <span className="text-sm text-zinc-400">{data.company} · {data.tier}</span>
          <Badge className={BATCH_STATUS_COLORS[data.status] ?? 'bg-zinc-700/50 text-zinc-400'}>
            {data.status}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">Delete this batch and revert all cards?</span>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button
                size="sm"
                className="bg-red-600 hover:bg-red-500 text-white border-0"
                disabled={deleteBatch.isPending}
                onClick={() => deleteBatch.mutate()}
              >
                <Trash2 size={13} />
                {deleteBatch.isPending ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={13} /> Delete
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setShowEdit(true)}>
            Edit Details
          </Button>
          {data.status === 'submitted' ? (
            <Button size="sm" variant="ghost" onClick={() => setStatus.mutate('pending')} disabled={setStatus.isPending}>
              Unlock Sub
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => setShowCloseSub(true)}>
                Close Sub
              </Button>
              <Button size="sm" onClick={() => setShowAddCard(true)}>
                <Plus size={14} /> Add Card
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex gap-6 px-6 py-2.5 border-b border-zinc-800 text-xs text-zinc-400">
        <span>Cards: <span className="text-zinc-200">{data.items.length}</span></span>
        <span>Raw Cost: <span className="text-zinc-200">{formatCurrency(data.stats.rawCost, 'USD')}</span></span>
        <span>Grading: <span className="text-zinc-200">{formatCurrency(data.stats.gradingCost, 'USD')}</span></span>
        <span>Total In: <span className="text-zinc-200">{formatCurrency(data.stats.totalCost, 'USD')}</span></span>
        {data.stats.totalValue > 0 && (
          <>
            <span>Est. Value: <span className="text-zinc-200">{formatCurrency(data.stats.totalValue, 'USD')}</span></span>
            <span>Max Gain: <span className={data.stats.maxGain >= 0 ? 'text-emerald-400' : 'text-red-400'}>
              {formatCurrency(data.stats.maxGain, 'USD')}
            </span></span>
          </>
        )}
        {data.submission_number && (
          <span>Sub #: <span className="text-zinc-200 font-mono">{data.submission_number}</span></span>
        )}
        {data.submitted_at && (
          <span className="ml-auto">Submitted: <span className="text-zinc-300">{formatDate(data.submitted_at)}</span></span>
        )}
      </div>

      {/* Items */}
      <div className="flex-1 overflow-auto">
        {data.items.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">
            No cards in this batch yet.
          </div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-zinc-950 z-10">
              <tr className="border-b border-zinc-700 text-zinc-400 uppercase tracking-wide text-[10px]">
                <th className="px-4 py-2 text-left font-medium w-8">#</th>
                <th className="px-4 py-2 text-left font-medium">Card</th>
                <th className="px-4 py-2 text-left font-medium">Set</th>
                <th className="px-4 py-2 text-left font-medium">Card #</th>
                <th className="px-4 py-2 text-left font-medium">ID</th>
                <th className="px-4 py-2 text-left font-medium">Cond</th>
                <th className="px-4 py-2 text-right font-medium">Qty</th>
                <th className="px-4 py-2 text-right font-medium">Raw Cost</th>
                <th className="px-4 py-2 text-right font-medium">Total Raw</th>
                <th className="px-4 py-2 text-right font-medium">Est. Value</th>
                <th className="px-4 py-2 text-right font-medium">Total Est. Value</th>
                <th className="px-4 py-2 text-right font-medium">Total # in Sub</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {data.items.map((item) => (
                <tr key={item.id}
                  onClick={() => { if (data.status === 'pending') setEditingItem(item); }}
                  className={`transition-colors ${data.status === 'pending' ? 'hover:bg-zinc-800/40 cursor-pointer' : 'hover:bg-zinc-800/20'}`}>
                  <td className="px-4 py-2 text-zinc-500 text-[10px] font-mono">{item.line_item_num}</td>
                  <td className="px-4 py-2 text-zinc-200 font-medium">{item.card_name ?? '—'}</td>
                  <td className="px-4 py-2 text-zinc-500">{item.set_name ?? '—'}</td>
                  <td className="px-4 py-2 text-zinc-500">{item.card_number ? `#${item.card_number}` : '—'}</td>
                  <td className="px-4 py-2 text-zinc-500 font-mono text-[10px]">{item.raw_purchase_label ?? '—'}</td>
                  <td className="px-4 py-2 text-zinc-400">{item.condition ?? '—'}</td>
                  <td className="px-4 py-2 text-right text-zinc-300">{item.quantity}</td>
                  <td className="px-4 py-2 text-right text-zinc-400">
                    {formatCurrency(item.purchase_cost, item.currency)}
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-300">
                    {formatCurrency(item.purchase_cost * item.quantity, item.currency)}
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-400">
                    {item.estimated_value ? formatCurrency(item.estimated_value, item.currency) : '—'}
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-300">
                    {item.item_total ? formatCurrency(item.item_total, item.currency) : '—'}
                  </td>
                  <td className="px-4 py-2 text-right text-zinc-400">{item.rolling_total}</td>
                  <td className="px-4 py-2">
                    {data.status !== 'submitted' && (confirmingId === item.id ? (
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => setConfirmingId(null)}
                          className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors">
                          Cancel
                        </button>
                        <button onClick={() => { removeItem.mutate(item.id); setConfirmingId(null); }}
                          className="text-[10px] font-medium text-red-400 hover:text-red-300 transition-colors">
                          Confirm
                        </button>
                      </div>
                    ) : (
                      <button onClick={(e) => { e.stopPropagation(); setConfirmingId(item.id); }}
                        className="text-zinc-600 hover:text-red-400 transition-colors">
                        <Trash2 size={12} />
                      </button>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={!!editingItem} onClose={() => setEditingItem(null)} title="Edit Line Item">
        {editingItem && <EditItemModal item={editingItem} batchId={batchId} onClose={() => setEditingItem(null)} />}
      </Modal>

      <Modal open={showAddCard} onClose={() => setShowAddCard(false)} title="Add Card to Batch">
        <AddCardModal batchId={batchId} onClose={() => setShowAddCard(false)} />
      </Modal>

      <Modal open={showEdit} onClose={() => setShowEdit(false)} title="Edit Submission Details">
        {showEdit && <EditBatchModal batch={data} onClose={() => setShowEdit(false)} />}
      </Modal>

      <Modal open={showCloseSub} onClose={() => setShowCloseSub(false)} title="Close Submission">
        {showCloseSub && <CloseSubModal batch={data} onClose={() => setShowCloseSub(false)} />}
      </Modal>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function Grading() {
  const [selectedId, setSelectedId]     = useState<string | null>(null);
  const [showCreate, setShowCreate]     = useState(false);

  const { data, isLoading } = useQuery<Batch[]>({
    queryKey: ['grading-batches'],
    queryFn:  () => api.get('/grading-subs').then((r) => r.data),
  });

  if (selectedId) {
    return <BatchDetailPanel batchId={selectedId} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-100">Grading Submissions</h1>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus size={14} /> Start Sub
        </Button>
      </div>

      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">Loading…</div>
        ) : !data?.length ? (
          <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">
            No grading batches yet.
          </div>
        ) : (
          <table className="text-xs border-collapse" style={{ tableLayout: 'fixed', minWidth: '100%', width: 'max-content' }}>
            <colgroup>
              <col style={{ minWidth: 200 }} />
              <col style={{ minWidth: 70 }} />
              <col style={{ minWidth: 100 }} />
              <col style={{ minWidth: 55 }} />
              <col style={{ minWidth: 105 }} />
              <col style={{ minWidth: 105 }} />
              <col style={{ minWidth: 105 }} />
              <col style={{ minWidth: 100 }} />
              <col style={{ minWidth: 100 }} />
              <col style={{ minWidth: 100 }} />
              <col style={{ minWidth: 110 }} />
              <col style={{ minWidth: 180 }} />
            </colgroup>
            <thead className="sticky top-0 bg-zinc-950 z-10">
              <tr className="border-b border-zinc-700 text-zinc-400 uppercase tracking-wide text-[10px]">
                <th className="px-4 py-2 text-left font-medium">Batch</th>
                <th className="px-4 py-2 text-left font-medium">Company</th>
                <th className="px-4 py-2 text-left font-medium">Tier</th>
                <th className="px-4 py-2 text-right font-medium">Cards</th>
                <th className="px-4 py-2 text-right font-medium">Cost/Card</th>
                <th className="px-4 py-2 text-right font-medium">Raw Cost</th>
                <th className="px-4 py-2 text-right font-medium">Grade Cost</th>
                <th className="px-4 py-2 text-right font-medium">Total Cost</th>
                <th className="px-4 py-2 text-right font-medium">Est. Value</th>
                <th className="px-4 py-2 text-right font-medium">Est. Gain</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Submitted / Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {data.map((batch) => {
                const totalGrading = (batch.grading_cost ?? 0) * (batch.total_qty ?? batch.item_count);
                const totalCost    = batch.raw_cost + totalGrading;
                const estGain      = batch.estimated_total - totalCost;
                const statusLabel  = batch.status === 'pending' ? 'Adding Cards' : batch.status;
                return (
                  <tr key={batch.id}
                    className="hover:bg-zinc-800/30 cursor-pointer transition-colors"
                    onClick={() => setSelectedId(batch.id)}>
                    <td className="px-4 py-2.5">
                      <p className="text-zinc-100 font-medium">{batch.name ?? batch.batch_id}</p>
                      <p className="text-[10px] text-zinc-600 font-mono">{batch.batch_id}</p>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-300">{batch.company}</td>
                    <td className="px-4 py-2.5 text-zinc-400">{batch.tier}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-300">{batch.item_count}</td>
                    <td className="px-4 py-2.5 text-right text-zinc-400">
                      {batch.grading_cost ? formatCurrency(batch.grading_cost, 'USD') : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-400">
                      {batch.raw_cost ? formatCurrency(batch.raw_cost, 'USD') : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-400">
                      {totalGrading ? formatCurrency(totalGrading, 'USD') : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-200 font-medium">
                      {totalCost ? formatCurrency(totalCost, 'USD') : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-zinc-300">
                      {batch.estimated_total ? formatCurrency(batch.estimated_total, 'USD') : '—'}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-medium ${estGain > 0 ? 'text-emerald-400' : estGain < 0 ? 'text-red-400' : 'text-zinc-500'}`}>
                      {totalCost ? formatCurrency(estGain, 'USD') : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge className={BATCH_STATUS_COLORS[batch.status] ?? 'bg-zinc-700/50 text-zinc-400'}>
                        {statusLabel}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="text-zinc-500 text-[11px]">{formatDate(batch.submitted_at) ?? '—'}</p>
                      {batch.notes && <p className="text-zinc-600 text-[10px] truncate">{batch.notes}</p>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Start Submission">
        <CreateBatchModal onClose={() => setShowCreate(false)} />
      </Modal>
    </div>
  );
}
