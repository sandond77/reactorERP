import { db } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { parseCsvBuffer, autoDetectMapping } from './csvParser';
import { toCents } from '../../utils/cents';
import { createRawPurchase } from '../raw-purchases.service';
import { recordSale } from '../sales.service';
import type { GradingCompany, ListingPlatform } from '../../types/db';

// ── Upload / Preview ──────────────────────────────────────────────────────────

export async function uploadCsv(
  userId: string,
  filename: string,
  buffer: Buffer,
  importType: string = 'cards'
) {
  const { headers, rows, rowCount, errors } = parseCsvBuffer(buffer, filename);
  const autoMapping = autoDetectMapping(headers);

  const record = await db
    .insertInto('csv_imports')
    .values({
      user_id: userId,
      filename,
      import_type: importType,
      row_count: rowCount,
      status: 'pending',
      raw_headers: headers as any,
      preview_rows: rows.slice(0, 5) as any,
      mapping: autoMapping as any,
      error_log: errors.length > 0 ? (errors as any) : null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return {
    import_id: record.id,
    headers,
    row_count: rowCount,
    preview_rows: rows.slice(0, 5),
    auto_mapping: autoMapping,
    parse_errors: errors,
  };
}

export async function saveColumnMapping(
  userId: string,
  importId: string,
  mapping: Record<string, string>
) {
  const record = await db.selectFrom('csv_imports').selectAll()
    .where('id', '=', importId).where('user_id', '=', userId).executeTakeFirst();
  if (!record) throw new AppError(404, 'Import not found');

  return db.updateTable('csv_imports').set({ mapping: mapping as any })
    .where('id', '=', importId).returningAll().executeTakeFirstOrThrow();
}

// ── Execute ───────────────────────────────────────────────────────────────────

export async function executeImport(userId: string, importId: string, buffer: Buffer) {
  const record = await db.selectFrom('csv_imports').selectAll()
    .where('id', '=', importId).where('user_id', '=', userId).executeTakeFirst();

  if (!record) throw new AppError(404, 'Import not found');
  if (record.status === 'completed') throw new AppError(409, 'Import already completed');

  await db.updateTable('csv_imports').set({ status: 'processing' }).where('id', '=', importId).execute();

  const { rows } = parseCsvBuffer(buffer, record.filename);
  const mapping = (record.mapping ?? {}) as Record<string, string>;

  let result: { importedCount: number; errorLog: Array<{ row: number; message: string }> };

  switch (record.import_type) {
    case 'graded':
      result = await executeGradedImport(userId, rows, mapping);
      break;
    case 'raw_purchase':
      result = await executeRawPurchaseImport(userId, rows, mapping);
      break;
    case 'bulk_sale':
      result = await executeBulkSaleImport(userId, rows, mapping);
      break;
    default:
      result = await executeLegacyCardsImport(userId, rows, mapping);
  }

  const finalStatus = result.errorLog.length > 0 && result.importedCount === 0 ? 'failed' : 'completed';

  await db.updateTable('csv_imports').set({
    status: finalStatus,
    imported_count: result.importedCount,
    error_count: result.errorLog.length,
    error_log: result.errorLog.length > 0 ? (result.errorLog as any) : null,
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
  mapping: Record<string, string>
) {
  const errorLog: Array<{ row: number; message: string }> = [];
  let importedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const rowIndex = i + 2;
    const row = applyMapping(rows[i], mapping);
    try {
      const cardName = row['card_name']?.trim();
      if (!cardName) throw new Error('card_name is required');

      const certRaw = row['cert_number']?.trim();
      if (!certRaw) throw new Error('cert_number is required');

      const gradeRaw = row['grade']?.trim();
      if (!gradeRaw) throw new Error('grade is required');

      const companyRaw = normalizeCompany(row['company']?.trim());
      if (!companyRaw) throw new Error('company is required (PSA, BGS, CGC, SGC, HGA, ACE, ARS, OTHER)');

      const certNumber = parseInt(certRaw.replace(/\D/g, ''), 10);
      const grade = parseFloat(gradeRaw.replace(/[^\d.]/g, ''));
      const gradeLabel = makeGradeLabel(grade, companyRaw);

      const purchaseCost = toCents(row['purchase_cost'] ?? '0');
      const gradingCost  = toCents(row['grading_cost']  ?? '0');
      const currency = normalizeCurrency(row['currency']);
      const purchasedAt = row['purchased_at'] ? new Date(row['purchased_at']) : null;

      const ci = await db.insertInto('card_instances').values({
        user_id:              userId,
        catalog_id:           null,
        card_name_override:   cardName,
        set_name_override:    row['set_name']?.trim()     ?? null,
        card_number_override: row['card_number']?.trim()  ?? null,
        card_game:            'pokemon',
        language:             'EN',
        variant:              null,
        rarity:               null,
        notes:                row['notes']?.trim() ?? null,
        purchase_type:        'pre_graded',
        status:               'graded',
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

      importedCount++;
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
  mapping: Record<string, string>
) {
  const errorLog: Array<{ row: number; message: string }> = [];
  let importedCount = 0;

  // Group by order_number; rows without one each get their own purchase
  const groups = new Map<string, { rows: Record<string, string>[]; indices: number[] }>();
  rows.forEach((raw, i) => {
    const row = applyMapping(raw, mapping);
    const key = row['order_number']?.trim() || `__solo_${i}`;
    if (!groups.has(key)) groups.set(key, { rows: [], indices: [] });
    groups.get(key)!.rows.push(row);
    groups.get(key)!.indices.push(i + 2);
  });

  for (const [, group] of groups) {
    const firstRow = group.rows[0];
    try {
      const purchasedAt = firstRow['purchased_at'] ? new Date(firstRow['purchased_at']) : null;
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
        source,
        order_number: orderNumber,
        language,
        card_name:   group.rows.length === 1 ? (firstRow['card_name']?.trim() || null) : null,
        set_name:    group.rows.length === 1 ? (firstRow['set_name']?.trim()  || null) : null,
        card_number: group.rows.length === 1 ? (firstRow['card_number']?.trim() || null) : null,
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
  mapping: Record<string, string>
) {
  const errorLog: Array<{ row: number; message: string }> = [];
  let importedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const rowIndex = i + 2;
    const row = applyMapping(rows[i], mapping);
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
      const soldAt = row['sold_at'] ? new Date(row['sold_at']) : undefined;

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
          purchased_at:         mapped['purchased_at'] ? new Date(mapped['purchased_at']) : null,
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

function normalizePlatform(value?: string): ListingPlatform {
  const lower = (value ?? '').toLowerCase().trim();
  const map: Record<string, ListingPlatform> = {
    ebay: 'ebay', tcgplayer: 'tcgplayer', tcg: 'tcgplayer',
    'card show': 'card_show', card_show: 'card_show', show: 'card_show',
    facebook: 'facebook', fb: 'facebook', instagram: 'instagram', ig: 'instagram', local: 'local',
  };
  return map[lower] ?? 'other';
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
