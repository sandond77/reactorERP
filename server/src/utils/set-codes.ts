/**
 * Pokemon TCG internal set code reference.
 * Format: PKMN-{Lang}-{CODE}-{num}
 *
 * Each entry has a code (the part used in the SKU) and a list of lowercase
 * name aliases as they appear in PSA/grading-company label strings.
 */

interface SetEntry {
  code: string;       // SKU set code part, e.g. 'SWSH9', 'SV3.5', 'BS'
  names: string[];    // lowercase aliases — longest/most-specific listed first
}

// ── English sets ──────────────────────────────────────────────────────────────

export const EN_SETS: SetEntry[] = [
  // WOTC era
  { code: 'BS',   names: ['base set', 'base'] },
  { code: 'JU',   names: ['jungle'] },
  { code: 'FO',   names: ['fossil'] },
  { code: 'TR',   names: ['team rocket'] },
  { code: 'G1',   names: ['gym heroes'] },
  { code: 'G2',   names: ['gym challenge'] },
  { code: 'N1',   names: ['neo genesis'] },
  { code: 'N2',   names: ['neo discovery'] },
  { code: 'N3',   names: ['neo revelation'] },
  { code: 'N4',   names: ['neo destiny'] },
  { code: 'LC',   names: ['legendary collection'] },
  // EX era
  { code: 'EX1',  names: ['ex ruby & sapphire', 'ex ruby and sapphire', 'ex ruby sapphire'] },
  { code: 'EX2',  names: ['ex sandstorm'] },
  { code: 'EX3',  names: ['ex dragon'] },
  { code: 'EX4',  names: ['ex team magma vs aqua', 'ex team magma vs team aqua'] },
  { code: 'EX5',  names: ['ex hidden legends'] },
  { code: 'EX6',  names: ['ex firered & leafgreen', 'ex firered leafgreen', 'ex fire red leaf green'] },
  { code: 'EX7',  names: ['ex team rocket returns'] },
  { code: 'EX8',  names: ['ex deoxys'] },
  { code: 'EX9',  names: ['ex emerald'] },
  { code: 'EX10', names: ['ex unseen forces'] },
  { code: 'EX11', names: ['ex delta species'] },
  { code: 'EX12', names: ['ex legend maker'] },
  { code: 'EX13', names: ['ex holon phantoms'] },
  { code: 'EX14', names: ['ex crystal guardians'] },
  { code: 'EX15', names: ['ex dragon frontiers'] },
  { code: 'EX16', names: ['ex power keepers'] },
  // Diamond & Pearl
  { code: 'DP1',  names: ['diamond & pearl', 'diamond and pearl', 'diamond pearl base'] },
  { code: 'DP2',  names: ['mysterious treasures'] },
  { code: 'DP3',  names: ['secret wonders'] },
  { code: 'DP4',  names: ['great encounters'] },
  { code: 'DP5',  names: ['majestic dawn'] },
  { code: 'DP6',  names: ['legends awakened'] },
  { code: 'DP7',  names: ['stormfront'] },
  // Platinum
  { code: 'PL1',  names: ['platinum'] },
  { code: 'PL2',  names: ['rising rivals'] },
  { code: 'PL3',  names: ['supreme victors'] },
  { code: 'PL4',  names: ['arceus'] },
  // Black & White
  { code: 'BW1',  names: ['black & white', 'black and white', 'black white base'] },
  { code: 'BW2',  names: ['emerging powers'] },
  { code: 'BW3',  names: ['noble victories'] },
  { code: 'BW4',  names: ['next destinies'] },
  { code: 'BW5',  names: ['dark explorers'] },
  { code: 'BW6',  names: ['dragons exalted', 'dragon exalted'] },
  { code: 'BW7',  names: ['boundaries crossed'] },
  { code: 'BW8',  names: ['plasma storm'] },
  { code: 'BW9',  names: ['plasma freeze'] },
  { code: 'BW10', names: ['plasma blast'] },
  { code: 'BW11', names: ['legendary treasures'] },
  // XY
  { code: 'XY1',  names: ['xy base set', 'xy base', 'xy'] },
  { code: 'XY2',  names: ['flashfire'] },
  { code: 'XY3',  names: ['furious fists'] },
  { code: 'XY4',  names: ['phantom forces'] },
  { code: 'XY5',  names: ['primal clash'] },
  { code: 'XY6',  names: ['roaring skies'] },
  { code: 'XY7',  names: ['ancient origins'] },
  { code: 'XY8',  names: ['breakthrough'] },
  { code: 'XY9',  names: ['breakpoint'] },
  { code: 'XY10', names: ['fates collide'] },
  { code: 'XY11', names: ['steam siege'] },
  { code: 'XY12', names: ['evolutions'] },
  // Sun & Moon
  { code: 'SM1',    names: ['sun & moon base', 'sun and moon base', 'sun moon base', 'sun & moon'] },
  { code: 'SM2',    names: ['guardians rising'] },
  { code: 'SM3',    names: ['burning shadows'] },
  { code: 'SM3.5',  names: ['hidden fates'] },
  { code: 'SM4',    names: ['crimson invasion'] },
  { code: 'SM5',    names: ['ultra prism'] },
  { code: 'SM6',    names: ['forbidden light'] },
  { code: 'SM7',    names: ['celestial storm'] },
  { code: 'SM7.5',  names: ['dragon majesty'] },
  { code: 'SM8',    names: ['lost thunder'] },
  { code: 'SM9',    names: ['team up'] },
  { code: 'SM10',   names: ['unbroken bonds'] },
  { code: 'SM11',   names: ['unified minds'] },
  { code: 'SM12',   names: ['cosmic eclipse'] },
  { code: 'SM12.5', names: ['hidden fates shiny vault', 'hidden fates shiny'] },
  // Sword & Shield
  { code: 'SWSH1',    names: ['sword & shield base', 'sword and shield base', 'swsh base', 'sword shield base'] },
  { code: 'SWSH2',    names: ['rebel clash'] },
  { code: 'SWSH3',    names: ['darkness ablaze'] },
  { code: 'SWSH3.5',  names: ["champion's path", 'champions path'] },
  { code: 'SWSH4',    names: ['vivid voltage'] },
  { code: 'SWSH4.5',  names: ['shining fates'] },
  { code: 'SWSH5',    names: ['battle styles'] },
  { code: 'SWSH6',    names: ['chilling reign'] },
  { code: 'SWSH7',    names: ['evolving skies'] },
  { code: 'SWSH8',    names: ['fusion strike'] },
  { code: 'SWSH9',    names: ['brilliant stars'] },
  { code: 'SWSH10',   names: ['astral radiance'] },
  { code: 'SWSH10.5', names: ['pokémon go', 'pokemon go'] },
  { code: 'SWSH11',   names: ['lost origin'] },
  { code: 'SWSH12',   names: ['silver tempest'] },
  { code: 'SWSH12.5', names: ['crown zenith'] },
  // Scarlet & Violet
  { code: 'SV1',   names: ['scarlet & violet base', 'scarlet and violet base', 'scarlet & violet', 'sv base'] },
  { code: 'SV2',   names: ['paldea evolved'] },
  { code: 'SV3',   names: ['obsidian flames'] },
  { code: 'SV3.5', names: ['151', 'pokemon 151', 'pokémon 151'] },
  { code: 'SV4',   names: ['paradox rift'] },
  { code: 'SV4.5', names: ['paldean fates'] },
  { code: 'SV5',   names: ['temporal forces'] },
  { code: 'SV6',   names: ['twilight masquerade'] },
  { code: 'SV6.5', names: ['shrouded fable'] },
  { code: 'SV7',   names: ['stellar crown'] },
];

// ── Japanese sets ─────────────────────────────────────────────────────────────

export const JP_SETS: SetEntry[] = [
  // Vintage / Base era
  { code: 'BS',  names: ['expansion pack', 'basic', 'japanese base', 'base set jp'] },
  { code: 'JU',  names: ['jungle jp', 'jungle'] },
  { code: 'FO',  names: ['fossil jp', 'fossil'] },
  { code: 'TR',  names: ['rocket gang', 'team rocket jp', 'team rocket'] },
  { code: 'GY1', names: ['gym heroes jp', 'gym heroes'] },
  { code: 'GY2', names: ['gym challenge jp', 'gym challenge'] },
  { code: 'N1',  names: ['neo genesis jp', 'neo genesis'] },
  { code: 'N2',  names: ['neo discovery jp', 'neo discovery', 'neo 2'] },
  { code: 'N3',  names: ['neo revelation jp', 'neo revelation', 'neo 3'] },
  { code: 'N4',  names: ['neo destiny jp', 'neo destiny', 'neo 4'] },
  { code: 'NEO', names: ['neo'] },
  // e-Card / Misc vintage
  { code: 'E1',   names: ['expedition jp', 'expedition'] },
  { code: 'VEND96',  names: ['1996 bandai carddass vending', '1996 bandai carddass', 'bandai carddass vending', 'carddass vending', 'bandai carddass'] },
  { code: 'VEND97',  names: ['1997 bandai carddass vending', '1997 bandai carddass', '1997 carddass', 'pocket monsters carddass'] },
  { code: 'CDPROMO', names: ['cd promo', 'vending series', 'vending machine series', 'vending'] },
  { code: 'VS',   names: ['vs series', 'vs'] },
  { code: 'WEB',  names: ['web series', 'web'] },
  // DP special subsets
  { code: 'DP-SD', names: ['shining darkness', 'diamond & pearl shining darkness', 'diamond pearl shining darkness', 'dp shining darkness'] },
  // BW special subsets
  { code: 'BW-SF', names: ['spiral force', 'bw spiral force', 'black & white spiral force', 'black white spiral force'] },
  { code: 'BW-CF', names: ['cold flare', 'bw cold flare', 'black & white cold flare'] },
  // Mega era (Old Back series)
  { code: 'M1L', names: ['mega brave'] },
  { code: 'M1S', names: ['mega symphonia'] },
  { code: 'M2',  names: ['inferno x'] },
  // Sun & Moon — PSA uses SM prefix (SM1, SM1+, SM2K, SM2L, etc.)
  { code: 'SM1',   names: ['collection sun', 'sm1'] },
  { code: 'SM1+',  names: ['collection moon', 'sm1+'] },
  { code: 'SM2K',  names: ['to have seen the battle rainbow', 'sm2k'] },
  { code: 'SM2L',  names: ['alolan moonlight', 'sm2l'] },
  { code: 'SM3H',  names: ['burning shadows jp', 'sm3h'] },
  { code: 'SM3N',  names: ['light-devouring darkness', 'sm3n'] },
  { code: 'SM4+',  names: ['gx battle boost', 'sm4+'] },
  { code: 'SM5M',  names: ['ultra moon', 'sm5m'] },
  { code: 'SM5S',  names: ['ultra sun', 'sm5s'] },
  { code: 'SM6',   names: ['forbidden light jp', 'sm6'] },
  { code: 'SM6a',  names: ['dragon storm', 'sm6a'] },
  { code: 'SM7',   names: ['thunderclap spark', 'sm7'] },
  { code: 'SM7a',  names: ['fairy rise', 'sm7a'] },
  { code: 'SM8',   names: ['super-burst impact', 'super burst impact', 'sm8'] },
  { code: 'SM8b',  names: ['gx ultra shiny', 'ultra shiny gx', 'sm8b'] },
  { code: 'SM9',   names: ['tag bolt', 'sm9'] },
  { code: 'SM9a',  names: ['night unison', 'sm9a'] },
  { code: 'SM10',  names: ['double blaze', 'sm10'] },
  { code: 'SM10a', names: ['gg end', 'sm10a'] },
  { code: 'SM11',  names: ['miracle twin', 'sm11'] },
  { code: 'SM11a', names: ['remix bout', 'sm11a'] },
  { code: 'SM12',  names: ['alter genesis', 'sm12'] },
  { code: 'SM12a', names: ['tag team gx all stars', 'tag all stars', 'sm12a'] },
  // Sword & Shield — PSA uses S1H/S1W, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, S12, etc.
  { code: 'S1W',  names: ['sword', 's1w'] },
  { code: 'S1H',  names: ['shield', 's1h'] },
  { code: 'S2',   names: ['vmax rising', 's2'] },
  { code: 'S2a',  names: ['legendary heartbeat', 's2a'] },
  { code: 'S3',   names: ['infinity zone', 's3'] },
  { code: 'S3a',  names: ['amazing volt tackle', 's3a'] },
  { code: 'S4',   names: ['amazing volt tackle', 's4'] },
  { code: 'S4a',  names: ['shiny star v', 's4a'] },
  { code: 'S5I',  names: ['single strike master', 's5i'] },
  { code: 'S5R',  names: ['rapid strike master', 's5r'] },
  { code: 'S6H',  names: ['silver lance', 's6h'] },
  { code: 'S6a',  names: ['jet-black spirit', 'jet black spirit', 's6a'] },
  { code: 'S7D',  names: ['skyscraping perfection', 's7d'] },
  { code: 'S7R',  names: ['blue sky stream', 's7r'] },
  { code: 'S8',   names: ['fusion arts', 's8'] },
  { code: 'S8a',  names: ['vmax climax', 's8a'] },
  { code: 'S9',   names: ['star birth', 's9'] },
  { code: 'S9a',  names: ['battle region', 's9a'] },
  { code: 'S10D', names: ['time gazer', 's10d'] },
  { code: 'S10P', names: ['space juggler', 's10p'] },
  { code: 'S10a', names: ['dark phantasma', 's10a'] },
  { code: 'S11',  names: ['lost abyss', 's11'] },
  { code: 'S11a', names: ['incandescent arcana', 's11a'] },
  { code: 'S12',  names: ['paradigm trigger', 's12'] },
  { code: 'S12a', names: ['vstar universe', 's12a'] },
  // Scarlet & Violet — PSA uses SV1S, SV1V, SV2D, SV2P, SV3K, SV3M, etc.
  { code: 'SV1',  names: ['scarlet ex', 'scarlet', 'sv1s', 'sv1'] },
  { code: 'SV1V', names: ['violet ex', 'violet', 'sv1v'] },
  { code: 'SV1a', names: ['triplet beat', 'sv1a'] },
  { code: 'SV2a', names: ['pokemon card 151', 'pokémon card 151', '151 jp', 'sv2a'] },
  { code: 'SV2D', names: ['clay burst', 'sv2d'] },
  { code: 'SV2P', names: ['snow hazard', 'sv2p'] },
  { code: 'SV3',  names: ['ruler of the black flame', 'sv3k', 'sv3'] },
  { code: 'SV3a', names: ['raging surf', 'sv3a'] },
  { code: 'SV4K', names: ['ancient roar', 'sv4k'] },
  { code: 'SV4M', names: ['future flash', 'sv4m'] },
  { code: 'SV4a', names: ['shiny treasure ex', 'sv4a'] },
  { code: 'SV5K', names: ['wild force', 'sv5k'] },
  { code: 'SV5M', names: ['cyber judge', 'sv5m'] },
  { code: 'SV6',  names: ['mask of change', 'sv6'] },
  { code: 'SV6a', names: ['night wanderer', 'sv6a'] },
  { code: 'SV7',  names: ['stellar miracle', 'sv7'] },
  { code: 'SV7a', names: ['paradise dragona', 'sv7a'] },
  { code: 'SV8',  names: ['super electric breaker', 'sv8'] },
  { code: 'SV8a', names: ['terastal festival ex', 'terastal fest ex', 'terastal fest', 'sv8a'] },
  // SV special
  { code: 'SV9',  names: ['battle partners', 'sv9'] },
  { code: 'SV10', names: ['glory of team rocket', 'sv10'] },
  // Promos
  { code: 'PROMO-P',   names: ['corocoro', 'corocoro comics', 'promo corocoro', "mcdonald's", 'mcdonalds', 'game movie', 'movie promo', 'promo card pack'] },
  { code: 'PROMO-SP',  names: ['s-p promo', 's promo', 'swsh promo jp', 'sword shield promo jp'] },
  { code: 'PROMO-SVP', names: ['sv-p promo', 'svp promo', 'sv promo jp'] },
  { code: 'PROMO-MP',  names: ['m-p promo', 'mp promo'] },
];

// ── Lookup ────────────────────────────────────────────────────────────────────

// Build index: normalized name → code, keyed by language
type LangMap = Map<string, string>;

function buildIndex(sets: SetEntry[]): LangMap {
  const map: LangMap = new Map();
  for (const entry of sets) {
    for (const name of entry.names) {
      map.set(name.toLowerCase(), entry.code);
    }
  }
  return map;
}

const EN_INDEX = buildIndex(EN_SETS);
const JP_INDEX = buildIndex(JP_SETS);

/**
 * Look up a set code part given a language and a set name as it appears in
 * a PSA/grading label. Tries longest-first substring matching.
 * Returns null if no match found.
 */
export function lookupSetCode(language: 'EN' | 'JP', setName: string): string | null {
  const index = language === 'JP' ? JP_INDEX : EN_INDEX;
  const sets  = language === 'JP' ? JP_SETS  : EN_SETS;
  const norm  = setName.toLowerCase().trim();
  // Also try a normalized version where hyphens/underscores → spaces
  const normSpaced = norm.replace(/[-_]/g, ' ');

  // Exact match first (alias index)
  const exact = index.get(norm) ?? index.get(normSpaced);
  if (exact) return exact;

  // Build alias list, augmented with each set's own code as an alias.
  const allAliases: { alias: string; code: string }[] = [];
  for (const entry of sets) {
    const codeLower = entry.code.toLowerCase();
    allAliases.push({ alias: codeLower, code: entry.code });
    const codeSpaced = codeLower.replace(/[-_]/g, ' ');
    if (codeSpaced !== codeLower) allAliases.push({ alias: codeSpaced, code: entry.code });
    for (const name of entry.names) {
      allAliases.push({ alias: name, code: entry.code });
    }
  }
  // Longest match wins — prevents "sv1" matching before "sv1a", "xy" before "xy2"
  allAliases.sort((a, b) => b.alias.length - a.alias.length);

  for (const { alias, code } of allAliases) {
    if (norm.includes(alias) || normSpaced.includes(alias)) return code;
  }

  return null;
}

/**
 * Given a language and set code, return the canonical (first) name for that set.
 * Returns null if the set code is not found in the static lists.
 */
export function lookupSetName(language: 'EN' | 'JP', setCode: string): string | null {
  const sets = language === 'JP' ? JP_SETS : EN_SETS;
  const entry = sets.find(s => s.code === setCode);
  return entry ? entry.names[0] : null;
}

/**
 * Load DB-stored aliases and return an augmented lookup function that checks
 * the DB first, then falls back to the static map.
 */
export async function buildLookupWithDbAliases(
  dbClient: { query: (sql: string, params?: unknown[]) => Promise<{ rows: { language: string; alias: string; set_code: string }[] }> },
  userId?: string
): Promise<(language: 'EN' | 'JP', setName: string) => string | null> {
  const { rows } = userId
    ? await dbClient.query(`SELECT language, alias, set_code FROM pokemon_set_aliases WHERE user_id = $1`, [userId])
    : await dbClient.query(`SELECT language, alias, set_code FROM pokemon_set_aliases`);

  const enExtra = new Map<string, string>();
  const jpExtra = new Map<string, string>();

  for (const row of rows) {
    const map = row.language === 'JP' ? jpExtra : enExtra;
    map.set(row.alias.toLowerCase(), row.set_code);
  }

  return function lookup(language: 'EN' | 'JP', setName: string): string | null {
    const extra = language === 'JP' ? jpExtra : enExtra;
    const norm = setName.toLowerCase().trim();

    // DB aliases — exact first, then substring
    const dbExact = extra.get(norm);
    if (dbExact) return dbExact;

    for (const [alias, code] of [...extra.entries()].sort((a, b) => b[0].length - a[0].length)) {
      if (norm.includes(alias)) return code;
    }

    // Fall back to static map
    return lookupSetCode(language, setName);
  };
}

/**
 * Generate a part number (SKU) given parsed card fields.
 *
 * @param language  'EN' | 'JP'
 * @param setCode   Set code part (from lookupSetCode), e.g. 'SWSH9', 'SV3.5'
 * @param cardNumber  Raw card number string — will be zero-padded to 3 digits
 */
export function generatePartNumber(language: 'EN' | 'JP', setCode: string, cardNumber: string): string {
  const rawNum = cardNumber.split('/')[0].trim();
  const paddedNum = rawNum.replace(/[^0-9]/g, '').padStart(3, '0') || rawNum;
  return `PKMN-${language}-${setCode}-${paddedNum}`;
}
