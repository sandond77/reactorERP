import React, { useState, useRef } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Plus, ChevronLeft, Trash2, Pencil, ImagePlus, X } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { formatCurrency, toCents } from '../../lib/utils';
import toast from 'react-hot-toast';
import type { PurchaseRow, PurchaseDetail, InspectionLine, Decision } from './types';
import { CONDITIONS, DECISION_LABELS } from './types';
import { useLocations } from '../../hooks/useLocations';

// ── Inspection line form ──────────────────────────────────────────────────────

type LineImages = { front?: File; back?: File };

interface SlabPickerResult {
  id: string;
  card_name: string | null;
  set_name: string | null;
  card_number: string | null;
  cert_number: string | null;
  grade: number | null;
  grade_label: string | null;
  company: string | null;
  raw_purchase_id: string | null;
  status?: string;
  purchase_cost?: number;  // existing cost basis on the slab (cents)
  currency?: string;
}

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
    location_id: (initial as { location_id?: string | null })?.location_id ?? '',
  });
  const { locations: rawLocations, allLocations } = useLocations('raw');

  // Slab picker (only used when decision === 'already_graded') — multi-select
  const [slabSearch, setSlabSearch] = useState('');
  const [debouncedSlabSearch, setDebouncedSlabSearch] = useState('');
  // When editing an existing already_graded line, pre-populate with the current slab
  const editingBackLinkId: string | null = initial?.decision === 'already_graded' && initial?.id ? initial.id : null;
  const [pickedSlabs, setPickedSlabs] = useState<SlabPickerResult[]>(() => {
    if (initial?.decision === 'already_graded' && initial?.id) {
      return [{
        id: initial.id,
        card_name: initial.card_name ?? null,
        set_name: initial.set_name ?? null,
        card_number: initial.card_number ?? null,
        cert_number: initial.cert_number ?? null,
        grade: initial.grade ?? null,
        grade_label: initial.grade_label ?? null,
        company: initial.company ?? null,
        raw_purchase_id: null,
      }];
    }
    return [];
  });
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSlabSearch(slabSearch), 250);
    return () => clearTimeout(t);
  }, [slabSearch]);

  const { data: slabResults = [], isFetching: searchingSlabs } = useQuery<SlabPickerResult[]>({
    queryKey: ['slab-picker', debouncedSlabSearch],
    queryFn: () => api.get('/cards', { params: { search: debouncedSlabSearch, status: 'graded,sold', purchase_type: 'pre_graded', limit: 12 } })
      .then(r => (r.data?.data ?? r.data ?? []) as SlabPickerResult[]),
    enabled: form.decision === 'already_graded' && debouncedSlabSearch.trim().length >= 2,
  });

  function toggleSlab(s: SlabPickerResult) {
    setPickedSlabs(prev => prev.some(p => p.id === s.id)
      ? prev.filter(p => p.id !== s.id)
      : [...prev, s]);
  }

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

  // Ref guards against rapid double-clicks: state batching means a second
  // click in the same tick still sees `submitting=false` in its closure.
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return;
    if (form.decision === 'already_graded') {
      const targetQty = parseInt(form.quantity) || 0;
      if (targetQty < 1) { toast.error('Quantity must be at least 1'); return; }
      if (targetQty > maxQuantity) { setQtyError(`Max ${maxQuantity} remaining`); return; }
      if (pickedSlabs.length !== targetQty) {
        toast.error(`Pick exactly ${targetQty} slab${targetQty === 1 ? '' : 's'} (currently picked: ${pickedSlabs.length})`);
        return;
      }
      submittingRef.current = true;
      setSubmitting(true);
      // If we're editing an existing non-back-link line (e.g. Grade → Already
      // Graded), the lot has no remaining capacity until that line is gone.
      // Pass _replace_line_id so the mutation deletes the old line before
      // posting the back-link.
      const replaceLineId = initial && initial.decision !== 'already_graded' && initial.id
        ? initial.id
        : undefined;
      onSave({
        _back_link: true,
        slab_ids: pickedSlabs.map(s => s.id),
        _replace_slab_id: editingBackLinkId ?? undefined,
        _replace_line_id: replaceLineId,
      }, {});
      return;
    }
    const qty = parseInt(form.quantity) || 1;
    if (qty > maxQuantity) {
      setQtyError(`Max ${maxQuantity} remaining`);
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    onSave({
      condition:     form.condition,
      decision:      form.decision,
      quantity:      qty,
      purchase_cost: toCents(form.purchase_cost),
      currency:      form.currency,
      notes:         form.notes || undefined,
      location_id:   form.location_id || null,
    }, { front: frontFile ?? undefined, back: backFile ?? undefined });
  }

  const inp   = 'w-full px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500';
  const label = 'block text-xs text-zinc-400 mb-1';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {form.decision !== 'already_graded' && (
          <div>
            <label className={label}>Condition</label>
            <select value={form.condition} onChange={(e) => set('condition', e.target.value)} className={inp}>
              {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}
        <div className={form.decision === 'already_graded' ? 'col-span-2' : ''}>
          <label className={label}>Decision</label>
          <select value={form.decision} onChange={(e) => set('decision', e.target.value)} className={inp}>
            <option value="sell_raw">Sell Raw</option>
            <option value="grade">Grade</option>
            <option value="already_graded">Already Graded</option>
          </select>
        </div>
      </div>

      {form.decision === 'already_graded' ? (
        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
          <p className="text-xs text-zinc-500">
            Back-link existing slabs to this lot. Set how many cards from this lot were already graded, then pick that many slabs.
            Existing cost basis on each slab is left as-is — only lineage is added.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>
                Quantity
                {qtyError && <span className="ml-1 text-xs text-red-400">{qtyError}</span>}
              </label>
              <input type="number" min="1" max={maxQuantity} value={form.quantity}
                onChange={(e) => { set('quantity', e.target.value); setQtyError(''); }}
                className={`${inp} ${qtyError ? 'border-red-500/60' : ''}`} />
              <p className="text-[10px] text-zinc-600 mt-0.5">
                {initial?.quantity ? `Max ${maxQuantity} (includes this line)` : `${maxQuantity} remaining in lot`}
              </p>
            </div>
            <div className="self-end">
              <p className={`text-xs ${pickedSlabs.length === (parseInt(form.quantity) || 0) ? 'text-green-400' : 'text-yellow-400'}`}>
                Picked {pickedSlabs.length} / {parseInt(form.quantity) || 0} slab{(parseInt(form.quantity) || 0) === 1 ? '' : 's'}
              </p>
            </div>
          </div>

          {/* Picked slabs */}
          {pickedSlabs.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">Linked slabs</p>
              {pickedSlabs.map(s => (
                <div key={s.id} className="flex items-center justify-between bg-zinc-900 border border-green-700/50 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-green-300">{s.cert_number ?? '(no cert)'} · {s.company} {s.grade_label ?? s.grade ?? ''}</div>
                    <div className="text-sm text-zinc-200 truncate">{s.card_name ?? '—'}</div>
                    <div className="text-[10px] text-zinc-500 truncate">{s.set_name ?? '—'}{s.card_number ? ` · #${s.card_number}` : ''}</div>
                    {s.raw_purchase_id && <div className="text-[10px] text-yellow-400 mt-0.5">⚠ already linked to another lot — will be reassigned</div>}
                  </div>
                  <button type="button" onClick={() => toggleSlab(s)}
                    className="text-xs text-zinc-500 hover:text-red-400 shrink-0 ml-2">Remove</button>
                </div>
              ))}
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <input type="text" value={slabSearch} onChange={(e) => setSlabSearch(e.target.value)}
              placeholder="Search by cert # or card name…"
              className={inp} />
            {debouncedSlabSearch.trim().length >= 2 && (
              <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-lg bg-zinc-900 border border-zinc-700 shadow-xl divide-y divide-zinc-800">
                {searchingSlabs ? (
                  <div className="px-3 py-2 text-xs text-zinc-500">Searching…</div>
                ) : slabResults.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-zinc-500">No graded slabs match.</div>
                ) : slabResults.map(s => {
                  const picked = pickedSlabs.some(p => p.id === s.id);
                  return (
                    <button key={s.id} type="button" onClick={() => toggleSlab(s)}
                      className={`w-full text-left px-3 py-2 transition-colors ${picked ? 'bg-indigo-600/20' : 'hover:bg-zinc-800/60'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-indigo-300">{s.cert_number ?? '(no cert)'}{picked ? ' ✓' : ''}</span>
                        <span className="text-[10px] text-zinc-500">
                          {s.company} {s.grade_label ?? s.grade ?? ''}
                          {s.status === 'sold' && <span className="ml-1 text-zinc-600">· sold</span>}
                          {s.purchase_cost != null && s.purchase_cost > 0 && (
                            <span className="ml-1 text-zinc-600">· {formatCurrency(s.purchase_cost, s.currency ?? 'USD')}</span>
                          )}
                        </span>
                      </div>
                      <div className="text-xs text-zinc-200 truncate">{s.card_name ?? '—'}</div>
                      <div className="text-[10px] text-zinc-500 truncate">{s.set_name ?? '—'}{s.card_number ? ` · #${s.card_number}` : ''}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={label}>
              Quantity
              {qtyError && <span className="ml-1 text-xs text-red-400">{qtyError}</span>}
            </label>
            <input type="number" min="1" max={maxQuantity} value={form.quantity}
              onChange={(e) => { set('quantity', e.target.value); setQtyError(''); }}
              className={`${inp} ${qtyError ? 'border-red-500/60' : ''}`} />
            <p className="text-[10px] text-zinc-600 mt-0.5">
              {initial?.quantity ? `Max ${maxQuantity} (includes this line)` : `${maxQuantity} remaining`}
            </p>
          </div>
          <div>
            <label className={label}>Cost / Card (USD)</label>
            <input type="text" inputMode="decimal" value={form.purchase_cost} onChange={(e) => set('purchase_cost', e.target.value)} className={inp} />
          </div>
          <div>
            <label className={label}>Currency</label>
            <select value={form.currency} onChange={(e) => set('currency', e.target.value)} className={inp}>
              <option value="USD">USD</option>
              <option value="JPY">JPY</option>
            </select>
          </div>
        </div>
      )}
      <div>
        <label className={label}>Notes</label>
        <input value={form.notes} onChange={(e) => set('notes', e.target.value)} className={inp} />
      </div>
      <div>
        <label className={label}>Location</label>
        {rawLocations.length > 0 ? (
          <select value={form.location_id} onChange={(e) => set('location_id', e.target.value)} className={inp}>
            <option value="">— No location —</option>
            {rawLocations.map((l) => {
              const parent = l.parent_id ? allLocations.find((p) => p.id === l.parent_id) : null;
              return (
                <option key={l.id} value={l.id}>{parent ? `${parent.name} › ${l.name}` : l.name}{l.is_card_show ? ' (Card Show)' : ''}</option>
              );
            })}
          </select>
        ) : (
          <p className="text-xs text-zinc-600 py-1">No raw locations yet. Add them in Settings → Locations.</p>
        )}
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
        <Button type="submit" size="sm" disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
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
      // Sentinel: this is an "Already Graded" back-link, not a normal inspection line
      if (body._back_link) {
        // Edit/swap flow — unlink the original slab first, then add new picks.
        // (No-op if the user re-picked the same slab as before.)
        const replaceId = body._replace_slab_id as string | undefined;
        const replaceLineId = body._replace_line_id as string | undefined;
        const newIds = body.slab_ids as string[];
        if (replaceId && !newIds.includes(replaceId)) {
          await api.delete(`/raw-purchases/${purchase.id}/back-link-slab/${replaceId}`).catch(() => {});
        }
        // Converting an existing non-back-link line (Grade / Sell Raw) into a
        // back-link — delete the original line to free its slot before posting.
        if (replaceLineId) {
          await api.delete(`/raw-purchases/${purchase.id}/lines/${replaceLineId}`);
        }
        return api.post(`/raw-purchases/${purchase.id}/back-link-slab`, { slab_ids: newIds }).then((r) => r.data);
      }
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
    onError: (err: any) => toast.error(err?.response?.data?.error ?? 'Failed to add line'),
  });

  const updateMut = useMutation({
    mutationFn: ({ cardId, body }: { cardId: string; body: Record<string, unknown> }) =>
      api.patch(`/raw-purchases/${purchase.id}/lines/${cardId}`, body).then((r) => r.data),
    onSuccess: () => { invalidate(); setEditLine(null); toast.success('Updated'); },
    onError: (err: any) => toast.error(err?.response?.data?.error ?? 'Failed to update'),
  });

  const deleteMut = useMutation({
    mutationFn: (cardId: string) => api.delete(`/raw-purchases/${purchase.id}/lines/${cardId}`),
    onSuccess: () => { invalidate(); toast.success('Removed'); },
    onError: () => toast.error('Failed to remove'),
  });

  const unlinkMut = useMutation({
    mutationFn: (slabId: string) => api.delete(`/raw-purchases/${purchase.id}/back-link-slab/${slabId}`),
    onSuccess: () => {
      invalidate();
      qc.invalidateQueries({ queryKey: ['slab-picker'] });   // picker results may have included the now-unlinked slab
      toast.success('Back-link removed (slab kept)');
    },
    onError: (err: any) => toast.error(err?.response?.data?.error ?? 'Failed to unlink'),
  });

  const allocated = data?.cards.reduce((s, c) => s + c.quantity, 0) ?? 0;
  const remaining = purchase.card_count - allocated;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 lg:gap-0 px-6 py-4 border-b border-zinc-800">
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
        <div className="flex items-center flex-wrap gap-3 w-full lg:w-auto justify-end">
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
              ) : data.cards.map((line) => {
                const isAlreadyGraded = line.decision === 'already_graded';
                return (
                <tr key={line.id} className="hover:bg-zinc-800/25 transition-colors">
                  <td className="px-4 py-2 text-zinc-400 font-mono">
                    {line.part_number ?? '—'}
                    {isAlreadyGraded && line.cert_number && (
                      <div className="text-[10px] text-zinc-500 mt-0.5 font-mono">
                        cert {line.cert_number}{line.company || line.grade_label || line.grade ? ` · ${line.company ?? ''} ${line.grade_label ?? line.grade ?? ''}` : ''}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-zinc-300">{line.condition ?? '—'}</td>
                  <td className="px-4 py-2">
                    {line.decision ? (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        line.decision === 'grade'
                          ? 'bg-indigo-500/15 text-indigo-300'
                          : line.decision === 'already_graded'
                          ? 'bg-yellow-500/15 text-yellow-300'
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
                      <button onClick={() => setEditLine(line)} className="text-zinc-600 hover:text-zinc-300 transition-colors"
                        title={isAlreadyGraded ? 'Reselect linked slab' : 'Edit line'}>
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => isAlreadyGraded ? unlinkMut.mutate(line.id) : deleteMut.mutate(line.id)}
                        className="text-zinc-600 hover:text-red-400 transition-colors"
                        title={isAlreadyGraded ? 'Remove back-link (slab stays)' : 'Delete line'}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
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

      <Modal open={!!editLine} onClose={() => setEditLine(null)} title={editLine?.decision === 'already_graded' ? 'Reselect Linked Slab' : 'Edit Inspection Line'}>
        {editLine && (
          <InspectionLineForm
            purchase={purchase}
            initial={editLine}
            maxQuantity={remaining + editLine.quantity}
            showImages={false}
            onSave={(body) => {
              if (body._back_link) {
                addMut.mutate({ body, images: {} });
                setEditLine(null);
              } else {
                updateMut.mutate({ cardId: editLine.id, body });
              }
            }}
            onClose={() => setEditLine(null)}
          />
        )}
      </Modal>
    </div>
  );
}
