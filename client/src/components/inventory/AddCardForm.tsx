import { useState, useCallback, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Sparkles, Loader2, ImagePlus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { useLocations } from '../../hooks/useLocations';
import { PartNumberField, type CatalogMatch } from '../catalog/PartNumberField';

const schema = z.object({
  card_name_override: z.string().min(1, 'Card name required'),
  set_name_override: z.string().optional(),
  card_number_override: z.string().optional(),
  rarity: z.string().optional(),
  card_game: z.string().default('pokemon'),
  language: z.string().default('EN'),
  purchase_type: z.enum(['raw', 'bulk']).default('raw'),
  decision: z.enum(['grade', 'sell_raw'], { required_error: 'Intent required' }),
  quantity: z.coerce.number().int().min(1).default(1),
  purchase_cost: z.coerce.number().min(0, 'Cost required'),
  currency: z.enum(['USD', 'JPY']).default('USD'),
  condition: z.string().optional(),
  purchased_at: z.string().optional(),
  notes: z.string().optional(),
  // Empty-string preprocess: the <select> emits '' for the "No location"
  // option, which would otherwise fail .uuid() and block submit.
  location_id: z.preprocess((v) => v === '' ? undefined : v, z.string().uuid().optional().nullable()),
});

type FormData = z.infer<typeof schema>;

interface AddCardFormProps {
  onSuccess: () => void;
}

export function AddCardForm({ onSuccess }: AddCardFormProps) {
  const { locations: rawLocations } = useLocations('raw');
  const [searchLabel, setSearchLabel] = useState('');
  const [autoFilling, setAutoFilling] = useState(false);
  const [catalogId, setCatalogId] = useState<string | null>(null);
  const [catalogMatch, setCatalogMatch] = useState<CatalogMatch | null>(null);
  const [unnumbered, setUnnumbered] = useState(false);
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  const [frontPreview, setFrontPreview] = useState<string | null>(null);
  const [backPreview, setBackPreview] = useState<string | null>(null);
  const frontRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLInputElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { register, handleSubmit, setValue, watch, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema) as any,
    defaultValues: { card_game: 'pokemon', language: 'EN', purchase_type: 'raw', quantity: 1, currency: 'USD' },
  });

  const purchaseType = watch('purchase_type');
  const purchaseCost = watch('purchase_cost');
  const quantity = watch('quantity');

  // PartNumberField watches these form values directly and runs its own
  // debounced /catalog/search + auto-pick + manual search dropdown.
  const watchedName   = watch('card_name_override') ?? '';
  const watchedSet    = watch('set_name_override') ?? '';
  const watchedNumber = watch('card_number_override') ?? '';
  const watchedLang   = watch('language') ?? 'EN';
  const isBulk = purchaseType === 'bulk';
  const costPerCard = isBulk && quantity > 1 && purchaseCost > 0
    ? (purchaseCost / quantity).toFixed(2)
    : null;

  const autoFill = useCallback(async (name: string) => {
    if (!name.trim()) return;
    setAutoFilling(true);
    try {
      const res = await api.post('/agent/auto-fill', { partial_name: name, game: 'pokemon' });
      const s = res.data.data?.suggestions?.[0];
      if (s) {
        // Always fill card name: prefer established catalog name, fall back to AI suggestion
        setValue('card_name_override', s.catalog_card_name || s.card_name || '');
        if (s.set_name) setValue('set_name_override', s.set_name);
        if (s.card_number) setValue('card_number_override', s.card_number);
        if (s.rarity) setValue('rarity', s.rarity);
        if (s.language) setValue('language', s.language === 'JP' ? 'JP' : 'EN');
        if (s.catalog_exists && s.catalog_id) {
          setCatalogId(s.catalog_id);
          setCatalogMatch({
            id: s.catalog_id,
            sku: s.sku ?? null,
            card_name: s.catalog_card_name || s.card_name || '',
            set_name: s.set_name ?? '',
            card_number: s.card_number ?? null,
            language: s.language === 'JP' ? 'JP' : 'EN',
          });
        } else {
          setCatalogId(null);
          setCatalogMatch(null);
        }
        toast.success('Auto-filled from card database');
      } else {
        toast('No match found — fill manually', { icon: '🔍' });
      }
    } catch {
      toast.error('Unable to auto-fill — fill manually');
    } finally {
      setAutoFilling(false);
    }
  }, [setValue]);

  function pickImage(side: 'front' | 'back', file: File) {
    const url = URL.createObjectURL(file);
    if (side === 'front') { setFrontFile(file); setFrontPreview(url); }
    else { setBackFile(file); setBackPreview(url); }
  }

  function clearImage(side: 'front' | 'back') {
    if (side === 'front') { if (frontPreview) URL.revokeObjectURL(frontPreview); setFrontFile(null); setFrontPreview(null); if (frontRef.current) frontRef.current.value = ''; }
    else { if (backPreview) URL.revokeObjectURL(backPreview); setBackFile(null); setBackPreview(null); if (backRef.current) backRef.current.value = ''; }
  }

  const onSubmit = async (data: FormData) => {
    const qty = data.purchase_type === 'bulk' ? (data.quantity ?? 1) : 1;
    const costPerUnit = qty > 1 ? (Number(data.purchase_cost) / qty).toFixed(2) : Number(data.purchase_cost).toFixed(2);
    const res = await api.post('/cards', {
      ...data,
      catalog_id: catalogId ?? undefined,
      quantity: qty,
      purchase_cost: costPerUnit,
      decision: data.decision,
    });
    const cardId = res.data?.data?.id ?? res.data?.id;
    if (cardId) {
      const uploads = [frontFile && { file: frontFile, side: 'front' }, backFile && { file: backFile, side: 'back' }].filter(Boolean) as { file: File; side: string }[];
      await Promise.all(uploads.map(({ file, side }) => {
        const fd = new FormData(); fd.append('image', file);
        return api.post(`/cards/${cardId}/image?side=${side}`, fd).catch(() => {});
      }));
    }
    toast.success('Card added!');
    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {/* Search + Auto-fill */}
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide block mb-1">Search</label>
          <input
            type="text"
            value={searchLabel}
            onChange={(e) => setSearchLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); autoFill(searchLabel); } }}
            placeholder="Paste card name, label, or part number…"
            className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
        <button
          type="button"
          onClick={() => autoFill(searchLabel)}
          disabled={autoFilling || !searchLabel.trim()}
          className="shrink-0 flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {autoFilling ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          Auto-fill
        </button>
      </div>

      <Input
        label="Card Name"
        placeholder="e.g. 1996 Pokemon Japanese Basic 6 Charizard-Holo"
        {...register('card_name_override')}
        error={errors.card_name_override?.message}
      />

      <div className="grid grid-cols-3 gap-3">
        <Input label="Set Name" placeholder="e.g. Base Set" {...register('set_name_override')} />
        <div>
          <Input
            label="Card Number"
            placeholder={unnumbered ? '—' : 'e.g. 4/102'}
            disabled={unnumbered}
            {...register('card_number_override')}
            className={unnumbered ? 'opacity-50' : undefined}
          />
          <label className="flex items-center gap-1 text-[10px] text-zinc-500 cursor-pointer select-none mt-1">
            <input
              type="checkbox"
              checked={unnumbered}
              onChange={(e) => {
                setUnnumbered(e.target.checked);
                if (e.target.checked) setValue('card_number_override', '');
              }}
              className="accent-indigo-500" />
            no card # (unnumbered)
          </label>
        </div>
        <Input label="Rarity" placeholder="e.g. Holo" {...register('rarity')} />
      </div>

      <PartNumberField
        form={{ card_name: watchedName, set_name: watchedSet, card_number: watchedNumber, language: watchedLang }}
        catalogMatch={catalogMatch}
        catalogId={catalogId}
        onSelect={(m) => {
          setCatalogMatch(m);
          setCatalogId(m.id);
          // Fill any missing form fields from the picked catalog row
          if (!watchedName && m.card_name) setValue('card_name_override', m.card_name);
          if (!watchedSet && m.set_name) setValue('set_name_override', m.set_name);
          if (!watchedNumber && m.card_number) setValue('card_number_override', m.card_number);
          if (m.language) setValue('language', m.language === 'JP' ? 'JP' : 'EN');
        }}
        onClear={() => { setCatalogMatch(null); setCatalogId(null); }}
      />

      <div className="grid grid-cols-2 gap-3">
        <Select label="Game" {...register('card_game')}>
          <option value="pokemon">Pokémon</option>
          <option value="one_piece">One Piece</option>
          <option value="mtg">MTG</option>
          <option value="other">Other</option>
        </Select>
        <Select label="Language" {...register('language')}>
          <option value="EN">English</option>
          <option value="JP">Japanese</option>
          <option value="KR">Korean</option>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Select label="Purchase Type" {...register('purchase_type')}>
          <option value="raw">Raw</option>
          <option value="bulk">Bulk</option>
        </Select>
        <Select label="Condition" {...register('condition')}>
          <option value="">—</option>
          <option value="NM">NM</option>
          <option value="LP">LP</option>
          <option value="MP">MP</option>
          <option value="HP">HP</option>
          <option value="DMG">DMG</option>
        </Select>
      </div>

      <Select label="Intent" {...register('decision')} error={errors.decision?.message}>
        <option value="">—</option>
        <option value="sell_raw">For Sale</option>
        <option value="grade">To Grade</option>
      </Select>

      {isBulk && (
        <Input
          label="Quantity"
          type="number"
          min="1"
          step="1"
          placeholder="e.g. 10"
          {...register('quantity')}
        />
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Input
            label={isBulk ? 'Total Cost' : 'Purchase Cost'}
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            {...register('purchase_cost')}
            error={errors.purchase_cost?.message}
          />
          {costPerCard && (
            <p className="text-[11px] text-zinc-500">
              ≈ <span className="text-zinc-300 font-medium">${costPerCard}</span> per card
            </p>
          )}
        </div>
        <Select label="Currency" {...register('currency')}>
          <option value="USD">USD</option>
          <option value="JPY">JPY</option>
        </Select>
      </div>

      <Input label="Purchase Date" type="date" {...register('purchased_at')} />
      <Input label="Notes" placeholder="Optional notes" {...register('notes')} />

      {rawLocations.length > 0 && (
        <Select label="Location" {...register('location_id')}>
          <option value="">— No location —</option>
          {rawLocations.map(l => (
            <option key={l.id} value={l.id}>{l.name}{l.is_card_show ? ' (Card Show)' : ''}</option>
          ))}
        </Select>
      )}

      {/* Front / back images */}
      <div>
        <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide block mb-2">Card Images</label>
        <div className="flex gap-3">
          {(['front', 'back'] as const).map((side) => {
            const preview = side === 'front' ? frontPreview : backPreview;
            const ref = side === 'front' ? frontRef : backRef;
            return (
              <div key={side} className="relative group">
                <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) pickImage(side, f); }} />
                {preview ? (
                  <div className="relative">
                    <img src={preview} alt={side} className="w-20 h-28 object-contain rounded-lg bg-zinc-800 border border-zinc-700 cursor-pointer" onClick={() => ref.current?.click()} />
                    <button type="button" onClick={() => clearImage(side)}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-zinc-700 hover:bg-zinc-600 rounded-full flex items-center justify-center">
                      <X size={10} className="text-zinc-300" />
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => ref.current?.click()}
                    className="w-20 h-28 rounded-lg border border-dashed border-zinc-700 hover:border-indigo-500 flex flex-col items-center justify-center gap-1 text-zinc-600 hover:text-indigo-400 transition-colors">
                    <ImagePlus size={16} />
                    <span className="text-[10px] capitalize">{side}</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 size={14} className="animate-spin" />}
          Add Card
        </Button>
      </div>

    </form>
  );
}
