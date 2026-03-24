import { useState, useCallback, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Sparkles, Loader2, CheckCircle, AlertCircle, Upload, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';

const GRADING_COMPANIES = ['PSA', 'BGS', 'CGC', 'SGC', 'HGA', 'ACE', 'ARS', 'OTHER'] as const;

const schema = z.object({
  card_name_override: z.string().min(1, 'Card name required'),
  set_name_override: z.string().min(1, 'Set name required'),
  card_number_override: z.string().min(1, 'Card number required'),
  rarity: z.string().optional(),
  card_game: z.string().default('pokemon'),
  language: z.string().default('EN'),
  purchase_cost: z.coerce.number().min(0, 'Purchase cost required'),
  grading_cost: z.coerce.number().min(0).default(0),
  currency: z.enum(['USD', 'JPY']).default('USD'),
  purchased_at: z.string().min(1, 'Purchase date required'),
  notes: z.string().optional(),
  is_personal_collection: z.boolean().default(false),
  slab_company: z.enum(GRADING_COMPANIES),
  slab_grade: z.coerce.number().min(1, 'Grade required').max(10),
  slab_grade_label: z.string().min(1, 'Grade label required'),
  slab_cert_number: z.string().min(1, 'Cert # required'),
});

type FormData = z.infer<typeof schema>;

interface AddSlabFormProps {
  onSuccess: () => void;
}

export function AddSlabForm({ onSuccess }: AddSlabFormProps) {
  const [autoFilling, setAutoFilling] = useState(false);
  const [gradingLabel, setGradingLabel] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [partNumber, setPartNumber] = useState<{ sku: string | null; exists: boolean; catalogData?: Record<string, string> } | null>(null);
  const [creatingPart, setCreatingPart] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { register, handleSubmit, setValue, getValues, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { card_game: 'pokemon', language: 'EN', currency: 'USD', slab_company: 'PSA', is_personal_collection: false },
  });

  const handleImageSelect = (file: File) => {
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setGradingLabel('');
  };

  const clearImage = () => {
    setImageFile(null);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const autoFill = useCallback(async (name: string) => {
    if (!name.trim() && !imageFile) return;
    setAutoFilling(true);
    try {
      let data: any;
      if (imageFile) {
        const fd = new FormData();
        fd.append('image', imageFile);
        fd.append('game', 'pokemon');
        const res = await api.post('/agent/auto-fill', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        data = res.data;
      } else {
        const res = await api.post('/agent/auto-fill', { partial_name: name, game: 'pokemon' });
        data = res.data;
      }
      const s = data.data?.suggestions?.[0];
      const pg = data.data?.parsed_grade;
      const parsedCert: string | undefined = data.data?.parsed_cert;
      const parsedLabel: string | undefined = data.data?.parsed_label;
      if (s) {
        // Card name: only fill if the part exists and we have an established name from inventory
        // If part is new, leave blank — user pastes from grading company cert page
        if (s.catalog_exists && s.catalog_card_name) {
          setValue('card_name_override', s.catalog_card_name);
        }
        if (s.set_name) setValue('set_name_override', s.set_name);
        if (s.card_number) setValue('card_number_override', s.card_number);
        if (s.rarity) setValue('rarity', s.rarity);
        if (s.language) setValue('language', s.language === 'JP' ? 'JP' : 'EN');
        setPartNumber({ sku: s.sku ?? null, exists: !!s.catalog_exists, catalogData: s });
      }
      if (pg) {
        const validCompanies = ['PSA', 'BGS', 'CGC', 'SGC', 'HGA', 'ACE', 'ARS', 'OTHER'];
        if (validCompanies.includes(pg.company)) setValue('slab_company', pg.company as any);
        if (pg.grade) setValue('slab_grade', pg.grade);
        if (pg.grade_label) setValue('slab_grade_label', pg.grade_label);
      }
      if (parsedCert) setValue('slab_cert_number', parsedCert);
      if (s || pg) {
        toast.success('Auto-filled from card database');
      } else {
        toast('No match found — fill manually', { icon: '🔍' });
      }

    } catch {
      toast.error('Unable to auto-fill — fill manually');
    } finally {
      setAutoFilling(false);
    }
  }, [setValue, imageFile, gradingLabel]);

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
    if (partNumber && !partNumber.exists) {
      toast.error('Create the part number before adding the slab');
      return;
    }
    const { grading_cost, purchase_cost, ...rest } = data;
    await api.post('/cards', {
      ...rest,
      purchase_type: 'pre_graded',
      purchase_cost: purchase_cost.toFixed(2),
      slab_additional_cost: grading_cost.toFixed(2),
      is_personal_collection: rest.is_personal_collection ?? false,
    });
    toast.success('Slab added!');
    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
          Auto-fill <span className="normal-case text-zinc-600">(optional)</span>
        </label>

        {imagePreview ? (
          <div className="relative rounded-lg overflow-hidden border border-zinc-700 bg-zinc-900">
            <img src={imagePreview} alt="Slab" className="max-h-32 w-full object-contain" />
            <button
              type="button"
              onClick={clearImage}
              className="absolute top-1.5 right-1.5 p-1 rounded-full bg-zinc-800/80 text-zinc-400 hover:text-zinc-100"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <div
            className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700 bg-zinc-900 px-3 py-3 cursor-pointer hover:border-indigo-500 transition-colors"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files[0];
              if (file?.type.startsWith('image/')) handleImageSelect(file);
            }}
          >
            <Upload size={14} className="text-zinc-500" />
            <span className="text-xs text-zinc-500">Drop slab image or <span className="text-indigo-400">browse</span></span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageSelect(f); }}
            />
          </div>
        )}

        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={gradingLabel}
            onChange={(e) => { setGradingLabel(e.target.value); if (imageFile) clearImage(); }}
            placeholder="or paste PSA label / cert URL"
            disabled={!!imageFile}
            className="flex-1 rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors disabled:opacity-40"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={() => autoFill(gradingLabel)}
            disabled={autoFilling || (!gradingLabel.trim() && !imageFile)}
          >
            {autoFilling ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Auto-fill
          </Button>
        </div>
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
            New part — enter the card name from the grading company cert page (the text in the blue box)
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Input label="Set Name" placeholder="e.g. Base Set" {...register('set_name_override')} error={errors.set_name_override?.message} />
        <Input label="Card Number" placeholder="e.g. 4/102" {...register('card_number_override')} error={errors.card_number_override?.message} />
        <Input label="Rarity" placeholder="e.g. Holo, Art Rare" {...register('rarity')} />
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
          <option value="other">Other</option>
        </Select>
        <Select label="Language" {...register('language')}>
          <option value="EN">English</option>
          <option value="JP">Japanese</option>
          <option value="KR">Korean</option>
        </Select>
      </div>

      <div className="border-t border-zinc-800 pt-4">
        <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-3">Grading Details</p>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Grading Company" {...register('slab_company')} error={errors.slab_company?.message}>
            {GRADING_COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Input
            label="Grade"
            type="number"
            step="0.5"
            min="1"
            max="10"
            placeholder="e.g. 9"
            {...register('slab_grade')}
            error={errors.slab_grade?.message}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Input label="Grade Label" placeholder="e.g. MINT 9" {...register('slab_grade_label')} error={errors.slab_grade_label?.message} />
          <Input label="Cert #" placeholder="e.g. 12345678" {...register('slab_cert_number')} error={errors.slab_cert_number?.message} />
        </div>
      </div>

      <div className="border-t border-zinc-800 pt-4">
        <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-3">Purchase Details</p>
        <div className="grid grid-cols-3 gap-3">
          <Input
            label="Purchase Cost"
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            {...register('purchase_cost')}
            error={errors.purchase_cost?.message}
          />
          <Input
            label="Grading Cost"
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            {...register('grading_cost')}
          />
          <Select label="Currency" {...register('currency')}>
            <option value="USD">USD</option>
            <option value="JPY">JPY</option>
          </Select>
        </div>
        <div className="mt-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Purchase Date</label>
            <input
              type="date"
              {...register('purchased_at')}
              className={`w-full rounded-lg bg-zinc-900 border px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors [color-scheme:dark] ${errors.purchased_at ? 'border-red-500' : 'border-zinc-700'}`}
            />
            {errors.purchased_at && <p className="text-xs text-red-400">{errors.purchased_at.message}</p>}
          </div>
        </div>
      </div>

      <Input label="Notes" placeholder="Optional notes" {...register('notes')} />

      <label className="flex items-center gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          {...register('is_personal_collection')}
          className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0"
        />
        <div>
          <p className="text-sm text-zinc-200">Personal Collection</p>
          <p className="text-xs text-zinc-500">Excluded from listing/sale counts</p>
        </div>
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="submit" disabled={isSubmitting || (!!partNumber && !partNumber.exists)}>
          {isSubmitting && <Loader2 size={14} className="animate-spin" />}
          Add Slab
        </Button>
      </div>
    </form>
  );
}
