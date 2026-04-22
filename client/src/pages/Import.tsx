import React, { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, Download, FileText, Loader2, CheckCircle, XCircle, Sparkles, AlertTriangle, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

// ─── Types ────────────────────────────────────────────────────────────────────

type ImportType = 'graded' | 'raw_purchase' | 'bulk_sale' | 'expenses';

interface AmbiguousRow {
  row: number;
  card_name: string;
  set_name: string | null;
  en_code: string | null;
  en_set: string | null;
  jp_code: string | null;
  jp_set: string | null;
}

interface ImportPreview {
  id: string;
  original_filename: string;
  columns: string[];
  total_rows: number;
  preview_rows: Record<string, string>[];
  detected_mapping: Record<string, string>;
  detected_type: ImportType | 'unknown';
  detected_confidence: 'high' | 'medium' | 'low';
  detected_reasoning: string;
  import_type: string;
}

interface ImportRecord {
  id: string;
  import_type: string;
  filename: string;
  status: string;
  row_count: number;
  imported_count: number;
  error_count: number;
  created_at: string;
  completed_at: string | null;
}

interface ImportResult {
  imported_count: number;
  error_count: number;
  errors?: { row: number; message: string }[];
}

// ─── Config ───────────────────────────────────────────────────────────────────

const IMPORT_TYPES: { key: ImportType; label: string }[] = [
  { key: 'graded',       label: 'Graded Cards' },
  { key: 'raw_purchase', label: 'Raw Purchases' },
  { key: 'bulk_sale',    label: 'Bulk Sales' },
  { key: 'expenses',     label: 'Expenses' },
];

// All fields the system can accept — used to populate mapping dropdowns.
// Organized by category for readability in the UI.
const ALL_TARGET_FIELDS: { group: string; fields: string[] }[] = [
  { group: 'Card',     fields: ['card_name', 'set_name', 'card_number', 'card_game', 'language', 'condition', 'notes'] },
  { group: 'Graded',   fields: ['cert_number', 'grade', 'company', 'grading_cost'] },
  { group: 'Purchase', fields: ['purchase_cost', 'cost', 'quantity', 'currency', 'purchased_at', 'order_number', 'source', 'type'] },
  { group: 'Sale',     fields: ['sold_at', 'sale_price', 'after_fees', 'net', 'platform_fees', 'shipping_cost', 'platform', 'unique_id', 'listing_url'] },
  { group: 'Listing',  fields: ['is_listed', 'list_price', 'listed_at'] },
  { group: 'Expense',  fields: ['description', 'amount', 'date', 'link'] },
  { group: 'Bulk Sale',fields: ['identifier'] },
];

const CONFIDENCE_COLORS: Record<string, string> = {
  high:   'text-green-400',
  medium: 'text-yellow-400',
  low:    'text-orange-400',
};

async function downloadTemplate(type: ImportType) {
  const res = await api.get(`/import/template/${type}`, { responseType: 'blob' });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${type}-template.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusBadge(status: string) {
  if (status === 'completed') return <span className="text-xs text-emerald-400">Completed</span>;
  if (status === 'completed_with_errors') return <span className="text-xs text-amber-400">With errors</span>;
  if (status === 'failed') return <span className="text-xs text-red-400">Failed</span>;
  return <span className="text-xs text-zinc-500">{status}</span>;
}

// ─── Inline Set Creator (used inside resolution modal) ────────────────────────

const NEW_LANG_SENTINEL = '__new__';

// All known Pokémon TCG release languages (shared with Set Codes page)
const KNOWN_POKEMON_LANGUAGES = [
  { code: 'EN', name: 'English' },
  { code: 'JP', name: 'Japanese' },
  { code: 'KR', name: 'Korean' },
  { code: 'ZH-TW', name: 'Chinese (Traditional)' },
  { code: 'ZH-CN', name: 'Chinese (Simplified)' },
  { code: 'FR', name: 'French' },
  { code: 'DE', name: 'German' },
  { code: 'IT', name: 'Italian' },
  { code: 'ES', name: 'Spanish' },
  { code: 'PT', name: 'Portuguese' },
  { code: 'PL', name: 'Polish' },
  { code: 'NL', name: 'Dutch' },
  { code: 'RU', name: 'Russian' },
  { code: 'TH', name: 'Thai' },
  { code: 'ID', name: 'Indonesian' },
];

const NEW_LANG_SENTINEL_IMPORT = '__new_lang__';

function InlineSetCreator({ onCreated }: { onCreated: (lang: string) => void }) {
  const qc = useQueryClient();
  const [langSelection, setLangSelection] = useState('');
  const [showCustomLang, setShowCustomLang] = useState(false);
  const [customLang, setCustomLang] = useState({ code: '', name: '' });
  const [form, setForm] = useState({ set_code: '', alias: '', set_name: '' });
  const [saving, setSaving] = useState(false);

  function handleLangChange(val: string) {
    if (val === NEW_LANG_SENTINEL_IMPORT) {
      setShowCustomLang(true);
      setLangSelection('');
    } else {
      setShowCustomLang(false);
      setLangSelection(val);
    }
  }

  async function handleSave() {
    const lang = langSelection || customLang.code.toUpperCase();
    if (!lang || !form.set_code || !form.alias) return;
    setSaving(true);
    try {
      // If it's a custom language not in the known list, register it first
      if (showCustomLang && customLang.code && customLang.name) {
        await api.post('/sets/languages', { code: customLang.code.toUpperCase(), name: customLang.name });
        qc.invalidateQueries({ queryKey: ['card-languages'] });
      }
      await api.post('/sets/aliases', { ...form, language: lang });
      qc.invalidateQueries({ queryKey: ['set-aliases'] });
      toast.success(`Set ${form.set_code} registered for ${lang}`);
      onCreated(lang);
    } catch {
      toast.error('Failed to register set');
    } finally {
      setSaving(false);
    }
  }

  const fi = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [key]: e.target.value }));

  const activeLang = langSelection || (showCustomLang ? customLang.code.toUpperCase() : '');

  return (
    <div className="mt-3 p-3 bg-zinc-800/60 border border-zinc-700 rounded-lg space-y-2">
      <p className="text-xs font-medium text-zinc-300">Register a new card set</p>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-[10px] text-zinc-500 mb-1">Language</label>
          <select value={showCustomLang ? NEW_LANG_SENTINEL_IMPORT : langSelection} onChange={e => handleLangChange(e.target.value)}
            className="w-full text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 focus:outline-none focus:border-indigo-500">
            <option value="">Select…</option>
            {KNOWN_POKEMON_LANGUAGES.map(l => (
              <option key={l.code} value={l.code}>{l.code} — {l.name}</option>
            ))}
            <option value={NEW_LANG_SENTINEL_IMPORT}>+ Other language…</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-zinc-500 mb-1">Set Code</label>
          <input value={form.set_code} onChange={fi('set_code')} placeholder="e.g. SV1"
            className="w-full text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 focus:outline-none focus:border-indigo-500" />
        </div>
        <div>
          <label className="block text-[10px] text-zinc-500 mb-1">Alias (match string)</label>
          <input value={form.alias} onChange={fi('alias')} placeholder="e.g. scarlet ex kr"
            className="w-full text-xs bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 focus:outline-none focus:border-indigo-500" />
        </div>
      </div>
      {showCustomLang && (
        <div className="grid grid-cols-2 gap-2 p-2 bg-zinc-900 rounded border border-zinc-700">
          <div>
            <label className="block text-[10px] text-zinc-500 mb-1">Full Language Name</label>
            <input value={customLang.name} onChange={e => setCustomLang(f => ({ ...f, name: e.target.value }))} placeholder="e.g. French"
              className="w-full text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 focus:outline-none focus:border-indigo-500" />
          </div>
          <div>
            <label className="block text-[10px] text-zinc-500 mb-1">Abbreviation</label>
            <input value={customLang.code} onChange={e => setCustomLang(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="e.g. FR" maxLength={10}
              className="w-full text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 focus:outline-none focus:border-indigo-500 uppercase" />
          </div>
        </div>
      )}
      <div className="flex justify-end">
        <button onClick={handleSave} disabled={!activeLang || !form.set_code || !form.alias || saving}
          className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-3 py-1.5 rounded font-medium transition-colors">
          {saving ? 'Saving…' : 'Save Set'}
        </button>
      </div>
    </div>
  );
}

// ─── Language Resolution Modal ────────────────────────────────────────────────

// Group key for deduplication
function groupKey(r: AmbiguousRow) {
  return `${r.card_name}|${r.en_code ?? ''}|${r.jp_code ?? ''}`;
}

interface RowGroup {
  key: string;
  representative: AmbiguousRow;
  rowNumbers: number[];
}

function buildGroups(rows: AmbiguousRow[]): RowGroup[] {
  const map = new Map<string, RowGroup>();
  for (const r of rows) {
    const k = groupKey(r);
    if (map.has(k)) {
      map.get(k)!.rowNumbers.push(r.row);
    } else {
      map.set(k, { key: k, representative: r, rowNumbers: [r.row] });
    }
  }
  return Array.from(map.values());
}

function LanguageResolutionModal({
  rows,
  onResolve,
  onCancel,
}: {
  rows: AmbiguousRow[];
  onResolve: (overrides: Record<number, string>) => void;
  onCancel: () => void;
}) {
  const groups = buildGroups(rows);

  // selections keyed by group key
  const [selections, setSelections] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    groups.forEach((g) => { init[g.key] = 'EN'; });
    return init;
  });
  // Track which group has the inline set creator open
  const [creatorGroup, setCreatorGroup] = useState<string | null>(null);

  const allResolved = groups.every((g) => selections[g.key] && selections[g.key] !== NEW_LANG_SENTINEL);

  function handleLangChange(key: string, val: string) {
    if (val === NEW_LANG_SENTINEL) {
      setCreatorGroup(key);
      setSelections(s => ({ ...s, [key]: NEW_LANG_SENTINEL }));
    } else {
      setCreatorGroup(null);
      setSelections(s => ({ ...s, [key]: val }));
    }
  }

  function handleConfirm() {
    const overrides: Record<number, string> = {};
    groups.forEach((g) => {
      const lang = selections[g.key];
      g.rowNumbers.forEach((rowNum) => { overrides[rowNum] = lang; });
    });
    onResolve(overrides);
  }

  const uniqueCount = groups.length;
  const totalCount = rows.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl">
        <div className="p-5 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-100">Resolve Language Ambiguity</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            {totalCount} card{totalCount !== 1 ? 's' : ''} matched sets in multiple languages
            {uniqueCount < totalCount ? ` — grouped into ${uniqueCount} unique card${uniqueCount !== 1 ? 's' : ''}` : ''}.
            Select the correct language for each.
          </p>
          <p className="text-xs text-zinc-600 mt-1.5">
            Only languages with registered card sets are shown. Select "New language…" to register a card set for a different language before importing.
          </p>
        </div>
        <div className="overflow-y-auto flex-1 divide-y divide-zinc-800">
          {groups.map((g) => {
            const r = g.representative;
            const options: { lang: string; code: string; set: string | null }[] = [];
            if (r.en_code) options.push({ lang: 'EN', code: r.en_code, set: r.en_set });
            if (r.jp_code) options.push({ lang: 'JP', code: r.jp_code, set: r.jp_set });
            const isCreating = creatorGroup === g.key;
            return (
              <div key={g.key} className="px-4 py-3">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <p className="text-sm text-zinc-200 break-words">{r.card_name}</p>
                      {g.rowNumbers.length > 1 && (
                        <span className="shrink-0 text-xs font-medium text-indigo-400 bg-indigo-500/15 px-1.5 py-0.5 rounded">
                          ×{g.rowNumbers.length}
                        </span>
                      )}
                    </div>
                    {r.set_name && <p className="text-xs text-zinc-500 mt-0.5">Set: {r.set_name}</p>}
                    <div className="flex gap-4 mt-1.5 text-xs text-zinc-500">
                      {options.map((o) => (
                        <span key={o.lang}>{o.lang}: <span className="text-zinc-300">{o.code} — {o.set}</span></span>
                      ))}
                    </div>
                  </div>
                  <select
                    value={selections[g.key] ?? options[0]?.lang ?? 'EN'}
                    onChange={(e) => handleLangChange(g.key, e.target.value)}
                    className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 focus:outline-none focus:border-indigo-500 shrink-0"
                  >
                    {options.map((o) => (
                      <option key={o.lang} value={o.lang}>{o.lang} — {o.code}</option>
                    ))}
                    <option value={NEW_LANG_SENTINEL}>New language…</option>
                  </select>
                </div>
                {isCreating && (
                  <InlineSetCreator
                    onCreated={(lang) => {
                      setCreatorGroup(null);
                      setSelections(s => ({ ...s, [g.key]: lang }));
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="p-4 border-t border-zinc-800 flex justify-end gap-3">
          <button onClick={onCancel} className="text-xs text-zinc-500 hover:text-zinc-300 px-3 py-1.5">Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={!allResolved}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-1.5 rounded font-medium transition-colors"
          >
            Confirm & Import
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Upload zone ──────────────────────────────────────────────────────────────

function UploadZone({ onFile }: { onFile: (file: File) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    onFile(file);
  }

  return (
    <div
      className="border-2 border-dashed border-zinc-700 rounded-xl p-12 text-center cursor-pointer hover:border-indigo-500 transition-colors"
      onClick={() => fileRef.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
      }}
    >
      <Upload size={28} className="mx-auto text-zinc-600 mb-3" />
      <p className="text-sm font-medium text-zinc-300">Click or drag to upload</p>
      <p className="text-xs text-zinc-500 mt-1">CSV, Excel (.xlsx, .xls) — any format, any columns</p>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx,.xls,.ods"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
    </div>
  );
}

// ─── Unlinked Resolution Modal ────────────────────────────────────────────────

interface UnlinkedRow {
  row: number;
  card_name: string;
  set_name: string | null;
  game_hint: string;
}

interface CatalogOverride {
  game: string;
  set_code: string;
  set_name: string;
  language: string;
}

const KNOWN_GAMES = [
  { value: 'pokemon',   label: 'Pokémon' },
  { value: 'one_piece', label: 'One Piece' },
  { value: 'magic',     label: 'Magic: The Gathering' },
  { value: 'yugioh',    label: 'Yu-Gi-Oh!' },
  { value: 'other',     label: 'Other' },
];

function UnlinkedResolutionModal({
  rows,
  onResolve,
  onCancel,
}: {
  rows: UnlinkedRow[];
  onResolve: (overrides: Record<string, CatalogOverride>) => void;
  onCancel: () => void;
}) {
  // Deduplicate by card_name|set_name
  const groups = React.useMemo(() => {
    const map = new Map<string, UnlinkedRow>();
    for (const r of rows) {
      const key = `${r.card_name}|${r.set_name ?? ''}`;
      if (!map.has(key)) map.set(key, r);
    }
    return Array.from(map.entries()).map(([key, row]) => ({ key, row }));
  }, [rows]);

  const [overrides, setOverrides] = useState<Record<string, CatalogOverride>>(() => {
    const init: Record<string, CatalogOverride> = {};
    groups.forEach(({ key, row }) => {
      const langHint = /japanese/i.test(row.card_name) || /japanese/i.test(row.set_name ?? '') ? 'JP' : 'EN';
      init[key] = { game: row.game_hint, set_code: '', set_name: row.set_name ?? '', language: langHint };
    });
    return init;
  });

  function setField(key: string, field: keyof CatalogOverride, value: string) {
    setOverrides(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  }

  const allFilled = groups.every(({ key }) => overrides[key]?.set_code?.trim() && overrides[key]?.language?.trim());

  function handleConfirm() {
    const resolved: Record<string, CatalogOverride> = {};
    for (const { key } of groups) {
      resolved[key] = overrides[key];
    }
    onResolve(resolved);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl">
        <div className="p-5 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-100">Unlinked Cards — Assign Set & Game</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            {groups.length} card{groups.length !== 1 ? 's' : ''} couldn't be matched to a known set.
            Assign a set code and game to link them, or skip to import without linking.
          </p>
          <p className="text-xs text-zinc-600 mt-1.5">
            All cards must have a set code assigned before importing.
          </p>
        </div>
        <div className="overflow-y-auto flex-1 divide-y divide-zinc-800">
          {groups.map(({ key, row }) => (
            <div key={key} className="px-4 py-3 space-y-2">
              <div>
                <p className="text-sm text-zinc-200 break-words">{row.card_name}</p>
                {row.set_name && <p className="text-xs text-zinc-500 mt-0.5">Set label: {row.set_name}</p>}
              </div>
              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className="block text-[10px] text-zinc-500 mb-1">Game</label>
                  <select
                    value={overrides[key]?.game ?? 'pokemon'}
                    onChange={e => setField(key, 'game', e.target.value)}
                    className="w-full text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 focus:outline-none focus:border-indigo-500"
                  >
                    {KNOWN_GAMES.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-zinc-500 mb-1">Language</label>
                  <select
                    value={overrides[key]?.language ?? 'EN'}
                    onChange={e => setField(key, 'language', e.target.value)}
                    className="w-full text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 focus:outline-none focus:border-indigo-500"
                  >
                    {KNOWN_POKEMON_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.code} — {l.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-zinc-500 mb-1">Set Code</label>
                  <input
                    value={overrides[key]?.set_code ?? ''}
                    onChange={e => setField(key, 'set_code', e.target.value)}
                    placeholder="e.g. OP-01"
                    className="w-full text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-zinc-500 mb-1">Set Name</label>
                  <input
                    value={overrides[key]?.set_name ?? ''}
                    onChange={e => setField(key, 'set_name', e.target.value)}
                    placeholder="e.g. Romance Dawn"
                    className="w-full text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-zinc-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-zinc-800 flex items-center justify-end gap-3">
          <button onClick={onCancel} className="text-xs text-zinc-500 hover:text-zinc-300 px-3 py-1.5">Cancel</button>
          <button
            onClick={handleConfirm}
            disabled={!allFilled}
            className="text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-4 py-1.5 rounded font-medium transition-colors"
          >
            Confirm & Import
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main flow ────────────────────────────────────────────────────────────────

function ImportFlow() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importType, setImportType] = useState<ImportType>('graded');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [ambiguousRows, setAmbiguousRows] = useState<AmbiguousRow[] | null>(null);
  const [unlinkedRows, setUnlinkedRows] = useState<UnlinkedRow[] | null>(null);
  const [pendingLangOverrides, setPendingLangOverrides] = useState<Record<number, string>>({});

  const uploadMut = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append('file', f);
      return api.post('/import/upload', fd).then((r) => r.data.data as ImportPreview);
    },
    onSuccess: (data) => {
      setPreview(data);
      setMapping(data.detected_mapping ?? {});
      const detected = data.detected_type;
      if (detected && detected !== 'unknown' && IMPORT_TYPES.some((t) => t.key === detected)) {
        setImportType(detected as ImportType);
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Failed to parse file'),
  });

  const preflightMut = useMutation({
    mutationFn: async () => {
      if (!preview || !file) return [];
      await api.post(`/import/${preview.id}/mapping`, { mapping, import_type: importType });
      const fd = new FormData();
      fd.append('file', file);
      return api.post(`/import/${preview.id}/preflight`, fd).then((r) => r.data.data.ambiguous as AmbiguousRow[]);
    },
    onSuccess: (rows) => {
      if (!rows) return;
      if (rows.length > 0) {
        setAmbiguousRows(rows);
      } else {
        runPreflightUnlinked({});
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Preflight failed'),
  });

  const preflightUnlinkedMut = useMutation({
    mutationFn: async (langOverrides: Record<number, string>) => {
      if (!preview || !file) return { rows: [], langOverrides };
      const fd = new FormData();
      fd.append('file', file);
      const rows = await api.post(`/import/${preview.id}/preflight-unlinked`, fd).then((r) => r.data.data.unlinked as UnlinkedRow[]);
      return { rows, langOverrides };
    },
    onSuccess: ({ rows, langOverrides }) => {
      if (!rows) return;
      if (rows.length > 0) {
        setPendingLangOverrides(langOverrides);
        setUnlinkedRows(rows);
      } else {
        doExecute(langOverrides, {});
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Preflight failed'),
  });

  const executeMut = useMutation({
    mutationFn: async ({ langOverrides, catalogOverrides }: { langOverrides: Record<number, string>; catalogOverrides: Record<string, CatalogOverride> }) => {
      if (!preview || !file) return;
      const fd = new FormData();
      fd.append('file', file);
      if (Object.keys(langOverrides).length > 0) {
        fd.append('language_overrides', JSON.stringify(langOverrides));
      }
      if (Object.keys(catalogOverrides).length > 0) {
        fd.append('catalog_overrides', JSON.stringify(catalogOverrides));
      }
      return api.post(`/import/${preview.id}/execute`, fd).then((r) => r.data.data as ImportResult);
    },
    onSuccess: (res) => {
      if (!res) return;
      setResult(res);
      setPreview(null);
      setFile(null);
      setAmbiguousRows(null);
      setUnlinkedRows(null);
      setPendingLangOverrides({});
      qc.invalidateQueries({ queryKey: ['imports'] });
      if (res.error_count > 0) {
        toast(`Imported ${res.imported_count}, ${res.error_count} errors`, { icon: '⚠️' });
      } else {
        toast.success(`Imported ${res.imported_count} rows`);
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Import failed'),
  });

  function runPreflightUnlinked(langOverrides: Record<number, string>) {
    preflightUnlinkedMut.mutate(langOverrides);
  }

  function doExecute(langOverrides: Record<number, string>, catalogOverrides: Record<string, CatalogOverride>) {
    executeMut.mutate({ langOverrides, catalogOverrides });
  }

  function handleFile(f: File) {
    setFile(f);
    setResult(null);
    uploadMut.mutate(f);
  }

  function reset(deletePending = true) {
    if (deletePending && preview?.id) {
      api.delete(`/import/${preview.id}`).catch(() => {});
      qc.invalidateQueries({ queryKey: ['imports'] });
    }
    setFile(null);
    setPreview(null);
    setMapping({});
    setResult(null);
    setAmbiguousRows(null);
    setUnlinkedRows(null);
    setPendingLangOverrides({});
    uploadMut.reset();
    preflightMut.reset();
    preflightUnlinkedMut.reset();
    executeMut.reset();
  }


  // ── Upload state
  if (uploadMut.isPending) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 py-8">
          <Loader2 size={24} className="text-indigo-400 animate-spin" />
          <p className="text-sm text-zinc-400">Analyzing file with AI…</p>
        </div>
      </Card>
    );
  }

  // ── Initial upload
  if (!preview && !result) {
    return (
      <Card>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-300 font-medium">Smart Import</p>
              <p className="text-sm text-zinc-500 mt-0.5">Upload any CSV or Excel file — AI will detect what it is and map the columns automatically.</p>
            </div>
            <div className="flex gap-2 shrink-0">
              {IMPORT_TYPES.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => downloadTemplate(key)}
                  className="text-xs text-zinc-500 hover:text-indigo-400 transition-colors flex items-center gap-1"
                  title={`Download ${label} template`}
                >
                  <Download size={11} />
                  {label}
                </button>
              ))}
            </div>
          </div>
          <UploadZone onFile={handleFile} />
        </div>
      </Card>
    );
  }

  // ── Preview + mapping
  if (preview) {
    const confidence = preview.detected_confidence;
    const detectedLabel = IMPORT_TYPES.find((t) => t.key === preview.detected_type)?.label ?? preview.detected_type;

    return (
      <>
      <div className="space-y-4">
        {/* AI detection banner */}
        <Card>
          <div className="flex items-start gap-3">
            <Sparkles size={16} className="text-indigo-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-zinc-100">
                  Detected: <span className="text-indigo-400">{detectedLabel}</span>
                </span>
                <span className={`text-xs font-medium ${CONFIDENCE_COLORS[confidence] ?? 'text-zinc-400'}`}>
                  {confidence} confidence
                </span>
                {confidence !== 'high' && (
                  <AlertTriangle size={12} className="text-yellow-400" />
                )}
              </div>
              <p className="text-xs text-zinc-500 mt-0.5">{preview.detected_reasoning}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-zinc-500">Override:</span>
              <select
                value={importType}
                onChange={(e) => setImportType(e.target.value as ImportType)}
                className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-300 focus:outline-none focus:border-indigo-500"
              >
                {IMPORT_TYPES.map(({ key, label }) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
          </div>
        </Card>

        {/* File info + column mapping */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <FileText size={15} className="text-indigo-400" />
              <span className="text-sm font-medium text-zinc-100">{preview.original_filename}</span>
              <span className="text-xs text-zinc-500">{preview.total_rows} rows · {preview.columns.length} columns</span>
            </div>
            <button onClick={() => reset()} className="text-xs text-zinc-500 hover:text-zinc-300">Cancel</button>
          </div>

          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-3">Column mapping</h3>
          <div className="grid grid-cols-2 gap-2.5">
            {preview.columns.map((col) => (
              <div key={col} className="flex items-center gap-2">
                <span className="text-xs text-zinc-400 truncate w-28 shrink-0" title={col}>{col}</span>
                <span className="text-zinc-700 text-xs">→</span>
                <select
                  value={mapping[col] ?? ''}
                  onChange={(e) => setMapping((m) => ({ ...m, [col]: e.target.value }))}
                  className={`flex-1 text-xs bg-zinc-800 border rounded px-2 py-1 text-zinc-300 focus:outline-none focus:border-indigo-500 ${
                    mapping[col] ? 'border-indigo-500/40' : 'border-zinc-700'
                  }`}
                >
                  <option value="">Skip</option>
                  {ALL_TARGET_FIELDS.map(({ group, fields }) => (
                    <optgroup key={group} label={group}>
                      {fields.map((f) => <option key={f} value={f}>{f}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <p className="text-xs text-zinc-600 mt-3">
            {Object.values(mapping).filter(Boolean).length} of {preview.columns.length} columns mapped
            {Object.values(mapping).filter(Boolean).length < preview.columns.length && ' — unmapped columns will be skipped'}
          </p>
        </Card>

        {/* Data preview */}
        <Card>
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-3">Data preview (first 5 rows)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800">
                  {preview.columns.slice(0, 8).map((col) => (
                    <th key={col} className="py-1.5 px-2 text-left text-zinc-500 font-medium whitespace-nowrap">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {preview.preview_rows.slice(0, 5).map((row, i) => (
                  <tr key={i}>
                    {preview.columns.slice(0, 8).map((col) => (
                      <td key={col} className="py-1.5 px-2 text-zinc-400 max-w-[120px] truncate">{row[col] ?? '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="flex items-start justify-between gap-4">
          <p className="text-xs text-amber-400/80 max-w-md mt-1">
            Please verify that all column mappings are correct before importing. Auto-detected mappings may not be accurate — review each row above before proceeding.
          </p>
          <div className="flex gap-3 shrink-0">
            <Button variant="secondary" onClick={() => reset()}>Cancel</Button>
            <Button onClick={() => preflightMut.mutate()} disabled={preflightMut.isPending || preflightUnlinkedMut.isPending || executeMut.isPending}>
              {(preflightMut.isPending || preflightUnlinkedMut.isPending || executeMut.isPending) && <Loader2 size={14} className="animate-spin mr-1.5" />}
              Import {preview.total_rows} rows
            </Button>
          </div>
        </div>
      </div>
      {ambiguousRows && (
        <LanguageResolutionModal
          rows={ambiguousRows}
          onResolve={(overrides) => { setAmbiguousRows(null); runPreflightUnlinked(overrides); }}
          onCancel={() => setAmbiguousRows(null)}
        />
      )}
      {unlinkedRows && (
        <UnlinkedResolutionModal
          rows={unlinkedRows}
          onResolve={(catalogOverrides) => { setUnlinkedRows(null); doExecute(pendingLangOverrides, catalogOverrides); }}
          onCancel={() => setUnlinkedRows(null)}
        />
      )}
      </>
    );
  }

  // ── Result
  if (result) {
    return (
      <Card>
        <div className="flex items-start gap-3">
          {result.error_count === 0
            ? <CheckCircle size={20} className="text-emerald-400 mt-0.5 shrink-0" />
            : <XCircle size={20} className="text-amber-400 mt-0.5 shrink-0" />
          }
          <div className="flex-1 space-y-1">
            <p className="text-sm text-zinc-100 font-medium">
              Import complete — {result.imported_count} imported{result.error_count > 0 ? `, ${result.error_count} failed` : ''}
            </p>
            {result.errors && result.errors.length > 0 && (
              <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                {result.errors.map((e) => (
                  <p key={e.row} className="text-xs text-red-400">Row {e.row}: {e.message}</p>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => reset()} className="text-xs text-zinc-500 hover:text-zinc-300 shrink-0">Import another</button>
        </div>
      </Card>
    );
  }

  return null;
}

// ─── Import History ───────────────────────────────────────────────────────────

function ImportHistory() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<ImportRecord[]>({
    queryKey: ['imports'],
    queryFn: () => api.get('/import').then((r) => r.data.data ?? r.data),
    refetchInterval: (query) => {
      const rows = query.state.data;
      return rows?.some((r) => r.status === 'processing') ? 2000 : false;
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/import/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['imports'] }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => toast.error(e.response?.data?.error ?? 'Delete failed'),
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 size={18} className="text-zinc-600 animate-spin" /></div>;
  if (!data || data.length === 0) return null;

  return (
    <div>
      <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wide mb-3">Import History</h2>
      <Card className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800">
              <th className="py-2 px-4 text-left text-xs text-zinc-500 font-medium">File</th>
              <th className="py-2 px-4 text-left text-xs text-zinc-500 font-medium">Type</th>
              <th className="py-2 px-4 text-left text-xs text-zinc-500 font-medium">Status</th>
              <th className="py-2 px-4 text-right text-xs text-zinc-500 font-medium">Rows</th>
              <th className="py-2 px-4 text-right text-xs text-zinc-500 font-medium">Date</th>
              <th className="py-2 px-4 w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {data.map((rec) => (
              <tr key={rec.id} className="hover:bg-zinc-800/40 group">
                <td className="py-2 px-4 text-zinc-300 truncate max-w-[200px]">{rec.filename}</td>
                <td className="py-2 px-4 text-zinc-500 text-xs">{rec.import_type}</td>
                <td className="py-2 px-4">
                  {rec.status === 'processing' ? (
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                          style={{ width: rec.row_count > 0 ? `${Math.min(100, Math.round((rec.imported_count ?? 0) / rec.row_count * 100))}%` : '5%' }}
                        />
                      </div>
                      <span className="text-xs text-zinc-500 tabular-nums">
                        {rec.row_count > 0 ? `${Math.min(100, Math.round((rec.imported_count ?? 0) / rec.row_count * 100))}%` : '…'}
                      </span>
                    </div>
                  ) : statusBadge(rec.status)}
                </td>
                <td className="py-2 px-4 text-right text-zinc-500 text-xs">
                  {rec.imported_count ?? 0}
                  {(rec.error_count ?? 0) > 0 && <span className="text-amber-400 ml-1">({rec.error_count} err)</span>}
                </td>
                <td className="py-2 px-4 text-right text-zinc-500 text-xs">{fmtDate(rec.created_at)}</td>
                <td className="py-2 px-4">
                  {rec.status === 'pending' && (
                    <button
                      onClick={() => deleteMut.mutate(rec.id)}
                      disabled={deleteMut.isPending}
                      className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-all"
                      title="Delete pending import"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function Import() {
  return (
    <div className="p-6 space-y-6 max-w-3xl h-full overflow-y-auto">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">Import</h1>
        <p className="text-sm text-zinc-500 mt-0.5">Upload any CSV or Excel file — AI will detect the format and map columns automatically.</p>
      </div>
      <ImportFlow />
      <ImportHistory />
    </div>
  );
}
