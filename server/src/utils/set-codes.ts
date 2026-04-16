/**
 * Pokemon TCG internal set code reference.
 * Format: PKMN-{Lang}-{CODE}-{num}
 *
 * Each entry has a code (the part used in the SKU) and a list of lowercase
 * name aliases as they appear in PSA/grading-company label strings.
 */

interface SetEntry {
  code: string;       // SKU set code part, e.g. 'SWSH9', 'SPEC-S8a', 'BS1'
  names: string[];    // lowercase aliases — longest/most-specific listed first
}

// ── English sets ──────────────────────────────────────────────────────────────

export const EN_SETS: SetEntry[] = [
  // Base era
  { code: 'BS1',  names: ['base set', 'base'] },
  { code: 'JG',   names: ['jungle'] },
  { code: 'FO',   names: ['fossil'] },
  { code: 'BS2',  names: ['base set 2'] },
  { code: 'TR',   names: ['team rocket'] },
  { code: 'GH',   names: ['gym heroes'] },
  { code: 'GC',   names: ['gym challenge'] },
  // Neo
  { code: 'NEO1', names: ['neo genesis'] },
  { code: 'NEO2', names: ['neo discovery'] },
  { code: 'NEO3', names: ['neo revelation'] },
  { code: 'NEO4', names: ['neo destiny'] },
  // Misc classic
  { code: 'LC',   names: ['legendary collection'] },
  // e-Card
  { code: 'E1',   names: ['expedition'] },
  { code: 'E2',   names: ['aquapolis'] },
  { code: 'E3',   names: ['skyridge'] },
  // EX / ADV era
  { code: 'ADV1',  names: ['ex ruby & sapphire', 'ex ruby and sapphire', 'ex ruby sapphire'] },
  { code: 'ADV2',  names: ['ex sandstorm'] },
  { code: 'ADV3',  names: ['ex dragon'] },
  { code: 'ADV4',  names: ['ex team magma vs aqua', 'ex team magma vs team aqua'] },
  { code: 'ADV5',  names: ['ex hidden legends'] },
  { code: 'ADV6',  names: ['ex firered leafgreen', 'ex firered & leafgreen', 'ex fire red leaf green'] },
  { code: 'ADV7',  names: ['ex team rocket returns'] },
  { code: 'ADV8',  names: ['ex deoxys'] },
  { code: 'ADV9',  names: ['ex emerald'] },
  { code: 'ADV10', names: ['ex unseen forces'] },
  { code: 'ADV11', names: ['ex delta species'] },
  { code: 'ADV12', names: ['ex legend maker'] },
  { code: 'ADV13', names: ['ex holon phantoms'] },
  { code: 'ADV14', names: ['ex crystal guardians'] },
  { code: 'ADV15', names: ['ex dragon frontiers'] },
  { code: 'ADV16', names: ['ex power keepers'] },
  // Diamond & Pearl
  { code: 'DP1',  names: ['diamond & pearl', 'diamond and pearl', 'diamond pearl'] },
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
  // HGSS
  { code: 'HGSS1', names: ['heartgold soulsilver', 'heartgold & soulsilver', 'heart gold soul silver', 'hgss'] },
  { code: 'HGSS2', names: ['unleashed'] },
  { code: 'HGSS3', names: ['undaunted'] },
  { code: 'HGSS4', names: ['triumphant'] },
  // Black & White
  { code: 'BW1',  names: ['black & white', 'black and white', 'black white'] },
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
  { code: 'XY1',  names: ['xy base', 'xy'] },
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
  { code: 'SM1',  names: ['sun & moon', 'sun and moon', 'sun moon'] },
  { code: 'SM2',  names: ['guardians rising'] },
  { code: 'SM3',  names: ['burning shadows'] },
  { code: 'SM4',  names: ['crimson invasion'] },
  { code: 'SM5',  names: ['ultra prism'] },
  { code: 'SM6',  names: ['forbidden light'] },
  { code: 'SM7',  names: ['celestial storm'] },
  { code: 'SM8',  names: ['lost thunder'] },
  { code: 'SM9',  names: ['team up'] },
  { code: 'SM10', names: ['unbroken bonds'] },
  { code: 'SM11', names: ['unified minds'] },
  { code: 'SM12', names: ['cosmic eclipse'] },
  // Sword & Shield
  { code: 'SWSH1',  names: ['sword & shield', 'sword and shield base', 'swsh base'] },
  { code: 'SWSH2',  names: ['rebel clash', 'sword and shield rebel clash'] },
  { code: 'SWSH3',  names: ['darkness ablaze', 'sword and shield darkness ablaze'] },
  { code: 'SWSH4',  names: ['vivid voltage', 'sword and shield vivid voltage'] },
  { code: 'SWSH5',  names: ['battle styles', 'sword and shield battle styles'] },
  { code: 'SWSH6',  names: ['chilling reign', 'sword and shield chilling reign'] },
  { code: 'SWSH7',  names: ['evolving skies', 'sword and shield evolving skies'] },
  { code: 'SWSH8',  names: ['fusion strike', 'sword and shield fusion strike'] },
  { code: 'SWSH9',  names: ['brilliant stars', 'sword and shield brilliant stars', 'swsh brilliant stars'] },
  { code: 'SWSH10', names: ['astral radiance', 'sword and shield astral radiance'] },
  { code: 'SWSH11', names: ['lost origin', 'sword and shield lost origin'] },
  { code: 'SWSH12', names: ['silver tempest', 'sword and shield silver tempest'] },
  // Scarlet & Violet
  { code: 'SV1',  names: ['scarlet & violet', 'scarlet and violet base', 'sv base'] },
  { code: 'SV2',  names: ['paldea evolved'] },
  { code: 'SV3',  names: ['obsidian flames'] },
  { code: 'SV4',  names: ['paradox rift'] },
  { code: 'SV5',  names: ['temporal forces'] },
  { code: 'SV6',  names: ['twilight masquerade'] },
  { code: 'SV7',  names: ['stellar crown'] },
  { code: 'SV8',  names: ['surging sparks'] },
  // Special / subset
  { code: 'SPEC-SL',  names: ['shining legends'] },
  { code: 'SPEC-HF',  names: ['hidden fates'] },
  { code: 'SPEC-CP',  names: ["champion's path", 'champions path'] },
  { code: 'SPEC-SF',  names: ['shining fates'] },
  { code: 'SPEC-CZ',  names: ['crown zenith'] },
  { code: 'SPEC-DET', names: ['detective pikachu'] },
  { code: 'SPEC-GEN', names: ['generations'] },
  { code: 'SPEC-DRM', names: ['dragon majesty'] },
  { code: 'SPEC-GO',  names: ['pokemon go', 'pokémon go'] },
  { code: 'SPEC-151', names: ['pokemon 151', 'pokémon 151', '151'] },
  { code: 'SPEC-PRC', names: ['prismatic evolutions'] },
  { code: 'SPEC-CEL', names: ['celebrations', 'celebrations: classic collection', 'classic collection', '25th anniversary classic collection'] },
  // Promos
  { code: 'PROMO-WOTC', names: ['wotc black star promo', 'wotc promo', 'wizards black star promo'] },
  { code: 'PROMO-NP',   names: ['nintendo promo', 'np promo'] },
  { code: 'PROMO-DPP',  names: ['dp promo', 'dp black star promo'] },
  { code: 'PROMO-HGSS', names: ['hgss promo', 'heartgold soulsilver promo'] },
  { code: 'PROMO-BW',   names: ['bw promo', 'bw black star promo', 'black white promo'] },
  { code: 'PROMO-XY',   names: ['xy promo', 'xy black star promo'] },
  { code: 'PROMO-SM',   names: ['sm promo', 'sun moon promo', 'sm black star promo'] },
  { code: 'PROMO-SWSH', names: ['swsh promo', 'swsh black star promo', 'sword shield promo', 'sword and shield promo'] },
  { code: 'PROMO-SV',   names: ['sv promo', 'scarlet violet promo', 'sv black star promo'] },
];

// ── Japanese sets ─────────────────────────────────────────────────────────────

export const JP_SETS: SetEntry[] = [
  // Base era
  { code: 'BS1',  names: ['expansion pack', 'basic', 'japanese base', 'base set'] },
  { code: 'JG',   names: ['jungle'] },
  { code: 'FO',   names: ['fossil'] },
  { code: 'TR',   names: ['rocket gang', 'team rocket'] },
  { code: 'GY1',  names: ['gym heroes'] },
  { code: 'GY2',  names: ['gym challenge'] },
  // Neo
  { code: 'NEO1', names: ['neo genesis'] },
  { code: 'NEO2', names: ['neo discovery', 'neo 2'] },
  { code: 'NEO3', names: ['neo revelation', 'neo 3'] },
  { code: 'NEO4', names: ['neo destiny', 'neo 4'] },
  // e-Card
  { code: 'E1',   names: ['expedition'] },
  { code: 'E2',   names: ['aquapolis', 'the town on no map'] },
  { code: 'E3',   names: ['skyridge'] },
  // Misc
  { code: 'VS',   names: ['vs series', 'vs'] },
  { code: 'WEB',  names: ['web series', 'web'] },
  { code: 'CD96', names: ['japanese bandai carddass vending', 'bandai carddass vending', 'carddass vending', 'bandai carddass'] },
  { code: 'CD97', names: ['pocket monsters carddass', '1997 carddass'] },
  { code: 'VEND', names: ['vending series', 'vending machine series', 'ooyama', 'vending'] },
  // ADV era
  { code: 'ADV1',  names: ['adv expansion pack', 'adv1'] },
  { code: 'ADV2',  names: ['miracle of the desert'] },
  { code: 'ADV3',  names: ['rulers of the heavens'] },
  { code: 'ADV4',  names: ['team magma vs aqua', 'magma vs aqua'] },
  { code: 'ADV5',  names: ['hidden legends'] },
  { code: 'ADV6',  names: ['firered leafgreen', 'fire red leaf green', 'firered & leafgreen'] },
  { code: 'ADV7',  names: ['rocket returns'] },
  { code: 'ADV8',  names: ['deoxys'] },
  { code: 'ADV9',  names: ['emerald'] },
  { code: 'ADV10', names: ['unseen forces'] },
  { code: 'ADV11', names: ['delta species'] },
  { code: 'ADV12', names: ['legend maker'] },
  { code: 'ADV13', names: ['holon phantoms'] },
  { code: 'ADV14', names: ['crystal guardians'] },
  { code: 'ADV15', names: ['dragon frontiers'] },
  { code: 'ADV16', names: ['power keepers'] },
  // DP
  { code: 'DP1',  names: ['diamond pearl', 'diamond & pearl', 'dp'] },
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
  // HGSS
  { code: 'HGSS1', names: ['heartgold'] },
  { code: 'HGSS2', names: ['soulsilver'] },
  { code: 'HGSS3', names: ['lost link'] },
  { code: 'HGSS4', names: ['triumphant'] },
  // HGSS special subsets
  { code: 'HGSS-REV', names: ['reviving legends', 'reviving legend'] },
  { code: 'HGSS-GOL', names: ['golden sky, silvery ocean', 'golden sky silvery ocean'] },
  { code: 'HGSS-TCG', names: ['clash at the summit', 'legend maker jp'] },
  // BW special subsets
  { code: 'BW-EX',  names: ['black & white ex battle boost', 'ex battle boost', 'bw ex battle boost'] },
  { code: 'BW-WB',  names: ['wild blaze'] },
  { code: 'BW-SD',  names: ['shining darkness'] },
  { code: 'BW-BF',  names: ['beat of the frontier'] },
  { code: 'BW-GC',  names: ["galactic's conquest", 'galactic conquest'] },
  // BW
  { code: 'BW1',  names: ['black collection'] },
  { code: 'BW2',  names: ['white collection'] },
  { code: 'BW3',  names: ['emerging powers'] },
  { code: 'BW4',  names: ['dark rush'] },
  { code: 'BW5',  names: ['dragons exalted', 'dragon exalted'] },
  { code: 'BW6',  names: ['cold flare'] },
  { code: 'BW7',  names: ['plasma gale'] },
  { code: 'BW8',  names: ['plasma freeze'] },
  { code: 'BW9',  names: ['megalo cannon'] },
  // XY special subsets
  { code: 'XY-LSC',  names: ['legendary shine collection'] },
  { code: 'XY-POK',  names: ['pokekyun collection', 'xy pokekyun collection'] },
  { code: 'XY-HMC',  names: ['hyper metal chain deck'] },
  { code: 'XY-HRT',  names: ['holon research tower'] },
  { code: 'XY-MLD',  names: ['mythical & legendary dream shine collection', 'mythical legendary dream shine'] },
  { code: 'XY-YOK',  names: ['world championships yokohama deck', 'yokohama deck', 'world championships yokohama deck: pikachu'] },
  { code: 'XY-20TH', names: ['expansion 20th anniversary', '20th anniversary expansion', 'xy 20th anniversary', 'base set 20th anniversary', 'base set 20th'] },
  // XY
  { code: 'XY1',  names: ['collection x', 'xy base', 'xy'] },
  { code: 'XY2',  names: ['collection y'] },
  { code: 'XY3',  names: ['rising fist'] },
  { code: 'XY4',  names: ['phantom gate'] },
  { code: 'XY5',  names: ['gaia volcano'] },
  { code: 'XY6',  names: ['tidal storm'] },
  { code: 'XY7',  names: ['bandit ring'] },
  { code: 'XY8',  names: ['blue shock'] },
  { code: 'XY9',  names: ['red flash'] },
  { code: 'XY10', names: ['rage of broken heavens'] },
  { code: 'XY11', names: ['explosive fighter'] },
  { code: 'XY12', names: ['cruel traitor'] },
  // SM
  { code: 'SM1',  names: ['collection sun'] },
  { code: 'SM2',  names: ['collection moon'] },
  { code: 'SM3',  names: ['to have seen the battle rainbow', 'islands awaiting you'] },
  { code: 'SM4',  names: ['awakening psychic king'] },
  { code: 'SM5',  names: ['ultra sun'] },
  { code: 'SM6',  names: ['ultra moon'] },
  { code: 'SM7',  names: ['dragon storm'] },
  { code: 'SM8',  names: ['super burst impact'] },
  { code: 'SM9',  names: ['tag bolt'] },
  { code: 'SM10', names: ['double blaze'] },
  { code: 'SM11', names: ['miracle twin'] },
  { code: 'SM12', names: ['alter genesis'] },
  // SM special subsets / strength expansion packs
  { code: 'SM-MC',   names: ['miracle crystal'] },
  { code: 'SM-SF',   names: ['spiral force'] },
  { code: 'SM-SBI',  names: ['super-burst impact', 'super burst impact'] },
  { code: 'SM-GO',   names: ['pokemon go japanese', 'pokemon go jp', 'pokemon go'] },
  { code: 'SM-SKY',  names: ['sky legend'] },
  { code: 'SM-NUN',  names: ['night unison', 'strength expansion pack night unison'] },
  { code: 'SM-FMW',  names: ['full metal wall'] },
  { code: 'SM-RMX',  names: ['remix bout', 'sm remix bout'] },
  { code: 'SM-USG',  names: ['ultra shiny gx', 'ultra shiny'] },
  { code: 'SM-DRL',  names: ['dream league'] },
  { code: 'SPEC-SM12a', names: ['tag team gx all stars', 'tag team all stars'] },
  // SWSH
  { code: 'SWSH1',  names: ['sword'] },
  { code: 'SWSH2',  names: ['shield'] },
  { code: 'SWSH3',  names: ['vmax rising'] },
  { code: 'SWSH4',  names: ['rebellion crash'] },
  { code: 'SWSH5',  names: ['infinity zone'] },
  { code: 'SWSH6',  names: ['amazing volt tackle'] },
  { code: 'SWSH7',  names: ['single strike master'] },
  { code: 'SWSH8',  names: ['rapid strike master'] },
  { code: 'SWSH9',  names: ['jet-black spirit', 'jet black spirit'] },
  { code: 'SWSH10', names: ['silver lance'] },
  { code: 'SWSH11', names: ['blue sky stream'] },
  { code: 'SWSH12', names: ['eevee heroes'] },
  { code: 'SWSH13', names: ['fusion arts'] },
  // TCG Classic umbrella / misc
  { code: 'CLF', names: ['trading card game classic', 'classic collection', 'classic', 'special deck set', 'charizard vmax starter set'] },
  // TCG Classic decks (2023, CLF/CLL/CLK) — many label variations
  { code: 'CLF', names: ['classic venusaur & lugia ex deck', 'classic venusaur & lugia ex', 'classics venusaur & lugia ex deck', 'classic collection - venusaur & lugia ex deck', 'classic deck - venusaur & lugia ex', 'tcg classic venusaur', 'clf', 'venusaur & charizard & blastoise special deck set ex', 'venusaur & charizard & blastoise special deck set'] },
  { code: 'CLL', names: ['classic charizard & ho-oh ex deck', 'classic charizard & ho-oh ex', 'classics charizard & ho-oh ex deck', 'classic collection - charizard & ho-oh ex deck', 'classic deck - charizard & ho-oh ex', 'tcg classic charizard', 'cll'] },
  { code: 'CLK', names: ['classic blastoise & suicune ex deck', 'classic blastoise & suicune ex', 'classics blastoise & suicune ex deck', 'classic collection - blastoise & suicune ex deck', 'classic deck - blastoise & suicune ex', 'tcg classic blastoise', 'clk'] },
  // SWSH special subsets (JP-only sets not in main SWSH line)
  { code: 'SWSH-SB',  names: ['star birth'] },
  { code: 'SWSH-TG',  names: ['time gazer'] },
  { code: 'SWSH-SJ',  names: ['space juggler'] },
  { code: 'SWSH-DP',  names: ['dark phantasma'] },
  { code: 'SWSH-IA',  names: ['incandescent arcana'] },
  { code: 'SWSH-PT',  names: ['paradigm trigger'] },
  { code: 'SWSH-BR',  names: ['battle region'] },
  { code: 'SWSH-LA',  names: ['lost abyss'] },
  // SV
  { code: 'SV1',  names: ['scarlet ex', 'scarlet'] },
  { code: 'SV1V', names: ['violet ex', 'violet'] },
  { code: 'SV1a', names: ['triplet beat'] },
  { code: 'SV2',  names: ['snow hazard'] },
  { code: 'SV2a', names: ['pokemon card 151', 'pokémon card 151', '151'] },
  { code: 'SV3',  names: ['ruler of the black flame'] },
  { code: 'SV3a', names: ['raging surf'] },
  { code: 'SV4',  names: ['ancient roar'] },
  { code: 'SV4a', names: ['shiny treasure ex'] },
  { code: 'SV5',  names: ['cyber judge', 'clay burst', 'sv5k', 'sv5m'] },
  { code: 'SV5a', names: ['wild force'] },
  { code: 'SV6',  names: ['mask of change'] },
  { code: 'SV6a', names: ['night wanderer'] },
  { code: 'SV7',  names: ['stellar miracle'] },
  { code: 'SV7a', names: ['paradise dragona'] },
  { code: 'SV8',  names: ['super electric breaker'] },
  // SV special subsets
  { code: 'SV9',     names: ['battle partners'] },
  { code: 'SV11W',   names: ['white flare'] },
  { code: 'SV11B',   names: ['black bolt'] },
  { code: 'M1L',     names: ['mega brave'] },
  { code: 'M1S',     names: ['mega symphonia'] },
  { code: 'SV-CH',   names: ['crimson haze'] },
  { code: 'SV-FF',   names: ['future flash', 'shining treasure'] },
  { code: 'SV-TM',   names: ['transformation mask'] },
  { code: 'SV-US',   names: ['undone seal'] },
  { code: 'SV8a',    names: ['terastal fest', 'terastal fest ex'] },
  { code: 'SV9a',    names: ['heat wave arena'] },
  { code: 'SV-DD',   names: ['dawn dash'] },
  { code: 'SV-WCP',  names: ['world champions pack'] },
  // Special
  { code: 'SPEC-CP6',  names: ['20th anniversary', '20th anniversary cp6', 'cp6'] },
  { code: 'SPEC-SM12a',names: ['tag all stars'] },
  { code: 'SPEC-S4a',  names: ['shiny star v'] },
  { code: 'SPEC-S8a',  names: ['vmax climax', 'sword & shield vmax climax', 'sword shield vmax climax', 's8a'] },
  { code: 'SPEC-S12a', names: ['vstar universe'] },
  { code: 'SPEC-SV4a', names: ['shiny treasure ex'] },
  // Promos
  { code: 'PROMO-P',    names: ['classic promo', 'corocoro', 'promo card pack 25th anniversary', '25th anniversary edition', '25th anniversary promo', 'promo card pack', "mcdonald's", 'mcdonalds', 'game movie', 'movie promo'] },
  { code: 'PROMO-DP',   names: ['dp-p promo', 'dp promo'] },
  { code: 'PROMO-PCG',  names: ['pcg promo'] },
  { code: 'PROMO-HGSS', names: ['hgss promo'] },
  { code: 'PROMO-BW',   names: ['bw-p promo', 'bw promo'] },
  { code: 'PROMO-XY',   names: ['xy-p promo', 'xy promo'] },
  { code: 'PROMO-SM',   names: ['sm-p promo', 'sm promo'] },
  { code: 'PROMO-SWSH', names: ['s-p promo', 'swsh promo', 'sword shield promo'] },
  { code: 'PROMO-SV',   names: ['sv-p promo', 'sv promo', 'm-p promo', 'mp promo'] },
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

  // Exact match first
  const exact = index.get(norm);
  if (exact) return exact;

  // Substring match — try all aliases sorted by descending length so the most
  // specific match wins
  const allAliases: { alias: string; code: string }[] = [];
  for (const entry of sets) {
    for (const name of entry.names) {
      allAliases.push({ alias: name, code: entry.code });
    }
  }
  allAliases.sort((a, b) => b.alias.length - a.alias.length);

  for (const { alias, code } of allAliases) {
    if (norm.includes(alias)) return code;
  }

  return null;
}

/**
 * Load DB-stored aliases and return an augmented lookup function that checks
 * the DB first, then falls back to the static map. For use in seed scripts.
 */
export async function buildLookupWithDbAliases(
  dbClient: { query: (sql: string) => Promise<{ rows: { language: string; alias: string; set_code: string }[] }> }
): Promise<(language: 'EN' | 'JP', setName: string) => string | null> {
  const { rows } = await dbClient.query(
    `SELECT language, alias, set_code FROM pokemon_set_aliases`
  );

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
 * @param setCode   Set code part (from lookupSetCode), e.g. 'SWSH9', 'SPEC-S8a'
 *                  Use 'P' for generic promos if you only have era info.
 * @param cardNumber  Raw card number string — will be zero-padded to 3 digits
 */
export function generatePartNumber(language: 'EN' | 'JP', setCode: string, cardNumber: string): string {
  const rawNum = cardNumber.split('/')[0].trim();
  const paddedNum = rawNum.replace(/[^0-9]/g, '').padStart(3, '0') || rawNum;
  return `PKMN-${language}-${setCode}-${paddedNum}`;
}
