import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Loader2, Sparkles, CheckCircle, AlertCircle, ChevronRight, ArrowRightLeft, Upload, Pencil, Trash2 } from 'lucide-react';
import { api, type PaginatedResult } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Modal } from '../components/ui/Modal';
import { formatDate } from '../lib/utils';
import toast from 'react-hot-toast';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TradeCard {
  id: string;
  card_name: string | null;
  sale_price_cents?: number;
  purchase_cost_cents?: number;
  currency: string;
  purchase_type?: string;
  condition?: string | null;
  quantity?: number;
  company?: string | null;
  grade_label?: string | null;
  cert_number?: string | null;
  raw_label?: string | null;
}

interface Trade {
  id: string;
  trade_label: string | null;
  trade_date: string | null;
  person: string | null;
  cash_from_customer_cents: number;
  cash_to_customer_cents: number;
  trade_percent: number;
  notes: string | null;
  created_at: string;
  out_cards: TradeCard[];
  in_cards: TradeCard[];
}

interface SlabResult {
  id: string;
  card_name: string | null;
  set_name: string | null;
  company: string | null;
  grade_label: string | null;
  numeric_grade: number | null;
  cert_number: string | null;
  currency: string;
  raw_purchase_date: string | null;
  listed_price: number | null;
  listing_id: string | null;
  is_listed: boolean;
  is_personal_collection: boolean;
}

interface RawCardResult {
  id: string;
  card_name: string | null;
  set_name: string | null;
  card_number: string | null;
  condition: string | null;
  quantity: number;
  purchase_cost: number | null;
  currency: string;
  raw_purchase_label: string | null;
  is_listed: boolean;
}

// ── Trade Intake Modal ────────────────────────────────────────────────────────

interface OutEntry {
  uid: string;
  card: SlabResult | RawCardResult;
  cardType: 'graded' | 'raw';
  value: string;
}

interface IncomingCardData {
  uid: string;
  type: 'raw' | 'graded';
  card_name_override: string;
  set_name_override?: string;
  card_number_override?: string;
  rarity?: string;
  language: string;
  condition?: string;
  decision: 'sell_raw' | 'grade';
  market_value?: string;
  purchase_cost: string;
  currency: string;
  catalog_id?: string;
  slab_company?: string;
  slab_grade_label?: string;
  slab_cert_number?: string;
}

const SLAB_COMPANIES = ['PSA', 'BGS', 'CGC', 'SGC', 'HGA', 'ACE', 'ARS', 'OTHER'];

function TradeCardForm({ onAdd, tradePercent }: { onAdd: (data: IncomingCardData) => void; tradePercent: number }) {
  const [type, setType] = useState<'raw' | 'graded'>('raw');
  const [gradingLabel, setGradingLabel] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [autoFilling, setAutoFilling] = useState(false);
  const [catalogId, setCatalogId] = useState<string | null>(null);
  const [partNumber, setPartNumber] = useState<{ sku: string | null; exists: boolean; catalogData?: Record<string, any> } | null>(null);
  const [cardName, setCardName] = useState('');
  const [setName, setSetName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [rarity, setRarity] = useState('');
  const [language, setLanguage] = useState('EN');
  const [condition, setCondition] = useState('');
  const [decision, setDecision] = useState<'sell_raw' | 'grade'>('sell_raw');
  const [marketValue, setMarketValue] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [company, setCompany] = useState('');
  const [gradeLabel, setGradeLabel] = useState('');
  const [certNumber, setCertNumber] = useState('');

  const tradeCredit = marketValue ? (parseFloat(marketValue) * tradePercent / 100) : null;

  const handleImageSelect = (file: File) => {
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setGradingLabel('');
  };

  const clearImage = () => {
    setImageFile(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const autoFill = useCallback(async (name: string) => {
    if (!name.trim() && !imageFile) return;
    setAutoFilling(true);
    try {
      let data: any;
      if (imageFile) {
        const fd = new FormData();
        fd.append('image', imageFile);
        fd.append('game', 'pokemon');
        const res = await api.post('/agent/auto-fill', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        data = res.data;
      } else {
        const res = await api.post('/agent/auto-fill', { partial_name: name, game: 'pokemon' });
        data = res.data;
      }
      const s = data.data?.suggestions?.[0];
      const pg = data.data?.parsed_grade;
      const parsedCert: string | undefined = data.data?.parsed_cert;
      if (s) {
        if (s.catalog_exists && s.catalog_card_name) setCardName(s.catalog_card_name);
        else if (s.card_name) setCardName(s.card_name);
        if (s.set_name) setSetName(s.set_name);
        if (s.card_number) setCardNumber(s.card_number);
        if (s.rarity) setRarity(s.rarity);
        if (s.language) setLanguage(s.language === 'JP' ? 'JP' : 'EN');
        setCatalogId(s.catalog_id ?? null);
        setPartNumber({ sku: s.sku ?? null, exists: !!s.catalog_exists, catalogData: s });
      }
      if (pg) {
        const validCompanies = ['PSA', 'BGS', 'CGC', 'SGC', 'HGA', 'ACE', 'ARS', 'OTHER'];
        if (validCompanies.includes(pg.company)) setCompany(pg.company);
        if (pg.grade_label) setGradeLabel(pg.grade_label);
      }
      if (parsedCert) setCertNumber(parsedCert);
      if (s || pg) {
        toast.success('Auto-filled from card database');
      } else {
        toast('No match found — fill manually', { icon: '🔍' });
      }
    } catch {
      toast.error('Unable to auto-fill — fill manually');
    } finally {
      setAutoFilling(false);
    }
  }, [imageFile]);

  function handleAdd() {
    if (!cardName.trim()) { toast.error('Card name required'); return; }
    if (!marketValue) { toast.error('Market value required'); return; }
    const credit = (parseFloat(marketValue) * tradePercent / 100).toFixed(2);
    onAdd({
      uid: String(Date.now() + Math.random()),
      type,
      card_name_override: cardName,
      set_name_override: setName || undefined,
      card_number_override: cardNumber || undefined,
      rarity: rarity || undefined,
      language,
      condition: condition || undefined,
      decision,
      market_value: marketValue,
      purchase_cost: credit,
      currency,
      catalog_id: catalogId || undefined,
      slab_company: type === 'graded' ? (company || undefined) : undefined,
      slab_grade_label: type === 'graded' ? (gradeLabel || undefined) : undefined,
      slab_cert_number: type === 'graded' ? (certNumber || undefined) : undefined,
    });
    setGradingLabel(''); clearImage(); setCatalogId(null); setPartNumber(null);
    setCardName(''); setSetName(''); setCardNumber(''); setRarity('');
    setLanguage('EN'); setCondition(''); setDecision('sell_raw');
    setMarketValue(''); setCurrency('USD'); setCompany(''); setGradeLabel(''); setCertNumber('');
  }

  return (
    <div className="space-y-3 rounded-lg border border-zinc-700/50 bg-zinc-800/30 px-4 py-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-400">Add Incoming Card</span>
        <div className="flex gap-1">
          {(['raw', 'graded'] as const).map(t => (
            <button key={t} type="button" onClick={() => setType(t)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${type === t ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
              {t === 'raw' ? 'Raw' : 'Graded'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
          Auto-fill <span className="normal-case text-zinc-600">(optional)</span>
        </label>

        {imagePreview ? (
          <div className="relative rounded-lg overflow-hidden border border-zinc-700 bg-zinc-900">
            <img src={imagePreview} alt="Slab" className="max-h-32 w-full object-contain" />
            <button type="button" onClick={clearImage}
              className="absolute top-1.5 right-1.5 p-1 rounded-full bg-zinc-800/80 text-zinc-400 hover:text-zinc-100">
              <X size={12} />
            </button>
          </div>
        ) : (
          <div
            className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 bg-zinc-900 px-3 py-3 cursor-pointer hover:border-indigo-500 transition-colors"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file?.type.startsWith('image/')) handleImageSelect(file); }}
          >
            <Upload size={14} className="text-zinc-500" />
            <span className="text-xs text-zinc-500">Drop {type === 'raw' ? 'raw' : 'slab'} image or <span className="text-indigo-400">browse</span></span>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageSelect(f); }} />
          </div>
        )}

        <div className="flex gap-2 items-center">
          <input type="text" value={gradingLabel}
            onChange={(e) => { setGradingLabel(e.target.value); if (imageFile) clearImage(); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); autoFill(gradingLabel); } }}
            placeholder="or paste PSA label / URL"
            disabled={!!imageFile}
            className="flex-1 rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors disabled:opacity-40" />
          <Button type="button" variant="secondary" size="sm" className="shrink-0"
            onClick={() => autoFill(gradingLabel)}
            disabled={autoFilling || (!gradingLabel.trim() && !imageFile)}>
            {autoFilling ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Auto-fill
          </Button>
        </div>
      </div>

      <Input label="Card Name" placeholder="e.g. 1996 Pokemon Japanese Basic 6 Charizard-Holo"
        value={cardName} onChange={(e) => setCardName(e.target.value)} />

      <div className="grid grid-cols-3 gap-2">
        <Input label="Set Name" placeholder="e.g. Base Set" value={setName} onChange={(e) => setSetName(e.target.value)} />
        <Input label="Card #" placeholder="e.g. 4/102" value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} />
        <Input label="Rarity" placeholder="e.g. Holo" value={rarity} onChange={(e) => setRarity(e.target.value)} />
      </div>

      {partNumber && (
        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm border ${partNumber.exists ? 'bg-green-950/40 border-green-800/50' : 'bg-yellow-950/40 border-yellow-700/50'}`}>
          {partNumber.exists ? <CheckCircle size={14} className="text-green-400 shrink-0" /> : <AlertCircle size={14} className="text-yellow-400 shrink-0" />}
          {partNumber.sku ? <span className="font-mono text-xs text-zinc-200">{partNumber.sku}</span> : <span className="text-xs text-zinc-400 italic">No part number</span>}
          <span className={`text-xs ${partNumber.exists ? 'text-green-500' : 'text-yellow-500'}`}>{partNumber.exists ? 'Part exists' : 'New part'}</span>
        </div>
      )}

      {type === 'raw' ? (
        <div className="grid grid-cols-2 gap-2">
          <Select label="Condition" value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value="">—</option>
            <option value="NM">NM</option><option value="LP">LP</option><option value="MP">MP</option>
            <option value="HP">HP</option><option value="DMG">DMG</option>
          </Select>
          <Select label="Intent" value={decision} onChange={(e) => setDecision(e.target.value as any)}>
            <option value="sell_raw">For Sale</option>
            <option value="grade">To Grade</option>
          </Select>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <Select label="Company" value={company} onChange={(e) => setCompany(e.target.value)}>
            <option value="">—</option>
            {SLAB_COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Input label="Grade" placeholder="e.g. 9" value={gradeLabel} onChange={(e) => setGradeLabel(e.target.value)} />
          <Input label="Cert #" placeholder="12345678" value={certNumber} onChange={(e) => setCertNumber(e.target.value)} />
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2 space-y-1">
          <Input label="Market Value ($)" type="number" step="0.01" min="0" placeholder="0.00"
            value={marketValue} onChange={(e) => setMarketValue(e.target.value)} />
          {tradeCredit !== null && (
            <p className="text-[11px] text-zinc-500">
              Trade credit ({tradePercent}%): <span className="text-emerald-400 font-semibold">${tradeCredit.toFixed(2)}</span>
            </p>
          )}
        </div>
        <Select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          <option value="USD">USD</option>
          <option value="JPY">JPY</option>
        </Select>
      </div>

      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={handleAdd}>
          <Plus size={13} /> Add Card
        </Button>
      </div>
    </div>
  );
}

function TradeIntakeModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'out' | 'in' | 'review'>('out');

  // Step 1: Outgoing
  const [outgoing, setOutgoing] = useState<OutEntry[]>([]);
  const [outType, setOutType] = useState<'graded' | 'raw'>('graded');
  const [outSearch, setOutSearch] = useState('');
  const [debouncedOutSearch, setDebouncedOutSearch] = useState('');

  // Step 2: Incoming
  const [incomingAdded, setIncomingAdded] = useState<IncomingCardData[]>([]);
  const [tradePercent, setTradePercent] = useState('80');

  // Step 3: Review / details
  const [cashFromCustomer, setCashFromCustomer] = useState('');
  const [cashToCustomer, setCashToCustomer] = useState('');
  const [tradeDate, setTradeDate] = useState('');
  const [tradePerson, setTradePerson] = useState('');
  const [tradeNotes, setTradeNotes] = useState('');
  const [acceptDiff, setAcceptDiff] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedOutSearch(outSearch), 300);
    return () => clearTimeout(t);
  }, [outSearch]);

  const outSelectedIds = new Set(outgoing.map(e => e.card.id));

  const { data: gradedSearchData, isFetching: isGradedSearching } = useQuery<PaginatedResult<SlabResult>>({
    queryKey: ['trade-graded-search', debouncedOutSearch],
    queryFn: () => api.get('/grading/slabs', {
      params: { search: debouncedOutSearch, limit: 50, status: 'unsold', sort_by: 'card_name', sort_dir: 'asc', personal_collection: 'no', for_sale: 'yes' },
    }).then(r => r.data),
    enabled: debouncedOutSearch.length >= 2 && outType === 'graded' && step === 'out',
  });

  const { data: rawSearchData, isFetching: isRawSearching } = useQuery<PaginatedResult<RawCardResult>>({
    queryKey: ['trade-raw-search', debouncedOutSearch],
    queryFn: () => api.get('/cards', {
      params: { search: debouncedOutSearch, status: 'raw_for_sale', limit: 50, sort_by: 'card_name', sort_dir: 'asc' },
    }).then(r => r.data),
    enabled: debouncedOutSearch.length >= 2 && outType === 'raw' && step === 'out',
  });

  const gradedResults = (gradedSearchData?.data ?? []).filter(c => !outSelectedIds.has(c.id));
  const rawResults = (rawSearchData?.data ?? []).filter(c => !outSelectedIds.has(c.id));
  const isSearching = isGradedSearching || isRawSearching;

  const outTotal = outgoing.reduce((s, e) => s + (parseFloat(e.value) || 0), 0);
  const inTotal  = incomingAdded.reduce((s, e) => s + (parseFloat(e.purchase_cost) || 0), 0);
  const cashOut = parseFloat(cashToCustomer || '0') || 0;
  const cashIn  = parseFloat(cashFromCustomer || '0') || 0;
  const outSide = outTotal + cashOut;
  const inSide  = inTotal + cashIn;
  const diff = Math.abs(outSide - inSide);
  const isBalanced = diff < 0.01;

  function addOutgoing(card: SlabResult | RawCardResult, cardType: 'graded' | 'raw') {
    setOutgoing(prev => [...prev, { uid: String(Date.now()), card, cardType, value: '' }]);
    setOutSearch('');
  }

  function updateOut(uid: string, value: string) {
    setOutgoing(prev => prev.map(e => e.uid === uid ? { ...e, value } : e));
  }

  async function handleSubmit() {
    if (outgoing.length === 0) { toast.error('Add at least one outgoing card'); return; }
    if (outgoing.some(e => !e.value)) { toast.error('Assign a trade value to every outgoing card'); return; }
    if (incomingAdded.length === 0) { toast.error('Add at least one incoming card'); return; }
    setSubmitting(true);
    try {
      await api.post('/trades', {
        outgoing: outgoing.map(e => ({
          card_instance_id: e.card.id,
          listing_id: e.cardType === 'graded' ? ((e.card as SlabResult).listing_id ?? undefined) : undefined,
          sale_price: (parseFloat(e.value) || 0).toFixed(2),
          currency: e.card.currency,
        })),
        incoming: incomingAdded.map(e => ({
          card_name_override: e.card_name_override,
          set_name_override: e.set_name_override,
          card_number_override: e.card_number_override,
          rarity: e.rarity,
          language: e.language,
          condition: e.condition,
          decision: e.decision,
          market_value: e.market_value ? (parseFloat(e.market_value) || 0).toFixed(2) : undefined,
          purchase_cost: e.purchase_cost,
          currency: e.currency,
          catalog_id: e.catalog_id,
          slab_company: e.slab_company,
          slab_grade_label: e.slab_grade_label,
          slab_cert_number: e.slab_cert_number,
          slab_grade: e.slab_grade_label ? parseFloat(e.slab_grade_label) || undefined : undefined,
        })),
        trade_date: tradeDate || undefined,
        person: tradePerson || undefined,
        cash_from_customer: cashFromCustomer ? (parseFloat(cashFromCustomer) || 0).toFixed(2) : undefined,
        cash_to_customer: cashToCustomer ? (parseFloat(cashToCustomer) || 0).toFixed(2) : undefined,
        trade_percent: parseFloat(tradePercent) || 80,
        notes: tradeNotes || undefined,
      });
      toast.success('Trade recorded!');
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['raw-inventory'] });
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to record trade');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Step: Out ───────────────────────────────────────────────────────────────
  if (step === 'out') return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">Select cards from your inventory going to the customer.</p>

      <div className="space-y-2">
        <div className="flex gap-1">
          {(['graded', 'raw'] as const).map(t => (
            <button key={t} type="button" onClick={() => { setOutType(t); setOutSearch(''); }}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${outType === t ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
              {t === 'graded' ? 'Graded' : 'Raw'}
            </button>
          ))}
        </div>
        <div className="relative">
          <Input label="Search Card" placeholder={outType === 'graded' ? 'Card name or cert number…' : 'Card name or purchase ID…'}
            value={outSearch} onChange={(e) => setOutSearch(e.target.value)} autoComplete="off" />
          {isSearching && <Loader2 size={13} className="absolute right-3 top-[30px] animate-spin text-zinc-500" />}
        </div>
        {debouncedOutSearch.length >= 2 && (
          outType === 'graded' ? (
            gradedResults.length > 0 && (
              <div className="rounded-lg border border-zinc-700 overflow-hidden max-h-40 overflow-y-auto">
                {gradedResults.map(c => (
                  <button key={c.id} type="button" onClick={() => addOutgoing(c, 'graded')}
                    className="w-full text-left px-3 py-2 hover:bg-zinc-800 border-b border-zinc-700/40 last:border-0 transition-colors flex items-center justify-between gap-3">
                    <span className="text-sm text-zinc-200 truncate">{c.card_name}</span>
                    <span className="text-[11px] text-zinc-500 shrink-0">{c.company} {c.grade_label} · #{c.cert_number}</span>
                  </button>
                ))}
              </div>
            )
          ) : (
            rawResults.length > 0 && (
              <div className="rounded-lg border border-zinc-700 overflow-hidden max-h-40 overflow-y-auto">
                {rawResults.map(c => (
                  <button key={c.id} type="button" onClick={() => addOutgoing(c, 'raw')}
                    className="w-full text-left px-3 py-2 hover:bg-zinc-800 border-b border-zinc-700/40 last:border-0 transition-colors flex items-center justify-between gap-3">
                    <span className="text-sm text-zinc-200 truncate">{c.card_name}</span>
                    <span className="font-mono text-[11px] text-indigo-300 shrink-0">{c.raw_purchase_label ?? '—'}</span>
                  </button>
                ))}
              </div>
            )
          )
        )}
      </div>

      {outgoing.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500 mb-1.5">Going Out ({outgoing.length})</p>
          {outgoing.map(e => (
            <div key={e.uid} className="flex items-center gap-2 rounded-lg border border-zinc-700/50 bg-zinc-800/40 px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-200 truncate">{e.card.card_name}</p>
                <p className="text-[10px] text-zinc-500">
                  {e.cardType === 'graded'
                    ? `${(e.card as SlabResult).company} ${(e.card as SlabResult).grade_label} · #${(e.card as SlabResult).cert_number}`
                    : `ID: ${(e.card as RawCardResult).raw_purchase_label ?? '—'}`}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs text-zinc-500">$</span>
                <input type="number" step="0.01" min="0" placeholder="0.00" value={e.value}
                  onChange={(ev) => updateOut(e.uid, ev.target.value)}
                  className="w-20 rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                <button type="button" onClick={() => setOutgoing(prev => prev.filter(x => x.uid !== e.uid))} className="text-zinc-600 hover:text-zinc-400 ml-1">
                  <X size={13} />
                </button>
              </div>
            </div>
          ))}

          {/* Cash going out to customer */}
          <div className="flex items-center gap-2 rounded-lg border border-zinc-700/50 bg-zinc-800/40 px-3 py-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-zinc-400">Cash to customer</p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs text-zinc-500">$</span>
              <input type="number" step="0.01" min="0" placeholder="0.00" value={cashToCustomer}
                onChange={(e) => setCashToCustomer(e.target.value)}
                className="w-20 rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
              <span className="w-[13px] ml-1" />
            </div>
          </div>

          <div className="flex justify-end text-xs text-zinc-400 pr-2">
            Total out: <span className="font-semibold text-zinc-200 ml-1">${outSide.toFixed(2)}</span>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" disabled={outgoing.length === 0} onClick={() => setStep('in')}>Next →</Button>
      </div>
    </div>
  );

  // ── Step: In ────────────────────────────────────────────────────────────────
  if (step === 'in') return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setStep('out')} className="text-xs text-zinc-500 hover:text-zinc-300">← Back</button>
        <p className="text-xs text-zinc-500">Add cards coming in from the customer.</p>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide shrink-0">Trade %</label>
        <input type="number" step="1" min="1" max="100" value={tradePercent} onChange={(e) => setTradePercent(e.target.value)}
          className="w-20 rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
        <span className="text-xs text-zinc-500">% of market value credited as trade cost</span>
      </div>

      {incomingAdded.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Added ({incomingAdded.length})</p>
          {incomingAdded.map((e) => (
            <div key={e.uid} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-700/40 bg-zinc-800/30 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm text-zinc-200 truncate">{e.card_name_override}</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">
                  {e.type === 'graded' ? `${e.slab_company ?? ''} ${e.slab_grade_label ?? ''}` : `${e.condition ?? ''} · ${e.decision === 'sell_raw' ? 'Sell' : 'Grade'}`}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="text-right">
                  {e.market_value && <p className="text-[10px] text-zinc-500 line-through">${parseFloat(e.market_value).toFixed(2)}</p>}
                  <span className="text-xs text-emerald-400 font-semibold">${parseFloat(e.purchase_cost).toFixed(2)}</span>
                </div>
                <button type="button" onClick={() => setIncomingAdded(prev => prev.filter(x => x.uid !== e.uid))} className="text-zinc-600 hover:text-zinc-400">
                  <X size={12} />
                </button>
              </div>
            </div>
          ))}

          {/* Cash from customer — always at 100% face value */}
          <div className="flex items-center gap-2 rounded-lg border border-zinc-700/50 bg-zinc-800/40 px-3 py-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-zinc-400">Cash from customer <span className="text-[10px] text-zinc-600 font-normal">(100%)</span></p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-xs text-zinc-500">$</span>
              <input type="number" step="0.01" min="0" placeholder="0.00" value={cashFromCustomer}
                onChange={(e) => setCashFromCustomer(e.target.value)}
                className="w-20 rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
              <span className="w-[13px] ml-1" />
            </div>
          </div>

          <div className="flex justify-between text-xs text-zinc-400 pt-0.5">
            <span>Total in</span>
            <span className="font-semibold text-zinc-200">${inSide.toFixed(2)}</span>
          </div>
        </div>
      )}

      <TradeCardForm onAdd={(data) => setIncomingAdded(prev => [...prev, data])} tradePercent={parseFloat(tradePercent) || 80} />

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" disabled={incomingAdded.length === 0} onClick={() => setStep('review')}>Review →</Button>
      </div>
    </div>
  );

  // ── Step: Review ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setStep('in')} className="text-xs text-zinc-500 hover:text-zinc-300">← Back</button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">Going Out</p>
          {outgoing.map(e => (
            <div key={e.uid} className="flex justify-between gap-2 text-xs py-0.5">
              <div className="min-w-0">
                <p className="text-zinc-300 break-words">{e.card.card_name}</p>
                <p className="text-[10px] text-zinc-500">
                  {e.cardType === 'graded'
                    ? `${(e.card as SlabResult).company ?? ''} ${(e.card as SlabResult).grade_label ?? ''}${(e.card as SlabResult).cert_number ? ` · #${(e.card as SlabResult).cert_number}` : ''}`.trim()
                    : [
                        (e.card as RawCardResult).raw_purchase_label,
                        (e.card as RawCardResult).condition,
                        (e.card as RawCardResult).quantity > 1 ? `qty ${(e.card as RawCardResult).quantity}` : null,
                      ].filter(Boolean).join(' · ')}
                </p>
              </div>
              <span className="text-zinc-400 shrink-0">${parseFloat(e.value || '0').toFixed(2)}</span>
            </div>
          ))}
          {cashOut > 0 && (
            <div className="flex justify-between gap-2 text-xs py-0.5">
              <span className="text-zinc-500 italic">Cash to customer</span>
              <span className="text-zinc-400 shrink-0">${cashOut.toFixed(2)}</span>
            </div>
          )}
          <div className="border-t border-zinc-700 pt-1 flex justify-between text-xs font-semibold">
            <span className="text-zinc-500">Total out</span>
            <span className="text-zinc-200">${outSide.toFixed(2)}</span>
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
            Coming In <span className="normal-case font-normal text-zinc-600">(Cards at {parseFloat(tradePercent) || 80}% · Cash at 100%)</span>
          </p>
          {incomingAdded.map(e => (
            <div key={e.uid} className="flex justify-between gap-2 text-xs py-0.5">
              <div className="min-w-0">
                <p className="text-zinc-300 break-words">{e.card_name_override}</p>
                <p className="text-[10px] text-zinc-500">
                  {e.type === 'graded'
                    ? `${e.slab_company ?? ''} ${e.slab_grade_label ?? ''}${e.slab_cert_number ? ` · #${e.slab_cert_number}` : ''}`.trim()
                    : [e.condition, e.decision === 'grade' ? 'To Grade' : 'For Sale'].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="text-right shrink-0">
                {e.market_value && (
                  <p className="text-[10px] text-zinc-600 line-through">${parseFloat(e.market_value).toFixed(2)}</p>
                )}
                <span className="text-zinc-400">${parseFloat(e.purchase_cost || '0').toFixed(2)}</span>
              </div>
            </div>
          ))}
          {cashIn > 0 && (
            <div className="flex justify-between gap-2 text-xs py-0.5">
              <span className="text-zinc-500 italic">Cash from customer</span>
              <span className="text-zinc-400 shrink-0">${cashIn.toFixed(2)}</span>
            </div>
          )}
          <div className="border-t border-zinc-700 pt-1 flex justify-between text-xs font-semibold">
            <span className="text-zinc-500">Total in</span>
            <span className="text-zinc-200">${inSide.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {isBalanced && outSide > 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
          <span className="text-emerald-400">✓</span>
          <p className="text-xs text-emerald-300">Trade is balanced at ${outSide.toFixed(2)}.</p>
        </div>
      ) : !isBalanced ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-amber-400">⚠</span>
            <p className="text-xs text-amber-300">
              Unbalanced by ${diff.toFixed(2)} — out ${outSide.toFixed(2)} vs in ${inSide.toFixed(2)}.
            </p>
          </div>
          <button type="button" onClick={() => setAcceptDiff(v => !v)}
            className={`flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
              acceptDiff
                ? 'bg-amber-500/20 border-amber-500/50 text-amber-200'
                : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
            }`}>
            <span className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 ${acceptDiff ? 'bg-amber-500 border-amber-500' : 'border-zinc-600'}`}>
              {acceptDiff && <span className="text-[10px] text-zinc-900 font-bold leading-none">✓</span>}
            </span>
            Accept differential and proceed
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Trade Date</label>
          <input type="date" value={tradeDate} onChange={(e) => setTradeDate(e.target.value)}
            className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 [color-scheme:dark]" />
        </div>
        <Input label="Person" placeholder="Customer name" value={tradePerson} onChange={(e) => setTradePerson(e.target.value)} />
      </div>
      <Input label="Notes" placeholder="Any additional notes" value={tradeNotes} onChange={(e) => setTradeNotes(e.target.value)} />

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" disabled={submitting || (!isBalanced && !acceptDiff)} onClick={handleSubmit}>
          {submitting && <Loader2 size={14} className="animate-spin" />}
          Record Trade
        </Button>
      </div>
    </div>
  );
}

// ── Trades Page ───────────────────────────────────────────────────────────────

export function Trades() {
  const [showModal, setShowModal] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [editingTrade, setEditingTrade] = useState<Trade | null>(null);
  const [deletingTrade, setDeletingTrade] = useState<Trade | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const queryClient = useQueryClient();

  // Edit form state
  const [editDate, setEditDate] = useState('');
  const [editPerson, setEditPerson] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editTradePercent, setEditTradePercent] = useState('');

  const { data, isLoading } = useQuery<PaginatedResult<Trade>>({
    queryKey: ['trades', page],
    queryFn: () => api.get('/trades', { params: { page, limit: 25 } }).then(r => r.data),
  });

  const trades = data?.data ?? [];
  const totalPages = data ? Math.ceil(data.total / data.limit) : 1;

  function toggleExpand(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function fmt(cents: number, currency = 'USD') {
    return (cents / 100).toLocaleString('en-US', { style: 'currency', currency });
  }

  function openEdit(trade: Trade) {
    setEditingTrade(trade);
    setEditDate(trade.trade_date ? trade.trade_date.slice(0, 10) : '');
    setEditPerson(trade.person ?? '');
    setEditNotes(trade.notes ?? '');
    setEditTradePercent(String(trade.trade_percent));
  }

  async function handleEdit() {
    if (!editingTrade) return;
    setActionLoading(true);
    try {
      await api.patch(`/trades/${editingTrade.id}`, {
        trade_date: editDate || undefined,
        person: editPerson || undefined,
        notes: editNotes || undefined,
        trade_percent: parseFloat(editTradePercent) || 80,
      });
      toast.success('Trade updated');
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      setEditingTrade(null);
    } catch {
      toast.error('Failed to update trade');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDelete() {
    if (!deletingTrade) return;
    setActionLoading(true);
    try {
      await api.delete(`/trades/${deletingTrade.id}`);
      toast.success('Trade deleted and inventory restored');
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setDeletingTrade(null);
      setDeleteConfirm(false);
    } catch {
      toast.error('Failed to delete trade');
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Trades</h1>
          <p className="text-xs text-zinc-500 mt-0.5">Card-for-card trades with customers</p>
        </div>
        <Button size="sm" onClick={() => setShowModal(true)}>
          <ArrowRightLeft size={14} /> Record Trade
        </Button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-zinc-600 text-sm gap-2">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : trades.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-zinc-600">
            <ArrowRightLeft size={32} strokeWidth={1} />
            <p className="text-sm">No trades recorded yet</p>
            <Button size="sm" variant="ghost" onClick={() => setShowModal(true)}>Record your first trade</Button>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 w-6"></th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">ID</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Date</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Person</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Cards Out</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Cards In</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Cash</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">Notes</th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade) => {
                const expanded = expandedIds.has(trade.id);
                const outTotal = trade.out_cards.reduce((s, c) => s + (c.sale_price_cents ?? 0), 0);
                const inTotal  = trade.in_cards.reduce((s, c) => s + (c.purchase_cost_cents ?? 0), 0);
                const cashFrom = trade.cash_from_customer_cents;
                const cashTo   = trade.cash_to_customer_cents;
                const balanced = Math.abs((outTotal + cashTo) - (inTotal + cashFrom)) < 1;
                return (
                  <>
                    <tr key={trade.id}
                      onClick={() => toggleExpand(trade.id)}
                      className="border-b border-zinc-800/60 hover:bg-zinc-800/30 cursor-pointer transition-colors group">
                      <td className="px-4 py-3 text-zinc-600">
                        <ChevronRight size={13} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
                      </td>
                      <td className="px-4 py-3 text-zinc-400 font-mono text-xs whitespace-nowrap">
                        {trade.trade_label ?? <span className="text-zinc-600">—</span>}
                      </td>
                      <td className="px-4 py-3 text-zinc-300 whitespace-nowrap">
                        {trade.trade_date ? formatDate(trade.trade_date) : <span className="text-zinc-600">—</span>}
                      </td>
                      <td className="px-4 py-3 text-zinc-300">
                        {trade.person ?? <span className="text-zinc-600">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="text-zinc-300">{trade.out_cards.length} card{trade.out_cards.length !== 1 ? 's' : ''}</span>
                          <span className="text-zinc-500 text-xs">{fmt(outTotal)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="text-zinc-300">{trade.in_cards.length} card{trade.in_cards.length !== 1 ? 's' : ''}</span>
                          <span className="text-zinc-500 text-xs">{fmt(inTotal)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-500">
                        {cashFrom > 0 && <span className="text-emerald-400">+{fmt(cashFrom)} from customer</span>}
                        {cashTo > 0 && <span className="text-amber-400">{cashFrom > 0 ? ' · ' : ''}+{fmt(cashTo)} to customer</span>}
                        {cashFrom === 0 && cashTo === 0 && '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-zinc-500 max-w-[200px] truncate">
                        <div className="flex items-center gap-2">
                          {balanced
                            ? <span className="text-emerald-400 text-[10px] font-medium">✓ Balanced</span>
                            : <span className="text-amber-400 text-[10px] font-medium">⚠ Unbalanced</span>}
                          {trade.notes && <span className="text-zinc-500 truncate">{trade.notes}</span>}
                        </div>
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(trade); }}
                            className="p-1.5 rounded text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
                            <Pencil size={12} />
                          </button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); setDeletingTrade(trade); setDeleteConfirm(false); }}
                            className="p-1.5 rounded text-zinc-600 hover:text-red-400 hover:bg-zinc-800 transition-colors">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expanded && (
                      <tr key={`${trade.id}-expanded`} className="border-b border-zinc-800/40 bg-zinc-900/40">
                        <td></td>
                        <td colSpan={8} className="px-4 py-3">
                          <div className="grid grid-cols-2 gap-6">
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500 mb-2">Cards Out</p>
                              <div className="space-y-2">
                                {trade.out_cards.map(c => (
                                  <div key={c.id} className="flex justify-between text-xs gap-4">
                                    <div className="min-w-0">
                                      <p className="text-zinc-300 truncate">{c.card_name ?? '—'}</p>
                                      <p className="text-[10px] text-zinc-500">
                                        {c.company && c.grade_label
                                          ? `${c.company} ${c.grade_label}${c.cert_number ? ` · #${c.cert_number}` : ''}`
                                          : c.raw_label
                                            ? `${c.raw_label}${c.condition ? ` · ${c.condition}` : ''}${c.quantity && c.quantity > 1 ? ` · qty ${c.quantity}` : ''}`
                                            : c.condition ?? ''}
                                      </p>
                                    </div>
                                    <span className="text-zinc-400 shrink-0">{fmt(c.sale_price_cents ?? 0, c.currency)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500 mb-2">Cards In <span className="text-zinc-600 font-normal normal-case">({trade.trade_percent}% trade credit)</span></p>
                              <div className="space-y-2">
                                {trade.in_cards.map(c => (
                                  <div key={c.id} className="flex justify-between text-xs gap-4">
                                    <div className="min-w-0">
                                      <p className="text-zinc-300 truncate">{c.card_name ?? '—'}</p>
                                      <p className="text-[10px] text-zinc-500">
                                        {c.company && c.grade_label
                                          ? `${c.company} ${c.grade_label}${c.cert_number ? ` · #${c.cert_number}` : ''}`
                                          : c.raw_label
                                            ? `${c.raw_label}${c.condition ? ` · ${c.condition}` : ''}${c.quantity && c.quantity > 1 ? ` · qty ${c.quantity}` : ''}`
                                            : c.condition ?? ''}
                                      </p>
                                    </div>
                                    <span className="text-emerald-400 shrink-0">{fmt(c.purchase_cost_cents ?? 0, c.currency)}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
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
        <div className="flex items-center justify-between px-6 py-3 border-t border-zinc-800 shrink-0">
          <span className="text-xs text-zinc-500">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Trade Intake" className="max-w-3xl">
        <TradeIntakeModal onClose={() => setShowModal(false)} />
      </Modal>

      {/* Edit Trade Modal */}
      <Modal open={!!editingTrade} onClose={() => setEditingTrade(null)} title="Edit Trade">
        <div className="space-y-4">
          <p className="text-xs text-zinc-500">Only trade details can be edited. To change cards or values, delete and re-record the trade.</p>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Trade Date" type="date" value={editDate} onChange={e => setEditDate(e.target.value)} />
            <Input label="Person" placeholder="Customer name" value={editPerson} onChange={e => setEditPerson(e.target.value)} />
          </div>
          <Input label="Trade %" type="number" min="1" max="100" value={editTradePercent} onChange={e => setEditTradePercent(e.target.value)} />
          <Input label="Notes" placeholder="Optional notes" value={editNotes} onChange={e => setEditNotes(e.target.value)} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => setEditingTrade(null)}>Cancel</Button>
            <Button size="sm" onClick={handleEdit} disabled={actionLoading}>
              {actionLoading && <Loader2 size={13} className="animate-spin" />} Save Changes
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal open={!!deletingTrade} onClose={() => { setDeletingTrade(null); setDeleteConfirm(false); }} title="Delete Trade">
        <div className="space-y-4">
          <p className="text-sm text-zinc-300">
            This will permanently delete the trade and roll back all changes:
          </p>
          <ul className="text-xs text-zinc-500 space-y-1 list-disc list-inside">
            <li>Outgoing cards will be restored to inventory</li>
            <li>Incoming cards will be removed</li>
            <li>Any associated sale records will be deleted</li>
          </ul>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={deleteConfirm} onChange={e => setDeleteConfirm(e.target.checked)}
              className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 accent-red-500" />
            <span className="text-sm text-zinc-300">I understand this cannot be undone</span>
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => { setDeletingTrade(null); setDeleteConfirm(false); }}>Cancel</Button>
            <Button size="sm" onClick={handleDelete} disabled={!deleteConfirm || actionLoading}
              className="bg-red-600 hover:bg-red-500 disabled:opacity-40">
              {actionLoading && <Loader2 size={13} className="animate-spin" />} Delete Trade
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
