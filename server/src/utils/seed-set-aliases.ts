import { db } from '../config/database';
import { EN_SETS, JP_SETS } from './set-codes';

/**
 * Seed all static set aliases into pokemon_set_aliases for a given org owner user_id.
 * Uses ON CONFLICT DO NOTHING so it's safe to call multiple times.
 */
export async function seedOrgSetAliases(userId: string): Promise<void> {
  const rows: { user_id: string; language: string; game: string; set_code: string; alias: string; set_name: string }[] = [];

  for (const entry of EN_SETS) {
    const set_name = entry.names[0];
    for (const alias of entry.names) {
      rows.push({ user_id: userId, language: 'EN', game: 'pokemon', set_code: entry.code, alias: alias.toLowerCase().trim(), set_name });
    }
  }

  for (const entry of JP_SETS) {
    const set_name = entry.names[0];
    for (const alias of entry.names) {
      rows.push({ user_id: userId, language: 'JP', game: 'pokemon', set_code: entry.code, alias: alias.toLowerCase().trim(), set_name });
    }
  }

  // Insert in chunks to avoid parameter limit
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db
      .insertInto('pokemon_set_aliases')
      .values(rows.slice(i, i + CHUNK))
      .onConflict(oc => oc.columns(['user_id', 'language', 'alias']).doNothing())
      .execute();
  }
}
