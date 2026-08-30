import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';

interface VariantCode {
  code: string;
  name: string;
  description: string | null;
  sort_order: number;
}

interface Props {
  game: string;
  // Three-state value: string = code, null = explicit "None (Unlimited implied)",
  // undefined = unpicked (renders as a non-selectable placeholder). Callers that
  // never need the "unpicked" state (AddPartModal, EditPartModal) can pass null
  // and treat the placeholder as unreachable.
  value: string | null | undefined;
  onChange: (code: string | null) => void;
  className?: string;
  placeholder?: string;
}

// Sentinel value used in the <option> for "explicit None" so it's distinct
// from the empty-string placeholder value. HTML <select> can only key options
// by string, so we need a real value here.
const NONE_SENTINEL = '__NONE__';

// Dropdown of variant codes for a game (populates from card_game_variants),
// with an inline "+ Add code" affordance so a user of an unseeded game
// (e.g. weiss-schwarz) can create their own vocabulary without waiting for
// a developer to seed one. Codes are global; the "+ Add" form dedupe-warns
// by listing existing codes for the same game before submit.
export function VariantCodeSelect({ game, value, onChange, className = '', placeholder }: Props) {
  const qc = useQueryClient();
  const gameLower = game.toLowerCase().trim();
  const { data: codes = [], isLoading } = useQuery<VariantCode[]>({
    queryKey: ['variant-codes', gameLower],
    queryFn: () => api.get(`/card-games/${encodeURIComponent(gameLower)}/variants`).then(r => r.data.data),
    enabled: !!gameLower,
  });

  const [adding, setAdding] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const selectCls = 'w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500';
  const inputCls = 'w-full px-2 py-1 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500';

  async function handleAdd() {
    const code = newCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    const name = newName.trim();
    if (!code) { setAddError('Code is required (A-Z / 0-9, up to 6 chars).'); return; }
    if (!name) { setAddError('Name is required.'); return; }
    setSaving(true);
    setAddError(null);
    try {
      await api.post(`/card-games/${encodeURIComponent(gameLower)}/variants`, { code, name });
      await qc.invalidateQueries({ queryKey: ['variant-codes', gameLower] });
      onChange(code);
      setAdding(false);
      setNewCode('');
      setNewName('');
    } catch (err: any) {
      setAddError(err?.response?.data?.error ?? 'Failed to add code.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={className}>
      {!adding ? (
        <>
          <select
            className={selectCls}
            value={value === undefined ? '' : value === null ? NONE_SENTINEL : value}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '') return;                     // placeholder isn't a real pick
              if (v === NONE_SENTINEL) onChange(null);  // explicit "None"
              else onChange(v);                         // a real code
            }}
            disabled={isLoading}
          >
            {placeholder && (
              <option value="" disabled>{placeholder}</option>
            )}
            <option value={NONE_SENTINEL}>— None (Unlimited implied) —</option>
            {codes.map(c => (
              <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => { setAdding(true); setAddError(null); }}
            className="mt-1 inline-flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            <Plus size={10} /> Add code for {gameLower}
          </button>
        </>
      ) : (
        <div className="border border-zinc-700 rounded-lg bg-zinc-800/40 p-2 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-zinc-400 uppercase tracking-wider">New variant code · {gameLower}</span>
            <button
              type="button"
              onClick={() => { setAdding(false); setAddError(null); }}
              className="text-zinc-500 hover:text-zinc-300"
              aria-label="Cancel"
            >
              <X size={12} />
            </button>
          </div>
          <div className="grid grid-cols-[6rem_1fr] gap-2">
            <input
              className={inputCls}
              placeholder="CODE"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              maxLength={6}
              autoFocus
            />
            <input
              className={inputCls}
              placeholder="Name (e.g. First Edition)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={80}
            />
          </div>
          {codes.length > 0 && (
            <p className="text-[10px] text-zinc-500">
              Existing: {codes.map(c => c.code).join(', ')} — reuse if it matches.
            </p>
          )}
          {addError && <p className="text-[10px] text-red-400">{addError}</p>}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleAdd}
              disabled={saving || !newCode || !newName}
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
            >
              {saving ? <><Loader2 size={10} className="animate-spin" /> Adding…</> : 'Add'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
