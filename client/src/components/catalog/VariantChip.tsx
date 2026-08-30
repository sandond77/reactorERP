interface VariantChipProps {
  code: string | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
}

// Renders the 5th-SKU-segment code (1ED, ALT, RH…) as a small pill so two
// catalog rows sharing the same set + card_number are visually distinct in
// pickers, tables, and detail modals.
//
// Two visual modes:
//   - enum code (short A-Z0-9, ≤6 chars) → styled indigo pill
//   - legacy prose ("Alt Art", "Reverse Holo") → muted grey pill so the
//     Action Items nudge to migrate it stays visible without hiding the data
export function VariantChip({ code, size = 'sm', className = '' }: VariantChipProps) {
  const trimmed = (code ?? '').trim();
  if (!trimmed) return null;
  const isEnumShape = /^[A-Z0-9]{1,6}$/.test(trimmed);
  const px = size === 'sm' ? 'px-1.5 py-[1px]' : 'px-2 py-0.5';
  const fs = size === 'sm' ? 'text-[10px]' : 'text-xs';
  const tone = isEnumShape
    ? 'bg-indigo-500/15 border-indigo-500/30 text-indigo-300'
    : 'bg-zinc-700/40 border-zinc-600/40 text-zinc-400 italic';
  return (
    <span
      className={`inline-flex items-center rounded font-mono font-semibold border tracking-wide ${px} ${fs} ${tone} ${className}`}
      title={isEnumShape ? `Variant: ${trimmed}` : `Legacy variant text — migrate to a code via Action Items`}
    >
      {trimmed}
    </span>
  );
}
