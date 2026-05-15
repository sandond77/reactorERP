import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Plus, X, PackageCheck, Ban, ImagePlus, Sparkles, Loader2, RotateCcw } from 'lucide-react';
import { api } from '../lib/api';
import { PartNumberField, type CatalogMatch } from '../components/catalog/PartNumberField';
import { AddPartModal, type CreatedPart } from '../components/catalog/AddPartModal';
import { SetCombobox, useMergedSets } from '../components/catalog/SetCombobox';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { formatCurrency, formatDate } from '../lib/utils';
import { ColHeader, useColWidths, colMinWidth } from '../components/ui/TableHeader';
import { loadFilters, saveFilters } from '../lib/filter-store';
import toast from 'react-hot-toast';
import type { PurchaseRow, PurchaseType } from './raw/types';
import { STATUS_COLORS, TYPE_COLORS } from './raw/types';

// ── Add/Edit Purchase Form ────────────────────────────────────────────────────

interface LineItem {
  card_name: string;
  set_name: string;
  set_code: string;
  card_number: string;
  unnumbered: boolean; // true = card has no printed number; locks the # input
  quantity: string;
  cost: string;
  type: PurchaseType;
  catalog_id?: string | null; // set if line resolved to an existing catalog entry
}

function buildPartNumber(language: string, setCode: string, cardNumber: string): string | null {
  if (!setCode) return null;
  const lang = language.toUpperCase();
  const code = setCode.toUpperCase();
  if (!cardNumber) return `PKMN-${lang}-${code}`;
  const padded = /^\d+$/.test(cardNumber) ? cardNumber.padStart(3, '0') : cardNumber;
  return `PKMN-${lang}-${code}-${padded.toUpperCase()}`;
}

function PurchaseForm({
  initial,
  onSave,
  onClose,
  onDelete,
  onMultiLineChange,
}: {
  initial?: Partial<PurchaseRow>;
  onSave: (data: Record<string, unknown> | Record<string, unknown>[], receiptFile?: File) => void;
  onClose: () => void;
  onDelete?: () => void;
  onMultiLineChange?: (multi: boolean) => void;
}) {
  const [form, setForm] = useState({
    type:           (initial?.type ?? 'raw') as PurchaseType,
    source:         initial?.source ?? '',
    order_number:   initial?.order_number ?? '',
    language:       initial?.language ?? 'JP',
    card_name:      initial?.card_name ?? '',
    set_name:       initial?.set_name ?? '',
    card_number:    initial?.card_number ?? '',
    total_cost_yen: initial?.total_cost_yen ? String(initial.total_cost_yen) : '',
    fx_rate:        initial?.fx_rate ? String(initial.fx_rate) : '',
    total_cost_usd: initial?.total_cost_usd ? String(initial.total_cost_usd / 100) : '',
    card_count:     initial?.card_count ? String(initial.card_count) : '1',
    purchased_at:   initial?.purchased_at ? initial.purchased_at.slice(0, 10) : '',
    notes:          initial?.notes ?? '',
  });

  const [catalogMatch, setCatalogMatch] = useState<CatalogMatch | null>(
    initial?.catalog_id ? {
      id: initial.catalog_id,
      sku: (initial as { catalog_sku?: string | null })?.catalog_sku ?? null,
      card_name: initial.card_name ?? '',
      set_name: initial.set_name ?? '',
      card_number: initial.card_number ?? null,
      language: initial.language ?? 'EN',
    } : null
  );
  const [catalogId, setCatalogId] = useState<string | null>(initial?.catalog_id ?? null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(initial?.receipt_url ?? null);
  const [searchLabel, setSearchLabel] = useState('');
  const [autoFilling, setAutoFilling] = useState(false);
  const [parsingReceipt, setParsingReceipt] = useState(false);
  const [uploadKind, setUploadKind] = useState<'receipt' | 'card'>('receipt');
  const [lineItems, setLineItems] = useState<LineItem[] | null>(null);
  const [createPartLineIdx, setCreatePartLineIdx] = useState<number | null>(null);
  const [lineCurrency, setLineCurrency] = useState<'JPY' | 'USD'>('JPY');
  const [singleUnnumbered, setSingleUnnumbered] = useState(false);
  const setOptions = useMergedSets(form.language);

  useEffect(() => {
    onMultiLineChange?.(!!lineItems);
  }, [lineItems, onMultiLineChange]);
  const qcLocal = useQueryClient();

  async function addNewSetForLine(idx: number, typedName: string) {
    const code = window.prompt(`Set code for "${typedName}"?\n(e.g. SV3, SWSH9, BS, CRC)`);
    if (!code?.trim()) return;
    try {
      await api.post('/sets/aliases', {
        language: form.language,
        game: 'pokemon',
        alias: typedName.toLowerCase(),
        set_code: code.trim().toUpperCase(),
        set_name: typedName,
      });
      qcLocal.invalidateQueries({ queryKey: ['set-aliases'] });
      setLineItems((arr) => arr!.map((x, j) => j === idx ? { ...x, set_name: typedName, set_code: code.trim().toUpperCase() } : x));
      toast.success(`Added set ${code.trim().toUpperCase()}`);
    } catch {
      toast.error('Failed to register set');
    }
  }

  // Open AddPartModal for a line item — same modal Edit Purchase + Trades
  // use, so user gets the SKU preview / set-code / game / language UI
  // instead of a silent direct POST.
  function openCreatePartForLine(idx: number) {
    const li = lineItems?.[idx];
    if (!li) return;
    if (!li.card_number && !li.unnumbered) {
      toast.error('Tick "no #" first to create an unnumbered part');
      return;
    }
    setCreatePartLineIdx(idx);
  }

  function handlePartCreated(part: CreatedPart) {
    if (createPartLineIdx === null) return;
    const idx = createPartLineIdx;
    setLineItems((arr) => arr!.map((x, j) => j === idx ? {
      ...x,
      catalog_id: part.id,
      card_name: part.card_name || x.card_name,
      set_name: part.set_name  || x.set_name,
      card_number: part.card_number ?? x.card_number,
    } : x));
    qcLocal.invalidateQueries({ queryKey: ['inventory-summary'] });
    setCreatePartLineIdx(null);
    toast.success(`Created part ${part.sku ?? part.card_name}`);
  }

  async function autoFill() {
    const label = searchLabel.trim();
    if (!label) return;
    setAutoFilling(true);
    try {
      const res = await api.post('/agent/auto-fill', { partial_name: label, game: 'pokemon' });
      const s = res.data.data?.suggestions?.[0];
      if (s) {
        setForm((prev) => ({
          ...prev,
          card_name:   s.catalog_card_name || s.card_name || prev.card_name,
          set_name:    s.set_name    || prev.set_name,
          card_number: s.card_number || prev.card_number,
          language:    s.language === 'JP' ? 'JP' : s.language === 'EN' ? 'EN' : prev.language,
        }));
        if (s.catalog_id) setCatalogId(s.catalog_id);
        toast.success('Auto-filled from card database');
      } else {
        toast('No match found — fill manually', { icon: '🔍' });
      }
    } catch {
      toast.error('Unable to auto-fill — fill manually');
    } finally {
      setAutoFilling(false);
    }
  }

  async function parseImage(file: File, kind: 'receipt' | 'card') {
    setParsingReceipt(true);
    try {
      const fd = new FormData();
      fd.append('image', file);
      if (kind === 'receipt') {
        fd.append('hint', 'purchase');
        const res = await api.post('/agent/parse-receipt', fd);
        const parsed = res.data?.data ?? res.data;
        if (!parsed) throw new Error('No data returned');
        const cards = (parsed.cards ?? []) as Array<{ card_name?: string; set_name?: string; card_number?: string; quantity?: number; cost?: number }>;

        // Always update shared header fields
        setForm((prev) => ({
          ...prev,
          source:         parsed.platform === 'ebay' ? 'eBay' : (parsed.source ?? prev.source),
          order_number:   parsed.order_number ?? prev.order_number,
          purchased_at:   parsed.date ?? prev.purchased_at,
          total_cost_usd: parsed.currency === 'USD' && parsed.total != null ? String(parsed.total) : prev.total_cost_usd,
          total_cost_yen: (parsed.currency === 'JPY' || parsed.currency === 'YEN') && parsed.total != null ? String(parsed.total) : prev.total_cost_yen,
        }));

        if (cards.length > 1 && !initial) {
          // Multi-card mode: show line items list, user designates type per row
          const baseItems: LineItem[] = cards.map((c) => ({
            card_name:   c.card_name   ?? '',
            set_name:    c.set_name    ?? '',
            set_code:    '',
            card_number: c.card_number ?? '',
            unnumbered:  false,
            quantity:    c.quantity != null ? String(c.quantity) : '1',
            cost:        c.cost     != null ? String(c.cost)     : '',
            type:        'raw',
            catalog_id:  null,
          }));
          setLineItems(baseItems);
          setLineCurrency(parsed.currency === 'USD' ? 'USD' : 'JPY');
          toast.success(`Receipt parsed — ${cards.length} cards detected`);

          // Fire catalog lookups in parallel; populate catalog_id + canonical fields when an exact-1 match
          // Only run when card_number is present — unnumbered matches require the user to explicitly
          // tick "no #" first, otherwise we'd silently link to an unintended entry.
          Promise.all(baseItems.map(async (li) => {
            if (!li.card_name || !li.card_number) return null;
            try {
              const params: Record<string, string> = {
                card_name:   li.card_name,
                card_number: li.card_number,
                language:    form.language,
                limit:       '5',
              };
              if (li.set_name) params.set_name = li.set_name;
              const res = await api.get('/catalog/search', { params });
              const matches = (res.data?.data ?? res.data ?? []) as Array<{
                id: string; sku: string | null; card_name: string; set_name: string; set_code: string | null; card_number: string | null; language: string;
              }>;
              if (matches.length === 1) {
                const m = matches[0];
                return {
                  catalog_id:  m.id,
                  card_name:   m.card_name,
                  set_name:    m.set_name,
                  card_number: m.card_number ?? li.card_number,
                  set_code:    m.set_code ?? '',
                };
              }
            } catch { /* swallow — leave line unmatched */ }
            return null;
          })).then((resolved) => {
            setLineItems((arr) => arr ? arr.map((li, i) => resolved[i] ? { ...li, ...resolved[i] } as LineItem : li) : arr);
            const matchedCount = resolved.filter(Boolean).length;
            if (matchedCount > 0) toast.success(`${matchedCount}/${cards.length} matched to existing catalog entries`);
          });
        } else if (cards.length > 1 && initial) {
          // Edit mode — fill the first, ignore the rest (single-card row in DB)
          const card = cards[0];
          setForm((prev) => ({
            ...prev,
            card_name:   card?.card_name   || prev.card_name,
            set_name:    card?.set_name    || prev.set_name,
            card_number: card?.card_number || prev.card_number,
            card_count:  card?.quantity ? String(card.quantity) : prev.card_count,
          }));
          toast(`Receipt has ${cards.length} cards — only the first is applied to this existing purchase`, { icon: '⚠️' });
        } else {
          const card = cards[0];
          setForm((prev) => ({
            ...prev,
            card_name:   card?.card_name   || prev.card_name,
            set_name:    card?.set_name    || prev.set_name,
            card_number: card?.card_number || prev.card_number,
            card_count:  card?.quantity ? String(card.quantity) : prev.card_count,
          }));
          setLineItems(null);
          toast.success('Receipt parsed');
        }
      } else {
        fd.append('game', 'pokemon');
        const res = await api.post('/agent/auto-fill', fd);
        const s = res.data?.data?.suggestions?.[0];
        if (!s) { toast('No card info found in image', { icon: '🔍' }); return; }
        setForm((prev) => ({
          ...prev,
          card_name:   s.catalog_card_name || s.card_name || prev.card_name,
          set_name:    s.set_name    || prev.set_name,
          card_number: s.card_number || prev.card_number,
          language:    s.language === 'JP' ? 'JP' : s.language === 'EN' ? 'EN' : prev.language,
        }));
        if (s.catalog_id) setCatalogId(s.catalog_id);
        toast.success('Card identified from image');
      }
    } catch {
      toast.error(kind === 'receipt' ? 'Unable to parse receipt' : 'Unable to identify card');
    } finally {
      setParsingReceipt(false);
    }
  }

  useEffect(() => {
    const yen  = parseFloat(form.total_cost_yen);
    const rate = parseFloat(form.fx_rate);
    if (!isNaN(yen) && !isNaN(rate) && rate > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm((f) => ({ ...f, total_cost_usd: (yen / rate).toFixed(2) }));
    }
  }, [form.total_cost_yen, form.fx_rate]);

  function set(k: string, v: unknown) { setForm((f) => ({ ...f, [k]: v })); }

  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const e: Record<string, string> = {};
    if (!form.source)       e.source       = 'Required';
    if (!form.purchased_at) e.purchased_at = 'Required';
    if (lineItems && lineItems.length > 0) {
      // Multi-line: validate per-row card details
      lineItems.forEach((li, i) => {
        if (!li.card_name)   e[`line_${i}_name`]   = 'Required';
        if (!li.set_name)    e[`line_${i}_set`]    = 'Required';
        if (!li.unnumbered && !li.card_number) e[`line_${i}_num`] = 'Required';
        if (!li.quantity || parseInt(li.quantity) < 1) e[`line_${i}_qty`] = 'Required';
        if (!li.cost) e[`line_${i}_cost`] = 'Required';
      });
      if (lineCurrency === 'JPY' && (!form.fx_rate || parseFloat(form.fx_rate) <= 0)) {
        e.cost = '¥ → USD rate required when entering line costs in ¥';
      }
    } else {
      if (!form.card_name)    e.card_name    = 'Required';
      if (!form.set_name)     e.set_name     = 'Required';
      if (!singleUnnumbered && !form.card_number) e.card_number = 'Required';
      if (!form.card_count || parseInt(form.card_count) < 1) e.card_count = 'Required';
      const hasYen = !!form.total_cost_yen && !!form.fx_rate;
      const hasUsd = !!form.total_cost_usd;
      if (!hasYen && !hasUsd) e.cost = '¥ + rate, or USD total is required';
    }
    return e;
  }

  // Ref-based guard: rapid double-clicks both see the stale state value in
  // their closures before the re-render lands. Ref mutates synchronously.
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return;
    const errs = validate();
    if (Object.keys(errs).length) {
      setErrors(errs);
      const firstMsg = errs.cost ?? Object.values(errs)[0] ?? 'Please fix the highlighted fields';
      toast.error(firstMsg);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);

    if (lineItems && lineItems.length > 0) {
      const fxRate = parseFloat(form.fx_rate);
      const isJpy = lineCurrency === 'JPY';
      const payloads = lineItems.map((li) => {
        const lineCost = parseFloat(li.cost) || 0;
        const lineCostUsd = isJpy && fxRate > 0 ? lineCost / fxRate : lineCost;
        return {
          type:           li.type,
          source:         form.source || undefined,
          order_number:   form.order_number || undefined,
          language:       form.language,
          catalog_id:     li.catalog_id ?? undefined,
          card_name:      li.card_name || undefined,
          set_name:       li.set_name  || undefined,
          card_number:    li.card_number || undefined,
          total_cost_yen: isJpy ? Math.round(lineCost) : undefined,
          fx_rate:        isJpy ? fxRate : undefined,
          total_cost_usd: Math.round(lineCostUsd * 100),
          card_count:     parseInt(li.quantity) || 1,
          purchased_at:   form.purchased_at || undefined,
          notes:          form.notes || undefined,
        };
      });
      onSave(payloads, receiptFile ?? undefined);
      return;
    }

    const usd = parseFloat(form.total_cost_usd);
    onSave({
      type:           form.type,
      source:         form.source || undefined,
      order_number:   form.order_number || undefined,
      language:       form.language,
      card_name:      form.card_name || undefined,
      set_name:       form.set_name  || undefined,
      card_number:    form.card_number || undefined,
      catalog_id:     catalogId ?? undefined,
      total_cost_yen: form.total_cost_yen ? parseInt(form.total_cost_yen) : undefined,
      fx_rate:        form.fx_rate ? parseFloat(form.fx_rate) : undefined,
      total_cost_usd: !isNaN(usd) ? Math.round(usd * 100) : undefined,
      card_count:     parseInt(form.card_count) || 1,
      purchased_at:   form.purchased_at || undefined,
      notes:          form.notes || undefined,
    }, receiptFile ?? undefined);
  }

  const inp   = 'w-full px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [color-scheme:dark]';
  const lbl   = 'block text-xs text-zinc-400 mb-1';
  const err   = (k: string) => errors[k] ? <span className="text-xs text-red-400 ml-1">{errors[k]}</span> : null;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Auto-fill: from image (receipt OR card) or from text */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-indigo-400 shrink-0" />
          <span className="text-xs text-zinc-300 font-medium">Auto-fill</span>
          <span className="text-[11px] text-zinc-500">
            from image (receipt or card) or pasted text
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-400">Image type:</span>
          <div className="inline-flex rounded-lg bg-zinc-900 border border-zinc-700 p-0.5">
            {(['receipt', 'card'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setUploadKind(k)}
                className={`px-3 py-1 text-xs rounded-md capitalize transition-colors ${uploadKind === k ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>
                {k}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-zinc-500">
            {uploadKind === 'receipt' ? 'extracts source, order #, total, date' : 'extracts card name, set, number, language'}
          </span>
        </div>
        <label className="flex items-center gap-3 w-full rounded-xl border-2 border-dashed border-zinc-700 hover:border-zinc-500 px-4 py-3 cursor-pointer transition-colors hover:bg-zinc-800/40">
          <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (uploadKind === 'receipt') {
                setReceiptFile(f);
                setReceiptPreview(URL.createObjectURL(f));
              }
              parseImage(f, uploadKind);
            }} />
          {parsingReceipt ? (
            <div className="flex items-center gap-2 w-full">
              <Loader2 size={16} className="text-indigo-400 animate-spin shrink-0" />
              <span className="text-xs text-indigo-300">{uploadKind === 'receipt' ? 'Parsing receipt…' : 'Identifying card…'}</span>
            </div>
          ) : receiptPreview && uploadKind === 'receipt' ? (
            <div className="flex items-center gap-3 w-full">
              <img src={receiptPreview} alt="receipt" className="h-10 w-10 object-cover rounded-lg border border-zinc-700 shrink-0" />
              <span className="text-xs text-green-300">Receipt attached</span>
              <span className="ml-auto text-xs text-zinc-500 hover:text-zinc-300">Change</span>
            </div>
          ) : (
            <>
              <ImagePlus size={16} className="text-zinc-500 shrink-0" />
              <span className="text-xs text-zinc-400">
                {uploadKind === 'receipt'
                  ? <>Attach receipt image <span className="text-zinc-500">(auto-parses to fill fields)</span></>
                  : <>Attach card photo <span className="text-zinc-500">(uses vision to identify)</span></>}
              </span>
            </>
          )}
        </label>
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[10px] uppercase tracking-wide text-zinc-600">or</span>
          <input
            type="text"
            value={searchLabel}
            onChange={(e) => setSearchLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); autoFill(); } }}
            placeholder="Paste card name, label, or part number…"
            className={`${inp} flex-1`}
          />
          <button
            type="button"
            onClick={autoFill}
            disabled={autoFilling || !searchLabel.trim()}
            className="shrink-0 flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {autoFilling ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Auto-fill
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {!lineItems && (
          <div>
            <label className={lbl}>Type</label>
            <select value={form.type} onChange={(e) => set('type', e.target.value)} className={inp}>
              <option value="raw">Raw</option>
              <option value="bulk">Bulk</option>
            </select>
          </div>
        )}
        <div>
          <label className={lbl}>Language</label>
          <select value={form.language} onChange={(e) => set('language', e.target.value)} className={inp}>
            <option value="JP">JP</option>
            <option value="EN">EN</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Source{err('source')}</label>
          <input value={form.source} onChange={(e) => { set('source', e.target.value); setErrors((p) => ({ ...p, source: '' })); }}
            placeholder="Buyee, Yahoo Auctions…"
            className={`${inp} ${errors.source ? 'border-red-500/60' : ''}`} />
        </div>
        <div>
          <label className={lbl}>Order #</label>
          <input value={form.order_number} onChange={(e) => set('order_number', e.target.value)} className={inp} />
        </div>
      </div>

      <div>
        <label className={lbl}>Date Purchased{err('purchased_at')}</label>
        <input type="date" value={form.purchased_at}
          onChange={(e) => { set('purchased_at', e.target.value); setErrors((p) => ({ ...p, purchased_at: '' })); }}
          className={`${inp} ${errors.purchased_at ? 'border-red-500/60' : ''}`} />
      </div>

      {/* Multi-line items mode (receipt with multiple cards) */}
      {lineItems && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-300 font-medium">{lineItems.length} line items detected</span>
            <button type="button" onClick={() => setLineItems(null)} className="text-[11px] text-zinc-500 hover:text-zinc-300">Switch to single purchase</button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400">Line costs in:</span>
            <div className="inline-flex rounded-lg bg-zinc-900 border border-zinc-700 p-0.5">
              {(['JPY', 'USD'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setLineCurrency(c)}
                  className={`px-3 py-1 text-xs rounded-md transition-colors ${lineCurrency === c ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}>
                  {c === 'JPY' ? '¥ JPY' : '$ USD'}
                </button>
              ))}
            </div>
          </div>
          {lineCurrency === 'JPY' && (
            <div>
              <label className={lbl}>¥ → USD Rate (applies to all line costs)</label>
              <input type="number" step="0.0001" value={form.fx_rate}
                onChange={(e) => set('fx_rate', e.target.value)}
                placeholder="147" className={inp} />
            </div>
          )}
          <div className="border border-zinc-800 rounded-lg divide-y divide-zinc-800/60">
            <div className="grid grid-cols-[repeat(14,minmax(0,1fr))] gap-2 px-2 py-1.5 text-[10px] uppercase tracking-wide text-zinc-500 bg-zinc-900/50">
              <div className="col-span-3">Card Name</div>
              <div className="col-span-3">Set</div>
              <div className="col-span-1">#</div>
              <div className="col-span-2">Part #</div>
              <div className="col-span-1">Qty</div>
              <div className="col-span-2">Cost ({lineCurrency === 'JPY' ? '¥' : '$'})</div>
              <div className="col-span-2">Type</div>
            </div>
            {lineItems.map((li, i) => {
              const sku = buildPartNumber(form.language, li.set_code, li.card_number);
              return (
                <div key={i} className="grid grid-cols-[repeat(14,minmax(0,1fr))] gap-2 px-2 py-1.5 items-center">
                  <input value={li.card_name}
                    onChange={(e) => setLineItems((arr) => arr!.map((x, j) => j === i ? { ...x, card_name: e.target.value } : x))}
                    className={`col-span-3 ${inp} ${errors[`line_${i}_name`] ? 'border-red-500/60' : ''}`} />
                  <SetCombobox
                    value={li.set_name}
                    selectedCode={li.set_code || undefined}
                    options={setOptions}
                    inputCls={`${inp} ${errors[`line_${i}_set`] ? 'border-red-500/60' : ''}`}
                    placeholder="Set"
                    wrapperClassName="col-span-3"
                    onTyped={(v) => setLineItems((arr) => arr!.map((x, j) => j === i ? { ...x, set_name: v, set_code: '' } : x))}
                    onSelect={(entry) => setLineItems((arr) => arr!.map((x, j) => j === i ? { ...x, set_name: entry.name, set_code: entry.code } : x))}
                    onAddNew={() => addNewSetForLine(i, li.set_name)}
                  />
                  <div className="col-span-1 flex flex-col gap-0.5">
                    <input
                      value={li.unnumbered ? '' : li.card_number}
                      disabled={li.unnumbered}
                      placeholder={li.unnumbered ? '—' : ''}
                      onChange={(e) => setLineItems((arr) => arr!.map((x, j) => j === i ? { ...x, card_number: e.target.value } : x))}
                      className={`${inp} ${errors[`line_${i}_num`] ? 'border-red-500/60' : ''} ${li.unnumbered ? 'opacity-50' : ''}`} />
                    <label className="flex items-center gap-1 text-[9px] text-zinc-500 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={li.unnumbered}
                        onChange={(e) => setLineItems((arr) => arr!.map((x, j) => j === i ? { ...x, unnumbered: e.target.checked, card_number: e.target.checked ? '' : x.card_number } : x))}
                        className="accent-indigo-500" />
                      no #
                    </label>
                  </div>
                  <div className="col-span-2 px-2 text-[10px] font-mono truncate flex items-center gap-1" title={sku ?? ''}>
                    {sku && li.catalog_id ? (
                      <>
                        <span className="text-green-400">{sku}</span>
                        {!li.card_number && <span className="font-sans text-[9px] text-zinc-500">(no #)</span>}
                        <span title="Matches existing catalog entry" className="text-green-400 font-sans text-[9px]">✓</span>
                        <button
                          type="button"
                          onClick={() => setLineItems((arr) => arr!.map((x, j) => j === i ? { ...x, catalog_id: null } : x))}
                          title="Clear catalog match"
                          className="ml-auto text-zinc-600 hover:text-zinc-300 transition-colors"
                        >
                          <X size={10} />
                        </button>
                      </>
                    ) : sku && (li.card_number || li.unnumbered) ? (
                      <button
                        type="button"
                        onClick={() => openCreatePartForLine(i)}
                        className="text-[10px] font-sans text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-0.5"
                        title={li.card_number ? `Create new catalog entry: ${sku}` : `Create unnumbered catalog entry: ${sku} (${li.card_name})`}>
                        <Plus size={10} /> Create part {!li.card_number && <span className="text-zinc-500">(no #)</span>}
                      </button>
                    ) : li.set_name && !li.set_code ? (
                      <button
                        type="button"
                        onClick={() => addNewSetForLine(i, li.set_name)}
                        className="text-[10px] font-sans text-yellow-400 hover:text-yellow-300 inline-flex items-center gap-0.5"
                        title={`Register "${li.set_name}" as a new set`}>
                        <Plus size={10} /> Add set
                      </button>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
                  </div>
                  <input type="number" min="1" value={li.quantity}
                    onChange={(e) => setLineItems((arr) => arr!.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))}
                    className={`col-span-1 ${inp} ${errors[`line_${i}_qty`] ? 'border-red-500/60' : ''}`} />
                  <input type="number" step="0.01" value={li.cost}
                    onChange={(e) => setLineItems((arr) => arr!.map((x, j) => j === i ? { ...x, cost: e.target.value } : x))}
                    className={`col-span-2 ${inp} ${errors[`line_${i}_cost`] ? 'border-red-500/60' : ''}`} />
                  <select value={li.type}
                    onChange={(e) => setLineItems((arr) => arr!.map((x, j) => j === i ? { ...x, type: e.target.value as PurchaseType } : x))}
                    className={`col-span-2 ${inp}`}>
                    <option value="raw">Raw</option>
                    <option value="bulk">Bulk</option>
                  </select>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-zinc-500">Each line will become its own purchase entry. Receipt is shared across all.</p>
        </div>
      )}

      {/* Single-card mode */}
      {!lineItems && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={lbl}>Card Name{err('card_name')}</label>
              <input value={form.card_name} onChange={(e) => { set('card_name', e.target.value); setErrors((p) => ({ ...p, card_name: '' })); }}
                placeholder="Shining Mew"
                className={`${inp} ${errors.card_name ? 'border-red-500/60' : ''}`} />
            </div>
            <div>
              <label className={lbl}>Set Name{err('set_name')}</label>
              <input value={form.set_name} onChange={(e) => { set('set_name', e.target.value); setErrors((p) => ({ ...p, set_name: '' })); }}
                placeholder="Corocoro Comics"
                className={`${inp} ${errors.set_name ? 'border-red-500/60' : ''}`} />
            </div>
            <div>
              <label className={lbl}>Card #{err('card_number')}</label>
              <input
                value={singleUnnumbered ? '' : form.card_number}
                disabled={singleUnnumbered}
                placeholder={singleUnnumbered ? '—' : '151'}
                onChange={(e) => { set('card_number', e.target.value); setErrors((p) => ({ ...p, card_number: '' })); }}
                className={`${inp} ${errors.card_number ? 'border-red-500/60' : ''} ${singleUnnumbered ? 'opacity-50' : ''}`} />
              <label className="flex items-center gap-1 text-[10px] text-zinc-500 cursor-pointer select-none mt-1">
                <input
                  type="checkbox"
                  checked={singleUnnumbered}
                  onChange={(e) => {
                    setSingleUnnumbered(e.target.checked);
                    if (e.target.checked) { set('card_number', ''); setErrors((p) => ({ ...p, card_number: '' })); }
                  }}
                  className="accent-indigo-500" />
                no card # (unnumbered)
              </label>
            </div>
          </div>

          <PartNumberField
            form={form}
            catalogMatch={catalogMatch}
            catalogId={catalogId}
            onSelect={(m) => {
              setCatalogMatch(m);
              setCatalogId(m.id);
              setForm((prev) => ({
                ...prev,
                card_name:   m.card_name   || prev.card_name,
                set_name:    m.set_name    || prev.set_name,
                card_number: m.card_number || prev.card_number,
                language:    m.language    || prev.language,
              }));
              setErrors({});
            }}
            onClear={() => { setCatalogMatch(null); setCatalogId(null); }}
          />

          <div>
            <label className={lbl}># of Cards{err('card_count')}</label>
            <input type="number" min="1" value={form.card_count}
              onChange={(e) => { set('card_count', e.target.value); setErrors((p) => ({ ...p, card_count: '' })); }}
              className={`${inp} ${errors.card_count ? 'border-red-500/60' : ''}`} />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={lbl}>Total Cost (¥)</label>
              <input type="number" value={form.total_cost_yen}
                onChange={(e) => { set('total_cost_yen', e.target.value); setErrors((p) => ({ ...p, cost: '' })); }}
                placeholder="11800" className={`${inp} ${errors.cost ? 'border-red-500/60' : ''}`} />
            </div>
            <div>
              <label className={lbl}>¥ → USD Rate</label>
              <input type="number" step="0.0001" value={form.fx_rate}
                onChange={(e) => { set('fx_rate', e.target.value); setErrors((p) => ({ ...p, cost: '' })); }}
                placeholder="147" className={`${inp} ${errors.cost ? 'border-red-500/60' : ''}`} />
            </div>
            <div>
              <label className={lbl}>Total Cost (USD)</label>
              <input type="number" step="0.01" value={form.total_cost_usd}
                onChange={(e) => { set('total_cost_usd', e.target.value); setErrors((p) => ({ ...p, cost: '' })); }}
                placeholder="80.27" className={`${inp} ${errors.cost ? 'border-red-500/60' : ''}`} />
            </div>
          </div>
          {errors.cost && <p className="text-xs text-red-400">{errors.cost}</p>}
        </>
      )}

      <div>
        <label className={lbl}>Notes</label>
        <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} className={inp} />
      </div>

      <div className="flex items-center justify-between pt-2">
        {onDelete && (
          <Button type="button" variant="ghost" size="sm" onClick={onDelete}
            className="text-red-500 hover:text-red-400">
            Delete
          </Button>
        )}
        <div className={`flex gap-2 ${onDelete ? '' : 'ml-auto'}`}>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>

      {createPartLineIdx !== null && lineItems?.[createPartLineIdx] && (() => {
        const li = lineItems[createPartLineIdx];
        return (
          <AddPartModal
            prefill={{
              card_name:   li.card_name,
              set_name:    li.set_name,
              card_number: li.unnumbered ? undefined : li.card_number,
              language:    form.language,
            }}
            onClose={() => setCreatePartLineIdx(null)}
            onCreated={handlePartCreated}
          />
        );
      })()}
    </form>
  );
}

// ── Receive Modal ─────────────────────────────────────────────────────────────

function ReceiveModal({
  purchase,
  onSave,
  onClose,
}: {
  purchase: PurchaseRow;
  onSave: (data: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    order_number: purchase.order_number ?? '',
    received_at:  new Date().toISOString().slice(0, 10),
    card_count:   String(purchase.card_count),
  });

  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      order_number: form.order_number || undefined,
      received_at:  form.received_at,
      card_count:   parseInt(form.card_count) || purchase.card_count,
      status:       'received',
    });
  }

  const inp = 'w-full px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500';
  const lbl = 'block text-xs text-zinc-400 mb-1';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-xs text-zinc-400">
        Receiving <span className="text-zinc-200 font-medium">{purchase.purchase_id}</span>
        {purchase.card_name ? ` — ${purchase.card_name}` : ''}
      </p>

      <div>
        <label className={lbl}>Order # (confirm)</label>
        <input value={form.order_number} onChange={(e) => set('order_number', e.target.value)} className={inp} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Receive Date</label>
          <input type="date" value={form.received_at} onChange={(e) => set('received_at', e.target.value)} required className={inp} />
        </div>
        <div>
          <label className={lbl}>Quantity Received</label>
          <input type="number" min="1" value={form.card_count} onChange={(e) => set('card_count', e.target.value)} required className={inp} />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button type="submit" size="sm">Mark Received</Button>
      </div>
    </form>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type SortDir = 'asc' | 'desc';

const INTAKE_FILTER_DEFAULTS = {
  search:  '',
  fType:   null as PurchaseType | null,
  fStatus: null as 'ordered' | 'received' | 'cancelled' | null,
  sortCol: null as string | null,
  sortDir: 'desc' as SortDir,
};

export function Intake() {
  const qc    = useQueryClient();
  const saved = loadFilters('intake', INTAKE_FILTER_DEFAULTS);
  const [page, setPage]                 = useState(1);
  const [search, setSearch]             = useState(saved.search);
  const [debouncedSearch, setDebounced] = useState(saved.search);
  const [fType, setFType]               = useState<PurchaseType | null>(saved.fType);
  const [fStatus, setFStatus]           = useState<'ordered' | 'received' | 'cancelled' | null>(saved.fStatus ?? null);
  const [sortCol, setSortCol]           = useState<string | null>(saved.sortCol);
  const [sortDir, setSortDir]           = useState<SortDir>(saved.sortDir);
  const [addOpen, setAddOpen]           = useState(false);
  const [addWide, setAddWide]           = useState(false);
  const [editRow, setEditRow]           = useState<PurchaseRow | null>(null);
  const [receiveRow, setReceiveRow]     = useState<PurchaseRow | null>(null);
  const [cancelRow, setCancelRow]       = useState<PurchaseRow | null>(null);
  const [unreceiveRow, setUnreceiveRow] = useState<PurchaseRow | null>(null);
  const [uncancelRow, setUncancelRow]   = useState<PurchaseRow | null>(null);
  const [deleteRow, setDeleteRow]       = useState<PurchaseRow | null>(null);

  const MINS = {
    pid:     colMinWidth('ID',         true, false),
    type:    colMinWidth('Type',       true, false),
    card:    colMinWidth('Card',       true, false),
    source:  colMinWidth('Source',     true, false),
    order:   colMinWidth('Order #',    true, false),
    lang:    colMinWidth('Lang',       true, false),
    cards:   colMinWidth('Cards',      true, false),
    cost:    colMinWidth('Cost (USD)', true, false),
    avg:     colMinWidth('Avg/Card',   true, false),
    status:  colMinWidth('Status',     true, false),
    bought:  colMinWidth('Purchased',  true, false),
    inspect:   colMinWidth('Inspected', true, false),
    receipt: 44,
    actions: 80,
  };
  const { rz, totalWidth } = useColWidths({
    pid:       Math.max(MINS.pid,       110),
    type:      Math.max(MINS.type,       80),
    card:      Math.max(MINS.card,      400),
    source:    Math.max(MINS.source,    120),
    order:     Math.max(MINS.order,     140),
    lang:      Math.max(MINS.lang,       70),
    cards:     Math.max(MINS.cards,      70),
    cost:      Math.max(MINS.cost,      110),
    avg:       Math.max(MINS.avg,       100),
    status:    Math.max(MINS.status,    100),
    bought:    Math.max(MINS.bought,    120),
    inspect:   Math.max(MINS.inspect,    90),
    receipt:   MINS.receipt,
    actions:   MINS.actions,
  });

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    saveFilters('intake', { search, fType, fStatus, sortCol, sortDir });
  }, [search, fType, fStatus, sortCol, sortDir]);

  function handleSort(col: string) {
    if (sortCol === col) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
    setPage(1);
  }

  const params = {
    page,
    pageSize: 50,
    search:   debouncedSearch || undefined,
    type:     fType ?? undefined,
    status:   fStatus ?? undefined,
    sort_by:  sortCol ?? undefined,
    sort_dir: sortDir,
  };

  const { data, isLoading } = useQuery<{ data: PurchaseRow[]; total: number; totalPages: number }>({
    queryKey: ['raw-purchases', params],
    queryFn:  () => api.get('/raw-purchases', { params }).then((r) => r.data),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['raw-purchases'] });

  const createMut = useMutation({
    mutationFn: async ({ body, receiptFile }: { body: Record<string, unknown> | Record<string, unknown>[]; receiptFile?: File }) => {
      const bodies = Array.isArray(body) ? body : [body];
      const created: { id: string; type: string }[] = [];
      for (const b of bodies) {
        const res = await api.post('/raw-purchases', b);
        created.push({ id: res.data.id, type: (b.type as string) ?? 'raw' });
      }
      // Receipt image is used for parsing only — never persisted to purchase records.
      void receiptFile;
      return { count: created.length };
    },
    onSuccess: ({ count }) => { invalidate(); setAddOpen(false); toast.success(count > 1 ? `${count} purchases added` : 'Purchase added'); },
    onError: () => toast.error('Failed to add purchase'),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, body, receiptFile }: { id: string; body: Record<string, unknown>; receiptFile?: File }) => {
      const res = await api.patch(`/raw-purchases/${id}`, body);
      if (receiptFile) {
        const fd = new FormData();
        fd.append('image', receiptFile);
        await api.post(`/raw-purchases/${id}/receipt`, fd).catch(() => {});
      }
      return res.data;
    },
    onSuccess: () => { invalidate(); setEditRow(null); setReceiveRow(null); toast.success('Updated'); },
    onError: () => toast.error('Failed to update'),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api.patch(`/raw-purchases/${id}`, { status: 'cancelled', received_at: null }),
    onSuccess: () => { invalidate(); setCancelRow(null); toast.success('Purchase cancelled'); },
    onError: () => toast.error('Failed to cancel'),
  });

  const unreceiveMut = useMutation({
    mutationFn: (id: string) => api.post(`/raw-purchases/${id}/unreceive`).then(r => r.data),
    onSuccess: () => { invalidate(); setUnreceiveRow(null); toast.success('Reverted to Ordered'); },
    onError: (err: any) => toast.error(err?.response?.data?.error ?? 'Failed to unreceive'),
  });

  const uncancelMut = useMutation({
    mutationFn: (id: string) => api.patch(`/raw-purchases/${id}`, { status: 'ordered' }).then(r => r.data),
    onSuccess: () => { invalidate(); setUncancelRow(null); toast.success('Reverted to Ordered'); },
    onError: (err: any) => toast.error(err?.response?.data?.error ?? 'Failed to revert'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/raw-purchases/${id}`),
    onSuccess: () => { invalidate(); setDeleteRow(null); toast.success('Purchase deleted'); },
    onError: () => toast.error('Failed to delete'),
  });

  const hasActiveFilters = !!debouncedSearch || fType !== null || fStatus !== null;
  function clearFilters() { setSearch(''); setFType(null); setFStatus(null); setPage(1); }

  const sh = { sortCol, sortDir, onSort: handleSort };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <h1 className="text-xl font-bold text-zinc-100">Purchases</h1>
        <div className="flex items-center gap-3">
          {hasActiveFilters && (
            <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
              <X size={12} /> Clear filters
            </button>
          )}
          <div className="flex gap-1">
            <button onClick={() => { setFType(null); setPage(1); }}
              className={`px-3 py-1 text-xs rounded-md text-xs font-medium transition-colors ${fType === null ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
              All
            </button>
            {(['raw', 'bulk'] as PurchaseType[]).map((t) => (
              <button key={t} onClick={() => { setFType(t); setPage(1); }}
                className={`px-3 py-1 text-xs rounded-md text-xs font-medium transition-colors capitalize ${fType === t ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                {t}
              </button>
            ))}
          </div>
          <div className="flex gap-1 border-l border-zinc-800 pl-3">
            {([
              { val: null,         label: 'Any status' },
              { val: 'ordered',    label: 'Not Received' },
              { val: 'received',   label: 'Received' },
              { val: 'cancelled',  label: 'Cancelled' },
            ] as const).map(s => (
              <button key={String(s.val)} onClick={() => { setFStatus(s.val as any); setPage(1); }}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${fStatus === s.val ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                {s.label}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56 px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
          />
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus size={14} /> Add Purchase
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">Loading…</div>
        ) : (
          <table className="text-xs whitespace-nowrap border-collapse" style={{ tableLayout: 'fixed', width: totalWidth + 'px' }}>
            <thead className="sticky top-0 bg-zinc-950 z-10">
              <tr className="border-b border-zinc-700 text-zinc-300 uppercase tracking-wide">
                <ColHeader label="ID"         col="purchase_id"     {...sh} {...rz('pid')}     minWidth={MINS.pid} />
                <ColHeader label="Type"       col="type"            {...sh} {...rz('type')}    minWidth={MINS.type} />
                <ColHeader label="Card"       col="card_name"       {...sh} {...rz('card')}    minWidth={MINS.card} />
                <ColHeader label="Source"     col="source"          {...sh} {...rz('source')}  minWidth={MINS.source} />
                <ColHeader label="Order #"    col="order_number"    {...sh} {...rz('order')}   minWidth={MINS.order} />
                <ColHeader label="Lang"       col="language"        {...sh} {...rz('lang')}    minWidth={MINS.lang} />
                <ColHeader label="Cards"      col="card_count"      {...sh} {...rz('cards')}   minWidth={MINS.cards} align="right" />
                <ColHeader label="Cost (USD)" col="total_cost_usd"  {...sh} {...rz('cost')}    minWidth={MINS.cost} align="right" />
                <ColHeader label="Avg/Card"   col="avg_cost_usd"    {...sh} {...rz('avg')}     minWidth={MINS.avg} align="right" />
                <ColHeader label="Status"     col="status"          {...sh} {...rz('status')}  minWidth={MINS.status} />
                <ColHeader label="Purchased"  col="purchased_at"    {...sh} {...rz('bought')}  minWidth={MINS.bought} />
                <ColHeader label="Inspected"  col="inspected_count"  {...sh} {...rz('inspect')}   minWidth={MINS.inspect}   align="right" />
                <th style={{ width: MINS.receipt + 'px', minWidth: MINS.receipt + 'px' }} className="px-2 py-2 text-center font-semibold text-zinc-300 uppercase tracking-wide text-xs">Received?</th>
                <th style={{ width: MINS.actions }} />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {!data?.data.length ? (
                <tr><td colSpan={14} className="px-4 py-10 text-center text-zinc-500">No purchases yet.</td></tr>
              ) : data.data.map((row) => (
                <tr key={row.id}
                  className="hover:bg-zinc-800/25 transition-colors group cursor-pointer"
                  onClick={() => setEditRow(row)}>
                  <td className="px-4 py-2 font-mono text-indigo-300">{row.purchase_id}</td>
                  <td className="px-4 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium capitalize ${TYPE_COLORS[row.type]}`}>{row.type}</span>
                  </td>
                  <td className="px-4 py-2 align-top">
                    <p className="text-zinc-200 whitespace-normal break-words leading-snug">{row.card_name ?? '—'}</p>
                    {row.set_name && <p className="text-[10px] text-zinc-500 whitespace-normal break-words leading-tight mt-0.5">{row.set_name}{row.card_number ? ` · #${row.card_number}` : ''}</p>}
                  </td>
                  <td className="px-4 py-2 text-zinc-400">{row.source ?? '—'}</td>
                  <td className="px-4 py-2 text-zinc-400 font-mono text-[10px]">{row.order_number ?? '—'}</td>
                  <td className="px-4 py-2 text-zinc-400">{row.language}</td>
                  <td className="px-4 py-2 text-right text-zinc-300">{row.card_count}</td>
                  <td className="px-4 py-2 text-right text-zinc-300">{row.total_cost_usd ? formatCurrency(row.total_cost_usd, 'USD') : '—'}</td>
                  <td className="px-4 py-2 text-right text-zinc-400">{row.avg_cost_usd ? formatCurrency(row.avg_cost_usd, 'USD') : '—'}</td>
                  <td className="px-4 py-2">
                    <span className={`capitalize font-medium ${STATUS_COLORS[row.status]}`}>{row.status}</span>
                  </td>
                  <td className="px-4 py-2 text-zinc-500">{formatDate(row.purchased_at)}</td>
                  <td className="px-4 py-2 text-right">
                    <span className={row.inspected_count > 0 ? 'text-emerald-400' : 'text-zinc-600'}>
                      {row.inspected_count}/{row.card_count}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-center">
                    {row.receipt_url && (
                      <a href={row.receipt_url} target="_blank" rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()} title="View receipt">
                        <img src={row.receipt_url} alt="receipt" className="h-7 w-7 object-cover rounded border border-zinc-700 hover:border-indigo-500 transition-colors mx-auto" />
                      </a>
                    )}
                  </td>
                  {/* Row actions */}
                  <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                    {row.status === 'ordered' && (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setReceiveRow(row)}
                          title="Mark received"
                          className="p-1 rounded text-zinc-500 hover:text-emerald-400 hover:bg-zinc-800 transition-colors">
                          <PackageCheck size={14} />
                        </button>
                        <button
                          onClick={() => setCancelRow(row)}
                          title="Cancel"
                          className="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors">
                          <Ban size={14} />
                        </button>
                      </div>
                    )}
                    {row.status === 'received' && row.inspected_count === 0 && (
                      <button
                        onClick={() => setUnreceiveRow(row)}
                        title="Unreceive — flip back to Ordered status"
                        className="p-1 rounded text-zinc-600 hover:text-amber-400 hover:bg-zinc-800 transition-colors opacity-0 group-hover:opacity-100">
                        <RotateCcw size={14} />
                      </button>
                    )}
                    {row.status === 'cancelled' && (
                      <button
                        onClick={() => setUncancelRow(row)}
                        title="Uncancel — flip back to Ordered status"
                        className="p-1 rounded text-zinc-600 hover:text-amber-400 hover:bg-zinc-800 transition-colors opacity-0 group-hover:opacity-100">
                        <RotateCcw size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {data && (
        <div className="flex items-center justify-between px-6 py-3 pr-44 border-t border-zinc-800 text-xs text-zinc-500">
          <span>{data.total.toLocaleString()} purchase{data.total !== 1 ? 's' : ''}</span>
          {(data.totalPages ?? 1) > 1 && (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Prev</Button>
              <span>{page} / {data.totalPages ?? 1}</span>
              <Button variant="ghost" size="sm" disabled={page >= (data.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </div>
      )}

      {/* Add */}
      <Modal
        open={addOpen}
        onClose={() => { setAddOpen(false); setAddWide(false); }}
        title="Add Purchase"
        className={addWide ? 'max-w-5xl' : undefined}
      >
        <PurchaseForm
          onSave={(body, receiptFile) => createMut.mutate({ body, receiptFile })}
          onClose={() => { setAddOpen(false); setAddWide(false); }}
          onMultiLineChange={setAddWide}
        />
      </Modal>

      {/* Edit */}
      <Modal open={!!editRow} onClose={() => setEditRow(null)} title="Edit Purchase">
        {editRow && (
          <PurchaseForm
            initial={editRow}
            onSave={(body, receiptFile) => {
              if (Array.isArray(body)) return; // edit only handles single-row updates
              updateMut.mutate({ id: editRow.id, body, receiptFile });
            }}
            onClose={() => setEditRow(null)}
            onDelete={() => { setEditRow(null); setDeleteRow(editRow); }}
          />
        )}
      </Modal>

      {/* Receive */}
      <Modal open={!!receiveRow} onClose={() => setReceiveRow(null)} title="Receive Order">
        {receiveRow && (
          <ReceiveModal
            purchase={receiveRow}
            onSave={(body) => updateMut.mutate({ id: receiveRow.id, body })}
            onClose={() => setReceiveRow(null)}
          />
        )}
      </Modal>

      {/* Delete confirmation */}
      <Modal open={!!deleteRow} onClose={() => setDeleteRow(null)} title="Delete Purchase">
        {deleteRow && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-300">
              Delete <span className="font-medium text-zinc-100">{deleteRow.purchase_id}</span>
              {deleteRow.card_name ? ` — ${deleteRow.card_name}` : ''}?
            </p>
            <p className="text-xs text-zinc-500">This will permanently remove the purchase record and cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDeleteRow(null)}>Keep</Button>
              <Button size="sm" className="bg-red-600 hover:bg-red-500" onClick={() => deleteMut.mutate(deleteRow.id)}>
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Cancel confirmation */}
      <Modal open={!!cancelRow} onClose={() => setCancelRow(null)} title="Cancel Purchase">
        {cancelRow && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-300">
              Cancel <span className="font-medium text-zinc-100">{cancelRow.purchase_id}</span>
              {cancelRow.card_name ? ` — ${cancelRow.card_name}` : ''}?
            </p>
            <p className="text-xs text-zinc-500">This will void the receive date and quantity. The record will remain for reference.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setCancelRow(null)}>Keep</Button>
              <Button size="sm" className="bg-red-600 hover:bg-red-500" onClick={() => cancelMut.mutate(cancelRow.id)}>
                Cancel Purchase
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Unreceive confirmation */}
      <Modal open={!!unreceiveRow} onClose={() => setUnreceiveRow(null)} title="Unreceive Purchase">
        {unreceiveRow && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-300">
              Revert <span className="font-medium text-zinc-100">{unreceiveRow.purchase_id}</span>
              {unreceiveRow.card_name ? ` — ${unreceiveRow.card_name}` : ''} back to Ordered?
            </p>
            <p className="text-xs text-zinc-500">
              The purchase record stays. Status flips from Received to Ordered, and the received date is cleared.
              You can mark it Received again later or cancel it.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setUnreceiveRow(null)}>Keep</Button>
              <Button size="sm" className="bg-amber-600 hover:bg-amber-500" disabled={unreceiveMut.isPending} onClick={() => unreceiveMut.mutate(unreceiveRow.id)}>
                {unreceiveMut.isPending ? 'Reverting…' : 'Unreceive'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Uncancel confirmation */}
      <Modal open={!!uncancelRow} onClose={() => setUncancelRow(null)} title="Uncancel Purchase">
        {uncancelRow && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-300">
              Revert <span className="font-medium text-zinc-100">{uncancelRow.purchase_id}</span>
              {uncancelRow.card_name ? ` — ${uncancelRow.card_name}` : ''} back to Ordered?
            </p>
            <p className="text-xs text-zinc-500">
              Status flips from Cancelled to Ordered. You can mark it Received once it actually arrives.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setUncancelRow(null)}>Keep</Button>
              <Button size="sm" className="bg-amber-600 hover:bg-amber-500" disabled={uncancelMut.isPending} onClick={() => uncancelMut.mutate(uncancelRow.id)}>
                {uncancelMut.isPending ? 'Reverting…' : 'Uncancel'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
