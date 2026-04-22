-- Add game field to pokemon_set_aliases so custom aliases can be associated with a game
ALTER TABLE pokemon_set_aliases ADD COLUMN IF NOT EXISTS game TEXT NOT NULL DEFAULT 'pokemon';
