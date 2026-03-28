import { useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Sparkles, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';

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
});

type FormData = z.infer<typeof schema>;

interface AddCardFormProps {
  onSuccess: () => void;
}

export function AddCardForm({ onSuccess }: AddCardFormProps) {
  const [searchLabel, setSearchLabel] = useState('');
  const [autoFilling, setAutoFilling] = useState(false);
  const [catalogId, setCatalogId] = useState<string | null>(null);
  const [partNumber, setPartNumber] = useState<{ sku: string | null; exists: boolean; catalogData?: Record<string, any> } | null>(null);
  const [creatingPart, setCreatingPart] = useState(false);
  const { register, handleSubmit, setValue, getValues, watch, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { card_game: 'pokemon', language: 'EN', purchase_type: 'raw', quantity: 1, currency: 'USD' },
  });

  const purchaseType = watch('purchase_type');
  const purchaseCost = watch('purchase_cost');
  const quantity = watch('quantity');
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
        setCatalogId(s.catalog_id ?? null);
        setPartNumber({ sku: s.sku ?? null, exists: !!s.catalog_exists, catalogData: s });
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

  const createCatalogEntry = async () => {
    if (!partNumber?.catalogData) return;
    setCreatingPart(true);
    try {
      const s = partNumber.catalogData;
      await api.post('/catalog', {
        game: 'pokemon',
        sku: partNumber.sku,
        card_name: s.card_name,
        set_name: s.set_name,
        set_code: s.set_code ?? null,
        card_number: s.card_number ?? null,
        language: s.language ?? 'EN',
        rarity: getValues('rarity') || s.rarity || null,
      });
      setPartNumber((p) => p ? { ...p, exists: true } : p);
      toast.success('Part number created');
    } catch {
      toast.error('Failed to create part number');
    } finally {
      setCreatingPart(false);
    }
  };

  const onSubmit = async (data: FormData) => {
    const qty = data.purchase_type === 'bulk' ? (data.quantity ?? 1) : 1;
    const costPerUnit = qty > 1 ? (Number(data.purchase_cost) / qty).toFixed(2) : Number(data.purchase_cost).toFixed(2);
    await api.post('/cards', {
      ...data,
      catalog_id: catalogId ?? undefined,
      quantity: qty,
      purchase_cost: costPerUnit,
      decision: data.decision,
    });
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

      <div className="flex flex-col gap-1">
        <Input
          label="Card Name"
          placeholder="e.g. 1996 Pokemon Japanese Basic 6 Charizard-Holo"
          {...register('card_name_override')}
          error={errors.card_name_override?.message}
        />
        {partNumber && !partNumber.exists && (
          <p className="text-xs text-yellow-500/80 leading-snug">
            New part — enter the established card name
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Input label="Set Name" placeholder="e.g. Base Set" {...register('set_name_override')} />
        <Input label="Card Number" placeholder="e.g. 4/102" {...register('card_number_override')} />
        <Input label="Rarity" placeholder="e.g. Holo" {...register('rarity')} />
      </div>

      {partNumber && (
        <div className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm border ${partNumber.exists ? 'bg-green-950/40 border-green-800/50' : 'bg-yellow-950/40 border-yellow-700/50'}`}>
          <div className="flex items-center gap-2">
            {partNumber.exists
              ? <CheckCircle size={14} className="text-green-400 shrink-0" />
              : <AlertCircle size={14} className="text-yellow-400 shrink-0" />}
            {partNumber.sku
              ? <span className="font-mono text-xs text-zinc-200">{partNumber.sku}</span>
              : <span className="text-xs text-zinc-400 italic">Part number unknown</span>}
            <span className={`text-xs ${partNumber.exists ? 'text-green-500' : 'text-yellow-500'}`}>
              {partNumber.exists ? 'Part exists' : partNumber.sku ? 'New part — not in catalog' : 'No part found'}
            </span>
          </div>
          {!partNumber.exists && (
            <button
              type="button"
              onClick={createCatalogEntry}
              disabled={creatingPart || !partNumber.sku}
              className="text-xs text-yellow-400 hover:text-yellow-300 font-medium disabled:opacity-50"
            >
              {creatingPart ? 'Creating…' : 'Create part'}
            </button>
          )}
        </div>
      )}

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

      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 size={14} className="animate-spin" />}
          Add Card
        </Button>
      </div>
    </form>
  );
}
