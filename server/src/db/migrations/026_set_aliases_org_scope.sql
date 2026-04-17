-- Scope set aliases to org (via owner user_id, same pattern as all other data)
ALTER TABLE pokemon_set_aliases ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- Existing rows (if any) — assign to the first owner user so they don't break
UPDATE pokemon_set_aliases SET user_id = (
  SELECT m.user_id FROM org_members m WHERE m.role = 'owner' LIMIT 1
) WHERE user_id IS NULL;

-- Now enforce NOT NULL
ALTER TABLE pokemon_set_aliases ALTER COLUMN user_id SET NOT NULL;

CREATE INDEX idx_set_aliases_user ON pokemon_set_aliases(user_id);
ALTER TABLE pokemon_set_aliases ADD CONSTRAINT pokemon_set_aliases_user_lang_alias UNIQUE (user_id, language, alias);
