import { useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Sparkles, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';

const schema = z.object({
  card_name_override: z.string().min(1, 'Card name required'),
  set_name_override: z.string().optional(),
  card_number_override: z.string().optional(),
  card_game: z.string().default('pokemon'),
  language: z.string().default('EN'),
  purchase_type: z.enum(['raw', 'pre_graded']).default('raw'),
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
  const [autoFilling, setAutoFilling] = useState(false);
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { card_game: 'pokemon', language: 'EN', purchase_type: 'raw', currency: 'USD' },
  });

  const autoFill = useCallback(async (name: string) => {
    if (!name.trim()) return;
    setAutoFilling(true);
    try {
      const { data } = await api.post('/agent/autofill', { partial_name: name, game: 'pokemon' });
      const s = data.suggestions?.[0];
      if (s) {
        if (s.set_name) setValue('set_name_override', s.set_name);
        if (s.card_number) setValue('card_number_override', s.card_number);
        toast.success('Auto-filled from card database');
      } else {
        toast('No match found — fill manually', { icon: '🔍' });
      }
    } catch {
      // silently ignore auto-fill failures
    } finally {
      setAutoFilling(false);
    }
  }, [setValue]);

  const onSubmit = async (data: FormData) => {
    await api.post('/cards', data);
    toast.success('Card added!');
    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Input
            label="Card Name"
            placeholder="e.g. Charizard"
            {...register('card_name_override')}
            error={errors.card_name_override?.message}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="shrink-0"
          onClick={() => {
            const el = document.getElementById('card_name_override') as HTMLInputElement | null;
            autoFill(el?.value ?? '');
          }}
          disabled={autoFilling}
        >
          {autoFilling ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          Auto-fill
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input label="Set Name" placeholder="e.g. Base Set" {...register('set_name_override')} />
        <Input label="Card Number" placeholder="e.g. 4/102" {...register('card_number_override')} />
      </div>

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
          <option value="pre_graded">Pre-Graded Slab</option>
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

      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Purchase Cost"
          type="number"
          step="0.01"
          min="0"
          placeholder="0.00"
          {...register('purchase_cost')}
          error={errors.purchase_cost?.message}
        />
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
