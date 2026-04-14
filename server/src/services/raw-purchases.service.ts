import { db } from '../config/database';
import { sql } from 'kysely';
import { logAudit } from '../utils/audit';
import type { RawPurchaseType, RawPurchaseStatus } from '../types/db';

// ── Types ────────────────────────────────────────────────────────────────────

export interface RawPurchaseRow {
  id: string;
  purchase_id: string;
  type: RawPurchaseType;
  source: string | null;
  order_number: string | null;
  language: string;
  catalog_id: string | null;
  card_name: string | null;
  set_name: string | null;
  card_number: string | null;
  total_cost_yen: number | null;
  fx_rate: number | null;
  total_cost_usd: number | null;
  card_count: number;
  avg_cost_usd: number | null;
  status: RawPurchaseStatus;
  purchased_at: string | null;
  received_at: string | null;
  reserved: boolean;
  notes: string | null;
  receipt_url: string | null;
  // aggregated
  inspected_count: number;
  sell_raw_count: number;
  grade_count: number;
}

export interface CreateRawPurchaseInput {
  type: RawPurchaseType;
  source?: string;
  order_number?: string;
  language?: string;
  catalog_id?: string;
  card_name?: string;
  set_name?: string;
  card_number?: string;
  total_cost_yen?: number;
  fx_rate?: number;
  total_cost_usd?: number;
  card_count?: number;
  status?: RawPurchaseStatus;
  purchased_at?: string;
  received_at?: string;
  reserved?: boolean;
  notes?: string;
}

export interface UpdateRawPurchaseInput extends Partial<CreateRawPurchaseInput> {}

// ── Purchase ID generation ────────────────────────────────────────────────────

async function nextPurchaseId(userId: string, type: RawPurchaseType, year: number): Promise<string> {
  const letter = type === 'raw' ? 'R' : 'B';

  // Upsert sequence row and return the incremented value atomically
  const result = await sql<{ next_seq: number }>`
    INSERT INTO raw_purchase_sequences (user_id, year, type, next_seq)
    VALUES (${userId}, ${year}, ${type}, 2)
    ON CONFLICT (user_id, year, type)
    DO UPDATE SET next_seq = raw_purchase_sequences.next_seq + 1
    RETURNING next_seq - 1 AS next_seq
  `.execute(db);

  const seq = result.rows[0].next_seq;
  return `${year}${letter}${seq}`;
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function listRawPurchases(
  userId: string,
  filters: {
    type?: RawPurchaseType;
    status?: RawPurchaseStatus;
    needs_inspection?: boolean;
    search?: string;
    page?: number;
    pageSize?: number;
  } = {}
) {
  const { type, status, needs_inspection, search, page = 1, pageSize = 50 } = filters;
  const offset = (page - 1) * pageSize;

  let query = db
    .selectFrom('raw_purchases as rp')
    .leftJoin('card_instances as ci', (join) =>
      join.onRef('ci.raw_purchase_id', '=', 'rp.id')
    )
    .select([
      'rp.id',
      'rp.purchase_id',
      'rp.type',
      'rp.source',
      'rp.order_number',
      'rp.language',
      'rp.catalog_id',
      'rp.card_name',
      'rp.set_name',
      'rp.card_number',
      'rp.total_cost_yen',
      'rp.fx_rate',
      'rp.total_cost_usd',
      'rp.card_count',
      'rp.status',
      'rp.purchased_at',
      'rp.received_at',
      'rp.reserved',
      'rp.notes',
      'rp.receipt_url',
      sql<number>`COALESCE(SUM(ci.quantity), 0)`.as('inspected_count'),
      sql<number>`COALESCE(SUM(CASE WHEN ci.decision = 'sell_raw' THEN ci.quantity END), 0)`.as('sell_raw_count'),
      sql<number>`COALESCE(SUM(CASE WHEN ci.decision = 'grade' THEN ci.quantity END), 0)`.as('grade_count'),
    ])
    .where('rp.user_id', '=', userId)
    .groupBy('rp.id')
    .orderBy('rp.purchased_at', 'desc')
    .orderBy('rp.purchase_id', 'desc');

  if (type) query = query.where('rp.type', '=', type);
  if (status) query = query.where('rp.status', '=', status);
  if (needs_inspection) {
    query = query
      .where('rp.status', '=', 'received')
      .having(sql<boolean>`COALESCE(SUM(ci.quantity), 0) < rp.card_count`);
  }
  if (search) {
    const term = `%${search}%`;
    query = query.where((eb) =>
      eb.or([
        eb('rp.purchase_id', 'ilike', term),
        eb('rp.card_name', 'ilike', term),
        eb('rp.set_name', 'ilike', term),
        eb('rp.source', 'ilike', term),
        eb('rp.order_number', 'ilike', term),
      ])
    );
  }

  const [rows, countResult] = await Promise.all([
    query.limit(pageSize).offset(offset).execute(),
    needs_inspection
      ? db
          .selectFrom('raw_purchases as rp')
          .leftJoin('card_instances as ci', (join) =>
            join.onRef('ci.raw_purchase_id', '=', 'rp.id')
          )
          .select('rp.id')
          .where('rp.user_id', '=', userId)
          .where('rp.status', '=', 'received')
          .$if(!!type, (q) => q.where('rp.type', '=', type!))
          .groupBy('rp.id')
          .having(sql<boolean>`COALESCE(SUM(ci.quantity), 0) < rp.card_count`)
          .execute()
          .then((rows) => ({ total: rows.length }))
      : db
          .selectFrom('raw_purchases')
          .select(db.fn.count<number>('id').as('total'))
          .where('user_id', '=', userId)
          .$if(!!type, (q) => q.where('type', '=', type!))
          .$if(!!status, (q) => q.where('status', '=', status!))
          .executeTakeFirst(),
  ]);

  const total = Number(countResult?.total ?? 0);

  return {
    data: rows.map((r) => ({
      ...r,
      inspected_count: Number(r.inspected_count),
      sell_raw_count: Number(r.sell_raw_count),
      grade_count: Number(r.grade_count),
      avg_cost_usd:
        r.total_cost_usd && r.card_count > 0
          ? Math.round(r.total_cost_usd / r.card_count)
          : null,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function getRawPurchase(userId: string, id: string) {
  const purchase = await db
    .selectFrom('raw_purchases')
    .selectAll()
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (!purchase) return null;

  // Cards linked to this purchase
  const cards = await db
    .selectFrom('card_instances as ci')
    .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
    .select([
      'ci.id',
      'ci.status',
      'ci.decision',
      'ci.condition',
      'ci.quantity',
      'ci.purchase_cost',
      'ci.currency',
      'ci.notes',
      sql<string>`COALESCE(cc.card_name, ci.card_name_override)`.as('card_name'),
      sql<string>`COALESCE(cc.set_name, ci.set_name_override)`.as('set_name'),
      sql<string>`COALESCE(cc.card_number, ci.card_number_override)`.as('card_number'),
      'cc.sku as part_number',
    ])
    .where('ci.raw_purchase_id', '=', id)
    .where('ci.user_id', '=', userId)
    .orderBy('ci.created_at', 'asc')
    .execute();

  return { ...purchase, cards };
}

export async function createRawPurchase(userId: string, input: CreateRawPurchaseInput) {
  const year = input.purchased_at
    ? new Date(input.purchased_at).getFullYear()
    : new Date().getFullYear();

  const purchaseId = await nextPurchaseId(userId, input.type, year);

  const purchase = await db
    .insertInto('raw_purchases')
    .values({
      user_id: userId,
      purchase_id: purchaseId,
      type: input.type,
      source: input.source ?? null,
      order_number: input.order_number ?? null,
      language: input.language ?? 'JP',
      catalog_id: input.catalog_id ?? null,
      card_name: input.card_name ?? null,
      set_name: input.set_name ?? null,
      card_number: input.card_number ?? null,
      total_cost_yen: input.total_cost_yen ?? null,
      fx_rate: input.fx_rate ?? null,
      total_cost_usd: input.total_cost_usd ?? null,
      card_count: input.card_count ?? 1,
      status: input.status ?? 'ordered',
      purchased_at: input.purchased_at ? new Date(input.purchased_at) : null,
      received_at: input.received_at ? new Date(input.received_at) : null,
      reserved: input.reserved ?? false,
      notes: input.notes ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await logAudit(userId, 'raw_purchases', purchase.id, 'created', null, purchase);
  return purchase;
}

export async function updateRawPurchase(
  userId: string,
  id: string,
  input: UpdateRawPurchaseInput
) {
  const existing = await db.selectFrom('raw_purchases').selectAll().where('id', '=', id).where('user_id', '=', userId).executeTakeFirst();

  const update: Record<string, unknown> = {};

  // If type is changing, regenerate the purchase_id for the new type
  if (input.type !== undefined && existing && input.type !== existing.type) {
    const year = existing.purchased_at
      ? new Date(existing.purchased_at).getFullYear()
      : new Date().getFullYear();
    update.purchase_id = await nextPurchaseId(userId, input.type as RawPurchaseType, year);
  }

  if (input.type !== undefined)          update.type = input.type;
  if (input.source !== undefined)        update.source = input.source;
  if (input.order_number !== undefined)  update.order_number = input.order_number;
  if (input.language !== undefined)      update.language = input.language;
  if (input.catalog_id !== undefined)    update.catalog_id = input.catalog_id;
  if (input.card_name !== undefined)     update.card_name = input.card_name;
  if (input.set_name !== undefined)      update.set_name = input.set_name;
  if (input.card_number !== undefined)   update.card_number = input.card_number;
  if (input.total_cost_yen !== undefined) update.total_cost_yen = input.total_cost_yen;
  if (input.fx_rate !== undefined)       update.fx_rate = input.fx_rate;
  if (input.total_cost_usd !== undefined) update.total_cost_usd = input.total_cost_usd;
  if (input.card_count !== undefined)    update.card_count = input.card_count;
  if (input.status !== undefined)        update.status = input.status;
  if (input.purchased_at !== undefined)  update.purchased_at = input.purchased_at ? new Date(input.purchased_at) : null;
  if (input.received_at !== undefined)   update.received_at = input.received_at ? new Date(input.received_at) : null;
  if (input.reserved !== undefined)      update.reserved = input.reserved;
  if (input.notes !== undefined)         update.notes = input.notes;

  const updated = await db
    .updateTable('raw_purchases')
    .set(update)
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .returningAll()
    .executeTakeFirst();
  if (updated) await logAudit(userId, 'raw_purchases', id, 'updated', existing, updated);
  return updated;
}

export async function saveReceiptUrl(userId: string, id: string, receiptUrl: string) {
  const updated = await db
    .updateTable('raw_purchases')
    .set({ receipt_url: receiptUrl } as any)
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .returningAll()
    .executeTakeFirst();
  if (!updated) throw new Error('Raw purchase not found');
  return updated;
}

export async function deleteRawPurchase(userId: string, id: string) {
  const existing = await db.selectFrom('raw_purchases').selectAll().where('id', '=', id).where('user_id', '=', userId).executeTakeFirst();

  // Unlink cards first
  await db
    .updateTable('card_instances')
    .set({ raw_purchase_id: null })
    .where('raw_purchase_id', '=', id)
    .where('user_id', '=', userId)
    .execute();

  const result = await db
    .deleteFrom('raw_purchases')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (existing) await logAudit(userId, 'raw_purchases', id, 'deleted', existing, null);
  return result;
}

// ── Inspection: add/update card instance linked to a purchase ─────────────────

export interface InspectionLineInput {
  condition: string;
  decision: 'sell_raw' | 'grade';
  quantity: number;
  purchase_cost: number;
  currency?: string;
  notes?: string;
}

export async function addInspectionLine(
  userId: string,
  purchaseId: string,
  input: InspectionLineInput
) {
  // Look up purchase for card identity
  const purchase = await db
    .selectFrom('raw_purchases')
    .selectAll()
    .where('id', '=', purchaseId)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (!purchase) throw new Error('Purchase not found');

  const status = input.decision === 'sell_raw' ? 'raw_for_sale' : 'inspected';

  const card = await db
    .insertInto('card_instances')
    .values({
      user_id: userId,
      raw_purchase_id: purchaseId,
      purchase_type: 'raw',
      card_game: 'pokemon',
      status,
      decision: input.decision,
      condition: input.condition,
      quantity: input.quantity,
      purchase_cost: input.purchase_cost,
      currency: input.currency ?? 'USD',
      language: purchase.language,
      card_name_override: purchase.card_name ?? null,
      set_name_override: purchase.set_name ?? null,
      card_number_override: purchase.card_number ?? null,
      catalog_id: purchase.catalog_id ?? null,
      notes: input.notes ?? null,
      purchased_at: purchase.purchased_at ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await logAudit(userId, 'card_instances', card.id, 'created', null, card);
  return card;
}

export async function updateInspectionLine(
  userId: string,
  cardInstanceId: string,
  input: Partial<InspectionLineInput>
) {
  const existing = await db.selectFrom('card_instances').selectAll().where('id', '=', cardInstanceId).where('user_id', '=', userId).executeTakeFirst();

  const update: Record<string, unknown> = {};
  if (input.condition !== undefined)     update.condition = input.condition;
  if (input.decision !== undefined) {
    update.decision = input.decision;
    update.status = input.decision === 'sell_raw' ? 'raw_for_sale' : 'inspected';
  }
  if (input.quantity !== undefined)      update.quantity = input.quantity;
  if (input.purchase_cost !== undefined) update.purchase_cost = input.purchase_cost;
  if (input.notes !== undefined)         update.notes = input.notes;

  const updated = await db
    .updateTable('card_instances')
    .set(update)
    .where('id', '=', cardInstanceId)
    .where('user_id', '=', userId)
    .returningAll()
    .executeTakeFirst();
  if (updated) await logAudit(userId, 'card_instances', cardInstanceId, 'updated', existing, updated);
  return updated;
}

export async function deleteInspectionLine(userId: string, cardInstanceId: string) {
  // Fetch snapshot for audit log
  const card = await db
    .selectFrom('card_instances')
    .selectAll()
    .where('id', '=', cardInstanceId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!card) return null;
  await logAudit(userId, 'card_instances', cardInstanceId, 'deleted', card, null);
  await db.deleteFrom('card_instances').where('id', '=', cardInstanceId).where('user_id', '=', userId).execute();
  return card;
}
