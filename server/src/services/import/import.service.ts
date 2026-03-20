import { db } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { parseCsvBuffer, autoDetectMapping } from './csvParser';
import { toCents } from '../../utils/cents';

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
  const record = await db
    .selectFrom('csv_imports')
    .selectAll()
    .where('id', '=', importId)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (!record) throw new AppError(404, 'Import not found');

  return db
    .updateTable('csv_imports')
    .set({ mapping: mapping as any })
    .where('id', '=', importId)
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function executeImport(
  userId: string,
  importId: string,
  buffer: Buffer
) {
  const record = await db
    .selectFrom('csv_imports')
    .selectAll()
    .where('id', '=', importId)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (!record) throw new AppError(404, 'Import not found');
  if (record.status === 'completed') throw new AppError(409, 'Import already completed');

  await db
    .updateTable('csv_imports')
    .set({ status: 'processing' })
    .where('id', '=', importId)
    .execute();

  const { rows } = parseCsvBuffer(buffer, record.filename);
  const mapping = (record.mapping ?? {}) as Record<string, string>;
  const errorLog: Array<{ row: number; message: string }> = [];
  let importedCount = 0;

  // Process in batches of 100
  const BATCH_SIZE = 100;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const inserts = [];

    for (let j = 0; j < batch.length; j++) {
      const rowIndex = i + j + 2; // 1-indexed + header row
      const row = batch[j];

      try {
        const mapped = applyMapping(row, mapping);
        const validated = validateRow(mapped, rowIndex);
        if (validated) inserts.push(validated);
      } catch (err) {
        errorLog.push({
          row: rowIndex,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (inserts.length > 0) {
      await db
        .insertInto('card_instances')
        .values(inserts.map((ins) => ({ ...ins, user_id: userId })))
        .execute()
        .catch((err) => {
          errorLog.push({ row: -1, message: `Batch insert failed: ${err.message}` });
        });
      importedCount += inserts.length;
    }
  }

  const finalStatus = errorLog.length > 0 && importedCount === 0 ? 'failed' : 'completed';

  await db
    .updateTable('csv_imports')
    .set({
      status: finalStatus,
      imported_count: importedCount,
      error_count: errorLog.length,
      error_log: errorLog.length > 0 ? (errorLog as any) : null,
      completed_at: new Date(),
    })
    .where('id', '=', importId)
    .execute();

  return {
    status: finalStatus,
    imported_count: importedCount,
    error_count: errorLog.length,
    errors: errorLog.slice(0, 50), // Return first 50 errors
  };
}

function applyMapping(
  row: Record<string, string>,
  mapping: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [csvColumn, field] of Object.entries(mapping)) {
    if (row[csvColumn] !== undefined) {
      result[field] = row[csvColumn];
    }
  }
  return result;
}

function validateRow(
  mapped: Record<string, string>,
  rowIndex: number
): Omit<import('../../types/db').NewCardInstance, 'user_id'> | null {
  const cardName = mapped['card_name']?.trim();
  if (!cardName) {
    throw new Error(`Row ${rowIndex}: card_name is required`);
  }

  const rawCost = mapped['purchase_cost'];
  const purchaseCost = rawCost ? toCents(rawCost) : 0;

  const currency = mapped['currency']?.toUpperCase() ?? 'USD';
  const validCurrencies = ['USD', 'JPY', 'YEN'];
  const normalizedCurrency = validCurrencies.includes(currency)
    ? (currency === 'YEN' ? 'JPY' : currency)
    : 'USD';

  const quantity = parseInt(mapped['quantity'] ?? '1', 10);

  return {
    catalog_id: null,
    card_name_override: cardName,
    set_name_override: mapped['set_name']?.trim() ?? null,
    card_number_override: mapped['card_number']?.trim() ?? null,
    card_game: mapped['card_game']?.toLowerCase() ?? 'pokemon',
    language: mapped['language']?.toUpperCase() ?? 'EN',
    variant: null,
    rarity: null,
    notes: null,
    purchase_type: 'raw',
    status: 'purchased_raw',
    quantity: isNaN(quantity) ? 1 : quantity,
    purchase_cost: purchaseCost,
    currency: normalizedCurrency,
    source_link: mapped['source_link']?.trim() ?? null,
    order_number: mapped['order_number']?.trim() ?? null,
    condition: normalizeCondition(mapped['condition']),
    condition_notes: null,
    image_front_url: null,
    image_back_url: null,
    purchased_at: mapped['purchased_at'] ? new Date(mapped['purchased_at']) : null,
  };
}

function normalizeCondition(value?: string): string | null {
  if (!value) return null;
  const upper = value.toUpperCase().trim();
  const map: Record<string, string> = {
    'NM': 'NM', 'NEAR MINT': 'NM',
    'LP': 'LP', 'LIGHTLY PLAYED': 'LP',
    'MP': 'MP', 'MODERATELY PLAYED': 'MP',
    'HP': 'HP', 'HEAVILY PLAYED': 'HP',
    'DMG': 'DMG', 'DAMAGED': 'DMG',
  };
  return map[upper] ?? value;
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

export async function listImports(userId: string) {
  return db
    .selectFrom('csv_imports')
    .select(['id', 'filename', 'import_type', 'status', 'row_count', 'imported_count', 'error_count', 'created_at', 'completed_at'])
    .where('user_id', '=', userId)
    .orderBy('created_at', 'desc')
    .limit(50)
    .execute();
}
