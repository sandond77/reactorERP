import { db } from '../config/database';
import { sql } from 'kysely';
import { logAudit } from '../utils/audit';
import type { GradingCompany } from '../types/db';

// ── ID generation ─────────────────────────────────────────────────────────────

async function nextBatchId(userId: string, year: number): Promise<string> {
  const result = await sql<{ next_seq: number }>`
    INSERT INTO grading_batch_sequences (user_id, year, next_seq)
    VALUES (${userId}, ${year}, 2)
    ON CONFLICT (user_id, year)
    DO UPDATE SET next_seq = grading_batch_sequences.next_seq + 1
    RETURNING next_seq - 1 AS next_seq
  `.execute(db);
  return `${year}S${result.rows[0].next_seq}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreateBatchInput {
  name?: string;
  company: string;
  tier: string;
  submitted_at?: string;
  grading_cost?: number;  // cost per card, in cents
  notes?: string;
}

export interface UpdateBatchInput extends Partial<CreateBatchInput> {
  status?: string;
  submission_number?: string | null;
}

export interface AddItemInput {
  card_instance_id: string;
  quantity?: number;
  expected_grade?: number;
  estimated_value?: number;
}

// ── Queries ───────────────────────────────────────────────────────────────────

export async function listBatches(userId: string) {
  const rows = await db
    .selectFrom('grading_batches as gb')
    .leftJoin('grading_batch_items as gbi', 'gbi.batch_id', 'gb.id')
    .leftJoin('card_instances as ci', 'ci.id', 'gbi.card_instance_id')
    .select([
      'gb.id',
      'gb.batch_id',
      'gb.name',
      'gb.company',
      'gb.tier',
      'gb.submitted_at',
      'gb.grading_cost',
      'gb.status',
      'gb.notes',
      'gb.created_at',
      db.fn.count<number>('gbi.id').as('item_count'),
      sql<number>`COALESCE(SUM(gbi.quantity), 0)`.as('total_qty'),
      sql<number>`COALESCE(SUM(ci.purchase_cost * gbi.quantity), 0)`.as('raw_cost'),
      sql<number>`COALESCE(SUM(gbi.estimated_value * gbi.quantity), 0)`.as('estimated_total'),
    ])
    .where('gb.user_id', '=', userId)
    .groupBy('gb.id')
    .orderBy('gb.created_at', 'desc')
    .execute();

  return rows.map((r) => ({
    ...r,
    item_count:      Number(r.item_count),
    total_qty:       Number((r as any).total_qty),
    raw_cost:        Number(r.raw_cost),
    estimated_total: Number(r.estimated_total),
  }));
}

export async function getBatch(userId: string, id: string) {
  const batch = await db
    .selectFrom('grading_batches')
    .selectAll()
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (!batch) return null;

  const items = await db
    .selectFrom('grading_batch_items as gbi')
    .innerJoin('card_instances as ci', 'ci.id', 'gbi.card_instance_id')
    .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
    .leftJoin('raw_purchases as rp', 'rp.id', 'ci.raw_purchase_id')
    .select([
      'gbi.id',
      'gbi.card_instance_id',
      'gbi.line_item_num',
      'gbi.quantity',
      'gbi.expected_grade',
      'gbi.estimated_value',
      'ci.quantity as available_quantity',
      'ci.purchase_cost',
      'ci.currency',
      'ci.condition',
      'rp.purchase_id as raw_purchase_label',
      sql<string>`COALESCE(ci.card_name_override, cc.card_name)`.as('card_name'),
      sql<string>`COALESCE(cc.set_name, ci.set_name_override)`.as('set_name'),
      sql<string>`COALESCE(cc.card_number, ci.card_number_override)`.as('card_number'),
      'ci.catalog_id',
      'cc.sku',
    ])
    .where('gbi.batch_id', '=', id)
    .orderBy('gbi.line_item_num', 'asc')
    .execute();

  // Stats — grading_cost is per card; multiply by total card count
  const totalQty    = items.reduce((s, i) => s + i.quantity, 0);
  const rawCost     = items.reduce((s, i) => s + i.purchase_cost * i.quantity, 0);
  const gradingCost = (batch.grading_cost ?? 0) * totalQty;
  const totalCost   = rawCost + gradingCost;
  const totalValue  = items.reduce((s, i) => s + (i.estimated_value ?? 0) * i.quantity, 0);
  const maxGain     = totalValue - totalCost;
  const estimate80  = Math.round(maxGain * 0.8);

  // Rolling total (card count)
  let rolling = 0;
  const itemsWithRolling = items.map((item) => {
    const itemTotal = (item.estimated_value ?? 0) * item.quantity;
    rolling += item.quantity;
    return { ...item, item_total: itemTotal, rolling_total: rolling };
  });

  return {
    ...batch,
    items: itemsWithRolling,
    stats: { rawCost, gradingCost, totalCost, totalValue, maxGain, estimate80 },
  };
}

export async function createBatch(userId: string, input: CreateBatchInput) {
  const year = input.submitted_at
    ? new Date(input.submitted_at).getFullYear()
    : new Date().getFullYear();
  const batchId = await nextBatchId(userId, year);

  const batch = await db
    .insertInto('grading_batches')
    .values({
      user_id:      userId,
      batch_id:     batchId,
      name:         input.name ?? null,
      company:      input.company,
      tier:         input.tier,
      submitted_at: input.submitted_at ? new Date(input.submitted_at) : null,
      grading_cost: input.grading_cost ?? 0,
      notes:        input.notes ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await logAudit(userId, 'grading_batches', batch.id, 'created', null, batch);
  return batch;
}

export async function updateBatch(userId: string, id: string, input: UpdateBatchInput) {
  const existing = await db.selectFrom('grading_batches').selectAll().where('id', '=', id).where('user_id', '=', userId).executeTakeFirst();

  const update: Record<string, unknown> = {};
  if (input.name !== undefined)         update.name         = input.name;
  if (input.company !== undefined)      update.company      = input.company;
  if (input.tier !== undefined)         update.tier         = input.tier;
  if (input.submitted_at !== undefined) update.submitted_at = input.submitted_at ? new Date(input.submitted_at) : null;
  if (input.grading_cost !== undefined) update.grading_cost = input.grading_cost;
  if (input.status !== undefined)            update.status            = input.status;
  if (input.notes !== undefined)             update.notes             = input.notes;
  if (input.submission_number !== undefined) update.submission_number = input.submission_number;

  const updated = await db
    .updateTable('grading_batches')
    .set({ ...update, updated_at: new Date() })
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .returningAll()
    .executeTakeFirst();
  if (updated) await logAudit(userId, 'grading_batches', id, 'updated', existing, updated);
  return updated;
}

export async function deleteBatch(userId: string, id: string) {
  const existing = await db.selectFrom('grading_batches').selectAll().where('id', '=', id).where('user_id', '=', userId).executeTakeFirst();

  // Revert all card instances in this batch back to inspected
  const items = await db
    .selectFrom('grading_batch_items')
    .select('card_instance_id')
    .where('batch_id', '=', id)
    .execute();

  if (items.length > 0) {
    const instanceIds = items.map((i) => i.card_instance_id);
    await db
      .updateTable('card_instances')
      .set({ status: 'inspected', decision: 'grade' })
      .where('id', 'in', instanceIds)
      .where('user_id', '=', userId)
      .execute();
  }

  const result = await db
    .deleteFrom('grading_batches')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (existing) await logAudit(userId, 'grading_batches', id, 'deleted', existing, null);
  return result;
}

export async function addItem(userId: string, batchId: string, input: AddItemInput) {
  const batch = await db
    .selectFrom('grading_batches')
    .select('id')
    .where('id', '=', batchId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!batch) throw new Error('Batch not found');

  const maxRow = await db
    .selectFrom('grading_batch_items')
    .select(db.fn.max('line_item_num').as('max_num'))
    .where('batch_id', '=', batchId)
    .executeTakeFirst();
  const lineItemNum = (maxRow?.max_num ?? 0) + 1;

  const item = await db
    .insertInto('grading_batch_items')
    .values({
      batch_id:         batchId,
      card_instance_id: input.card_instance_id,
      line_item_num:    lineItemNum,
      quantity:         input.quantity ?? 1,
      expected_grade:   input.expected_grade ?? null,
      estimated_value:  input.estimated_value ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  // Move card instance to grading_submitted
  await db
    .updateTable('card_instances')
    .set({ status: 'grading_submitted' })
    .where('id', '=', input.card_instance_id)
    .where('user_id', '=', userId)
    .execute();

  return item;
}

export interface UpdateItemInput {
  quantity?: number;
  expected_grade?: number | null;
  estimated_value?: number | null;
}

export async function updateItem(userId: string, itemId: string, input: UpdateItemInput) {
  const update: Record<string, unknown> = {};
  if (input.quantity        !== undefined) update.quantity        = input.quantity;
  if (input.expected_grade  !== undefined) update.expected_grade  = input.expected_grade;
  if (input.estimated_value !== undefined) update.estimated_value = input.estimated_value;

  return db
    .updateTable('grading_batch_items as gbi')
    .set(update)
    .where('gbi.id', '=', itemId)
    .where((eb) =>
      eb.exists(
        eb.selectFrom('grading_batches as gb')
          .select('gb.id')
          .whereRef('gb.id', '=', 'gbi.batch_id')
          .where('gb.user_id', '=', userId)
      )
    )
    .returningAll()
    .executeTakeFirst();
}

export interface ReturnItemInput {
  batch_item_id: string;
  grade: number;
  grade_label?: string;
  cert_number?: string;
  actual_value?: number;
  card_name_override?: string;
}

export interface ProcessReturnInput {
  returned_at?: string;
  items: ReturnItemInput[];
}

export async function processReturn(userId: string, batchId: string, input: ProcessReturnInput) {
  const batch = await db
    .selectFrom('grading_batches')
    .selectAll()
    .where('id', '=', batchId)
    .where('user_id', '=', userId)
    .where('status', '=', 'submitted')
    .executeTakeFirst();
  if (!batch) return null;

  for (const item of input.items) {
    const batchItem = await db
      .selectFrom('grading_batch_items')
      .selectAll()
      .where('id', '=', item.batch_item_id)
      .where('batch_id', '=', batchId)
      .executeTakeFirst();
    if (!batchItem) continue;

    const original = await db
      .selectFrom('card_instances')
      .selectAll()
      .where('id', '=', batchItem.card_instance_id)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!original) continue;

    const newInstance = await db
      .insertInto('card_instances')
      .values({
        user_id:              userId,
        catalog_id:           original.catalog_id,
        card_name_override:   item.card_name_override ?? original.card_name_override,
        set_name_override:    original.set_name_override,
        card_number_override: original.card_number_override,
        card_game:            original.card_game,
        language:             original.language,
        variant:              original.variant,
        rarity:               original.rarity,
        notes:                original.notes,
        status:               'graded',
        purchase_type:        'pre_graded',
        quantity:             batchItem.quantity,
        purchase_cost:        original.purchase_cost,
        currency:             original.currency,
        raw_purchase_id:      null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await db
      .insertInto('slab_details')
      .values({
        card_instance_id:      newInstance.id,
        user_id:               userId,
        source_raw_instance_id: original.id,
        grading_submission_id: null,
        company:               batch.company as GradingCompany,
        grade:                 item.grade,
        grade_label:           item.grade_label ?? null,
        cert_number:           item.cert_number ? Number(item.cert_number) : null,
        grading_cost:          batch.grading_cost,
        additional_cost:       0,
        currency:              'USD',
      })
      .execute();
    await logAudit(userId, 'card_instances', newInstance.id, 'created', null, newInstance);

    const newQty = original.quantity - batchItem.quantity;
    if (newQty <= 0) {
      // All copies sent to grading — hard-delete the raw instance
      await logAudit(userId, 'card_instances', original.id, 'deleted', original, null);
      await db.deleteFrom('card_instances').where('id', '=', original.id).where('user_id', '=', userId).execute();
    } else {
      await db
        .updateTable('card_instances')
        .set({ quantity: newQty, updated_at: new Date() })
        .where('id', '=', original.id)
        .where('user_id', '=', userId)
        .execute();
    }
  }

  await db
    .updateTable('grading_batches')
    .set({ status: 'returned', updated_at: new Date() })
    .where('id', '=', batchId)
    .where('user_id', '=', userId)
    .execute();

  return getBatch(userId, batchId);
}

export async function revertReturn(userId: string, batchId: string) {
  const batch = await db
    .selectFrom('grading_batches')
    .selectAll()
    .where('id', '=', batchId)
    .where('user_id', '=', userId)
    .where('status', '=', 'returned')
    .executeTakeFirst();
  if (!batch) return null;

  // Get all batch items to find the original raw instances
  const batchItems = await db
    .selectFrom('grading_batch_items')
    .selectAll()
    .where('batch_id', '=', batchId)
    .execute();

  for (const batchItem of batchItems) {
    // Find the graded instance created for this raw source
    const slabDetail = await db
      .selectFrom('slab_details')
      .select(['card_instance_id'])
      .where('source_raw_instance_id', '=', batchItem.card_instance_id)
      .executeTakeFirst();

    if (slabDetail) {
      // Delete the slab detail and the graded card instance
      await db
        .deleteFrom('slab_details')
        .where('card_instance_id', '=', slabDetail.card_instance_id)
        .execute();
      await db
        .deleteFrom('card_instances')
        .where('id', '=', slabDetail.card_instance_id)
        .where('user_id', '=', userId)
        .execute();
    }

    // Restore the original raw instance
    const original = await db
      .selectFrom('card_instances')
      .selectAll()
      .where('id', '=', batchItem.card_instance_id)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (original) {
      // Partially consumed — original still exists, add quantity back
      if (slabDetail) {
        await db.updateTable('card_instances')
          .set({ quantity: original.quantity + batchItem.quantity, updated_at: new Date() })
          .where('id', '=', original.id).execute();
      }
    } else {
      // Fully consumed — was hard-deleted, restore from audit log
      const auditRow = await db
        .selectFrom('audit_log')
        .select('old_data')
        .where('entity_type', '=', 'card_instances')
        .where('entity_id', '=', batchItem.card_instance_id)
        .where('action', '=', 'deleted')
        .orderBy('created_at', 'desc')
        .limit(1)
        .executeTakeFirst();
      if (auditRow?.old_data) {
        const snap = auditRow.old_data as Record<string, any>;
        await db.insertInto('card_instances').values({
          id: snap.id,
          user_id: snap.user_id,
          raw_purchase_id: snap.raw_purchase_id ?? null,
          card_name_override: snap.card_name_override ?? null,
          set_name_override: snap.set_name_override ?? null,
          card_number_override: snap.card_number_override ?? null,
          card_game: snap.card_game ?? 'pokemon',
          language: snap.language ?? 'JP',
          variant: snap.variant ?? null,
          rarity: snap.rarity ?? null,
          status: 'grading_submitted',
          quantity: batchItem.quantity,
          purchase_cost: snap.purchase_cost ?? 0,
          currency: snap.currency ?? 'USD',
          purchase_type: snap.purchase_type ?? 'raw',
          condition: snap.condition ?? null,
          decision: snap.decision ?? null,
          notes: snap.notes ?? null,
          catalog_id: snap.catalog_id ?? null,
          location_id: snap.location_id ?? null,
          trade_id: snap.trade_id ?? null,
          purchased_at: snap.purchased_at ? new Date(snap.purchased_at) : null,
          created_at: snap.created_at ? new Date(snap.created_at) : new Date(),
          updated_at: new Date(),
        } as any).execute();
      }
    }
  }

  await db
    .updateTable('grading_batches')
    .set({ status: 'submitted', updated_at: new Date() })
    .where('id', '=', batchId)
    .execute();

  return getBatch(userId, batchId);
}

export async function removeItem(userId: string, itemId: string) {
  // Fetch the item first so we know which card instance to potentially revert
  const item = await db
    .selectFrom('grading_batch_items as gbi')
    .select(['gbi.id', 'gbi.card_instance_id'])
    .where('gbi.id', '=', itemId)
    .where((eb) =>
      eb.exists(
        eb.selectFrom('grading_batches as gb')
          .select('gb.id')
          .whereRef('gb.id', '=', 'gbi.batch_id')
          .where('gb.user_id', '=', userId)
      )
    )
    .executeTakeFirst();

  if (!item) return;

  await db
    .deleteFrom('grading_batch_items')
    .where('id', '=', itemId)
    .execute();

  // If no other batch items reference this card instance, revert to inspected
  const remaining = await db
    .selectFrom('grading_batch_items')
    .select('id')
    .where('card_instance_id', '=', item.card_instance_id)
    .executeTakeFirst();

  if (!remaining) {
    await db
      .updateTable('card_instances')
      .set({ status: 'inspected', decision: 'grade' })
      .where('id', '=', item.card_instance_id)
      .where('user_id', '=', userId)
      .execute();
  }
}
