import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Mic, X, ArrowRight, Check, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, apiErrorMessage } from '../../lib/api';
import { Button } from '../ui/Button';

// Quick Sale — sale-by-text subagent flow.
//
// Two phases in a single modal:
//   1. Input — user types (or dictates via the phone keyboard) a one-liner.
//      The keyboard's built-in mic button handles voice-to-text; no custom
//      speech recognition needed.
//   2. Confirm — server returns { parsed, candidates }. Modal shows the
//      parsed fields (all editable) plus a candidate picker when > 1 match.
//      Nothing gets recorded until the user taps Confirm.

interface ParsedSaleData {
  card_query?: string;
  company?: string;
  grade?: number;
  cert_number?: string;
  price?: number;
  quantity?: number;
  buyer?: string;
  platform?: 'card_show' | 'ebay' | 'tcgplayer' | 'facebook' | 'instagram' | 'local' | 'other';
  sold_at?: string;
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
}

interface QuickCandidate {
  id: string;
  card_name: string | null;
  set_name: string | null;
  cert_number: string | null;
  grade_label: string | null;
  numeric_grade: number | null;
  company: string;
  is_listed: boolean;
  listed_price: number | null;
  card_show_price: number | null;
  raw_cost: number;
  grading_cost: number;
}

interface CardShowLite {
  id: string;
  name: string;
  show_date: string;
  end_date: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

const PLATFORM_OPTIONS: ParsedSaleData['platform'][] = [
  'card_show', 'ebay', 'tcgplayer', 'facebook', 'instagram', 'local', 'other',
];

export function QuickSaleModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [parseResult, setParseResult] = useState<{ parsed: ParsedSaleData; candidates: QuickCandidate[] } | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  // Editable form fields — start from the parsed values, user can adjust before commit
  const [editPrice, setEditPrice] = useState('');
  const [editBuyer, setEditBuyer] = useState('');
  const [editPlatform, setEditPlatform] = useState<ParsedSaleData['platform']>('card_show');
  const [editSoldAt, setEditSoldAt] = useState('');
  const [editShowId, setEditShowId] = useState('');

  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Reset all state when the modal opens fresh. This is a legitimate
  // sync-with-external-event effect (open toggling); the lint rule blocks
  // setState-in-effect in general but doesn't understand the pattern here.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setText('');
    setParseResult(null);
    setSelectedCandidateId(null);
    setEditPrice('');
    setEditBuyer('');
    setEditPlatform('card_show');
    setEditSoldAt(new Date().toISOString().slice(0, 10));
    setEditShowId('');
    // Auto-focus so the phone keyboard opens immediately with the mic button visible.
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Card shows dropdown — only queried when platform=card_show. Lets the user
  // link the sale to an active show without leaving the modal.
  const showsQuery = useQuery<{ data: CardShowLite[] }>({
    queryKey: ['card-shows-lite'],
    queryFn: () => api.get('/card-shows').then(r => r.data),
    enabled: open && editPlatform === 'card_show',
  });

  const parseMut = useMutation({
    mutationFn: (t: string) => api.post('/sales/quick-parse', { text: t }).then(r => r.data as { parsed: ParsedSaleData; candidates: QuickCandidate[] }),
    onSuccess: (data) => {
      setParseResult(data);
      const p = data.parsed;
      // Prefill the editable fields from the parse. Candidate picker defaults
      // to the first hit — user can switch inside the modal.
      if (p.price != null) setEditPrice(p.price.toFixed(2));
      if (p.buyer) setEditBuyer(p.buyer);
      if (p.platform) setEditPlatform(p.platform);
      if (p.sold_at) setEditSoldAt(p.sold_at);
      if (data.candidates.length > 0) setSelectedCandidateId(data.candidates[0].id);
    },
    onError: (err: unknown) => {
      toast.error(apiErrorMessage(err, 'Parse failed'));
    },
  });

  const submitMut = useMutation({
    mutationFn: async () => {
      if (!selectedCandidateId) throw new Error('Pick a card first');
      const priceNum = parseFloat(editPrice);
      if (!Number.isFinite(priceNum) || priceNum <= 0) throw new Error('Enter a valid price');
      const payload: Record<string, unknown> = {
        card_instance_id: selectedCandidateId,
        platform: editPlatform,
        sale_price: priceNum,
        sold_at: editSoldAt || undefined,
      };
      if (editBuyer.trim()) payload.unique_id_2 = editBuyer.trim();
      if (editPlatform === 'card_show' && editShowId) payload.card_show_id = editShowId;
      if (parseResult?.parsed.quantity && parseResult.parsed.quantity > 1) {
        payload.quantity = parseResult.parsed.quantity;
      }
      await api.post('/sales', payload);
    },
    onSuccess: () => {
      toast.success('Sale recorded');
      qc.invalidateQueries({ queryKey: ['overall'] });
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['grading-slabs'] });
      onClose();
    },
    onError: (err: unknown) => {
      toast.error(apiErrorMessage(err, 'Failed to record sale'));
    },
  });

  if (!open) return null;

  const parsed = parseResult?.parsed;
  const candidates = parseResult?.candidates ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2">
            <Mic size={16} className="text-indigo-400" />
            <h2 className="text-sm font-semibold text-zinc-100">Quick Sale</h2>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300"><X size={18} /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!parseResult ? (
            // ── Phase 1: Input ──────────────────────────────────────────
            <>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Type or dictate the sale as a single sentence. The phone keyboard's mic button turns your speech into text.
              </p>
              <textarea
                ref={inputRef}
                rows={3}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder='e.g. "sold Charizard PSA 10 to John for 200"'
                className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 resize-none"
                autoCapitalize="off"
                autoCorrect="off"
              />
              <div className="text-[11px] text-zinc-600 space-y-0.5">
                <p><span className="text-zinc-500">Examples:</span></p>
                <p>· "cert 12345678 gone for 800 to alex"</p>
                <p>· "moved BGS 9.5 pikachu for 45 cash"</p>
                <p>· "3 raw commons to john for 5 at the show"</p>
              </div>
            </>
          ) : (
            // ── Phase 2: Confirm ────────────────────────────────────────
            <>
              {parsed && parsed.confidence === 'low' && (
                <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/40 text-[11px] text-amber-200">
                  <span className="font-semibold">Low confidence.</span> Double-check every field before confirming.
                  {parsed.notes && <p className="mt-0.5 text-amber-300/80">{parsed.notes}</p>}
                </div>
              )}

              {/* Candidate picker — always shown even for single match, so
                  the user can eyeball the row before committing. */}
              <div>
                <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-1.5">
                  {candidates.length === 0
                    ? 'No inventory match — try a different phrasing'
                    : candidates.length === 1
                      ? 'Match'
                      : `Pick one of ${candidates.length} matches`}
                </p>
                <div className="border border-zinc-800 rounded-lg divide-y divide-zinc-800 max-h-52 overflow-y-auto">
                  {candidates.map((c) => {
                    const picked = c.id === selectedCandidateId;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedCandidateId(c.id)}
                        className={`w-full text-left px-3 py-2 flex items-start gap-2 transition-colors ${picked ? 'bg-indigo-900/30 hover:bg-indigo-900/40' : 'hover:bg-zinc-800/50'}`}
                      >
                        <input
                          type="radio"
                          checked={picked}
                          onChange={() => setSelectedCandidateId(c.id)}
                          className="mt-0.5 accent-indigo-500"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-zinc-100 truncate flex items-center gap-1.5">
                            <span className="truncate">{c.card_name ?? '—'}</span>
                            {c.is_listed && (
                              <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-[1px] rounded bg-sky-500/15 border border-sky-500/40 text-sky-300">eBay</span>
                            )}
                          </p>
                          <p className="text-[11px] text-zinc-500 truncate">
                            {c.set_name ?? ''}{c.cert_number ? ` · #${c.cert_number}` : ''} · {c.company} {c.grade_label ?? ''}
                          </p>
                        </div>
                        <div className="shrink-0 text-right text-[10px] text-zinc-500">
                          {c.card_show_price != null && <div>CS ${(c.card_show_price / 100).toFixed(2)}</div>}
                          {c.listed_price != null && <div>Listed ${(c.listed_price / 100).toFixed(2)}</div>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Editable sale fields */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Price $</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500 tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Sold on</label>
                  <input
                    type="date"
                    value={editSoldAt}
                    onChange={(e) => setEditSoldAt(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500 [color-scheme:dark]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Platform</label>
                  <select
                    value={editPlatform}
                    onChange={(e) => setEditPlatform(e.target.value as ParsedSaleData['platform'])}
                    className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500"
                  >
                    {PLATFORM_OPTIONS.map((p) => (
                      <option key={p} value={p}>{p!.replace('_', ' ')}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Buyer</label>
                  <input
                    type="text"
                    value={editBuyer}
                    onChange={(e) => setEditBuyer(e.target.value)}
                    placeholder="optional"
                    className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                {editPlatform === 'card_show' && (
                  <div className="col-span-2">
                    <label className="block text-[11px] text-zinc-500 uppercase tracking-wider mb-1">Card show (optional)</label>
                    <select
                      value={editShowId}
                      onChange={(e) => setEditShowId(e.target.value)}
                      className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="">— None —</option>
                      {(showsQuery.data?.data ?? []).map((s) => (
                        <option key={s.id} value={s.id}>{s.name} · {s.show_date}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Reparse button */}
              <button
                type="button"
                onClick={() => { setParseResult(null); setTimeout(() => inputRef.current?.focus(), 50); }}
                className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <RotateCcw size={11} /> Reparse from a different sentence
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-800 p-3 shrink-0 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          {!parseResult ? (
            <Button
              size="sm"
              onClick={() => parseMut.mutate(text)}
              disabled={!text.trim() || parseMut.isPending}
            >
              {parseMut.isPending
                ? <><Loader2 size={12} className="animate-spin mr-1.5" />Parsing…</>
                : <>Parse <ArrowRight size={13} className="ml-1" /></>}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => submitMut.mutate()}
              disabled={!selectedCandidateId || !editPrice || submitMut.isPending}
            >
              {submitMut.isPending
                ? <><Loader2 size={12} className="animate-spin mr-1.5" />Recording…</>
                : <><Check size={13} className="mr-1" /> Confirm sale</>}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
