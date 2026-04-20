-- Drop the EN/JP-only check constraint so any language code is allowed
ALTER TABLE pokemon_set_aliases DROP CONSTRAINT IF EXISTS pokemon_set_aliases_language_check;
