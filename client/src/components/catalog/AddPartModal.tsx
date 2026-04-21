import { useState, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../ui/Button';
import { filterSets } from '../../lib/set-codes';

const GAMES = [
  { value: 'pokemon',   label: 'Pokémon' },
  { value: 'one_piece', label: 'One Piece' },
  { value: 'old_maid',  label: 'Old Maid' },
];

function SetCodeCombobox({
  value,
  language,
  inputCls,
  onChange,
}: {
  value: string;
  language: 'JP' | 'EN';
  inputCls: string;
  onChange: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const suggestions = filterSets(language, value).slice(0, 12);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <input
        className={inputCls}
        value={value}
        placeholder="e.g. SV3"
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl text-xs">
          {suggestions.map((s) => (
            <li
              key={s.code}
              onMouseDown={(e) => { e.preventDefault(); onChange(s.code); setOpen(false); }}
              className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-zinc-800">
              <span className="font-mono text-indigo-300 w-24 shrink-0">{s.code}</span>
              <span className="text-zinc-400 truncate">{s.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface CreatedPart {
  id: string;
  sku: string | null;
  card_name: string;
  set_name: string;
  card_number: string | null;
  language: string;
}

interface Props {
  onClose: () => void;
  onCreated?: (part: CreatedPart) => void;
  prefill?: {
    card_name?: string;
    set_name?: string;
    card_number?: string;
    language?: string;
  };
}

export function AddPartModal({ onClose, onCreated, prefill }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    game:        'pokemon',
    sku:         '',
    card_name:   prefill?.card_name   ?? '',
    set_name:    prefill?.set_name    ?? '',
    set_code:    '',
    card_number: prefill?.card_number ?? '',
    language:    prefill?.language    ?? 'JP',
    rarity:      '',
    variant:     '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skuManual, setSkuManual] = useState(false);

  function autoSku(game: string, lang: string, setCode: string, cardNum: string) {
    if (!setCode && !cardNum) return '';
    const prefix = game === 'one_piece' ? 'OP' : game === 'old_maid' ? 'OM' : 'PKMN';
    return [prefix, lang.toUpperCase(), setCode.toUpperCase(), cardNum.toUpperCase()].filter(Boolean).join('-');
  }

  const field = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const val = e.target.value;
    setForm(prev => {
      const next = { ...prev, [key]: val };
      if (!skuManual) next.sku = autoSku(next.game, next.language, next.set_code, next.card_number);
      return next;
    });
  };

  const inputCls = 'w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500';

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.post('/catalog', {
        game:        form.game,
        sku:         form.sku || null,
        card_name:   form.card_name,
        set_name:    form.set_name,
        set_code:    form.set_code || null,
        card_number: form.card_number || null,
        language:    form.language,
        rarity:      form.rarity || null,
        variant:     form.variant || null,
      });
      queryClient.invalidateQueries({ queryKey: ['inventory-summary'] });
      queryClient.invalidateQueries({ queryKey: ['empty-parts'] });
      if (onCreated) {
        onCreated({
          id:          res.data.id,
          sku:         form.sku || null,
          card_name:   form.card_name,
          set_name:    form.set_name,
          card_number: form.card_number || null,
          language:    form.language,
        });
      } else {
        onClose();
      }
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? (err as any).response?.data?.error ?? 'Failed to save.'
        : 'Failed to save.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-zinc-100">Add Part Number</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors"><X size={16} /></button>
        </div>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Card Game</label>
              <select value={form.game} onChange={field('game')} className={inputCls}>
                {GAMES.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Language</label>
              <select value={form.language} onChange={field('language')} className={inputCls}>
                <option value="JP">JP</option>
                <option value="EN">EN</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-zinc-400 mb-1">
                Part # <span className="text-zinc-600">auto-generated from set code + card #</span>
              </label>
              <input
                className={inputCls}
                value={form.sku}
                onChange={e => { setSkuManual(true); setForm(prev => ({ ...prev, sku: e.target.value })); }}
                placeholder="e.g. PKMN-JP-SV1-001"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-zinc-400 mb-1">Card Name <span className="text-red-500">*</span></label>
              <input className={inputCls} value={form.card_name} onChange={field('card_name')} required placeholder="e.g. Charizard ex" />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Set Name <span className="text-red-500">*</span></label>
              <input className={inputCls} value={form.set_name} onChange={field('set_name')} required placeholder="e.g. Obsidian Flames" />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Set Code</label>
              <SetCodeCombobox
                value={form.set_code}
                language={form.language as 'JP' | 'EN'}
                inputCls={inputCls}
                onChange={(code) => {
                  setForm((prev) => {
                    const next = { ...prev, set_code: code };
                    if (!skuManual) next.sku = autoSku(next.game, next.language, next.set_code, next.card_number);
                    return next;
                  });
                }}
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Card #</label>
              <input className={inputCls} value={form.card_number} onChange={field('card_number')} placeholder="e.g. 215" />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Rarity</label>
              <input className={inputCls} value={form.rarity} onChange={field('rarity')} placeholder="e.g. Special Illustration Rare" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-zinc-400 mb-1">Variant</label>
              <input className={inputCls} value={form.variant} onChange={field('variant')} placeholder="e.g. Reverse Holo" />
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
              Cancel
            </button>
            <Button type="button" size="sm" onClick={handleSubmit} disabled={submitting || !form.card_name || !form.set_name}>
              {submitting ? 'Saving…' : 'Add Part'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
