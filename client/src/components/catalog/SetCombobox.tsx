import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '../../lib/api';

export interface SetOption { code: string; name: string; }

export function useMergedSets(language: string) {
  const codesQ = useQuery<{ language: string; set_code: string; names: string[] }[]>({
    queryKey: ['set-codes-static'],
    queryFn: () => api.get('/sets/codes').then(r => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const aliasQ = useQuery<{ language: string; set_code: string; alias: string; set_name: string | null }[]>({
    queryKey: ['set-aliases'],
    queryFn: () => api.get('/sets/aliases').then(r => r.data),
    staleTime: 60 * 1000,
  });
  const list: SetOption[] = [];
  const seen = new Set<string>();
  (codesQ.data ?? []).filter(s => s.language === language).forEach(s => {
    const key = s.set_code.toUpperCase();
    if (!seen.has(key)) { seen.add(key); list.push({ code: s.set_code, name: s.names[0] ?? s.set_code }); }
  });
  (aliasQ.data ?? []).filter(a => a.language === language).forEach(a => {
    const key = a.set_code.toUpperCase();
    if (!seen.has(key)) { seen.add(key); list.push({ code: a.set_code, name: a.set_name ?? a.alias }); }
  });
  return list;
}

export function SetCombobox({
  value,
  selectedCode,
  inputCls,
  placeholder,
  options,
  onTyped,
  onSelect,
  onAddNew,
  typedSetName,
  typedSetCode,
  wrapperClassName,
}: {
  value: string;
  selectedCode?: string;
  inputCls: string;
  placeholder: string;
  options: SetOption[];
  onTyped: (raw: string) => void;
  onSelect: (entry: SetOption) => void;
  onAddNew?: () => void;
  typedSetName?: string;
  typedSetCode?: string;
  wrapperClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const q = value.toLowerCase().trim();
  const filtered = q
    ? options.filter(s => s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
    : options;
  const suggestions = filtered.slice(0, 12);
  const exactMatch = options.some(s => s.code.toLowerCase() === q || s.name.toLowerCase() === q);
  // Show "+ Add new set" when:
  //   - both fields provided (AddPartModal style) — show full label
  //   - only typed value (line-item style, no separate code) — show name only
  const hasBothFields = !!typedSetName?.trim() && !!typedSetCode?.trim();
  const canShowAddNew = !!onAddNew && !exactMatch && (hasBothFields || !!value.trim());

  // Display "CODE — NAME" when a set is matched and the user isn't actively editing
  const displayValue = !focused && selectedCode && value
    ? `${selectedCode} — ${value}`
    : value;

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setFocused(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className={`relative ${wrapperClassName ?? ''}`}>
      <input
        className={inputCls}
        value={displayValue}
        placeholder={placeholder}
        onChange={(e) => { onTyped(e.target.value); setOpen(true); }}
        onFocus={() => { setFocused(true); setOpen(true); }}
        onBlur={() => setFocused(false)}
      />
      {open && (suggestions.length > 0 || canShowAddNew) && (
        <ul className="absolute z-50 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl text-xs">
          {suggestions.map((s) => (
            <li
              key={s.code}
              onMouseDown={(e) => { e.preventDefault(); onSelect(s); setOpen(false); }}
              className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-zinc-800">
              <span className="font-mono text-indigo-300 w-24 shrink-0">{s.code}</span>
              <span className="text-zinc-400 truncate">{s.name}</span>
            </li>
          ))}
          {canShowAddNew && (
            <li
              onMouseDown={(e) => { e.preventDefault(); onAddNew!(); setOpen(false); }}
              className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-zinc-800 border-t border-zinc-800 text-indigo-400">
              <Plus size={12} />
              <span>
                {hasBothFields
                  ? <>Add &ldquo;{typedSetCode}&rdquo; — {typedSetName} as new set</>
                  : <>Add &ldquo;{value}&rdquo; as new set…</>}
              </span>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
