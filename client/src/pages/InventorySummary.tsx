import React, { useState } from 'react';

function toTitleCase(s: string) {
  return s.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';
import { ColHeader, useColWidths, colMinWidth } from '../components/ui/TableHeader';
import { AddPartModal } from '../components/catalog/AddPartModal';
import toast from 'react-hot-toast';

interface SummaryRow {
  game: string;
  sku: string | null;
  card_name: string | null;
  set_name: string | null;
  set_code: string | null;
  card_number: string | null;
  rarity: string | null;
  variant: string | null;
  language: string;
  company: string;
  grade: number | null;
  grade_label: string | null;
  qty_total: number;
  qty_unsold: number;
  qty_sold: number;
  catalog_id: string | null;
}

// Group rows by SKU (or card_name if no SKU)
function groupRows(rows: SummaryRow[]) {
  const groups: Map<string, SummaryRow[]> = new Map();
  for (const row of rows) {
    const key = row.sku ?? `__nosku__${row.card_name ?? ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  return groups;
}

function totalQty(rows: SummaryRow[]) {
  return rows.reduce((s, r) => s + r.qty_total, 0);
}

type SortDir = 'asc' | 'desc';

type SortKey = 'sku' | 'card_name' | 'set_name' | 'language' | 'rarity' | 'company' | 'grade' | 'qty_total' | 'qty_unsold' | 'qty_sold';

function getSortValue(row: SummaryRow, col: SortKey): string | number | null {
  switch (col) {
    case 'sku': return row.sku ?? '';
    case 'card_name': return row.card_name ?? '';
    case 'set_name': return row.set_name ?? '';
    case 'language': return row.language;
    case 'rarity': return row.rarity ?? '';
    case 'company': return row.company;
    case 'grade': return row.grade ?? 0;
    case 'qty_total': return row.qty_total;
    case 'qty_unsold': return row.qty_unsold;
    case 'qty_sold': return row.qty_sold;
    default: return '';
  }
}

// ── Edit Part Modal ───────────────────────────────────────────────────────────

interface EditPartModalProps {
  row: SummaryRow;
  onClose: () => void;
}

function EditPartModal({ row, onClose }: EditPartModalProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    game:        row.game ?? 'pokemon',
    sku:         row.sku ?? '',
    card_name:   row.card_name ?? '',
    set_name:    row.set_name ?? '',
    set_code:    row.set_code ?? '',
    card_number: row.card_number ?? '',
    rarity:      row.rarity ?? '',
    variant:     row.variant ?? '',
    language:    row.language ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);

  const field = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [key]: e.target.value }));

  async function handleDelete() {
    if (!row.catalog_id) return;
    setDeleting(true);
    setError(null);
    try {
      await api.delete(`/catalog/${row.catalog_id}`);
      queryClient.invalidateQueries({ queryKey: ['inventory-summary'] });
      queryClient.invalidateQueries({ queryKey: ['empty-parts'] });
      onClose();
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as any).response?.data?.error ?? 'Failed to delete.'
        : 'Failed to delete.';
      setError(msg);
      setDeleteStep(0);
    } finally {
      setDeleting(false);
    }
  }

  async function handleSave() {
    if (!row.catalog_id) return;
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/catalog/${row.catalog_id}`, {
        game:        form.game ? form.game.toLowerCase().trim() : undefined,
        sku:         form.sku || undefined,
        card_name:   form.card_name || undefined,
        set_name:    form.set_name || undefined,
        set_code:    form.set_code || undefined,
        card_number: form.card_number || undefined,
        rarity:      form.rarity || null,
        variant:     form.variant || null,
        language:    form.language || undefined,
      });
      queryClient.invalidateQueries({ queryKey: ['inventory-summary'] });
      onClose();
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
        ? (err as any).response?.data?.error ?? 'Failed to save.'
        : 'Failed to save.';
      setError(msg);
      setConfirm(false);
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-zinc-100">Edit Part</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors"><X size={16} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Game</label>
            <GameSelect value={form.game} onChange={v => setForm(f => ({ ...f, game: v }))} />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Part #</label>
            <input className={inputCls} value={form.sku} onChange={field('sku')} />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-zinc-400 mb-1">Card Name</label>
            <input className={inputCls} value={form.card_name} onChange={field('card_name')} />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Set Name</label>
            <input className={inputCls} value={form.set_name} onChange={field('set_name')} />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Set Code</label>
            <input className={inputCls} value={form.set_code} onChange={field('set_code')} />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Card #</label>
            <input className={inputCls} value={form.card_number} onChange={field('card_number')} />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Language</label>
            <input className={inputCls} value={form.language} onChange={field('language')} />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Rarity</label>
            <input className={inputCls} value={form.rarity} onChange={field('rarity')} placeholder="optional" />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Variant</label>
            <input className={inputCls} value={form.variant} onChange={field('variant')} placeholder="optional" />
          </div>
        </div>

        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}

        <div className="flex items-center justify-between mt-5">
          {/* Delete flow */}
          <div className="flex items-center gap-2">
            {deleteStep === 0 && (
              <button
                onClick={() => setDeleteStep(1)}
                className="px-3 py-1.5 text-sm text-red-500 hover:text-red-400 transition-colors"
              >
                Delete
              </button>
            )}
            {deleteStep === 1 && (
              <>
                <span className="text-xs text-zinc-400">Delete this part?</span>
                <button onClick={() => setDeleteStep(0)} className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">No</button>
                <button
                  onClick={() => setDeleteStep(2)}
                  className="px-2 py-1 text-xs text-red-500 hover:text-red-400 transition-colors font-medium"
                >
                  Yes, Delete
                </button>
              </>
            )}
            {deleteStep === 2 && (
              <>
                <span className="text-xs text-red-400 font-medium">Cannot be undone. Confirm?</span>
                <button onClick={() => setDeleteStep(0)} className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">No</button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="px-2 py-1 text-xs bg-red-700 hover:bg-red-600 text-white rounded transition-colors font-medium disabled:opacity-50"
                >
                  {deleting ? 'Deleting…' : 'Confirm Delete'}
                </button>
              </>
            )}
          </div>

          {/* Save flow */}
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
              Cancel
            </button>
            {confirm ? (
              <>
                <span className="px-3 py-1.5 text-xs text-zinc-400 self-center">Save changes?</span>
                <button onClick={() => setConfirm(false)} className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
                  No
                </button>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Yes, Save'}
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setConfirm(true)}>
                Save Changes
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const PAGE_SIZE = 50;

function Pagination({ page, totalPages, total, onChange }: { page: number; totalPages: number; total: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-6 py-2.5 pr-40 border-t border-zinc-800 text-xs text-zinc-500 shrink-0">
      <span>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}</span>
      <div className="flex items-center gap-1">
        <button onClick={() => onChange(page - 1)} disabled={page === 1} className="px-2 py-1 rounded disabled:opacity-30 hover:text-zinc-300 transition-colors">←</button>
        <span className="px-2">{page} / {totalPages}</span>
        <button onClick={() => onChange(page + 1)} disabled={page === totalPages} className="px-2 py-1 rounded disabled:opacity-30 hover:text-zinc-300 transition-colors">→</button>
      </div>
    </div>
  );
}

// ── Game Dropdown ─────────────────────────────────────────────────────────────

interface CardGame { id: string | null; name: string }

function GameSelect({ value, onChange }: { value: string; onChange: (g: string) => void }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [newGame, setNewGame] = useState('');

  const { data: games = [] } = useQuery<CardGame[]>({
    queryKey: ['card-games'],
    queryFn: () => api.get('/sets/games').then(r => r.data),
  });

  const addMut = useMutation({
    mutationFn: (name: string) => api.post('/sets/games', { name }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['card-games'] });
      onChange(res.data.name);
      setNewGame('');
      setAdding(false);
    },
    onError: () => toast.error('Failed to add game'),
  });

  const selectCls = 'w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500';

  if (adding) {
    return (
      <div className="flex gap-2">
        <input autoFocus value={newGame} onChange={e => setNewGame(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && newGame.trim()) addMut.mutate(newGame.trim()); if (e.key === 'Escape') setAdding(false); }}
          placeholder="New game name…"
          className={selectCls} />
        <button onClick={() => newGame.trim() && addMut.mutate(newGame.trim())}
          disabled={!newGame.trim() || addMut.isPending}
          className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg transition-colors">
          Add
        </button>
        <button onClick={() => setAdding(false)} className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">Cancel</button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <select value={value} onChange={e => { if (e.target.value === '__add__') setAdding(true); else onChange(e.target.value); }} className={selectCls}>
        {games.map(g => (
          <option key={g.id ?? g.name} value={g.name}>{g.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
        ))}
        <option value="__add__">+ Add new game…</option>
      </select>
    </div>
  );
}

// ── Set Code Manager ─────────────────────────────────────────────────────────

interface StaticSet { game: string; language: string; set_code: string; names: string[] }
interface DbAlias { id: string; language: string; set_code: string; alias: string; set_name: string | null }

function SetCodeModal({ set: s, allAliases, onClose }: { set: StaticSet; allAliases: DbAlias[]; onClose: () => void }) {
  const qc = useQueryClient();
  const aliases = allAliases.filter(a => a.language === s.language && a.set_code === s.set_code);
  const [newAlias, setNewAlias] = useState('');
  const [adding, setAdding] = useState(false);
  const [deleteSteps, setDeleteSteps] = useState<Record<string, number>>({});
  const [deleteAllStep, setDeleteAllStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (!newAlias.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await api.post('/sets/aliases', { language: s.language, set_code: s.set_code, alias: newAlias.trim() });
      qc.invalidateQueries({ queryKey: ['set-aliases'] });
      setNewAlias('');
    } catch { setError('Failed to add alias.'); }
    finally { setAdding(false); }
  }

  async function handleDeleteAlias(id: string) {
    try {
      await api.delete(`/sets/aliases/${id}`);
      qc.invalidateQueries({ queryKey: ['set-aliases'] });
      setDeleteSteps(p => { const n = { ...p }; delete n[id]; return n; });
    } catch { setError('Delete failed.'); }
  }

  async function handleDeleteAll() {
    try {
      await Promise.all(aliases.map(a => api.delete(`/sets/aliases/${a.id}`)));
      qc.invalidateQueries({ queryKey: ['set-aliases'] });
      onClose();
    } catch { setError('Delete failed.'); setDeleteAllStep(0); }
  }

  function stepFor(id: string) { return deleteSteps[id] ?? 0; }
  function setStep(id: string, v: number) { setDeleteSteps(p => ({ ...p, [id]: v })); }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold text-zinc-100 font-mono">{s.set_code}</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors"><X size={16} /></button>
        </div>
        <p className="text-xs text-zinc-500 mb-4">{s.language === 'EN' ? 'English' : 'Japanese'}</p>

        <div className="mb-4">
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">Built-in Names</p>
          <div className="flex flex-wrap gap-1.5">
            {s.names.map((n, i) => (
              <span key={i} className="px-2 py-0.5 bg-zinc-800 text-zinc-400 text-xs rounded">{n}</span>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">Custom Aliases</p>
          {aliases.length === 0 ? (
            <p className="text-xs text-zinc-600 italic">None yet</p>
          ) : (
            <div className="space-y-1">
              {aliases.map(a => (
                <div key={a.id} className="flex items-center justify-between px-2 py-1 bg-zinc-800/50 rounded">
                  <span className="text-xs text-zinc-300">{a.alias}</span>
                  <div className="flex items-center gap-2 text-xs">
                    {stepFor(a.id) === 0 && (
                      <button onClick={() => setStep(a.id, 1)} className="text-zinc-600 hover:text-red-400 transition-colors">Delete</button>
                    )}
                    {stepFor(a.id) === 1 && (
                      <>
                        <span className="text-zinc-500">Remove alias?</span>
                        <button onClick={() => setStep(a.id, 0)} className="text-zinc-400 hover:text-zinc-200">No</button>
                        <button onClick={() => setStep(a.id, 2)} className="text-red-500 hover:text-red-400 font-medium">Yes</button>
                      </>
                    )}
                    {stepFor(a.id) === 2 && (
                      <>
                        <span className="text-red-400 font-medium">Cannot be undone.</span>
                        <button onClick={() => setStep(a.id, 0)} className="text-zinc-400 hover:text-zinc-200">No</button>
                        <button onClick={() => handleDeleteAlias(a.id)} className="text-red-500 hover:text-red-400 font-medium">Confirm</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mb-5">
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">Add New Set</p>
          <div className="flex gap-2">
            <input
              value={newAlias} onChange={e => setNewAlias(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder="e.g. star birth"
              className="flex-1 px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
            />
            <Button size="sm" onClick={handleAdd} disabled={!newAlias.trim() || adding}>Add</Button>
          </div>
        </div>

        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

        {aliases.length > 0 && (
          <div className="border-t border-zinc-800 pt-4 flex items-center gap-2 text-xs">
            {deleteAllStep === 0 && (
              <button onClick={() => setDeleteAllStep(1)} className="text-red-500/70 hover:text-red-400 transition-colors">
                Delete Set Code
              </button>
            )}
            {deleteAllStep === 1 && (
              <>
                <span className="text-zinc-400">Remove all {aliases.length} alias{aliases.length !== 1 ? 'es' : ''} for {s.set_code}?</span>
                <button onClick={() => setDeleteAllStep(0)} className="text-zinc-400 hover:text-zinc-200">No</button>
                <button onClick={() => setDeleteAllStep(2)} className="text-red-500 hover:text-red-400 font-medium">Yes, Delete</button>
              </>
            )}
            {deleteAllStep === 2 && (
              <>
                <span className="text-red-400 font-medium">Cannot be undone. Confirm?</span>
                <button onClick={() => setDeleteAllStep(0)} className="text-zinc-400 hover:text-zinc-200">No</button>
                <button onClick={handleDeleteAll} className="px-2 py-1 bg-red-700 hover:bg-red-600 text-white rounded transition-colors font-medium">
                  Confirm Delete
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AliasModal({ alias, onClose }: { alias: DbAlias; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ language: alias.language, set_code: alias.set_code, alias: alias.alias, set_name: alias.set_name ?? '' });
  const [deleteStep, setDeleteStep] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const field = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.delete(`/sets/aliases/${alias.id}`);
      qc.invalidateQueries({ queryKey: ['set-aliases'] });
      onClose();
    } catch { setError('Delete failed'); setDeleteStep(0); }
    finally { setDeleting(false); }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await api.put(`/sets/aliases/${alias.id}`, form);
      qc.invalidateQueries({ queryKey: ['set-aliases'] });
      onClose();
    } catch { setError('Failed to save.'); setConfirm(false); }
    finally { setSaving(false); }
  }

  const inputCls = 'w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-zinc-100">Edit Alias</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors"><X size={16} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Language</label>
            <select value={form.language} onChange={field('language')}
              className="w-full px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 focus:outline-none focus:border-indigo-500">
              <option value="EN">EN</option><option value="JP">JP</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Set Code</label>
            <input className={inputCls} value={form.set_code} onChange={field('set_code')} />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Alias (match string)</label>
            <input className={inputCls} value={form.alias} onChange={field('alias')} />
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Set Name (optional)</label>
            <input className={inputCls} value={form.set_name} onChange={field('set_name')} placeholder="optional" />
          </div>
        </div>

        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}

        <div className="flex items-center justify-between mt-5">
          <div className="flex items-center gap-2">
            {deleteStep === 0 && (
              <button onClick={() => setDeleteStep(1)} className="px-3 py-1.5 text-sm text-red-500 hover:text-red-400 transition-colors">Delete</button>
            )}
            {deleteStep === 1 && (
              <>
                <span className="text-xs text-zinc-400">Delete this alias?</span>
                <button onClick={() => setDeleteStep(0)} className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">No</button>
                <button onClick={() => setDeleteStep(2)} className="px-2 py-1 text-xs text-red-500 hover:text-red-400 transition-colors font-medium">Yes, Delete</button>
              </>
            )}
            {deleteStep === 2 && (
              <>
                <span className="text-xs text-red-400 font-medium">Cannot be undone. Confirm?</span>
                <button onClick={() => setDeleteStep(0)} className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 transition-colors">No</button>
                <button onClick={handleDelete} disabled={deleting}
                  className="px-2 py-1 text-xs bg-red-700 hover:bg-red-600 text-white rounded transition-colors font-medium disabled:opacity-50">
                  {deleting ? 'Deleting…' : 'Confirm Delete'}
                </button>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">Cancel</button>
            {confirm ? (
              <>
                <span className="px-3 py-1.5 text-xs text-zinc-400 self-center">Save changes?</span>
                <button onClick={() => setConfirm(false)} className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">No</button>
                <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Yes, Save'}</Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setConfirm(true)}>Save Changes</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SetCodeManager() {
  const qc = useQueryClient();
  const [fGame, setFGame] = useState<string | null>(null);
  const [lang, setLang] = useState<'EN' | 'JP'>('EN');
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({ language: 'EN', set_code: '', alias: '', set_name: '' });
  const [editingAlias, setEditingAlias] = useState<DbAlias | null>(null);
  const [editingSet, setEditingSet] = useState<StaticSet | null>(null);

  const { data: staticSets = [] } = useQuery<StaticSet[]>({
    queryKey: ['set-codes-static'],
    queryFn: () => api.get('/sets/codes').then(r => r.data),
  });
  const { data: dbAliases = [] } = useQuery<DbAlias[]>({
    queryKey: ['set-aliases'],
    queryFn: () => api.get('/sets/aliases').then(r => r.data),
  });
  const { data: games = [] } = useQuery<CardGame[]>({
    queryKey: ['card-games'],
    queryFn: () => api.get('/sets/games').then(r => r.data),
  });
  const gameOptions = games.map(g => g.name.toLowerCase());

  const addMut = useMutation({
    mutationFn: (body: typeof form) => api.post('/sets/aliases', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['set-aliases'] }); setShowAddForm(false); setForm({ language: 'EN', set_code: '', alias: '', set_name: '' }); },
    onError: () => toast.error('Failed to add alias'),
  });

  const filtered = staticSets
    .filter(s => s.language === lang)
    .filter(s => !fGame || s.game.toLowerCase() === fGame)
    .filter(s => !search || s.set_code.toLowerCase().includes(search.toLowerCase()) || s.names.some(n => n.includes(search.toLowerCase())));

  const customAliases = dbAliases.filter(a => a.language === lang);

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            <button onClick={() => setFGame(null)}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${!fGame ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
              All
            </button>
            {gameOptions.map(g => (
              <button key={g} onClick={() => setFGame(fGame === g ? null : g)}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-colors capitalize ${fGame === g ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                {g.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
          <div className="flex gap-4 border-l border-zinc-700 pl-3">
            {(['EN', 'JP'] as const).map(l => (
              <button key={l} onClick={() => setLang(l)}
                className={`pb-1 text-sm font-medium border-b-2 transition-colors ${lang === l ? 'border-indigo-500 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}>
                {l === 'EN' ? 'English' : 'Japanese'} <span className="text-zinc-600 text-xs ml-1">{staticSets.filter(s => s.language === l && (!fGame || s.game.toLowerCase() === fGame)).length}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {search && <button onClick={() => setSearch('')} className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300"><X size={12} /> Clear</button>}
          <input type="text" placeholder="Search code or alias…" value={search} onChange={e => setSearch(e.target.value)}
            className="px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 w-56" />
          <Button size="sm" onClick={() => setShowAddForm(v => !v)}><Plus size={14} /> Add New Set</Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {/* Add alias form */}
        {showAddForm && (
          <div className="mx-6 mt-4 p-4 bg-zinc-800/50 border border-zinc-700 rounded-lg">
            <p className="text-xs font-medium text-zinc-300 mb-3">Add Custom Alias</p>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Language</label>
                <select value={form.language} onChange={e => setForm(f => ({ ...f, language: e.target.value }))}
                  className="w-full text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 focus:outline-none focus:border-indigo-500">
                  <option value="EN">EN</option><option value="JP">JP</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Set Code</label>
                <input value={form.set_code} onChange={e => setForm(f => ({ ...f, set_code: e.target.value }))} placeholder="e.g. SWSH-SB"
                  className="w-full text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 focus:outline-none focus:border-indigo-500" />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Alias (match string)</label>
                <input value={form.alias} onChange={e => setForm(f => ({ ...f, alias: e.target.value }))} placeholder="e.g. star birth"
                  className="w-full text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 focus:outline-none focus:border-indigo-500" />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Set Name (optional)</label>
                <input value={form.set_name} onChange={e => setForm(f => ({ ...f, set_name: e.target.value }))} placeholder="e.g. Star Birth"
                  className="w-full text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 focus:outline-none focus:border-indigo-500" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-3">
              <Button size="sm" variant="secondary" onClick={() => setShowAddForm(false)}>Cancel</Button>
              <Button size="sm" onClick={() => addMut.mutate(form)} disabled={!form.set_code || !form.alias || addMut.isPending}>Save</Button>
            </div>
          </div>
        )}

        {/* Custom aliases */}
        {customAliases.length > 0 && (
          <div className="mx-6 mt-4 mb-2">
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">Custom Aliases</p>
            <table className="w-full text-xs border border-zinc-800 rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-zinc-800/60 text-zinc-400 uppercase tracking-wide text-[10px]">
                  <th className="px-3 py-2 text-left">Code</th>
                  <th className="px-3 py-2 text-left">Alias</th>
                  <th className="px-3 py-2 text-left">Set Name</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {customAliases.map(a => (
                  <tr key={a.id} className="hover:bg-zinc-800/30 cursor-pointer transition-colors" onClick={() => setEditingAlias(a)}>
                    <td className="px-3 py-1.5 font-mono text-indigo-300">{a.set_code}</td>
                    <td className="px-3 py-1.5 text-zinc-300">{a.alias}</td>
                    <td className="px-3 py-1.5 text-zinc-500">{a.set_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Static sets */}
        <div className="mx-6 mt-4 mb-6">
          <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">Static Sets</p>
          <table className="w-full text-xs border border-zinc-800 rounded-lg overflow-hidden">
            <thead>
              <tr className="bg-zinc-800/60 text-zinc-400 uppercase tracking-wide text-[10px]">
                <th className="px-3 py-2 text-left w-32">Code</th>
                <th className="px-3 py-2 text-left">Aliases / Match Strings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {filtered.map((s, i) => (
                <tr key={i} className="hover:bg-zinc-800/30 cursor-pointer transition-colors" onClick={() => setEditingSet(s)}>
                  <td className="px-3 py-1.5 font-mono text-indigo-300/80 align-top">{s.set_code}</td>
                  <td className="px-3 py-1.5 text-zinc-400 whitespace-normal">{s.names.join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editingAlias && <AliasModal alias={editingAlias} onClose={() => setEditingAlias(null)} />}
      {editingSet && <SetCodeModal set={editingSet} allAliases={dbAliases} onClose={() => setEditingSet(null)} />}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function InventorySummary() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [fGame, setFGame] = useState<string | null>(null);
  const [fLanguage, setFLanguage] = useState<string[] | null>(null);
  const [fRarity, setFRarity] = useState<string[] | null>(null);
  const [fCompany, setFCompany] = useState<string[] | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);
  const [editPart, setEditPart] = useState<SummaryRow | null>(null);
  const MINS = {
    sku:       colMinWidth('Part #',  true,  false),
    set:       colMinWidth('Set',     true,  false),
    card:      colMinWidth('Card',    true,  false),
    lang:      colMinWidth('Lang',    true,  true),
    rarity:    colMinWidth('Rarity',  true,  true),
    grader:    colMinWidth('Grader',  true,  true),
    grade:     colMinWidth('Grade',   true,  false),
    qty_total:  colMinWidth('Total',  true,  false),
    qty_unsold: colMinWidth('Unsold', true,  false),
    qty_sold:   colMinWidth('Sold',   true,  false),
  };
  const { rz, totalWidth } = useColWidths({ sku: Math.max(MINS.sku, 180), set: Math.max(MINS.set, 200), card: Math.max(MINS.card, 640), lang: Math.max(MINS.lang, 80), rarity: Math.max(MINS.rarity, 130), grader: Math.max(MINS.grader, 110), grade: Math.max(MINS.grade, 130), qty_total: Math.max(MINS.qty_total, 90), qty_unsold: Math.max(MINS.qty_unsold, 90), qty_sold: Math.max(MINS.qty_sold, 80) });

  const { data: gamesData = [] } = useQuery<CardGame[]>({
    queryKey: ['card-games'],
    queryFn: () => api.get('/sets/games').then(r => r.data),
  });
  const gameOptions = gamesData.map(g => g.name.toLowerCase());

  const { data: summaryData, isLoading: summaryLoading } = useQuery<{ data: SummaryRow[] }>({
    queryKey: ['inventory-summary'],
    queryFn: () => api.get('/catalog/inventory-summary').then((r) => r.data),
    enabled: !showEmpty,
  });

  const { data: emptyData, isLoading: emptyLoading } = useQuery<{ data: SummaryRow[] }>({
    queryKey: ['empty-parts'],
    queryFn: () => api.get('/catalog/empty-parts').then((r) => ({
      data: r.data.data.map((e: any) => ({
        ...e,
        catalog_id: e.id,
        company: '—',
        grade: null,
        grade_label: null,
        qty_total: 0,
        qty_unsold: 0,
        qty_sold: 0,
      })),
    })),
    enabled: showEmpty,
  });

  const rows = showEmpty ? (emptyData?.data ?? []) : (summaryData?.data ?? []);
  const isLoading = showEmpty ? emptyLoading : summaryLoading;

  // Derive filter options from data
  const languageOptions = [...new Set(rows.map((r) => r.language))].sort();
  const rarityOptions = [...new Set(rows.map((r) => r.rarity).filter(Boolean) as string[])].sort();
  const companyOptions = [...new Set(rows.map((r) => r.company))].sort();

  // Filter by search + column filters
  const filtered = rows.filter((r) => {
    const matchSearch = !search ||
      r.sku?.toLowerCase().includes(search.toLowerCase()) ||
      r.card_name?.toLowerCase().includes(search.toLowerCase()) ||
      r.set_name?.toLowerCase().includes(search.toLowerCase());

    const matchGame = !fGame || (r.game ?? 'pokemon').toLowerCase() === fGame;
    const matchLang = fLanguage === null || fLanguage.length === 0 || fLanguage.includes(r.language);
    const matchRarity = fRarity === null || fRarity.length === 0 || fRarity.includes(r.rarity ?? '');
    const matchCompany = fCompany === null || fCompany.length === 0 || fCompany.includes(r.company);

    return matchSearch && matchGame && matchLang && matchRarity && matchCompany;
  });

  // Client-side sort at SummaryRow level before grouping
  const sortedFiltered = sortCol
    ? [...filtered].sort((a, b) => {
        const av = getSortValue(a, sortCol as SortKey);
        const bv = getSortValue(b, sortCol as SortKey);
        if (av === bv) return 0;
        if (av == null || av === '') return 1;
        if (bv == null || bv === '') return -1;
        const cmp = av < bv ? -1 : 1;
        return sortDir === 'asc' ? cmp : -cmp;
      })
    : filtered;

  const groups = groupRows(sortedFiltered);
  // Preserve sort order from sortedFiltered by using insertion order
  const sortedKeys = sortCol
    ? [...groups.keys()]
    : [...groups.keys()].sort();

  const toggleGroup = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const totalCards = rows.reduce((s, r) => s + r.qty_total, 0);

  const handleSort = (col: string) => {
    setSortCol((prev) => {
      if (prev === col) return prev;
      return col;
    });
    setSortDir((prev) => sortCol === col ? (prev === 'asc' ? 'desc' : 'asc') : 'asc');
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(sortedKeys.length / PAGE_SIZE));
  const pagedKeys = sortedKeys.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const sh = { sortCol, sortDir, onSort: handleSort };

  const [activeTab, setActiveTab] = useState<'parts' | 'sets'>('parts');

  const tabBar = (
    <div className="flex gap-6 px-6 pt-4 border-b border-zinc-800 shrink-0">
      {(['parts', 'sets'] as const).map(t => (
        <button key={t} onClick={() => setActiveTab(t)}
          className={`pb-3 text-sm font-medium border-b-2 transition-colors ${activeTab === t ? 'border-indigo-500 text-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}>
          {t === 'parts' ? 'Part Numbers' : 'Set Codes'}
        </button>
      ))}
    </div>
  );

  if (activeTab === 'sets') {
    return (
      <div className="flex flex-col h-full">
        {tabBar}
        <div className="flex-1 overflow-auto">
          <SetCodeManager />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {tabBar}
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">Part Numbers</h1>
          {!isLoading && (
            <p className="text-xs text-zinc-500 mt-0.5">
              {showEmpty
                ? `${sortedKeys.length.toLocaleString()} catalog entries with no inventory`
                : `${totalCards.toLocaleString()} cards · ${sortedKeys.length.toLocaleString()} unique parts`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {(fGame !== null || fLanguage !== null || fRarity !== null || fCompany !== null || search) && (
            <button
              onClick={() => { setFGame(null); setFLanguage(null); setFRarity(null); setFCompany(null); setSearch(''); setPage(1); }}
              className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300"
            >
              <X size={12} /> Clear filters
            </button>
          )}
          <div className="flex gap-1">
            <button onClick={() => { setFGame(null); setPage(1); }}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${!fGame ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
              All
            </button>
            {gameOptions.map(g => (
              <button key={g} onClick={() => { setFGame(fGame === g ? null : g); setPage(1); }}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-colors capitalize ${fGame === g ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}>
                {g.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
          <Button size="sm" variant={showEmpty ? 'primary' : 'secondary'} onClick={() => setShowEmpty(v => !v)}>
            {showEmpty ? 'In Inventory' : 'Show Empty'}
          </Button>
          <input
            type="text"
            placeholder="Search SKU, card, set…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 w-64"
          />
          <Button size="sm" onClick={() => setShowAddModal(true)}>
            <Plus size={14} /> Add Part
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-zinc-600 text-sm">Loading…</div>
        ) : !sortedKeys.length ? (
          <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">No inventory found.</div>
        ) : (
          <table className="text-xs whitespace-nowrap border-collapse" style={{ tableLayout: 'fixed', width: totalWidth + 'px' }}>
            <thead className="sticky top-0 bg-zinc-950 z-10">
              <tr className="border-b border-zinc-700 text-zinc-300 uppercase tracking-wide">
                <ColHeader label="Part #"     col="sku"        {...sh} {...rz('sku')} minWidth={MINS.sku} />
                <ColHeader label="Set"        col="set_name"   {...sh} {...rz('set')} minWidth={MINS.set} />
                <ColHeader label="Card"       col="card_name"  {...sh} {...rz('card')} minWidth={MINS.card} />
                <ColHeader label="Lang"       col="language"   {...sh} {...rz('lang')} minWidth={MINS.lang}
                  filterOptions={languageOptions} filterSelected={fLanguage} onFilterChange={(v) => { setFLanguage(v); setPage(1); }} />
                <ColHeader label="Rarity"     col="rarity"     {...sh} {...rz('rarity')} minWidth={MINS.rarity}
                  filterOptions={rarityOptions} filterSelected={fRarity} onFilterChange={(v) => { setFRarity(v); setPage(1); }} />
                <ColHeader label="Grader"     col="company"    {...sh} {...rz('grader')} minWidth={MINS.grader}
                  filterOptions={companyOptions} filterSelected={fCompany} onFilterChange={(v) => { setFCompany(v); setPage(1); }} />
                <ColHeader label="Grade"      col="grade"      {...sh} {...rz('grade')} minWidth={MINS.grade} />
                <ColHeader label="Total"   col="qty_total"  {...sh} {...rz('qty_total')}  align="right" minWidth={MINS.qty_total} />
                <ColHeader label="Unsold"  col="qty_unsold" {...sh} {...rz('qty_unsold')} align="right" minWidth={MINS.qty_unsold} />
                <ColHeader label="Sold"    col="qty_sold"   {...sh} {...rz('qty_sold')}   align="right" minWidth={MINS.qty_sold} />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {pagedKeys.map((key) => {
                const groupRows = groups.get(key)!;
                const isNoSku = key.startsWith('__nosku__');
                const sku = isNoSku ? null : key;
                const displayName = groupRows[0].card_name ?? '—';
                const setName = toTitleCase(groupRows[0].set_name ?? groupRows[0].set_code ?? '—');
                const lang = groupRows[0].language;
                const rarity = groupRows[0].rarity ?? '—';
                const isExpanded = expanded.has(key);
                const qty = totalQty(groupRows);

                // Single grade line — no expansion needed
                if (groupRows.length === 1) {
                  const r = groupRows[0];
                  return (
                    <tr key={key} className="hover:bg-zinc-800/25">
                      <td className="px-3 py-1.5 font-mono text-[11px]">
                        {r.catalog_id ? (
                          <button onClick={() => setEditPart(r)} className="text-indigo-400 hover:text-indigo-300 hover:underline text-left">
                            {sku ?? <span className="text-zinc-600 italic">unlinked</span>}
                          </button>
                        ) : (
                          <span className="text-zinc-600 italic">unlinked</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-zinc-400 truncate">{setName}</td>
                      <td className="px-3 py-1.5 text-zinc-200 whitespace-normal break-words">
                        {displayName}
                      </td>
                      <td className="px-3 py-1.5 text-zinc-500">{lang}</td>
                      <td className="px-3 py-1.5 text-zinc-500">{rarity}</td>
                      <td className="px-3 py-1.5 text-zinc-400">{r.company}</td>
                      <td className="px-3 py-1.5 text-zinc-300 font-medium">{r.grade_label ?? (r.grade != null ? String(r.grade) : '—')}</td>
                      <td className="px-3 py-1.5 text-right text-zinc-300">{r.qty_total}</td>
                      <td className="px-3 py-1.5 text-right text-zinc-300">{r.qty_unsold}</td>
                      <td className="px-3 py-1.5 text-right text-zinc-400">{r.qty_sold}</td>
                    </tr>
                  );
                }

                // Multiple grade lines — collapsible
                return [
                  // Summary row
                  <tr
                    key={`${key}-summary`}
                    className="hover:bg-zinc-800/40 cursor-pointer bg-zinc-900/30"
                    onClick={() => toggleGroup(key)}
                  >
                    <td className="px-3 py-1.5 font-mono text-[11px]">
                      <span className="inline-flex items-center gap-1">
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        {groupRows[0].catalog_id ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditPart(groupRows[0]); }}
                            className="text-indigo-400 hover:text-indigo-300 hover:underline text-left"
                          >
                            {sku ?? <span className="text-zinc-600 italic">unlinked</span>}
                          </button>
                        ) : (
                          <span className="text-zinc-600 italic">unlinked</span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-zinc-400 truncate">{setName}</td>
                    <td className="px-3 py-1.5 text-zinc-200 font-medium whitespace-normal break-words">
                      {displayName}
                    </td>
                    <td className="px-3 py-1.5 text-zinc-500">{lang}</td>
                    <td className="px-3 py-1.5 text-zinc-500">{rarity}</td>
                    <td className="px-3 py-1.5 text-zinc-600">{groupRows.map((r) => r.company).filter((v, i, a) => a.indexOf(v) === i).join(', ')}</td>
                    <td className="px-3 py-1.5 text-zinc-600">{groupRows.length} grades</td>
                    <td className="px-3 py-1.5 text-right text-zinc-200 font-semibold">{qty}</td>
                    <td className="px-3 py-1.5 text-right text-zinc-200 font-semibold">{groupRows.reduce((s, r) => s + r.qty_unsold, 0)}</td>
                    <td className="px-3 py-1.5 text-right text-zinc-400">{groupRows.reduce((s, r) => s + r.qty_sold, 0)}</td>
                  </tr>,
                  // Expanded grade rows
                  ...(isExpanded
                    ? groupRows.map((r, idx) => (
                        <tr key={`${key}-grade-${idx}`} className="hover:bg-zinc-800/15">
                          <td className="px-3 py-1 pl-8 text-zinc-700 font-mono text-[10px]">↳</td>
                          <td className="px-3 py-1 text-zinc-600">{setName}</td>
                          <td className="px-3 py-1 text-zinc-400 whitespace-normal break-words">{r.card_name ?? '—'}</td>
                          <td className="px-3 py-1 text-zinc-600">{r.language}</td>
                          <td className="px-3 py-1 text-zinc-600">{r.rarity ?? '—'}</td>
                          <td className="px-3 py-1 text-zinc-400">{r.company}</td>
                          <td className="px-3 py-1 text-zinc-300">{r.grade_label ?? (r.grade != null ? String(r.grade) : '—')}</td>
                          <td className="px-3 py-1 text-right text-zinc-400">{r.qty_total}</td>
                          <td className="px-3 py-1 text-right text-zinc-400">{r.qty_unsold}</td>
                          <td className="px-3 py-1 text-right text-zinc-400">{r.qty_sold}</td>
                        </tr>
                      ))
                    : []),
                ];
              })}
            </tbody>
          </table>
        )}
      </div>

      <Pagination page={page} totalPages={totalPages} total={sortedKeys.length} onChange={setPage} />

      {/* Add Set Alias Modal */}
      {showAddModal && <AddPartModal onClose={() => setShowAddModal(false)} />}
      {editPart && <EditPartModal row={editPart} onClose={() => setEditPart(null)} />}
    </div>
  );
}
