import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { api } from '../../lib/api';
import { Button } from '../ui/Button';

interface CardGame {
  id: string | null;
  name: string;
  abbreviation: string | null;
}

const ADD_GAME_SENTINEL = '__add_new_game__';

const GAME_LABELS: Record<string, string> = {
  pokemon: 'Pokémon',
  one_piece: 'One Piece',
  mtg: 'MTG',
  old_maid: 'Old Maid',
  'weiss-schwarz': 'Weiss Schwarz',
  weiss_schwarz: 'Weiss Schwarz',
  weiss: 'Weiss Schwarz',
  union_arena: 'Union Arena',
};

function gameLabel(name: string): string {
  return (
    GAME_LABELS[name.toLowerCase()] ??
    name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

interface Props {
  label?: string;
  value: string;
  onChange: (game: string) => void;
}

const inputCls =
  'w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors';

export function CardGameSelect({ label = 'Game', value, onChange }: Props) {
  const queryClient = useQueryClient();
  const { data: games = [] } = useQuery<CardGame[]>({
    queryKey: ['card-games'],
    queryFn: () => api.get('/sets/games').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const [addingGame, setAddingGame] = useState(false);
  const [newGameName, setNewGameName] = useState('');
  const [newGameAbbrev, setNewGameAbbrev] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
          {label}
        </label>
      )}
      <select
        value={value}
        onChange={(e) => {
          if (e.target.value === ADD_GAME_SENTINEL) {
            setAddingGame(true);
            setNewGameName('');
            setNewGameAbbrev('');
            return;
          }
          onChange(e.target.value);
        }}
        className={inputCls}
      >
        {games.length === 0 ? (
          <option value="pokemon">Pokémon</option>
        ) : (
          games.map((g) => (
            <option key={g.id ?? g.name} value={g.name}>
              {gameLabel(g.name)}
            </option>
          ))
        )}
        <option value={ADD_GAME_SENTINEL}>+ Add new game…</option>
      </select>
      {addingGame && (
        <div className="mt-2 rounded-lg border border-zinc-700 bg-zinc-900/60 p-3 space-y-2">
          <input
            type="text"
            placeholder="Game name (e.g. Black Clover)"
            value={newGameName}
            onChange={(e) => setNewGameName(e.target.value)}
            className={inputCls}
            autoFocus
          />
          <input
            type="text"
            placeholder="SKU prefix (e.g. BC)"
            value={newGameAbbrev}
            onChange={(e) =>
              setNewGameAbbrev(
                e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
              )
            }
            className={inputCls}
            maxLength={6}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAddingGame(false)}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Cancel
            </button>
            <Button
              type="button"
              size="sm"
              disabled={!newGameName.trim() || !newGameAbbrev.trim() || saving}
              onClick={async () => {
                try {
                  setSaving(true);
                  const res = await api.post('/sets/games', {
                    name: newGameName.trim(),
                    abbreviation: newGameAbbrev.trim(),
                  });
                  const created = res.data;
                  if (!created?.name) throw new Error('No game returned');
                  await queryClient.refetchQueries({ queryKey: ['card-games'] });
                  onChange(created.name);
                  setAddingGame(false);
                  setNewGameName('');
                  setNewGameAbbrev('');
                } catch (err: any) {
                  toast.error(err?.response?.data?.error ?? 'Failed to add game');
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? 'Saving…' : 'Add'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
