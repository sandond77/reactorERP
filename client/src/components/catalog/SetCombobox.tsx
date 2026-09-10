import { useState, useRef, useEffect } from 'react';
import { Plus } from 'lucide-react';
// SetOption + useMergedSets live in ./use-merged-sets. Callers should import
// them from there directly; this module only exports the SetCombobox
// component so react-refresh (HMR) works reliably.
import type { SetOption } from './use-merged-sets';

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
  // Token-based scoring so "2025 Taruka Hoppip" still surfaces a set whose
  // alias only contains "taruka". Score = whole-string substring (4 pts,
  // strongest signal) + token hits (1 pt each) + code prefix hit (2 pts).
  // Pure year-tokens (4 digits) are ignored — they match too many sets.
  const tokens = q.split(/\s+/).filter(t => t.length >= 2 && !/^\d{4}$/.test(t));
  const scored = q
    ? options
        .map(s => {
          const nameLc = s.name.toLowerCase();
          const codeLc = s.code.toLowerCase();
          let score = 0;
          if (nameLc.includes(q) || codeLc.includes(q)) score += 4;
          for (const t of tokens) {
            if (codeLc === t || codeLc.startsWith(t)) score += 2;
            else if (codeLc.includes(t) || nameLc.includes(t)) score += 1;
          }
          return { s, score };
        })
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score || a.s.name.length - b.s.name.length)
        .map(x => x.s)
    : options;
  const suggestions = scored.slice(0, 12);
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
