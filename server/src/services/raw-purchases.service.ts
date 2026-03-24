import { db } from '../config/database';
import { sql } from 'kysely';
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
    search?: string;
    page?: number;
    pageSize?: number;
  } = {}
) {
  const { type, status, search, page = 1, pageSize = 50 } = filters;
  const offset = (page - 1) * pageSize;

  let query = db
    .selectFrom('raw_purchases as rp')
    .leftJoin('card_instances as ci', (join) =>
      join.onRef('ci.raw_purchase_id', '=', 'rp.id').on('ci.deleted_at', 'is', null)
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
      db.fn.count<number>('ci.id' as any).as('inspected_count'),
      db.fn
        .count<number>(sql`CASE WHEN ci.decision = 'sell_raw' THEN 1 END`)
        .as('sell_raw_count'),
      db.fn
        .count<number>(sql`CASE WHEN ci.decision = 'grade' THEN 1 END`)
        .as('grade_count'),
    ])
    .where('rp.user_id', '=', userId)
    .groupBy('rp.id')
    .orderBy('rp.purchased_at', 'desc')
    .orderBy('rp.purchase_id', 'desc');

  if (type) query = query.where('rp.type', '=', type);
  if (status) query = query.where('rp.status', '=', status);
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
    db
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
    .where('ci.deleted_at', 'is', null)
    .orderBy('ci.created_at', 'asc')
    .execute();

  return { ...purchase, cards };
}

export async function createRawPurchase(userId: string, input: CreateRawPurchaseInput) {
  const year = input.purchased_at
    ? new Date(input.purchased_at).getFullYear()
    : new Date().getFullYear();

  const purchaseId = await nextPurchaseId(userId, input.type, year);

  return db
    .insertInto('raw_purchases')
    .values({
      user_id: userId,
      purchase_id: purchaseId,
      type: input.type,
      source: input.source ?? null,
      order_number: input.order_number ?? null,
      language: input.language ?? 'JP',
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
}

export async function updateRawPurchase(
  userId: string,
  id: string,
  input: UpdateRawPurchaseInput
) {
  const update: Record<string, unknown> = {};
  if (input.type !== undefined)          update.type = input.type;
  if (input.source !== undefined)        update.source = input.source;
  if (input.order_number !== undefined)  update.order_number = input.order_number;
  if (input.language !== undefined)      update.language = input.language;
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

  return db
    .updateTable('raw_purchases')
    .set(update)
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .returningAll()
    .executeTakeFirst();
}

export async function deleteRawPurchase(userId: string, id: string) {
  // Unlink cards first
  await db
    .updateTable('card_instances')
    .set({ raw_purchase_id: null })
    .where('raw_purchase_id', '=', id)
    .where('user_id', '=', userId)
    .execute();

  return db
    .deleteFrom('raw_purchases')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();
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

  return db
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
}

export async function updateInspectionLine(
  userId: string,
  cardInstanceId: string,
  input: Partial<InspectionLineInput>
) {
  const update: Record<string, unknown> = {};
  if (input.condition !== undefined)     update.condition = input.condition;
  if (input.decision !== undefined) {
    update.decision = input.decision;
    update.status = input.decision === 'sell_raw' ? 'raw_for_sale' : 'inspected';
  }
  if (input.quantity !== undefined)      update.quantity = input.quantity;
  if (input.purchase_cost !== undefined) update.purchase_cost = input.purchase_cost;
  if (input.notes !== undefined)         update.notes = input.notes;

  return db
    .updateTable('card_instances')
    .set(update)
    .where('id', '=', cardInstanceId)
    .where('user_id', '=', userId)
    .where('deleted_at', 'is', null)
    .returningAll()
    .executeTakeFirst();
}

export async function deleteInspectionLine(userId: string, cardInstanceId: string) {
  return db
    .updateTable('card_instances')
    .set({ deleted_at: new Date() })
    .where('id', '=', cardInstanceId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
}
