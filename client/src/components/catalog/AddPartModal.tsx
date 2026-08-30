import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api } from '../../lib/api';
import { Button } from '../ui/Button';
import { SetCombobox, useMergedSets } from './SetCombobox';
import { VariantCodeSelect } from './VariantCodeSelect';

const ADD_GAME_SENTINEL = '__add_new_game__';

interface CardGame {
  id: string | null;
  name: string;
  abbreviation: string | null;
}

const GAME_LABELS: Record<string, string> = {
  pokemon: 'Pokémon',
  one_piece: 'One Piece',
  old_maid: 'Old Maid',
  'weiss-schwarz': 'Weiss Schwarz',
  weiss_schwarz: 'Weiss Schwarz',
  weiss: 'Weiss Schwarz',
};

function gameLabel(name: string): string {
  return GAME_LABELS[name.toLowerCase()] ?? name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function fallbackPrefix(game: string): string {
  if (!game) return 'PKMN';
  const cleaned = game.replace(/[^a-zA-Z0-9]/g, '');
  return cleaned.slice(0, 4).toUpperCase() || 'PKMN';
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
    unnumbered?: boolean;
  };
}

const LANG_NORMALIZE: Record<string, string> = {
  japanese: 'JP', jpn: 'JP', jp: 'JP',
  english: 'EN', eng: 'EN', en: 'EN',
  korean: 'KR', kor: 'KR', kr: 'KR',
  'chinese traditional': 'ZH-TW', 'chinese (traditional)': 'ZH-TW', 'zh-tw': 'ZH-TW', zhtw: 'ZH-TW',
  'chinese simplified': 'ZH-CN', 'chinese (simplified)': 'ZH-CN', 'zh-cn': 'ZH-CN', zhcn: 'ZH-CN',
  french: 'FR', fra: 'FR', fr: 'FR',
  german: 'DE', deu: 'DE', de: 'DE',
  italian: 'IT', ita: 'IT', it: 'IT',
  spanish: 'ES', esp: 'ES', es: 'ES',
  portuguese: 'PT', por: 'PT', pt: 'PT',
  polish: 'PL', pol: 'PL', pl: 'PL',
  dutch: 'NL', nld: 'NL', nl: 'NL',
  russian: 'RU', rus: 'RU', ru: 'RU',
  thai: 'TH', tha: 'TH', th: 'TH',
  indonesian: 'ID', ind: 'ID', id: 'ID',
};
function normalizeLang(lang?: string): string {
  if (!lang) return 'JP';
  return LANG_NORMALIZE[lang.toLowerCase()] ?? lang.toUpperCase();
}

const LANGUAGES = [
  { code: 'JP',    name: 'Japanese' },
  { code: 'EN',    name: 'English' },
  { code: 'KR',    name: 'Korean' },
  { code: 'ZH-TW', name: 'Chinese (Traditional)' },
  { code: 'ZH-CN', name: 'Chinese (Simplified)' },
  { code: 'FR',    name: 'French' },
  { code: 'DE',    name: 'German' },
  { code: 'IT',    name: 'Italian' },
  { code: 'ES',    name: 'Spanish' },
  { code: 'PT',    name: 'Portuguese' },
  { code: 'PL',    name: 'Polish' },
  { code: 'NL',    name: 'Dutch' },
  { code: 'RU',    name: 'Russian' },
  { code: 'TH',    name: 'Thai' },
  { code: 'ID',    name: 'Indonesian' },
];

export function AddPartModal({ onClose, onCreated, prefill }: Props) {
  const queryClient = useQueryClient();
  // Shares the ['card-games'] query key with the catalog page — both MUST hit
  // the same endpoint. /sets/games returns a bare array; /card-games returns
  // { data: [...] }. Mixing them under one key poisons the cache and crashes
  // whichever consumer reads the wrong shape.
  const { data: games = [] } = useQuery<CardGame[]>({
    queryKey: ['card-games'],
    queryFn: () => api.get('/sets/games').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const gamePrefixes = new Map(games.map(g => [g.name.toLowerCase(), g.abbreviation || fallbackPrefix(g.name)]));
  const [form, setForm] = useState({
    game:        'pokemon',
    sku:         '',
    card_name:   prefill?.card_name   ?? '',
    set_name:    prefill?.set_name    ?? '',
    set_code:    '',
    card_number: prefill?.card_number ?? '',
    language:    normalizeLang(prefill?.language),
    rarity:      '',
    variant:     '',
  });
  const [unnumbered, setUnnumbered] = useState(prefill?.unnumbered ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingGame, setAddingGame] = useState(false);
  const [newGameName, setNewGameName] = useState('');
  const [newGameAbbrev, setNewGameAbbrev] = useState('');
  const setOptions = useMergedSets(form.language);

  // Recompute the auto-SKU once the /card-games query lands. Without this,
  // the modal opens before the games list arrives, autoSku falls back to
  // fallbackPrefix() (e.g. "POKE" for "pokemon"), and the SKU stays stuck
  // on the wrong prefix even after the canonical abbreviation ("PKMN") is
  // available.
  useEffect(() => {
    if (games.length === 0) return;
    setForm((prev) => ({
      ...prev,
      sku: autoSku(prev.game, prev.language, prev.set_code, prev.card_number, prev.card_name, unnumbered, prev.variant),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games.length]);

  async function handleAddNewSet() {
    const code = form.set_code.trim();
    const name = form.set_name.trim();
    if (!code || !name) return;
    try {
      await api.post('/sets/aliases', {
        language: form.language,
        game: form.game,
        alias: name.toLowerCase(),
        set_code: code,
        set_name: name,
      });
      queryClient.invalidateQueries({ queryKey: ['set-aliases'] });
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? (err as any).response?.data?.error ?? 'Failed to register set.'
        : 'Failed to register set.';
      setError(msg);
    }
  }

  function autoSku(game: string, lang: string, setCode: string, cardNum: string, cardName: string, isUnnumbered: boolean, variantCode: string) {
    const prefix = gamePrefixes.get(game.toLowerCase()) ?? fallbackPrefix(game);
    // When unnumbered, substitute a normalized card name for the card-number
    // segment so each unnumbered card under the same set still gets a unique,
    // addressable SKU (e.g. PKMN-JP-LEGACY-LEGACYCARDS). Strips non-ASCII-alnum
    // and uppercases; truncated to keep the SKU readable. Falls back gracefully
    // to just prefix-lang-setcode if the name doesn't yield any ASCII chars.
    const nameKey = (cardName ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
    const tail = isUnnumbered ? nameKey : cardNum.toUpperCase();
    if (!setCode && !tail) return '';
    const base = [prefix, lang.toUpperCase(), setCode.toUpperCase(), tail].filter(Boolean).join('-');
    // 5th segment: variant code. Unlimited implied by omission (no tail added).
    const vTail = (variantCode ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    return vTail ? `${base}-${vTail}` : base;
  }

  const field = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const val = e.target.value;
    setForm(prev => {
      const next = { ...prev, [key]: val };
      next.sku = autoSku(next.game, next.language, next.set_code, next.card_number, next.card_name, unnumbered, next.variant);
      return next;
    });
  };

  const inputCls = 'w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500';

  async function handleSubmit() {
    if (!unnumbered && !form.card_number.trim()) {
      setError('Card number required (or tick "no card # (unnumbered)")');
      return;
    }
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
              <select
                value={form.game}
                onChange={(e) => {
                  if (e.target.value === ADD_GAME_SENTINEL) {
                    setAddingGame(true);
                    setNewGameName('');
                    setNewGameAbbrev('');
                    return;
                  }
                  field('game')(e);
                }}
                className={inputCls}
              >
                {games.length === 0
                  ? <option value="pokemon">Pokémon</option>
                  : games.map(g => <option key={g.id ?? g.name} value={g.name}>{gameLabel(g.name)}</option>)}
                <option value={ADD_GAME_SENTINEL}>+ Add new game…</option>
              </select>
              {addingGame && (
                <div className="mt-2 rounded-lg border border-zinc-700 bg-zinc-900/60 p-3 space-y-2">
                  <input
                    type="text"
                    placeholder="Game name (e.g. Black Clover)"
                    value={newGameName}
                    onChange={(e) => setNewGameName(e.target.value)}
                    className={inputCls}
                    autoFocus
                  />
                  <input
                    type="text"
                    placeholder="SKU prefix (e.g. BC)"
                    value={newGameAbbrev}
                    onChange={(e) => setNewGameAbbrev(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                    className={inputCls}
                    maxLength={6}
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setAddingGame(false)}
                      className="text-xs text-zinc-500 hover:text-zinc-300"
                    >
                      Cancel
                    </button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!newGameName.trim() || !newGameAbbrev.trim()}
                      onClick={async () => {
                        try {
                          const res = await api.post('/sets/games', {
                            name: newGameName.trim(),
                            abbreviation: newGameAbbrev.trim(),
                          });
                          const created = res.data;
                          if (!created?.name) throw new Error('No game returned');
                          // Wait for the refetch to complete BEFORE we update
                          // form.game, so the dropdown has an <option> for
                          // the new game when React re-renders. Otherwise
                          // value can fall through to a stale option and the
                          // catalog row ends up tagged with the wrong game.
                          await queryClient.refetchQueries({ queryKey: ['card-games'] });
                          setForm((prev) => {
                            const next = { ...prev, game: created.name };
                            next.sku = [
                              created.abbreviation || fallbackPrefix(created.name),
                              prev.language.toUpperCase(),
                              prev.set_code.toUpperCase(),
                              prev.card_number.toUpperCase(),
                            ].filter(Boolean).join('-');
                            return next;
                          });
                          setAddingGame(false);
                        } catch (err: unknown) {
                          const msg = err && typeof err === 'object' && 'response' in err
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            ? (err as any).response?.data?.error ?? 'Failed to add game.'
                            : 'Failed to add game.';
                          setError(msg);
                        }
                      }}
                    >
                      Add game
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Language</label>
              <select value={form.language} onChange={field('language')} className={inputCls}>
                {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.code} — {l.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-zinc-400 mb-1">
                Part # <span className="text-zinc-600">auto-generated from set code + card #</span>
              </label>
              <input
                className={`${inputCls} cursor-not-allowed text-zinc-400`}
                value={form.sku}
                readOnly
                tabIndex={-1}
                placeholder="e.g. PKMN-JP-SV1-001"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-zinc-400 mb-1">Card Name <span className="text-red-500">*</span></label>
              <input className={inputCls} value={form.card_name} onChange={field('card_name')} required placeholder="e.g. Charizard ex" />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Set Name <span className="text-red-500">*</span></label>
              <SetCombobox
                value={form.set_name}
                selectedCode={form.set_code || undefined}
                inputCls={inputCls}
                placeholder="e.g. Obsidian Flames"
                options={setOptions}
                typedSetName={form.set_name}
                typedSetCode={form.set_code}
                onTyped={(name) => setForm((prev) => ({ ...prev, set_name: name }))}
                onSelect={(entry) => setForm((prev) => {
                  const next = { ...prev, set_name: entry.name, set_code: entry.code };
                  next.sku = autoSku(next.game, next.language, next.set_code, next.card_number, next.card_name, unnumbered, next.variant);
                  return next;
                })}
                onAddNew={handleAddNewSet}
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">Set Code</label>
              <SetCombobox
                value={form.set_code}
                inputCls={inputCls}
                placeholder="e.g. SV3"
                options={setOptions}
                typedSetName={form.set_name}
                typedSetCode={form.set_code}
                onTyped={(code) => setForm((prev) => {
                  const next = { ...prev, set_code: code };
                  next.sku = autoSku(next.game, next.language, next.set_code, next.card_number, next.card_name, unnumbered, next.variant);
                  return next;
                })}
                onSelect={(entry) => setForm((prev) => {
                  const next = { ...prev, set_code: entry.code, set_name: entry.name };
                  next.sku = autoSku(next.game, next.language, next.set_code, next.card_number, next.card_name, unnumbered, next.variant);
                  return next;
                })}
                onAddNew={handleAddNewSet}
              />
            </div>
            <div>
              {/* min-h keeps the input aligned with Rarity's on the same row
                  even when the helper hint wraps to two lines at narrow widths. */}
              <label className="block text-xs text-zinc-400 mb-1 min-h-[2.25rem]">
                Card # <span className="text-zinc-600 text-[10px] font-normal">(numerator only — e.g. 215, not 215/172)</span>
              </label>
              <input
                className={`${inputCls} ${unnumbered ? 'opacity-50' : ''}`}
                value={unnumbered ? '' : form.card_number}
                disabled={unnumbered}
                placeholder={unnumbered ? '—' : 'e.g. 215'}
                onChange={field('card_number')} />
              <label className="flex items-center gap-1 text-[10px] text-zinc-500 cursor-pointer select-none mt-1">
                <input
                  type="checkbox"
                  checked={unnumbered}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setUnnumbered(checked);
                    setForm((prev) => {
                      const next = checked ? { ...prev, card_number: '' } : prev;
                      next.sku = autoSku(next.game, next.language, next.set_code, next.card_number, next.card_name, checked, next.variant);
                      return next;
                    });
                  }}
                  className="accent-indigo-500" />
                no card # (unnumbered)
              </label>
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1 min-h-[2.25rem]">Rarity</label>
              <input className={inputCls} value={form.rarity} onChange={field('rarity')} placeholder="e.g. Special Illustration Rare" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-zinc-400 mb-1">
                Variant <span className="text-zinc-600 text-[10px] font-normal">— Unlimited implied by leaving blank</span>
              </label>
              <VariantCodeSelect
                game={form.game}
                value={form.variant || null}
                onChange={(code) => setForm(prev => {
                  const next = { ...prev, variant: code ?? '' };
                  next.sku = autoSku(next.game, next.language, next.set_code, next.card_number, next.card_name, unnumbered, next.variant);
                  return next;
                })}
              />
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
