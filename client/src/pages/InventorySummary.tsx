import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';
import { ColHeader, useColWidths } from '../components/ui/TableHeader';

interface SummaryRow {
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
          <div className="col-span-2">
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

// ── Add Part Number Modal ─────────────────────────────────────────────────────

interface AddPartModalProps {
  onClose: () => void;
}

const GAMES = [
  { value: 'pokemon',   label: 'Pokémon' },
  { value: 'one_piece', label: 'One Piece' },
  { value: 'old_maid',  label: 'Old Maid' },
];

function AddPartModal({ onClose }: AddPartModalProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    game: 'pokemon',
    sku: '',
    card_name: '',
    set_name: '',
    set_code: '',
    card_number: '',
    language: 'JP',
    rarity: '',
    variant: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skuManual, setSkuManual] = useState(false);

  function autoSku(game: string, lang: string, setCode: string, cardNum: string) {
    if (!setCode && !cardNum) return '';
    const prefix = game === 'one_piece' ? 'OP' : game === 'old_maid' ? 'OM' : 'PKMN';
    const parts = [prefix, lang.toUpperCase(), setCode.toUpperCase(), cardNum.toUpperCase()].filter(Boolean);
    return parts.join('-');
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/catalog', {
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
      onClose();
    } catch (err: unknown) {
      const msg = err && typeof err === 'object' && 'response' in err
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

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
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
              <input className={inputCls} value={form.set_code} onChange={field('set_code')} placeholder="e.g. SV3" />
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
            <Button size="sm" type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Add Part'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function InventorySummary() {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [fLanguage, setFLanguage] = useState<string[] | null>(null);
  const [fRarity, setFRarity] = useState<string[] | null>(null);
  const [fCompany, setFCompany] = useState<string[] | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);
  const [editPart, setEditPart] = useState<SummaryRow | null>(null);
  const { rz, totalWidth } = useColWidths({ sku: 180, set: 200, card: 480, lang: 80, rarity: 130, grader: 110, grade: 130, qty_total: 90, qty_unsold: 90, qty_sold: 80 });

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

    const matchLang = fLanguage === null || fLanguage.length === 0 || fLanguage.includes(r.language);
    const matchRarity = fRarity === null || fRarity.length === 0 || fRarity.includes(r.rarity ?? '');
    const matchCompany = fCompany === null || fCompany.length === 0 || fCompany.includes(r.company);

    return matchSearch && matchLang && matchRarity && matchCompany;
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
  };

  const sh = { sortCol, sortDir, onSort: handleSort };

  return (
    <div className="flex flex-col h-full">
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
          {(fLanguage !== null || fRarity !== null || fCompany !== null || search) && (
            <button
              onClick={() => { setFLanguage(null); setFRarity(null); setFCompany(null); setSearch(''); }}
              className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300"
            >
              <X size={12} /> Clear filters
            </button>
          )}
          <Button size="sm" variant={showEmpty ? 'primary' : 'secondary'} onClick={() => setShowEmpty(v => !v)}>
            {showEmpty ? 'In Inventory' : 'Show Empty'}
          </Button>
          <input
            type="text"
            placeholder="Search SKU, card, set…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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
                <ColHeader label="Part #"     col="sku"        {...sh} {...rz('sku')} />
                <ColHeader label="Set"        col="set_name"   {...sh} {...rz('set')} />
                <ColHeader label="Card"       col="card_name"  {...sh} {...rz('card')} />
                <ColHeader label="Lang"       col="language"   {...sh} {...rz('lang')}
                  filterOptions={languageOptions} filterSelected={fLanguage} onFilterChange={setFLanguage} />
                <ColHeader label="Rarity"     col="rarity"     {...sh} {...rz('rarity')}
                  filterOptions={rarityOptions} filterSelected={fRarity} onFilterChange={setFRarity} />
                <ColHeader label="Grader"     col="company"    {...sh} {...rz('grader')}
                  filterOptions={companyOptions} filterSelected={fCompany} onFilterChange={setFCompany} />
                <ColHeader label="Grade"      col="grade"      {...sh} {...rz('grade')} />
                <ColHeader label="Total"   col="qty_total"  {...sh} {...rz('qty_total')}  align="right" />
                <ColHeader label="Unsold"  col="qty_unsold" {...sh} {...rz('qty_unsold')} align="right" />
                <ColHeader label="Sold"    col="qty_sold"   {...sh} {...rz('qty_sold')}   align="right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {sortedKeys.map((key) => {
                const groupRows = groups.get(key)!;
                const isNoSku = key.startsWith('__nosku__');
                const sku = isNoSku ? null : key;
                const displayName = groupRows[0].card_name ?? '—';
                const setName = groupRows[0].set_name ?? groupRows[0].set_code ?? '—';
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
                      <td className="px-3 py-1.5 text-zinc-200 truncate" title={displayName}>
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
                    <td className="px-3 py-1.5 text-zinc-200 font-medium truncate" title={displayName}>
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
                          <td className="px-3 py-1 text-zinc-400">{r.card_name ?? '—'}</td>
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

      {/* Add Set Alias Modal */}
      {showAddModal && <AddPartModal onClose={() => setShowAddModal(false)} />}
      {editPart && <EditPartModal row={editPart} onClose={() => setEditPart(null)} />}
    </div>
  );
}
