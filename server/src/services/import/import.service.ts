import { db } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { parseCsvBuffer, aiDetectImport } from './csvParser';
import { toCents } from '../../utils/cents';
import { createRawPurchase } from '../raw-purchases.service';
import { createExpense } from '../expenses.service';
import { recordSale } from '../sales.service';
import { lookupSetCode, lookupSetName, generatePartNumber, EN_SETS, JP_SETS } from '../../utils/set-codes';
import type { GradingCompany, ListingPlatform } from '../../types/db';

function parseDate(raw: string | undefined): Date | null {
  if (!raw?.trim()) return null;
  const d = new Date(raw.trim());
  return isNaN(d.getTime()) ? null : d;
}

// ── Upload / Preview ──────────────────────────────────────────────────────────

export async function uploadCsv(
  userId: string,
  filename: string,
  buffer: Buffer,
  importType?: string
) {
  const { headers, rows, rowCount, errors } = parseCsvBuffer(buffer, filename);

  if (errors.length > 0 && rowCount === 0) {
    throw new Error(`Could not parse file: ${errors[0]}`);
  }

  // Use AI to detect type + mapping unless type was explicitly provided
  const detection = await aiDetectImport(headers, rows.slice(0, 5));
  const resolvedType = importType ?? detection.import_type;

  const record = await db
    .insertInto('csv_imports')
    .values({
      user_id: userId,
      filename,
      import_type: resolvedType,
      row_count: rowCount,
      status: 'pending',
      raw_headers: JSON.stringify(headers) as any,
      preview_rows: JSON.stringify(rows.slice(0, 5)) as any,
      mapping: JSON.stringify(detection.mapping) as any,
      error_log: errors.length > 0 ? JSON.stringify(errors) as any : null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return {
    id: record.id,
    original_filename: filename,
    columns: headers,
    total_rows: rowCount,
    preview_rows: rows.slice(0, 5),
    detected_mapping: detection.mapping,
    detected_type: detection.import_type,
    detected_confidence: detection.confidence,
    detected_reasoning: detection.reasoning,
    import_type: resolvedType,
    parse_errors: errors,
  };
}

export async function saveColumnMapping(
  userId: string,
  importId: string,
  mapping: Record<string, string>,
  importType?: string
) {
  const record = await db.selectFrom('csv_imports').selectAll()
    .where('id', '=', importId).where('user_id', '=', userId).executeTakeFirst();
  if (!record) throw new AppError(404, 'Import not found');

  const update: Record<string, any> = { mapping: JSON.stringify(mapping) as any };
  if (importType) update.import_type = importType;

  return db.updateTable('csv_imports').set(update)
    .where('id', '=', importId).returningAll().executeTakeFirstOrThrow();
}

export async function listImports(userId: string) {
  return db
    .selectFrom('csv_imports')
    .selectAll()
    .where('user_id', '=', userId)
    .orderBy('created_at', 'desc')
    .limit(50)
    .execute();
}

export async function deletePendingImport(userId: string, importId: string) {
  const record = await db.selectFrom('csv_imports').select(['id', 'status'])
    .where('id', '=', importId).where('user_id', '=', userId).executeTakeFirst();
  if (!record) throw new AppError(404, 'Import not found');
  if (record.status !== 'pending') throw new AppError(400, 'Can only delete pending imports');
  await db.deleteFrom('csv_imports').where('id', '=', importId).execute();
}

export async function getImportStatus(userId: string, importId: string) {
  const record = await db
    .selectFrom('csv_imports')
    .selectAll()
    .where('id', '=', importId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!record) throw new AppError(404, 'Import not found');
  return record;
}

// ── Preflight ─────────────────────────────────────────────────────────────────

export interface AmbiguousRow {
  row: number;         // 1-based row index
  card_name: string;
  set_name: string | null;
  en_code: string | null;
  en_set: string | null;
  jp_code: string | null;
  jp_set: string | null;
}

function applyMappingStatic(raw: Record<string, string>, mapping: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [col, field] of Object.entries(mapping)) {
    if (field && raw[col] !== undefined) out[field] = raw[col];
  }
  return out;
}

export interface UnlinkedRow {
  row: number;       // 1-based
  card_name: string;
  set_name: string | null;
  game_hint: string; // 'pokemon' | 'one piece' | etc — best guess from card name
}

/** Scan rows and return those that would produce no set code match (and thus no catalog entry with a SKU). */
export async function preflightUnlinked(userId: string, importId: string, buffer: Buffer): Promise<UnlinkedRow[]> {
  const record = await db.selectFrom('csv_imports').selectAll()
    .where('id', '=', importId).where('user_id', '=', userId).executeTakeFirst();
  if (!record) throw new AppError(404, 'Import not found');
  if (record.import_type !== 'graded') return [];

  const { rows } = parseCsvBuffer(buffer, record.filename);
  const mapping = (record.mapping ?? {}) as Record<string, string>;

  // Load user-defined aliases so we can skip cards that are already resolvable
  const userAliases = await db.selectFrom('pokemon_set_aliases')
    .select(['language', 'set_code', 'alias', 'set_name'])
    .where('user_id', '=', userId)
    .execute();

  function hasAliasMatch(text: string): boolean {
    const norm = text.toLowerCase().trim();
    return userAliases.some(a =>
      norm === a.alias.toLowerCase() ||
      norm.includes(a.alias.toLowerCase()) ||
      norm === a.set_code.toLowerCase() ||
      (a.set_name && norm.includes(a.set_name.toLowerCase()))
    );
  }

  const unlinked: UnlinkedRow[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = applyMappingStatic(rows[i], mapping);
    if (Object.values(row).every(v => !v?.trim())) continue;

    const cardName = row['card_name']?.trim() || '';
    const setName  = row['set_name']?.trim() || null;
    if (!cardName) continue;

    const lookupText = setName ?? cardName;
    const enCode = lookupSetCode('EN', lookupText);
    const jpCode = lookupSetCode('JP', lookupText);

    if (enCode || jpCode || hasAliasMatch(lookupText)) continue; // will be matched

    // Deduplicate by card_name + set_name
    const key = `${cardName}|${setName ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Guess the game from the card name
    let game_hint = 'pokemon';
    if (/one piece/i.test(cardName) || /one piece/i.test(setName ?? '')) game_hint = 'one_piece';
    else if (/magic|mtg/i.test(cardName)) game_hint = 'magic';
    else if (/yugioh|yu-gi-oh/i.test(cardName)) game_hint = 'yugioh';

    unlinked.push({ row: i + 2, card_name: cardName, set_name: setName, game_hint });
  }

  return unlinked;
}

/** Scan rows and return those where language is ambiguous (both EN and JP find a set match, no clear signal). */
export async function preflightImport(userId: string, importId: string, buffer: Buffer): Promise<AmbiguousRow[]> {
  const record = await db.selectFrom('csv_imports').selectAll()
    .where('id', '=', importId).where('user_id', '=', userId).executeTakeFirst();
  if (!record) throw new AppError(404, 'Import not found');
  if (record.import_type !== 'graded') return []; // only graded uses catalog/part numbers

  const { rows } = parseCsvBuffer(buffer, record.filename);
  const mapping = (record.mapping ?? {}) as Record<string, string>;
  const ambiguous: AmbiguousRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = applyMappingStatic(rows[i], mapping);
    if (Object.values(row).every(v => !v?.trim())) continue;

    const cardName = row['card_name']?.trim() || '';
    const setName  = row['set_name']?.trim() || null;
    const language = row['language']?.trim() || '';
    if (!cardName) continue;

    // Skip rows with explicit language
    if (language.toUpperCase() === 'JP' || language.toUpperCase() === 'JPN') continue;

    const lookupText = setName ?? cardName;
    const enCode = lookupSetCode('EN', lookupText);
    const jpCode = lookupSetCode('JP', lookupText);

    // Skip rows where language is clear from the card name
    const hasJpSignal = /japanese/i.test(cardName)
      || /\b(S\d+[WH]|SM\d+[SMKLA+]|SM\d+a|SV\d+[SDPL]|SV\d+a)\b/i.test(cardName);
    if (hasJpSignal) continue;

    // Ambiguous: both languages found a match AND the set name exists in both lists
    if (enCode && jpCode) {
      const setInEnOnly = setName && lookupSetCode('EN', setName) !== null && lookupSetCode('JP', setName) === null;
      const setInJpOnly = setName && lookupSetCode('JP', setName) !== null && lookupSetCode('EN', setName) === null;
      if (setInEnOnly || setInJpOnly) continue; // clear signal from set name

      ambiguous.push({
        row: i + 2,
        card_name: cardName,
        set_name: setName,
        en_code: enCode,
        en_set: lookupSetName('EN', enCode),
        jp_code: jpCode,
        jp_set: lookupSetName('JP', jpCode),
      });
    }
  }

  return ambiguous;
}

// ── Execute ───────────────────────────────────────────────────────────────────

export interface CatalogOverride {
  game: string;
  set_code: string;
  set_name: string;
  language?: string;
}

export async function executeImport(
  userId: string,
  importId: string,
  buffer: Buffer,
  languageOverrides?: Record<number, string>,
  catalogOverrides?: Record<string, CatalogOverride>  // key: "card_name|set_name"
) {
  const record = await db.selectFrom('csv_imports').selectAll()
    .where('id', '=', importId).where('user_id', '=', userId).executeTakeFirst();

  if (!record) throw new AppError(404, 'Import not found');
  if (record.status === 'completed') throw new AppError(409, 'Import already completed');

  await db.updateTable('csv_imports').set({ status: 'processing' }).where('id', '=', importId).execute();

  const { rows } = parseCsvBuffer(buffer, record.filename);
  const mapping = (record.mapping ?? {}) as Record<string, string>;

  // Fire-and-forget progress flush every 10 rows
  const onProgress = (count: number) => {
    db.updateTable('csv_imports').set({ imported_count: count }).where('id', '=', importId).execute().catch(() => {});
  };

  let result: { importedCount: number; errorLog: Array<{ row: number; message: string }> };

  switch (record.import_type) {
    case 'graded':
      result = await executeGradedImport(userId, rows, mapping, languageOverrides, onProgress, catalogOverrides);
      break;
    case 'raw_purchase':
      result = await executeRawPurchaseImport(userId, rows, mapping, onProgress);
      break;
    case 'bulk_sale':
      result = await executeBulkSaleImport(userId, rows, mapping, onProgress);
      break;
    case 'expenses':
      result = await executeExpensesImport(userId, rows, mapping, onProgress);
      break;
    default:
      result = await executeLegacyCardsImport(userId, rows, mapping);
  }

  const finalStatus = result.errorLog.length > 0 && result.importedCount === 0 ? 'failed' : 'completed';

  await db.updateTable('csv_imports').set({
    status: finalStatus,
    imported_count: result.importedCount,
    error_count: result.errorLog.length,
    error_log: result.errorLog.length > 0 ? JSON.stringify(result.errorLog) as any : null,
    completed_at: new Date(),
  }).where('id', '=', importId).execute();

  return {
    status: finalStatus,
    imported_count: result.importedCount,
    error_count: result.errorLog.length,
    errors: result.errorLog.slice(0, 50),
  };
}

// ── Graded Cards Import ───────────────────────────────────────────────────────

async function executeGradedImport(
  userId: string,
  rows: Record<string, string>[],
  mapping: Record<string, string>,
  languageOverrides?: Record<number, string>,
  onProgress?: (count: number) => void,
  catalogOverrides?: Record<string, CatalogOverride>  // key: "card_name|set_name"
) {
  const errorLog: Array<{ row: number; message: string }> = [];
  let importedCount = 0;

  // Load user-defined set aliases for matching custom languages
  const userAliasRows = await db.selectFrom('pokemon_set_aliases')
    .select(['language', 'set_code', 'alias', 'set_name', 'game'])
    .where('user_id', '=', userId)
    .execute();

  function lookupUserAlias(text: string): { set_code: string; language: string; game: string } | null {
    const norm = text.toLowerCase().trim();
    for (const a of userAliasRows) {
      const normAlias = a.alias.toLowerCase();
      const normCode = a.set_code.toLowerCase();
      const normName = a.set_name?.toLowerCase() ?? '';
      if (norm === normAlias || norm.includes(normAlias) || norm === normCode || (normName && norm.includes(normName))) {
        return { set_code: a.set_code, language: a.language.toUpperCase(), game: a.game };
      }
    }
    return null;
  }

  // Cache catalog lookups: sku → catalog_id
  const catalogCache = new Map<string, string>();

  async function getOrCreateCatalogId(
    cardName: string, setName: string | null, cardNumber: string | null, language: string, rowIndex: number
  ): Promise<string | null> {
    // Detect language — priority order:
    // 1. Manual override from resolution modal (rowIndex keyed)
    // 2. Explicit language column (JP/JPN/EN)
    // 3. Set name resolves to JP-only → JP
    // 4. Set name resolves to EN-only → EN
    // 5. "japanese" in card name or JP PSA code pattern → JP
    // 6. Set name in both lists → no default, must be resolved (should be caught by preflight)
    // Override can be plain "EN"/"JP" or "LANG:SETCODE" (e.g. "ZH-TW:SWSH9") from disambiguation modal
    const rawOverride = languageOverrides?.[rowIndex];
    let overrideLang: string | null = null;
    let overrideSetCode: string | null = null;
    if (rawOverride) {
      const colonIdx = rawOverride.indexOf(':');
      if (colonIdx !== -1) {
        overrideLang = rawOverride.slice(0, colonIdx);
        overrideSetCode = rawOverride.slice(colonIdx + 1) || null;
      } else {
        overrideLang = rawOverride;
      }
    }

    const lookupText = setName ?? cardName;
    const enCode = lookupSetCode('EN', lookupText);
    const jpCode = lookupSetCode('JP', lookupText);

    const hasJpNameSignal = /japanese/i.test(cardName) || /\b(S\d+[WH]|SM\d+[SMKLA+]|SM\d+a|SV\d+[SDPL]|SV\d+a)\b/i.test(cardName);

    let resolvedLang: string;
    if (overrideLang) {
      resolvedLang = overrideLang;
    } else if (/^(jp|jpn|japanese)$/i.test(language)) {
      resolvedLang = 'JP';
    } else if (/^(en|eng|english)$/i.test(language) && !hasJpNameSignal) {
      resolvedLang = 'EN';
    } else if (setName) {
      const setInEn = lookupSetCode('EN', setName) !== null;
      const setInJp = lookupSetCode('JP', setName) !== null;
      if (setInJp && !setInEn) resolvedLang = 'JP';
      else if (hasJpNameSignal) resolvedLang = 'JP';
      else if (setInEn && !setInJp) resolvedLang = 'EN';
      else resolvedLang = 'EN';
    } else if (hasJpNameSignal) {
      resolvedLang = 'JP';
    } else {
      resolvedLang = 'EN';
    }

    // Pick set code: explicit override first, then language-matched lookup, then cross-language fallback
    let setCode: string | null = overrideSetCode ?? (resolvedLang === 'JP' ? jpCode : enCode);
    // If JP but setName-based lookup failed, retry against the full card name
    if (!setCode && resolvedLang === 'JP' && setName) {
      setCode = lookupSetCode('JP', cardName);
    }
    if (!setCode) {
      setCode = resolvedLang === 'JP' ? enCode : jpCode;
      // Do NOT flip resolvedLang — the card is still the resolved language even if
      // we borrow the set code from the other language's lookup table.
    }
    if (!setCode) {
      // Check user-defined aliases (covers custom languages like ZH-TW)
      const aliasMatch = lookupUserAlias(lookupText);
      if (aliasMatch) {
        setCode = aliasMatch.set_code;
        resolvedLang = aliasMatch.language;
      }
    }
    if (!setCode) {
      // Check if user provided a manual override for this card via the resolution modal
      const overrideKey = `${cardName}|${setName ?? ''}`;
      const catOverride = catalogOverrides?.[overrideKey];
      if (catOverride?.set_code) {
        setCode = catOverride.set_code;
        if (catOverride.language) resolvedLang = catOverride.language.toUpperCase();
      } else {
        // No set code and no override — return null (unlinked)
        return null;
      }
    }

    // Derive card number — prefer explicit, fall back to parsing the card name
    let resolvedNumber = cardNumber?.trim() || null;
    if (!resolvedNumber) {
      // Strip the set code from the label so it doesn't get mistaken for a card number
      // e.g. "SV10-GLORY OF TEAM ROCKET 101" → strip "SV10" before matching
      const labelWithoutSetCode = cardName.replace(new RegExp(`\\b${setCode.replace(/[-]/g, '[-]')}\\b`, 'i'), '');
      const promoHash  = labelWithoutSetCode.match(/#(\d+)/);
      // codedNum: promo-style like "SM240" or "SV-P 099" — but NOT bare set shorthands
      const codedNum   = labelWithoutSetCode.match(/\b([A-Z]{1,3}\d{1,3}[a-z]?)\b/);
      const threeDigit = labelWithoutSetCode.match(/\b(\d{3})\b/);
      const twoDigit   = labelWithoutSetCode.match(/\b(\d{2})\b/);
      // Fallback: last 1-3 digit number (excludes 4-digit years via \b boundary)
      const smallNums  = [...labelWithoutSetCode.matchAll(/\b(\d{1,3})\b/g)];
      const lastSmall  = smallNums.length > 0 ? smallNums[smallNums.length - 1][1] : null;
      resolvedNumber = promoHash?.[1] ?? codedNum?.[1] ?? threeDigit?.[1] ?? twoDigit?.[1] ?? lastSmall ?? null;
    }
    if (!resolvedNumber) return null;

    const sku = generatePartNumber(resolvedLang, setCode, resolvedNumber);
    if (catalogCache.has(sku)) return catalogCache.get(sku)!;
    const existing = await db.selectFrom('card_catalog').select('id').where('user_id', '=', userId).where('sku', '=', sku).executeTakeFirst();
    if (existing) { catalogCache.set(sku, existing.id); return existing.id; }
    const overrideKey2 = `${cardName}|${setName ?? ''}`;
    const catOverride2 = catalogOverrides?.[overrideKey2];
    const resolvedGame = catOverride2?.game ?? 'pokemon';
    const resolvedSetName = catOverride2?.set_name ?? setName ?? lookupSetName(resolvedLang, setCode) ?? setCode;
    const created = await db.insertInto('card_catalog').values({
      user_id: userId, game: resolvedGame, set_name: resolvedSetName, set_code: setCode,
      card_name: cardName, card_number: resolvedNumber, language: resolvedLang, sku,
    }).returning('id').executeTakeFirstOrThrow();
    catalogCache.set(sku, created.id);
    return created.id;
  }

  for (let i = 0; i < rows.length; i++) {
    const rowIndex = i + 2;
    // Skip entirely blank rows (trailing spreadsheet rows) — check raw row before mapping
    if (Object.values(rows[i]).every(v => !v?.trim())) continue;
    const row = applyMapping(rows[i], mapping);
    if (Object.values(row).every(v => !v?.trim())) continue;
    try {
      const cardName = row['card_name']?.trim();
      if (!cardName) continue;

      const certRaw = row['cert_number']?.trim();
      if (!certRaw) continue;

      const gradeRaw = row['grade']?.trim();
      if (!gradeRaw) throw new Error('grade is required');

      const { company: parsedCompany, grade } = parseGradeString(gradeRaw);
      const companyRaw = normalizeCompany(row['company']?.trim())
        ?? parsedCompany
        ?? inferCompanyFromCert(certRaw)
        ?? 'OTHER';

      const certNumber = parseInt(certRaw.replace(/\D/g, ''), 10);
      const gradeLabel = gradeRaw.trim(); // store exactly as-is

      const purchaseCost = toCents(row['purchase_cost'] ?? '0');
      const gradingCost  = toCents(row['grading_cost']  ?? '0');
      const currency = normalizeCurrency(row['currency']);
      const purchasedAt = parseDate(row['purchased_at']);

      // Determine lifecycle state from sheet columns
      const soldAtRaw  = row['sold_at']?.trim();
      const listedRaw  = row['is_listed']?.trim().toLowerCase();
      const isSold     = !!soldAtRaw && parseDate(soldAtRaw) !== null;
      const isListed   = !isSold && (listedRaw === 'yes' || listedRaw === 'true' || listedRaw === '1');
      const cardStatus = isSold ? 'sold' : 'graded';

      const setName    = row['set_name']?.trim()     ?? null;
      const cardNumber = row['card_number']?.trim()  ?? null;
      const explicitLang = row['language']?.trim();
      const language   = explicitLang || (/\bJAPANESE?\b|\bJP\b/i.test(cardName) ? 'JP' : 'EN');
      const catalogId  = await getOrCreateCatalogId(cardName, setName, cardNumber, language, rowIndex);

      // When a catalog entry was matched/created via part number, don't override
      // the canonical name — otherwise each PSA label variation creates a separate group.
      // Store the raw PSA label in notes for reference if no notes already provided.
      const existingNotes = row['notes']?.trim() ?? null;
      const ci = await db.insertInto('card_instances').values({
        user_id:              userId,
        catalog_id:           catalogId,
        card_name_override:   cardName ?? null,
        set_name_override:    catalogId ? null : setName,
        card_number_override: catalogId ? null : cardNumber,
        card_game:            'pokemon',
        language,
        variant:              null,
        rarity:               null,
        notes:                existingNotes ?? null,
        purchase_type:        'pre_graded',
        status:               cardStatus,
        quantity:             1,
        purchase_cost:        purchaseCost,
        currency,
        source_link:          null,
        order_number:         row['order_number']?.trim() ?? null,
        condition:            null,
        condition_notes:      null,
        image_front_url:      null,
        image_back_url:       null,
        purchased_at:         purchasedAt,
        raw_purchase_id:      null,
        trade_id:             null,
        location_id:          null,
        decision:             null,
      }).returningAll().executeTakeFirstOrThrow();

      await db.insertInto('slab_details').values({
        card_instance_id:       ci.id,
        user_id:                userId,
        source_raw_instance_id: null,
        grading_submission_id:  null,
        company:                companyRaw,
        cert_number:            isNaN(certNumber) ? null : certNumber,
        grade:                  isNaN(grade) ? null : grade,
        grade_label:            gradeLabel,
        subgrades:              null,
        grading_cost:           gradingCost,
        additional_cost:        0,
        currency,
      }).execute();

      // Create sale record if card has been sold
      if (isSold) {
        const salePriceRaw = toCents(row['sale_price'] ?? '0');
        const afterFeesRaw = toCents(row['after_fees']  ?? '0');
        const platformFees = salePriceRaw > 0 && afterFeesRaw > 0
          ? Math.max(0, salePriceRaw - afterFeesRaw)
          : 0;
        const soldAt = parseDate(soldAtRaw)!;
        const listingUrlForSale = row['listing_url']?.trim() || undefined;
        const platform = normalizePlatform(row['platform']?.trim(), listingUrlForSale, existingNotes ?? undefined);

        // Auto-link to a card show if sold_at falls within a show's date range,
        // no eBay order ID, and the listing URL isn't an eBay order confirmation link
        const uniqueId = row['unique_id']?.trim() || null;
        const isEbayOrder = !!uniqueId || (!!listingUrlForSale && isEbayOrderUrl(listingUrlForSale));
        let cardShowId: string | null = null;
        if (!isEbayOrder) {
          const soldDate = soldAt.toISOString().slice(0, 10);
          const show = await db
            .selectFrom('card_shows')
            .select(['id', 'show_date', 'end_date'])
            .where('user_id', '=', userId)
            .where('show_date', '<=', soldAt)
            .orderBy('show_date', 'desc')
            .executeTakeFirst();
          if (show) {
            const showEnd = show.end_date
              ? (show.end_date as unknown as Date).toISOString().slice(0, 10)
              : (show.show_date as unknown as Date).toISOString().slice(0, 10);
            if (soldDate <= showEnd) {
              cardShowId = show.id;
            }
          }
        }

        await db.insertInto('sales').values({
          user_id:          userId,
          card_instance_id: ci.id,
          listing_id:       null,
          card_show_id:     cardShowId,
          platform,
          sale_price:       salePriceRaw,
          platform_fees:    platformFees,
          shipping_cost:    toCents(row['shipping_cost'] ?? '0'),
          currency,
          total_cost_basis: purchaseCost + gradingCost,
          order_details_link: row['listing_url']?.trim() || null,
          unique_id:        uniqueId,
          unique_id_2:      null,
          sold_at:          soldAt,
        }).execute();
      }

      // Create listing record if card is currently listed
      if (isListed) {
        const listPrice = toCents(row['list_price'] ?? '0');
        const listedAt  = parseDate(row['listed_at']);
        const listingUrl = row['listing_url']?.trim() || null;
        const platform  = normalizePlatform(row['platform']?.trim(), listingUrl ?? undefined, existingNotes ?? undefined);

        await db.insertInto('listings').values({
          user_id:          userId,
          card_instance_id: ci.id,
          platform,
          listing_status:   'active',
          ebay_listing_id:  null,
          ebay_listing_url: listingUrl,
          show_name:        null,
          show_date:        null,
          booth_cost:       null,
          list_price:       listPrice,
          asking_price:     listPrice,
          currency,
          listed_at:        listedAt,
          sold_at:          null,
        }).execute();
      }

      importedCount++;
      if (importedCount % 10 === 0) onProgress?.(importedCount);
    } catch (err) {
      errorLog.push({ row: rowIndex, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return { importedCount, errorLog };
}

// ── Raw Purchase Import ───────────────────────────────────────────────────────

async function executeRawPurchaseImport(
  userId: string,
  rows: Record<string, string>[],
  mapping: Record<string, string>,
  onProgress?: (count: number) => void
) {
  const errorLog: Array<{ row: number; message: string }> = [];
  let importedCount = 0;

  // Group by order_number; rows without one each get their own purchase
  const groups = new Map<string, { rows: Record<string, string>[]; indices: number[] }>();
  rows.forEach((raw, i) => {
    const row = applyMapping(raw, mapping);
    if (Object.values(row).every(v => !v?.trim())) return;
    const key = row['order_number']?.trim() || `__solo_${i}`;
    if (!groups.has(key)) groups.set(key, { rows: [], indices: [] });
    groups.get(key)!.rows.push(row);
    groups.get(key)!.indices.push(i + 2);
  });

  for (const [, group] of groups) {
    const firstRow = group.rows[0];
    try {
      const purchasedAt = parseDate(firstRow['purchased_at']);
      const orderNumber = firstRow['order_number']?.trim() || null;
      const source = firstRow['source']?.trim() || null;
      const language = firstRow['language']?.toUpperCase() || 'EN';
      const purchaseType: 'raw' | 'bulk' = firstRow['type']?.toLowerCase() === 'bulk' ? 'bulk' : 'raw';

      const totalCostUsd = group.rows.reduce((s, r) => {
        const cost = parseFloat(r['cost'] ?? '0');
        return s + (isNaN(cost) ? 0 : cost);
      }, 0);

      const rp = await createRawPurchase(userId, {
        type: purchaseType,
        source: source ?? undefined,
        order_number: orderNumber ?? undefined,
        language,
        card_name:   group.rows.length === 1 ? (firstRow['card_name']?.trim() || undefined) : undefined,
        set_name:    group.rows.length === 1 ? (firstRow['set_name']?.trim()  || undefined) : undefined,
        card_number: group.rows.length === 1 ? (firstRow['card_number']?.trim() || undefined) : undefined,
        total_cost_usd: Math.round(totalCostUsd * 100),
        card_count:  group.rows.length,
        status:      'received',
        purchased_at: purchasedAt?.toISOString(),
        received_at:  purchasedAt?.toISOString(),
      });

      for (let j = 0; j < group.rows.length; j++) {
        const rowIndex = group.indices[j];
        const row = group.rows[j];
        try {
          const cardName = row['card_name']?.trim();
          if (!cardName) throw new Error('card_name is required');

          const quantity = parseInt(row['quantity'] ?? '1', 10);
          const purchaseCost = toCents(row['cost'] ?? '0');
          const currency = normalizeCurrency(row['currency']);

          await db.insertInto('card_instances').values({
            user_id:              userId,
            catalog_id:           null,
            card_name_override:   cardName,
            set_name_override:    row['set_name']?.trim()    ?? null,
            card_number_override: row['card_number']?.trim() ?? null,
            card_game:            'pokemon',
            language,
            variant:              null,
            rarity:               null,
            notes:                row['notes']?.trim() ?? null,
            purchase_type:        'raw',
            status:               'purchased_raw',
            quantity:             isNaN(quantity) ? 1 : quantity,
            purchase_cost:        purchaseCost,
            currency,
            source_link:          null,
            order_number:         orderNumber,
            condition:            normalizeCondition(row['condition']),
            condition_notes:      null,
            image_front_url:      null,
            image_back_url:       null,
            purchased_at:         purchasedAt,
            raw_purchase_id:      rp.id,
            trade_id:             null,
            location_id:          null,
            decision:             null,
          }).execute();

          importedCount++;
          if (importedCount % 10 === 0) onProgress?.(importedCount);
        } catch (err) {
          errorLog.push({ row: rowIndex, message: err instanceof Error ? err.message : String(err) });
        }
      }
    } catch (err) {
      group.indices.forEach((idx) =>
        errorLog.push({ row: idx, message: `Purchase group error: ${err instanceof Error ? err.message : String(err)}` })
      );
    }
  }

  return { importedCount, errorLog };
}

// ── Bulk Sale Import ──────────────────────────────────────────────────────────

async function executeBulkSaleImport(
  userId: string,
  rows: Record<string, string>[],
  mapping: Record<string, string>,
  onProgress?: (count: number) => void
) {
  const errorLog: Array<{ row: number; message: string }> = [];
  let importedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const rowIndex = i + 2;
    const row = applyMapping(rows[i], mapping);
    if (Object.values(row).every(v => !v?.trim())) continue;
    try {
      const identifier = row['identifier']?.trim();
      if (!identifier) throw new Error('identifier (cert# or purchase ID) is required');

      const salePriceRaw = row['sale_price']?.trim();
      if (!salePriceRaw) throw new Error('sale_price is required');

      const platform = normalizePlatform(row['platform']);
      const salePrice   = toCents(salePriceRaw);
      const platformFees = toCents(row['platform_fees'] ?? '0');
      const shippingCost = toCents(row['shipping_cost'] ?? '0');
      const currency = normalizeCurrency(row['currency']);
      const soldAt = parseDate(row['sold_at']) ?? undefined;

      let cardInstanceId: string;

      if (/^\d+$/.test(identifier)) {
        // Graded — match by cert number
        const slab = await db
          .selectFrom('slab_details as sd')
          .innerJoin('card_instances as ci', 'ci.id', 'sd.card_instance_id')
          .select(['ci.id', 'ci.status'])
          .where('sd.cert_number', '=', parseInt(identifier, 10) as any)
          .where('ci.user_id', '=', userId)
          .executeTakeFirst();

        if (!slab) throw new Error(`No graded card found with cert# ${identifier}`);
        if (slab.status === 'sold') throw new Error(`Card cert# ${identifier} is already sold`);
        cardInstanceId = slab.id;
      } else {
        // Raw — match by purchase label
        const rp = await db
          .selectFrom('raw_purchases')
          .select('id')
          .where('purchase_id', '=', identifier)
          .where('user_id', '=', userId)
          .executeTakeFirst();

        if (!rp) throw new Error(`No purchase found with ID ${identifier}`);

        const unsold = await db
          .selectFrom('card_instances')
          .select('id')
          .where('raw_purchase_id', '=', rp.id)
          .where('user_id', '=', userId)
          .where('status', '!=', 'sold' as any)
          .execute();

        if (unsold.length === 0) throw new Error(`No unsold cards for purchase ${identifier}`);
        if (unsold.length > 1) throw new Error(`Purchase ${identifier} has ${unsold.length} unsold cards — be more specific`);
        cardInstanceId = unsold[0].id;
      }

      await recordSale(userId, {
        card_instance_id: cardInstanceId,
        platform,
        sale_price:    salePrice,
        platform_fees: platformFees,
        shipping_cost: shippingCost,
        currency,
        sold_at:       soldAt,
        unique_id:     row['unique_id']?.trim() || undefined,
      });

      importedCount++;
      if (importedCount % 10 === 0) onProgress?.(importedCount);
    } catch (err) {
      errorLog.push({ row: rowIndex, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return { importedCount, errorLog };
}

// ── Expenses Import ───────────────────────────────────────────────────────────

async function executeExpensesImport(
  userId: string,
  rows: Record<string, string>[],
  mapping: Record<string, string>,
  onProgress?: (count: number) => void
) {
  const errorLog: Array<{ row: number; message: string }> = [];
  let importedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const rowIndex = i + 2;
    const row = applyMapping(rows[i], mapping);
    if (Object.values(row).every(v => !v?.trim())) continue;
    try {
      const description = row['description']?.trim();
      if (!description) throw new Error('description is required');

      const amountRaw = row['amount']?.trim();
      if (!amountRaw) throw new Error('amount is required');

      const amount = parseFloat(amountRaw.replace(/[^0-9.]/g, ''));
      if (isNaN(amount)) throw new Error(`Invalid amount: ${amountRaw}`);

      const type = row['type']?.trim() || 'Other';
      const currency = normalizeCurrency(row['currency']);
      const date = parseDate(row['date']) ?? new Date();
      const order_number = row['order_number']?.trim() || undefined;
      const link = row['link']?.trim() || undefined;

      await createExpense(userId, {
        description,
        type,
        amount: Math.round(amount * 100),
        currency,
        date,
        order_number,
        link,
      });

      importedCount++;
      if (importedCount % 10 === 0) onProgress?.(importedCount);
    } catch (err) {
      errorLog.push({ row: rowIndex, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return { importedCount, errorLog };
}

// ── Legacy Cards Import ───────────────────────────────────────────────────────

async function executeLegacyCardsImport(
  userId: string,
  rows: Record<string, string>[],
  mapping: Record<string, string>
) {
  const errorLog: Array<{ row: number; message: string }> = [];
  let importedCount = 0;
  const BATCH_SIZE = 100;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const inserts = [];

    for (let j = 0; j < batch.length; j++) {
      const rowIndex = i + j + 2;
      try {
        const mapped = applyMapping(batch[j], mapping);
        const cardName = mapped['card_name']?.trim();
        if (!cardName) throw new Error('card_name is required');
        const qty = parseInt(mapped['quantity'] ?? '1', 10);
        inserts.push({
          catalog_id:           null,
          card_name_override:   cardName,
          set_name_override:    mapped['set_name']?.trim()    ?? null,
          card_number_override: mapped['card_number']?.trim() ?? null,
          card_game:            mapped['card_game']?.toLowerCase() ?? 'pokemon',
          language:             mapped['language']?.toUpperCase() ?? 'EN',
          variant:              null, rarity: null, notes: null,
          purchase_type:        'raw' as const,
          status:               'purchased_raw' as const,
          quantity:             isNaN(qty) ? 1 : qty,
          purchase_cost:        toCents(mapped['purchase_cost'] ?? '0'),
          currency:             normalizeCurrency(mapped['currency']),
          source_link:          mapped['source_link']?.trim() ?? null,
          order_number:         mapped['order_number']?.trim() ?? null,
          condition:            normalizeCondition(mapped['condition']),
          condition_notes:      null, image_front_url: null, image_back_url: null,
          purchased_at:         parseDate(mapped['purchased_at']),
          raw_purchase_id:      null, trade_id: null, location_id: null, decision: null,
        });
      } catch (err) {
        errorLog.push({ row: rowIndex, message: err instanceof Error ? err.message : String(err) });
      }
    }

    if (inserts.length > 0) {
      await db.insertInto('card_instances')
        .values(inserts.map((ins) => ({ ...ins, user_id: userId })))
        .execute()
        .catch((err) => errorLog.push({ row: -1, message: `Batch insert failed: ${err.message}` }));
      importedCount += inserts.length;
    }
  }

  return { importedCount, errorLog };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function applyMapping(row: Record<string, string>, mapping: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [csvCol, field] of Object.entries(mapping)) {
    if (row[csvCol] !== undefined) result[field] = row[csvCol];
  }
  return result;
}

function normalizeCondition(value?: string): string | null {
  if (!value) return null;
  const upper = value.toUpperCase().trim();
  const map: Record<string, string> = {
    'NM': 'NM', 'NEAR MINT': 'NM', 'LP': 'LP', 'LIGHTLY PLAYED': 'LP',
    'MP': 'MP', 'MODERATELY PLAYED': 'MP', 'HP': 'HP', 'HEAVILY PLAYED': 'HP',
    'DMG': 'DMG', 'DAMAGED': 'DMG',
  };
  return map[upper] ?? value;
}

function normalizeCurrency(value?: string): string {
  const upper = (value ?? '').toUpperCase().trim();
  return upper === 'YEN' ? 'JPY' : (['USD', 'JPY'].includes(upper) ? upper : 'USD');
}

function isEbayOrderUrl(url: string): boolean {
  const u = url.toLowerCase();
  return u.includes('ebay.') && (
    u.includes('/sh/ord') ||
    u.includes('/vod/fetchorderdetails') ||
    u.includes('/mesh/') ||
    u.includes('/ord/') ||
    /orderid=/i.test(u) ||
    /order_id=/i.test(u)
  );
}

function normalizePlatform(value?: string, listingUrl?: string, notes?: string): ListingPlatform {
  const lower = (value ?? '').toLowerCase().trim();
  const map: Record<string, ListingPlatform> = {
    ebay: 'ebay', tcgplayer: 'tcgplayer', tcg: 'tcgplayer',
    'card show': 'card_show', card_show: 'card_show', show: 'card_show',
    facebook: 'facebook', fb: 'facebook', instagram: 'instagram', ig: 'instagram', local: 'local',
  };
  if (map[lower]) return map[lower];
  // Infer from listing URL
  if (listingUrl) {
    const url = listingUrl.toLowerCase();
    if (url.includes('ebay.')) return 'ebay';
    if (url.includes('tcgplayer.')) return 'tcgplayer';
    if (url.includes('facebook.') || url.includes('fb.com')) return 'facebook';
  }
  // Notes mentioning card show
  if (notes && /card.?show/i.test(notes)) return 'card_show';
  // If there's a listing URL (ebay-style), default to ebay
  if (listingUrl) return 'ebay';
  // No URL and no platform specified — assume card show
  return 'card_show';
}

// Parse a grade string that may contain an explicit company prefix OR PSA/CGC label formats.
// PSA format: "GEM MINT 10", "MINT 9", "NEAR MINT-MINT 8", "EXCELLENT-MINT 6"  (label first, number last)
// CGC format: "10 Gem Mint", "9.5", "8.5"  (number first, optional label after)
// Explicit prefix: "PSA 10", "BGS 9.5", "CGC 10", "ACE AP10"
function parseGradeString(raw: string): { company: GradingCompany | null; grade: number } {
  const s = raw.trim().toUpperCase();

  // Explicit company prefixes first
  const PREFIXES: [RegExp, GradingCompany][] = [
    [/^PSA[\s-]*/,          'PSA'],
    [/^BGS[\s-]*|^BECKETT[\s-]*/, 'BGS'],
    [/^CGC[\s-]*/,          'CGC'],
    [/^SGC[\s-]*/,          'SGC'],
    [/^HGA[\s-]*/,          'HGA'],
    [/^ACE[\s-]*(AP[\s-]*)*/,  'ACE'],
    [/^ARS[\s-]*/,          'ARS'],
  ];
  for (const [re, co] of PREFIXES) {
    if (re.test(s)) {
      const num = extractGradeNumber(s);
      return { company: co, grade: num };
    }
  }

  // PSA label patterns (label comes first, number at end)
  // e.g. "GEM MINT 10", "MINT 9", "NEAR MINT 7", "NEAR MINT-MINT 8", "EXCELLENT-MINT 6"
  if (/^(GEM\s*MINT|NEAR\s*MINT|EXCELLENT|VERY\s*GOOD|POOR|FAIR|GOOD|MINT)\b/.test(s)) {
    const num = extractGradeNumber(s);
    return { company: 'PSA', grade: num };
  }

  // CGC / plain numeric (number at start, optional label after): "10 Gem Mint", "9.5", "8.5"
  const num = extractGradeNumber(s);
  return { company: null, grade: num };
}

// Extract the numeric grade from anywhere in the string
function extractGradeNumber(s: string): number {
  // Try to grab a decimal number (e.g. "9.5", "8.5") first, then integer
  const m = s.match(/(\d+\.?\d*)/);
  return m ? parseFloat(m[1]) : NaN;
}

// Infer company from cert number digit length
function inferCompanyFromCert(cert?: string): GradingCompany | null {
  if (!cert) return null;
  const digits = cert.replace(/\D/g, '');
  if (digits.length === 8 || digits.length === 9) return 'PSA'; // PSA: legacy 8-digit + current 9-digit
  if (digits.length === 10) return 'CGC';                        // CGC: 10-digit certs
  return null;
}

function normalizeCompany(value?: string): GradingCompany | null {
  if (!value) return null;
  const upper = value.toUpperCase().trim();
  const map: Record<string, GradingCompany> = {
    PSA: 'PSA', BGS: 'BGS', BECKETT: 'BGS', CGC: 'CGC',
    SGC: 'SGC', HGA: 'HGA', ACE: 'ACE', ARS: 'ARS', OTHER: 'OTHER',
  };
  return map[upper] ?? null;
}

function makeGradeLabel(grade: number, company: GradingCompany): string {
  if (isNaN(grade)) return '';
  if (company === 'BGS' && grade === 10) return 'Pristine';
  if (grade === 10) return 'Gem MT';
  if (grade >= 9) return 'Mint';
  if (grade >= 8) return 'NM-MT';
  if (grade >= 7) return 'NM';
  if (grade >= 6) return 'EX-MT';
  if (grade >= 5) return 'EX';
  if (grade >= 4) return 'VG-EX';
  if (grade >= 3) return 'VG';
  if (grade >= 2) return 'Good';
  return 'Poor';
}
