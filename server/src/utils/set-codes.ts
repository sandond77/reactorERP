/**
 * Pokemon TCG internal set code reference.
 * Format: PKMN-{Lang}-{CODE}-{num}
 *
 * Each entry has a code (the part used in the SKU) and a list of lowercase
 * name aliases as they appear in PSA/grading-company label strings.
 * First name in the array is the canonical display name.
 */

interface SetEntry {
  code: string;
  names: string[];  // first = canonical display name, rest = aliases (all lowercase)
}

// ── English sets ──────────────────────────────────────────────────────────────

export const EN_SETS: SetEntry[] = [
  // WOTC
  { code: 'BS',   names: ['base set', 'base'] },
  { code: 'JU',   names: ['jungle'] },
  { code: 'FO',   names: ['fossil'] },
  { code: 'BS2',  names: ['base set 2'] },
  { code: 'TR',   names: ['team rocket'] },
  { code: 'G1',   names: ['gym heroes'] },
  { code: 'G2',   names: ['gym challenge'] },
  { code: 'N1',   names: ['neo genesis'] },
  { code: 'N2',   names: ['neo discovery'] },
  { code: 'N3',   names: ['neo revelation'] },
  { code: 'N4',   names: ['neo destiny'] },
  { code: 'LC',   names: ['legendary collection'] },
  // e-Card
  { code: 'EXP',  names: ['expedition', 'expedition base set'] },
  { code: 'AQ',   names: ['aquapolis'] },
  { code: 'SK',   names: ['skyridge'] },
  // EX era
  { code: 'EX1',  names: ['ruby & sapphire', 'ex ruby & sapphire', 'ex ruby and sapphire', 'ex ruby sapphire'] },
  { code: 'EX2',  names: ['sandstorm', 'ex sandstorm'] },
  { code: 'EX3',  names: ['dragon', 'ex dragon'] },
  { code: 'EX4',  names: ['team magma vs aqua', 'ex team magma vs aqua', 'ex team magma vs team aqua'] },
  { code: 'EX5',  names: ['hidden legends', 'ex hidden legends'] },
  { code: 'EX6',  names: ['firered & leafgreen', 'ex firered & leafgreen', 'ex firered leafgreen', 'ex fire red leaf green'] },
  { code: 'EX7',  names: ['team rocket returns', 'ex team rocket returns'] },
  { code: 'EX8',  names: ['deoxys', 'ex deoxys'] },
  { code: 'EX9',  names: ['emerald', 'ex emerald'] },
  { code: 'EX10', names: ['unseen forces', 'ex unseen forces'] },
  { code: 'EX11', names: ['delta species', 'ex delta species'] },
  { code: 'EX12', names: ['legend maker', 'ex legend maker'] },
  { code: 'EX13', names: ['holon phantoms', 'ex holon phantoms'] },
  { code: 'EX14', names: ['crystal guardians', 'ex crystal guardians'] },
  { code: 'EX15', names: ['dragon frontiers', 'ex dragon frontiers'] },
  { code: 'EX16', names: ['power keepers', 'ex power keepers'] },
  // Diamond & Pearl
  { code: 'DP1',  names: ['base set', 'diamond & pearl', 'diamond and pearl', 'diamond pearl base', 'dp base'] },
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
  { code: 'HGSS1', names: ['heartgold soulsilver', 'heartgold & soulsilver', 'heart gold soul silver', 'hgss base'] },
  { code: 'HGSS2', names: ['unleashed'] },
  { code: 'HGSS3', names: ['undaunted'] },
  { code: 'HGSS4', names: ['triumphant'] },
  { code: 'HGSS5', names: ['call of legends'] },
  // Black & White
  { code: 'BW1',   names: ['base set', 'black & white', 'black and white', 'black white base', 'bw base'] },
  { code: 'BW2',   names: ['emerging powers'] },
  { code: 'BW3',   names: ['noble victories'] },
  { code: 'BW4',   names: ['next destinies'] },
  { code: 'BW5',   names: ['dark explorers'] },
  { code: 'BW6',   names: ['dragons exalted', 'dragon exalted'] },
  { code: 'BW7',   names: ['boundaries crossed'] },
  { code: 'BW8',   names: ['plasma storm'] },
  { code: 'BW9',   names: ['plasma freeze'] },
  { code: 'BW10',  names: ['plasma blast'] },
  { code: 'BW11',  names: ['legendary treasures'] },
  { code: 'BW-DV', names: ['dragon vault'] },
  // XY
  { code: 'XY1',   names: ['base set', 'xy base set', 'xy base', 'xy'] },
  { code: 'XY2',   names: ['flashfire'] },
  { code: 'XY3',   names: ['furious fists'] },
  { code: 'XY4',   names: ['phantom forces'] },
  { code: 'XY5',   names: ['primal clash'] },
  { code: 'XY6',   names: ['roaring skies'] },
  { code: 'XY7',   names: ['ancient origins'] },
  { code: 'XY8',   names: ['breakthrough'] },
  { code: 'XY9',   names: ['breakpoint'] },
  { code: 'XY10',  names: ['fates collide'] },
  { code: 'XY11',  names: ['steam siege'] },
  { code: 'XY12',  names: ['evolutions'] },
  { code: 'XY-DC', names: ['double crisis'] },
  { code: 'XY-GEN', names: ['generations'] },
  // Sun & Moon
  { code: 'SM1',    names: ['base set', 'sun & moon base', 'sun and moon base', 'sun moon base'] },
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
  // SM special sets
  { code: 'SM-SL',  names: ['shining legends'] },
  { code: 'SM-DP',  names: ['detective pikachu'] },
  // Sword & Shield
  { code: 'SWSH1',    names: ['base set', 'sword & shield base', 'sword and shield base', 'swsh base'] },
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
  { code: 'SWSH12',    names: ['silver tempest'] },
  { code: 'SWSH12.5', names: ['crown zenith'] },
  { code: 'SWSH-CEL', names: ['celebrations', 'celebrations classic collection', '25th anniversary celebrations'] },
  // Scarlet & Violet
  { code: 'SV1',   names: ['scarlet & violet base', 'scarlet and violet base', 'sv base'] },
  { code: 'SV2',   names: ['paldea evolved'] },
  { code: 'SV3',   names: ['obsidian flames'] },
  { code: 'SV3.5', names: ['151', 'pokemon 151', 'pokémon 151'] },
  { code: 'SV4',   names: ['paradox rift'] },
  { code: 'SV4.5', names: ['paldean fates'] },
  { code: 'SV5',   names: ['temporal forces'] },
  { code: 'SV6',   names: ['twilight masquerade'] },
  { code: 'SV6.5', names: ['shrouded fable'] },
  { code: 'SV7',   names: ['stellar crown'] },
  { code: 'SV7.5', names: ['surging sparks'] },
  { code: 'SV8',   names: ['prismatic evolutions'] },
  { code: 'SV8.5', names: ['journey together'] },
  { code: 'SV9',   names: ['destined rivals'] },
  { code: 'SV10',  names: ['black bolt & white flare', 'black bolt white flare'] },
  // Promos
  { code: 'SV-P',    names: ['scarlet & violet promo', 'scarlet & violet promos', 'sv promo', 'sv promos', 'sv black star promo', 'sv black star promos'] },
  { code: 'SWSH-P',  names: ['sword & shield promo', 'sword & shield promos', 'swsh promo', 'swsh promos', 'swsh black star promo', 'swsh black star promos', 'sword shield promo'] },
  { code: 'SM-P',    names: ['sun & moon promo', 'sun & moon promos', 'sm promo', 'sm promos', 'sm black star promo', 'sm black star promos'] },
  { code: 'PROMO-XY',   names: ['xy promo', 'xy promos', 'xy black star promo', 'xy black star promos'] },
  { code: 'PROMO-BW',   names: ['bw promo', 'bw promos', 'bw black star promo', 'bw black star promos', 'black white promo'] },
  { code: 'PROMO-HGSS', names: ['hgss promo', 'hgss promos', 'heartgold soulsilver promo'] },
  { code: 'PROMO-DP',   names: ['dp promo', 'dp promos', 'dp black star promo'] },
  { code: 'PROMO-WOTC', names: ['wotc black star promo', 'wotc promos', 'wotc promo', 'wizards black star promo'] },
];

// ── Japanese sets ─────────────────────────────────────────────────────────────

export const JP_SETS: SetEntry[] = [
  // Vintage / WOTC era
  { code: 'BS',  names: ['expansion pack', 'basic', 'japanese base', 'base set jp'] },
  { code: 'JU',  names: ['jungle jp', 'jungle'] },
  { code: 'FO',  names: ['fossil jp', 'fossil'] },
  { code: 'TR',  names: ['rocket gang', 'team rocket jp'] },
  { code: 'GY1', names: ['gym heroes jp', 'gym heroes'] },
  { code: 'GY2', names: ['gym challenge jp', 'gym challenge'] },
  { code: 'N1',  names: ['neo genesis jp', 'neo genesis'] },
  { code: 'N2',  names: ['neo discovery jp', 'neo discovery', 'neo 2'] },
  { code: 'N3',  names: ['neo revelation jp', 'neo revelation', 'neo 3'] },
  { code: 'N4',  names: ['neo destiny jp', 'neo destiny', 'neo 4'] },
  { code: 'NEO', names: ['neo'] },
  // e-Card / Misc vintage
  { code: 'E1',      names: ['expedition jp', 'expedition'] },
  { code: 'VS',      names: ['vs series', 'vs'] },
  { code: 'WEB',     names: ['web series', 'web'] },
  { code: 'VEND96',  names: ['1996 bandai carddass vending', '1996 bandai carddass', 'bandai carddass vending', 'carddass vending', 'bandai carddass'] },
  { code: 'VEND97',  names: ['1997 bandai carddass vending', '1997 bandai carddass', '1997 carddass', 'pocket monsters carddass'] },
  { code: 'CDPROMO', names: ['cd promo', 'vending series', 'vending machine series'] },
  // EX / PCG era
  { code: 'PCG1', names: ['expansion pack pcg', 'pcg expansion pack', 'pcg1'] },
  { code: 'PCG2', names: ['flight of legends', 'pcg2'] },
  { code: 'PCG3', names: ['clash of the blue sky', 'pcg3'] },
  { code: 'PCG4', names: ['team rocket returns jp', 'pcg4'] },
  { code: 'PCG5', names: ['miracle of the desert', 'pcg5'] },
  { code: 'PCG6', names: ['holon research tower', 'pcg6'] },
  { code: 'PCG7', names: ['golden sky silvery ocean', 'golden sky, silvery ocean', 'pcg7'] },
  // Diamond & Pearl
  { code: 'DP1',  names: ['diamond collection', 'dp1'] },
  { code: 'DP2',  names: ['pearl collection', 'dp2'] },
  { code: 'DP3',  names: ['secret of the lakes', 'dp3'] },
  { code: 'DP4',  names: ['time-space creation', 'time space creation', 'dp4'] },
  { code: 'DP5',  names: ['shining darkness', 'dp5'] },
  { code: 'DP6',  names: ['clash at summit', 'dp6'] },
  { code: 'DP7',  names: ['offense and defense', 'dp7'] },
  // Platinum
  { code: 'PL1',  names: ['galactic conquest', "galactic's conquest"] },
  { code: 'PL2',  names: ['beat of the frontier'] },
  { code: 'PL3',  names: ['supreme victors jp'] },
  { code: 'PL4',  names: ['arceus jp'] },
  // HGSS
  { code: 'HGSS1', names: ['heartgold jp'] },
  { code: 'HGSS2', names: ['soulsilver jp'] },
  { code: 'HGSS3', names: ['lost link'] },
  { code: 'HGSS4', names: ['reviving legends', 'reviving legend'] },
  { code: 'HGSS5', names: ['clash at the summit jp'] },
  // Black & White
  { code: 'BW1',   names: ['black collection', 'bw1'] },
  { code: 'BW1W',  names: ['white collection', 'bw1w'] },
  { code: 'BW2',   names: ['red collection', 'bw2'] },
  { code: 'BW3',   names: ['psycho drive', 'bw3'] },
  { code: 'BW3B',  names: ['hail blizzard', 'bw3b'] },
  { code: 'BW4',   names: ['dark rush', 'bw4'] },
  { code: 'BW5',   names: ['dragon blade', 'bw5'] },
  { code: 'BW5R',  names: ['dragon blast', 'bw5r'] },
  { code: 'BW6',   names: ['freeze bolt', 'cold flare', 'bw6'] },
  { code: 'BW6C',  names: ['cold flare jp', 'bw6c'] },
  { code: 'BW7',   names: ['plasma gale', 'bw7'] },
  { code: 'BW8',   names: ['thunder knuckle', 'bw8'] },
  { code: 'BW8R',   names: ['spiral force', 'bw8r'] },
  { code: 'BW9',    names: ['megalo cannon', 'bw9'] },
  { code: 'BW-SHC', names: ['shiny collection', 'bw shiny collection'] },
  { code: 'BW-DS',  names: ['dragon selection'] },
  { code: 'BW-EB',  names: ['ex battle boost', 'bw ex battle boost'] },
  // XY / PCGxy
  { code: 'XY1',      names: ['collection x', 'xy base', 'xy'] },
  { code: 'XY2',      names: ['collection y'] },
  { code: 'XY3',      names: ['rising fist'] },
  { code: 'XY4',      names: ['phantom gate'] },
  { code: 'XY5',      names: ['gaia volcano'] },
  { code: 'XY6',      names: ['tidal storm'] },
  { code: 'XY7',      names: ['bandit ring'] },
  { code: 'XY8',      names: ['blue shock'] },
  { code: 'XY9',      names: ['red flash'] },
  { code: 'XY10',     names: ['rage of broken heavens'] },
  { code: 'XY11',     names: ['explosive fighter'] },
  { code: 'XY12',     names: ['cruel traitor'] },
  { code: 'XY-CP2',   names: ['legendary shine collection', 'cp2'] },
  { code: 'XY-CP3',   names: ['pokekyun collection', 'cp3'] },
  { code: 'XY-CP4',   names: ['hyper metal chain deck', 'cp4'] },
  { code: 'XY-CP5',   names: ['mythical & legendary dream shine collection', 'cp5'] },
  { code: 'XY-CP6',   names: ['20th anniversary', 'cp6'] },
  // Sun & Moon — PSA uses SM1S, SM1M, SM2K, SM2L, etc.
  { code: 'SM1S',  names: ['collection sun', 'sm1s'] },
  { code: 'SM1M',  names: ['collection moon', 'sm1m'] },
  { code: 'SM1+',  names: ['sun & moon expansion pack', 'sm expansion pack', 'sm1+'] },
  { code: 'SM2K',  names: ['islands awaiting you', 'to have seen the battle rainbow', 'sm2k'] },
  { code: 'SM2L',  names: ['alolan moonlight', 'sm2l'] },
  { code: 'SM3H',  names: ['burning shadows jp', 'sm3h'] },
  { code: 'SM3N',  names: ['light-devouring darkness', 'sm3n'] },
  { code: 'SM4S',  names: ['awakening of psychic kings', 'awakening psychic king', 'sm4s'] },
  { code: 'SM4A',  names: ['ultra sun jp', 'sm4a'] },
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
  { code: 'SM12a', names: ['tag all stars', 'tag team gx all stars', 'sm12a'] },
  // Sword & Shield — PSA uses S1W, S1H, S2, S2a, S3, S3a, S4, S4a, S5I, S5R, S6H, S6K, S6a, S7D, S7R, S8, S8a, S9, S9a, S10D, S10P, S10a, S11, S11a, S12, S12a
  { code: 'S1W',  names: ['sword', 's1w'] },
  { code: 'S1H',  names: ['shield', 's1h'] },
  { code: 'S2',   names: ['rebellion crash', 'vmax rising', 's2'] },
  { code: 'S2a',  names: ['explosive walker', 's2a'] },
  { code: 'S3',   names: ['infinity zone', 's3'] },
  { code: 'S3a',  names: ['legendary heartbeat', 's3a'] },
  { code: 'S4',   names: ['amazing volt tackle', 's4'] },
  { code: 'S4a',  names: ['shiny star v', 's4a'] },
  { code: 'S5I',  names: ['single strike master', 's5i'] },
  { code: 'S5R',  names: ['rapid strike master', 's5r'] },
  { code: 'S6H',  names: ['silver lance', 's6h'] },
  { code: 'S6K',  names: ['jet-black spirit', 'jet black spirit', 's6k'] },
  { code: 'S6a',  names: ['eevee heroes', 's6a'] },
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
  // Mega era
  { code: 'M1L', names: ['mega brave'] },
  { code: 'M1S', names: ['mega symphonia'] },
  { code: 'M2',  names: ['inferno x'] },
  // Scarlet & Violet — PSA uses SV1S, SV1V, SV2D, SV2P, SV3K, SV3M, etc.
  // Classic Collection decks (2023)
  { code: 'Clf',  names: ['trading card game classic venusaur', 'classic venusaur & lugia', 'classic venusaur lugia', 'clf'] },
  { code: 'Clk',  names: ['trading card game classic blastoise', 'classic blastoise & suicune', 'classic blastoise suicune', 'clk'] },
  { code: 'Cll',  names: ['trading card game classic charizard', 'classic charizard & ho-oh', 'classic charizard ho-oh', 'cll'] },
  { code: 'Svg',  names: ['venusaur & charizard & blastoise special deck', 'special deck set ex', 'svg'] },
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
  { code: 'SV5a',  names: ['crimson haze', 'sv5a'] },
  { code: 'SV8a', names: ['terastal festival ex', 'terastal fest ex', 'terastal fest', 'sv8a'] },
  { code: 'SV9',   names: ['battle partners', 'sv9'] },
  { code: 'SV9a',  names: ['heat wave arena', 'sv9a'] },
  { code: 'SV10',  names: ['glory of team rocket', 'sv10'] },
  { code: 'SV11B', names: ['black bolt', 'sv11b'] },
  { code: 'SV11W', names: ['white flare', 'sv11w'] },
  { code: 'SVLN',  names: ['starter deck terastal type', 'stellar sylveon', 'svln'] },
  // Mega Starter Decks
  { code: 'Mbg',   names: ['mega starter set mega gengar', 'mega gengar ex starter', 'mbg'] },
  // New 2025-2026 JP sets
  { code: 'M3',    names: ['nihil zero'] },
  { code: 'M4',    names: ['ninja spinner'] },
  { code: 'M5',    names: ['abyss eye'] },
  // Promos
  { code: 'SV-P',  names: ['scarlet & violet promo', 'sv-p promo', 'sv promo jp'] },
  { code: 'S-P',   names: ['sword & shield promo', 's-p promo', 'swsh promo jp'] },
  { code: 'SM-P',  names: ['sun & moon promo', 'sm-p promo'] },
  { code: 'PROMO-P', names: ['corocoro', 'corocoro comics', "mcdonald's", 'mcdonalds', 'movie promo', 'game movie', 'promo card pack', 'm-p promo', 'mp promo'] },
];

// ── Lookup ────────────────────────────────────────────────────────────────────

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
 * Look up a set code given a language and set name string (e.g. from a PSA label).
 * Tries exact match first, then longest-substring match. Returns null if no match.
 */
export function lookupSetCode(language: 'EN' | 'JP', setName: string): string | null {
  const index = language === 'JP' ? JP_INDEX : EN_INDEX;
  const sets  = language === 'JP' ? JP_SETS  : EN_SETS;
  const norm  = setName.toLowerCase().trim();
  const normSpaced = norm.replace(/[-_]/g, ' ');

  const exact = index.get(norm) ?? index.get(normSpaced);
  if (exact) return exact;

  // Build alias list augmented with each set's own code, longest-first
  const allAliases: { alias: string; code: string }[] = [];
  for (const entry of sets) {
    const codeLower = entry.code.toLowerCase();
    allAliases.push({ alias: codeLower, code: entry.code });
    const codeSpaced = codeLower.replace(/[-_.]/g, ' ');
    if (codeSpaced !== codeLower) allAliases.push({ alias: codeSpaced, code: entry.code });
    for (const name of entry.names) {
      allAliases.push({ alias: name, code: entry.code });
    }
  }
  allAliases.sort((a, b) => b.alias.length - a.alias.length);

  for (const { alias, code } of allAliases) {
    // Short aliases (≤4 chars, e.g. "sm2", "sv1") require word boundaries to avoid
    // "sm2" matching inside "sm210", "bs" inside "burst", etc.
    if (alias.length <= 4) {
      const re = new RegExp(`(?<![a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i');
      if (re.test(norm) || re.test(normSpaced)) return code;
    } else {
      if (norm.includes(alias) || normSpaced.includes(alias)) return code;
    }
  }

  return null;
}

/**
 * Given a language and set code, return the canonical (first) name for that set.
 */
export function lookupSetName(language: string, setCode: string): string | null {
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

    const dbExact = extra.get(norm);
    if (dbExact) return dbExact;

    for (const [alias, code] of [...extra.entries()].sort((a, b) => b[0].length - a[0].length)) {
      if (norm.includes(alias)) return code;
    }

    return lookupSetCode(language, setName);
  };
}

/**
 * Generate a part number (SKU) given parsed card fields.
 */
export function generatePartNumber(language: string, setCode: string, cardNumber: string): string {
  const rawNum = cardNumber.split('/')[0].trim();
  const paddedNum = rawNum.replace(/[^0-9]/g, '').padStart(3, '0') || rawNum;
  return `PKMN-${language}-${setCode}-${paddedNum}`;
}
