import { useState, useEffect, useRef } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import { api } from '../../lib/api';
import { AddPartModal } from './AddPartModal';

export interface CatalogMatch {
  id: string;
  sku: string | null;
  card_name: string;
  set_name: string;
  card_number: string | null;
  language: string;
}

interface Props {
  form: { card_name: string; set_name: string; card_number: string; language: string };
  catalogMatch: CatalogMatch | null;
  catalogId: string | null;
  onSelect: (match: CatalogMatch) => void;
  onClear: () => void;
}

export function PartNumberField({ form, catalogMatch, onSelect, onClear }: Props) {
  const [results, setResults] = useState<CatalogMatch[]>([]);
  const [open, setOpen] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [manualResults, setManualResults] = useState<CatalogMatch[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef2 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceRef3 = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasSearchTerms = !!(form.card_name || form.set_name || form.card_number);
  const [skipAutoPick, setSkipAutoPick] = useState(false);

  useEffect(() => {
    if (debounceRef2.current) clearTimeout(debounceRef2.current);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!hasSearchTerms) { setResults([]); return; }
    setSkipAutoPick(false);
    debounceRef2.current = setTimeout(() => {
      const params: Record<string, string> = { language: form.language };
      if (form.card_name)   params.card_name   = form.card_name;
      if (form.set_name)    params.set_name    = form.set_name;
      if (form.card_number) params.card_number = form.card_number;
      api.get('/catalog/search', { params })
        .then((r) => setResults(r.data.data as CatalogMatch[]))
        .catch(() => setResults([]));
    }, 350);
    return () => { if (debounceRef2.current) clearTimeout(debounceRef2.current); };
  }, [form.card_name, form.set_name, form.card_number, form.language, hasSearchTerms]);

  useEffect(() => {
    if (catalogMatch || skipAutoPick) return;
    if (results.length === 1) {
      onSelect(results[0]);
    }
  }, [results, catalogMatch, skipAutoPick, onSelect]);

  useEffect(() => {
    if (debounceRef3.current) clearTimeout(debounceRef3.current);
    if (manualQuery.trim().length < 2) { setManualResults([]); return; }
    debounceRef3.current = setTimeout(() => {
      api.get('/catalog/search', { params: { q: manualQuery.trim(), limit: 12 } })
        .then((r) => setManualResults(r.data.data as CatalogMatch[]))
        .catch(() => setManualResults([]));
    }, 250);
    return () => { if (debounceRef3.current) clearTimeout(debounceRef3.current); };
  }, [manualQuery]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const lbl = 'block text-xs text-zinc-400 mb-1';
  const inp = 'w-full px-3 py-1.5 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500';

  if (!hasSearchTerms) return null;

  return (
    <div ref={containerRef}>
      <label className={lbl}>Part #</label>

      {catalogMatch ? (
        <div className={`${inp} flex items-center gap-2 border-emerald-700/60`}>
          <span className="text-emerald-400 font-mono text-xs">{catalogMatch.sku ?? '—'}</span>
          <span className="text-zinc-600 text-[10px]">· {catalogMatch.card_name}</span>
          <button type="button" onClick={() => { onClear(); setSkipAutoPick(true); setOpen(true); }} className="ml-auto text-zinc-600 hover:text-zinc-400">
            <X size={12} />
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen((o) => !o)}
          className={`${inp} flex items-center justify-between text-left ${open ? 'border-indigo-500' : ''}`}>
          <span className="text-zinc-500 text-xs italic">
            {results.length > 0 ? `${results.length} match${results.length !== 1 ? 'es' : ''} — select one` : 'No match found'}
          </span>
          <ChevronDown size={13} className={`text-zinc-500 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
        </button>
      )}

      {open && !catalogMatch && (
        <div className="mt-1 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl overflow-hidden z-20 relative">
          <div className="px-2 py-1.5 border-b border-zinc-800/60 bg-zinc-900/60">
            <input
              type="text"
              value={manualQuery}
              onChange={(e) => setManualQuery(e.target.value)}
              placeholder="Search part #, card name, or set…"
              className="w-full px-2 py-1 text-xs bg-zinc-950 border border-zinc-800 rounded text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
              autoFocus
            />
          </div>

          {(() => {
            const showing = manualQuery.trim().length >= 2 ? manualResults : results;
            const isManual = manualQuery.trim().length >= 2;
            if (showing.length > 0) {
              return showing.map((s) => (
                <button key={s.id} type="button"
                  onClick={() => { onSelect(s); setOpen(false); setManualQuery(''); }}
                  className="w-full px-3 py-2 text-left flex items-center gap-3 hover:bg-zinc-800/60 transition-colors border-b border-zinc-800/50 last:border-0">
                  <span className="font-mono text-xs text-indigo-300 shrink-0">{s.sku ?? '—'}</span>
                  <span className="text-zinc-300 text-xs truncate">{s.card_name}</span>
                  <span className="text-zinc-500 text-[10px] shrink-0 ml-auto">{s.set_name}{s.card_number ? ` · #${s.card_number}` : ''}</span>
                </button>
              ));
            }
            return (
              <p className="px-3 py-2 text-xs text-zinc-500 italic">
                {isManual ? 'No matches for that query' : 'No catalog entries found'}
              </p>
            );
          })()}

          <button type="button"
            onClick={() => { setOpen(false); setShowAddModal(true); }}
            className="w-full px-3 py-2 text-left flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 hover:bg-zinc-800/40 transition-colors border-t border-zinc-700/60">
            <Plus size={11} /> Create new part #
          </button>
        </div>
      )}

      {showAddModal && (
        <AddPartModal
          prefill={{ card_name: form.card_name, set_name: form.set_name, card_number: form.card_number, language: form.language }}
          onClose={() => setShowAddModal(false)}
          onCreated={(part) => { onSelect(part); setShowAddModal(false); }}
        />
      )}
    </div>
  );
}
