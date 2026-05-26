import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Plus, ArrowLeft, Loader2, Trash2, CheckCircle, AlertCircle, X } from 'lucide-react';
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
        <Input label="Grading Cost Per Card (USD)" type="text" inputMode="decimal" placeholder="0.00"
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
  const [mode, setMode] = useState<'inventory' | 'legacy'>('inventory');

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-md bg-zinc-900 border border-zinc-800 p-0.5">
        {([
          { key: 'inventory', label: 'From Inventory' },
          { key: 'legacy',    label: 'Legacy (no lot)' },
        ] as const).map(t => (
          <button key={t.key} type="button" onClick={() => setMode(t.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${mode === t.key ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {mode === 'inventory'
        ? <AddCardFromInventory batchId={batchId} onClose={onClose} />
        : <AddCardLegacy        batchId={batchId} onClose={onClose} />}
    </div>
  );
}

const BULK_ADD_MAX = 10;

interface BulkAddRow {
  card: CardToGrade;
  qty: string;
  expectedGrade: string;
  estimatedValue: string;
}

function AddCardFromInventory({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [search, setSearch]       = useState('');
  const [debounced, setDebounced] = useState('');
  const [rows, setRows]           = useState<BulkAddRow[]>([]);
  const [saving, setSaving]       = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: cardResults, isLoading } = useQuery<PaginatedResult<CardToGrade>>({
    queryKey: ['card-picker-grading', debounced],
    queryFn:  () => api.get('/cards', {
      params: { search: debounced, limit: 50, status: 'inspected,grading_submitted', decision: 'grade' },
    }).then((r) => r.data),
    enabled: debounced.length >= 2,
  });

  const cards = cardResults?.data ?? [];
  const selectedIds = new Set(rows.map(r => r.card.id));
  const atCap = rows.length >= BULK_ADD_MAX;

  function addRow(card: CardToGrade) {
    if (selectedIds.has(card.id) || atCap) return;
    setRows(prev => [...prev, { card, qty: '1', expectedGrade: '', estimatedValue: '' }]);
    setSearch('');
  }
  function removeRow(id: string) {
    setRows(prev => prev.filter(r => r.card.id !== id));
  }
  function updateRow(id: string, key: 'qty' | 'expectedGrade' | 'estimatedValue', val: string) {
    setRows(prev => prev.map(r => r.card.id === id ? { ...r, [key]: val } : r));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rows.length === 0) { toast.error('Add at least one card'); return; }
    for (const r of rows) {
      const qtyNum = parseInt(r.qty);
      if (!r.qty || isNaN(qtyNum) || qtyNum < 1 || qtyNum > r.card.quantity) {
        toast.error(`${r.card.card_name ?? 'Card'}: qty must be between 1 and ${r.card.quantity}`);
        return;
      }
    }
    setSaving(true);
    try {
      await api.post(`/grading-subs/${batchId}/items/bulk`, {
        items: rows.map(r => ({
          card_instance_id: r.card.id,
          quantity:         parseInt(r.qty),
          expected_grade:   r.expectedGrade ? parseFloat(r.expectedGrade) : undefined,
          estimated_value:  r.estimatedValue ? Math.round(parseFloat(r.estimatedValue) * 100) : undefined,
        })),
      });
      toast.success(rows.length === 1 ? 'Card added to batch' : `${rows.length} cards added to batch`);
      qc.invalidateQueries({ queryKey: ['grading-batch', batchId] });
      onClose();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to add cards');
    } finally {
      setSaving(false);
    }
  }

  const cellCls = 'w-full px-2 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {/* Search */}
      <input
        type="text"
        placeholder={atCap ? `Maximum ${BULK_ADD_MAX} cards per batch add` : 'Search by card name or purchase ID…'}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        disabled={atCap}
        className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
        autoComplete="off"
      />

      {/* Card list — click to add to selection */}
      {!atCap && (
        <div className="border border-zinc-700 rounded-lg overflow-hidden">
          {debounced.length < 2 ? (
            <div className="px-4 py-4 text-center text-zinc-600 text-sm">Type to search</div>
          ) : isLoading ? (
            <div className="px-4 py-4 text-center text-zinc-600 text-sm">Loading…</div>
          ) : cards.length === 0 ? (
            <div className="px-4 py-4 text-center text-zinc-500 text-sm">No cards found.</div>
          ) : (
            <div className="max-h-44 overflow-y-auto divide-y divide-zinc-800">
              {cards.map((card) => {
                const already = selectedIds.has(card.id);
                return (
                  <button key={card.id} type="button" disabled={already}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${already ? 'opacity-40 cursor-not-allowed' : 'hover:bg-zinc-800/60'}`}
                    onClick={() => addRow(card)}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate text-zinc-200">{card.card_name ?? 'Unknown'}</span>
                      <span className="text-xs font-mono font-semibold text-zinc-400 shrink-0">
                        {card.raw_purchase_label ?? '—'}
                        {already && <span className="ml-2 text-[10px] text-indigo-400 font-sans">added</span>}
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
      )}

      {/* Selected rows — per-card qty/grade/value */}
      {rows.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-zinc-800">
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
            Selected ({rows.length}/{BULK_ADD_MAX})
          </p>
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {rows.map((r) => (
              <div key={r.card.id} className="grid items-center gap-2 rounded border border-zinc-800 bg-zinc-900/40 px-2.5 py-2"
                style={{ gridTemplateColumns: 'minmax(0,1.6fr) 80px 90px 110px 24px' }}>
                <div className="min-w-0">
                  <p className="text-xs text-zinc-100 truncate font-medium">{r.card.card_name ?? 'Unknown'}</p>
                  <p className="text-[10px] text-zinc-500 truncate">
                    {r.card.set_name ?? '—'}{r.card.card_number ? ` · #${r.card.card_number}` : ''}
                    {' · '}<span className="font-mono text-zinc-400">{r.card.raw_purchase_label ?? '—'}</span>
                    {' · '}max {r.card.quantity}
                  </p>
                </div>
                <input type="number" min={1} max={r.card.quantity} value={r.qty}
                  placeholder="Qty"
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '') { updateRow(r.card.id, 'qty', ''); return; }
                    const n = parseInt(v);
                    if (!isNaN(n)) updateRow(r.card.id, 'qty', String(Math.min(r.card.quantity, Math.max(1, n))));
                  }}
                  className={cellCls} />
                <input type="number" step="0.5" min="1" max="10" placeholder="Grade"
                  value={r.expectedGrade}
                  onChange={(e) => updateRow(r.card.id, 'expectedGrade', e.target.value)}
                  className={cellCls} />
                <input type="text" inputMode="decimal" placeholder="$ / card"
                  value={r.estimatedValue}
                  onChange={(e) => updateRow(r.card.id, 'estimatedValue', e.target.value)}
                  className={cellCls} />
                <button type="button" onClick={() => removeRow(r.card.id)}
                  className="text-zinc-600 hover:text-red-400 transition-colors flex items-center justify-center">
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={saving || rows.length === 0}>
          {saving && <Loader2 size={14} className="animate-spin" />}
          Add {rows.length > 0 ? `${rows.length} ` : ''}to Batch
        </Button>
      </div>
    </form>
  );
}

// ── Legacy Add (catalog-bucket flow) ──────────────────────────────────────────

interface CatalogSearchResult {
  id: string;
  sku: string | null;
  card_name: string;
  set_name: string;
  set_code: string | null;
  card_number: string | null;
  language: string;
}

interface LegacyBucket {
  id: string;
  sku: string | null;
  card_name: string;
  set_name: string;
  language: string;
  stash_qty: number;
  per_card_cost: number;
}

function AddCardLegacy({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    card_name: '',
    set_name: '',
    card_number: '',
    language: 'EN',
    condition: 'NM',
    quantity: '1',
    purchase_cost: '0',
    expected_grade: '',
    estimated_value: '',
  });
  const [searchLabel, setSearchLabel] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pickedCatalog, setPickedCatalog] = useState<CatalogSearchResult | null>(null);
  const [creatingPart, setCreatingPart] = useState(false);
  const [saving, setSaving] = useState(false);
  const [legacyBucketId, setLegacyBucketId] = useState<string>('');
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  // Debounce the search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchLabel), 250);
    return () => clearTimeout(t);
  }, [searchLabel]);

  // Legacy buckets — catalog entries with set_code='LEGACY' and their stash
  // snapshot (qty across child card_instances, per-card cost from the stash row).
  const { data: legacyBuckets = [] } = useQuery<LegacyBucket[]>({
    queryKey: ['legacy-buckets'],
    queryFn: () => api.get('/catalog/legacy-buckets').then(r => r.data.data),
  });
  const legacyBucket = legacyBuckets.find(b => b.id === legacyBucketId) ?? null;

  // When a legacy bucket is picked, sync language + per-card cost from it
  // (cost auto-fills read-only). User still assigns the REAL card identity
  // via the second part-number search below.
  useEffect(() => {
    if (!legacyBucket) return;
    setForm(prev => ({
      ...prev,
      language: legacyBucket.language,
      purchase_cost: (legacyBucket.per_card_cost / 100).toFixed(2),
    }));
  }, [legacyBucket]);

  const { data: matches = [], isFetching: searching } = useQuery<CatalogSearchResult[]>({
    queryKey: ['catalog-search-legacy', debouncedSearch],
    queryFn: () => api.get('/catalog/search', { params: { q: debouncedSearch, limit: 8 } }).then(r => r.data.data),
    enabled: debouncedSearch.trim().length >= 2 && !pickedCatalog,
  });

  function pickMatch(m: CatalogSearchResult) {
    setPickedCatalog(m);
    setForm(prev => ({
      ...prev,
      card_name: m.card_name,
      set_name: m.set_name,
      card_number: m.card_number ?? prev.card_number,
      language: m.language ?? prev.language,
    }));
    setSearchLabel(m.sku ?? m.card_name);
  }

  function clearPick() {
    setPickedCatalog(null);
    setSearchLabel('');
  }

  async function generatePart() {
    if (!form.card_name.trim() || !form.set_name.trim()) {
      toast.error('Card name and set name required to generate a part number');
      return;
    }
    setCreatingPart(true);
    try {
      const res = await api.post('/catalog', {
        game: 'pokemon',
        card_name: form.card_name.trim(),
        set_name: form.set_name.trim(),
        card_number: form.card_number.trim() || null,
        language: form.language,
      });
      const created = res.data?.data ?? res.data;
      const newPick: CatalogSearchResult = {
        id: created.id,
        sku: created.sku ?? null,
        card_name: created.card_name,
        set_name: created.set_name,
        set_code: created.set_code ?? null,
        card_number: created.card_number ?? null,
        language: created.language,
      };
      setPickedCatalog(newPick);
      setSearchLabel(newPick.sku ?? newPick.card_name);
      toast.success('Part number created');
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to create part number');
    } finally {
      setCreatingPart(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.card_name.trim()) { toast.error('Card name is required'); return; }
    const qtyNum = parseInt(form.quantity);
    if (!qtyNum || qtyNum < 1) { toast.error('Quantity must be at least 1'); return; }
    if (legacyBucket && qtyNum > legacyBucket.stash_qty) {
      toast.error(`Only ${legacyBucket.stash_qty} card${legacyBucket.stash_qty === 1 ? '' : 's'} in this legacy bucket`);
      return;
    }
    setSaving(true);
    try {
      await api.post(`/grading-subs/${batchId}/items/legacy`, {
        card_name:         form.card_name.trim(),
        set_name:          form.set_name.trim() || null,
        card_number:       form.card_number.trim() || null,
        language:          form.language,
        condition:         form.condition || null,
        quantity:          qtyNum,
        // When pulling from a legacy bucket, server derives cost from the
        // stash row; purchase_cost is only used in the phantom-lot fallback.
        purchase_cost:     form.purchase_cost ? Math.round(parseFloat(form.purchase_cost) * 100) : 0,
        expected_grade:    form.expected_grade ? parseFloat(form.expected_grade) : undefined,
        estimated_value:   form.estimated_value ? Math.round(parseFloat(form.estimated_value) * 100) : undefined,
        catalog_id:        pickedCatalog?.id,        // REAL card identity — slab lands here
        legacy_catalog_id: legacyBucketId || undefined, // legacy bucket — stash drawn from here
      });
      toast.success('Legacy card added to batch');
      qc.invalidateQueries({ queryKey: ['grading-batch', batchId] });
      qc.invalidateQueries({ queryKey: ['legacy-buckets'] });
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to add legacy card');
    } finally {
      setSaving(false);
    }
  }

  const noSpinner = '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-xs text-zinc-500 leading-relaxed">
        For cards you owned before tracking purchases in Reactor. Pick a <span className="text-zinc-300">Legacy Part #</span> to draw from your stash (cost + inventory tracked there),
        then assign the <span className="text-zinc-300">Card Part #</span> for what this specific card actually is — that's the part the slab lands under.
      </p>

      {/* Legacy Part # — bucket source */}
      <div>
        <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide block mb-1">
          Legacy Part # {!legacyBucketId && <span className="text-zinc-600 normal-case">(optional)</span>}
        </label>
        <select
          value={legacyBucketId}
          onChange={(e) => setLegacyBucketId(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500"
        >
          <option value="">— None: auto-create backdated lot for cost basis —</option>
          {legacyBuckets.map((b) => (
            <option key={b.id} value={b.id}>
              {b.sku ?? b.card_name} · {b.stash_qty} left · ${(b.per_card_cost / 100).toFixed(2)}/card
            </option>
          ))}
        </select>
        {legacyBucket && (
          <p className="text-[10px] text-zinc-500 mt-1">
            Pulling from this bucket. The stash row decrements by the qty you pull; cost moves to the slab when it returns.
          </p>
        )}
      </div>

      {/* Card Part # — real card identity */}
      <div>
        <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide block mb-1">
          Card Part # <span className="text-zinc-600 normal-case">(real card identity{legacyBucket ? ' — slab lands here, not under the legacy bucket' : ''})</span>
        </label>
        <div className="relative">
          <input
            type="text"
            value={searchLabel}
            onChange={(e) => { setSearchLabel(e.target.value); if (pickedCatalog) setPickedCatalog(null); }}
            placeholder="Search by part #, card name, or set…"
            className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
          />
          {/* Search results dropdown */}
          {!pickedCatalog && debouncedSearch.trim().length >= 2 && (
            <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-lg bg-zinc-900 border border-zinc-700 shadow-xl divide-y divide-zinc-800">
              {searching ? (
                <div className="px-3 py-2 text-xs text-zinc-500">Searching…</div>
              ) : matches.length === 0 ? (
                <div className="px-3 py-2 text-xs text-zinc-500">
                  No matching part number. Fill in fields below and click <span className="text-yellow-400">Generate part</span>.
                </div>
              ) : matches.map(m => (
                <button key={m.id} type="button" onClick={() => pickMatch(m)}
                  className="w-full text-left px-3 py-2 hover:bg-zinc-800/60 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-indigo-300">{m.sku ?? '(no sku)'}</span>
                    <span className="text-[10px] text-zinc-500">{m.language}</span>
                  </div>
                  <div className="text-xs text-zinc-200 truncate">{m.card_name}</div>
                  <div className="text-[10px] text-zinc-500 truncate">{m.set_name}{m.card_number ? ` · #${m.card_number}` : ''}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Selected part number badge */}
      {pickedCatalog ? (
        <div className="flex items-center justify-between rounded-lg px-3 py-2 text-sm border bg-green-950/40 border-green-800/50">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle size={14} className="text-green-400 shrink-0" />
            <span className="font-mono text-xs text-zinc-200 shrink-0">{pickedCatalog.sku ?? '(no sku)'}</span>
            <span className="text-xs text-zinc-400 truncate">{pickedCatalog.card_name} · {pickedCatalog.set_name}</span>
          </div>
          <button type="button" onClick={clearPick} className="text-xs text-zinc-500 hover:text-zinc-300 shrink-0 ml-2">Clear</button>
        </div>
      ) : (form.card_name.trim() && form.set_name.trim()) ? (
        <div className="flex items-center justify-between rounded-lg px-3 py-2 text-sm border bg-yellow-950/40 border-yellow-700/50">
          <div className="flex items-center gap-2">
            <AlertCircle size={14} className="text-yellow-400 shrink-0" />
            <span className="text-xs text-yellow-400">No part number assigned — generate one from the fields below?</span>
          </div>
          <button
            type="button"
            onClick={generatePart}
            disabled={creatingPart}
            className="text-xs text-yellow-400 hover:text-yellow-300 font-medium disabled:opacity-50"
          >
            {creatingPart ? 'Creating…' : 'Generate part'}
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Input label="Card Name *" value={form.card_name} onChange={set('card_name')} placeholder="e.g. Charizard" />
        <Input label="Set Name"   value={form.set_name}  onChange={set('set_name')}  placeholder="e.g. Base Set" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Input label="Card #"     value={form.card_number} onChange={set('card_number')} placeholder="4" />
        <div>
          <label className="block text-xs font-medium text-zinc-400 uppercase tracking-wide mb-1">Language</label>
          <select value={form.language} onChange={set('language')}
            className="w-full px-3 py-2 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500">
            <option value="EN">EN</option>
            <option value="JP">JP</option>
            <option value="KR">KR</option>
            <option value="ZH-TW">ZH-TW</option>
            <option value="ZH-CN">ZH-CN</option>
          </select>
        </div>
        <Input label="Condition" value={form.condition} onChange={set('condition')} placeholder="NM" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input
          label={`Quantity *${legacyBucket ? ` (max ${legacyBucket.stash_qty})` : ''}`}
          type="number" min="1" max={legacyBucket?.stash_qty}
          value={form.quantity} onChange={set('quantity')} className={noSpinner}
        />
        <Input
          label={`Cost / Card (USD)${legacyBucket ? ' — from legacy bucket' : ''}`}
          type="text" inputMode="decimal"
          value={form.purchase_cost} onChange={set('purchase_cost')}
          placeholder="0.00"
          readOnly={!!legacyBucket}
          className={`${noSpinner} ${legacyBucket ? 'opacity-60 cursor-not-allowed' : ''}`}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-zinc-800">
        <Input label="Expected Grade" type="number" step="0.5" min="1" max="10" placeholder="e.g. 9"
          value={form.expected_grade} onChange={set('expected_grade')} className={noSpinner} />
        <Input label="Est. Value / Card" type="text" inputMode="decimal" placeholder="0.00"
          value={form.estimated_value} onChange={set('estimated_value')} className={noSpinner} />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={saving || !form.card_name.trim()}>
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
        <Input label="Est. Value / Card" type="text" inputMode="decimal" placeholder="0.00"
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
        <Input label="Grading Cost Per Card (USD)" type="text" inputMode="decimal" placeholder="0.00"
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

      <Modal open={showAddCard} onClose={() => setShowAddCard(false)} title="Add Card to Batch" className="max-w-2xl">
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
