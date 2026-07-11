import { db } from '../config/database';
import { sql } from 'kysely';
import { logAudit } from '../utils/audit';
import { normalizeCardNumber } from '../utils/card-number';
import { AppError } from '../middleware/errorHandler';
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
      db.fn.count<number>('gbi.id' as any).as('item_count'),
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
      'ci.language',
      'ci.legacy_source_catalog_id',
      // Remaining stash for a legacy-sourced line — drives the modal's qty
      // max so the user can pull more from the bucket via Edit Line Item.
      // Sums grade-decision stash rows (status not in terminal states) under
      // the same legacy catalog entry. 0 for non-legacy lines.
      sql<number>`COALESCE((
        SELECT SUM(stash.quantity)::int
        FROM card_instances stash
        WHERE stash.catalog_id = ci.legacy_source_catalog_id
          AND stash.user_id = ci.user_id
          AND stash.status NOT IN ('grading_submitted', 'graded', 'sold', 'lost_damaged')
          AND stash.decision = 'grade'
      ), 0)`.as('legacy_stash_remaining'),
      'rp.purchase_id as raw_purchase_label',
      sql<string>`COALESCE(ci.card_name_override, cc.card_name)`.as('card_name'),
      sql<string>`COALESCE(cc.set_name, ci.set_name_override)`.as('set_name'),
      sql<string>`COALESCE(cc.card_number, ci.card_number_override)`.as('card_number'),
      'ci.catalog_id',
      'cc.sku',
      // Returned-slab info — when this batch has been processed, the slab
      // produced from this source is tied to it via slab_details.source_raw_instance_id.
      // We surface the cert # + grade label so the sub detail view can show
      // "what came back" per line item without an extra round trip.
      sql<string | null>`(SELECT sd.cert_number::text FROM slab_details sd WHERE sd.source_raw_instance_id = ci.id AND sd.grading_batch_id = ${id} LIMIT 1)`.as('slab_cert_number'),
      sql<string | null>`(SELECT sd.grade_label FROM slab_details sd WHERE sd.source_raw_instance_id = ci.id AND sd.grading_batch_id = ${id} LIMIT 1)`.as('slab_grade_label'),
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
    stats: { totalQty, rawCost, gradingCost, totalCost, totalValue, maxGain, estimate80 },
  };
}

// Slabs produced by this batch, with card name + cert + grade.
// Used by the Sub Returns "View Return" modal.
export async function getReturnedSlabs(userId: string, batchId: string) {
  const batch = await db
    .selectFrom('grading_batches')
    .select(['id', 'batch_id', 'name', 'company', 'tier', 'status', 'submitted_at'])
    .where('id', '=', batchId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!batch) return null;

  const slabs = await db
    .selectFrom('slab_details as sd')
    .innerJoin('card_instances as ci', 'ci.id', 'sd.card_instance_id')
    .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
    .leftJoin('card_instances as raw_ci', 'raw_ci.id', 'sd.source_raw_instance_id')
    .leftJoin('raw_purchases as rp', 'rp.id', 'raw_ci.raw_purchase_id')
    .select([
      'sd.id',
      'sd.cert_number',
      'sd.grade',
      'sd.grade_label',
      'sd.company',
      'ci.id as card_instance_id',
      sql<string>`COALESCE(ci.card_name_override, cc.card_name)`.as('card_name'),
      sql<string | null>`COALESCE(cc.set_name, ci.set_name_override)`.as('set_name'),
      sql<string | null>`COALESCE(cc.card_number, ci.card_number_override)`.as('card_number'),
      'raw_ci.condition as inspection_condition',
      'raw_ci.condition_notes as inspection_note',
      'rp.purchase_id as raw_purchase_label',
      sql<number | null>`(
        SELECT gbi.expected_grade
        FROM grading_batch_items gbi
        WHERE gbi.batch_id = ${batchId}
          AND gbi.card_instance_id = sd.source_raw_instance_id
        LIMIT 1
      )`.as('expected_grade'),
    ])
    .where('sd.grading_batch_id', '=', batchId)
    .where('sd.user_id', '=', userId)
    .orderBy('sd.cert_number', 'asc')
    .execute();

  return { batch, slabs };
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
  // Coerce to integer cents — clients sometimes send strings from form inputs.
  if (input.grading_cost !== undefined) {
    const n = Math.round(Number(input.grading_cost));
    if (!Number.isFinite(n) || n < 0) {
      throw new AppError(400, `grading_cost must be a non-negative number (cents). Got: ${input.grading_cost}`);
    }
    update.grading_cost = n;
  }
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

  // Propagate grading_cost change to every slab created from this batch so
  // cost basis on still-held slabs reflects the new value. Sold slabs have
  // a snapshotted total_cost_basis on the sales row — recompute those too.
  if (
    updated &&
    input.grading_cost !== undefined &&
    existing &&
    existing.grading_cost !== update.grading_cost
  ) {
    const slabsBefore = await db
      .selectFrom('slab_details')
      .selectAll()
      .where('grading_batch_id', '=', id)
      .where('user_id', '=', userId)
      .execute();
    const affected = await db
      .updateTable('slab_details')
      .set({ grading_cost: update.grading_cost as number, updated_at: new Date() })
      .where('grading_batch_id', '=', id)
      .where('user_id', '=', userId)
      .returning('card_instance_id')
      .execute();
    for (const before of slabsBefore) {
      await logAudit(userId, 'slab_details', before.card_instance_id, 'updated', before, { ...before, grading_cost: update.grading_cost as number });
    }

    if (affected.length > 0) {
      const cardIds = affected.map((r) => r.card_instance_id);
      const sales = await db
        .selectFrom('sales')
        .selectAll()
        .where('user_id', '=', userId)
        .where('card_instance_id', 'in', cardIds)
        .execute();
      const { computeCostBasis } = await import('./cards.service');
      for (const sale of sales) {
        const newBasis = await computeCostBasis(sale.card_instance_id);
        await db
          .updateTable('sales')
          .set({ total_cost_basis: newBasis })
          .where('id', '=', sale.id)
          .where('user_id', '=', userId)
          .execute();
        await logAudit(userId, 'sales', sale.id, 'updated', sale, { ...sale, total_cost_basis: newBasis });
      }
    }
  }

  return updated;
}

export interface DeleteBatchResult {
  deleted: boolean;
  kept_slabs: RevertReturnResult['kept_slabs'];
  recredited_to_legacy: number;
}

/**
 * Delete a grading batch, cascading any work that was done on it.
 *
 *   pending/submitted → cards revert to inspected/grade-decision (or back into
 *                       their legacy bucket if they came from one).
 *   returned         → first chain through revertReturn (deletes slabs +
 *                       restores source raws), then apply the same revert.
 *                       Slabs that are sold or actively listed stay intact
 *                       and are reported via `kept_slabs`.
 */
export async function deleteBatch(userId: string, id: string): Promise<DeleteBatchResult | null> {
  const existing = await db
    .selectFrom('grading_batches')
    .selectAll()
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!existing) return null;

  let keptSlabs: RevertReturnResult['kept_slabs'] = [];

  // For returned batches, undo the return first (skipping locked slabs).
  if (existing.status === 'returned') {
    const revert = await revertReturn(userId, id, { skipLockedSlabs: true });
    keptSlabs = revert?.kept_slabs ?? [];
  }

  // Now the batch is conceptually 'submitted' or 'pending'. Each batch_item
  // points at a card_instance currently in grading_submitted (or in some
  // earlier state for pending batches). Route them back:
  //   - Legacy-bucket cards → credit the bucket stash + hard-delete the row
  //   - Normal cards         → status='inspected', decision='grade'
  const items = await db
    .selectFrom('grading_batch_items')
    .select(['card_instance_id', 'quantity'])
    .where('batch_id', '=', id)
    .execute();

  let recreditedToLegacy = 0;
  for (const item of items) {
    const card = await db
      .selectFrom('card_instances')
      .selectAll()
      .where('id', '=', item.card_instance_id)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!card) continue; // already deleted (e.g. its slab was kept)

    if (card.legacy_source_catalog_id) {
      const bucketId = card.legacy_source_catalog_id;
      const qty = card.quantity ?? 1;

      // Find an existing grade-decision stash row under the same bucket and
      // increment it; otherwise create a fresh stash row.
      const stash = await db
        .selectFrom('card_instances')
        .selectAll()
        .where('catalog_id', '=', bucketId)
        .where('user_id', '=', userId)
        .where('decision', '=', 'grade')
        .where('status', 'not in', ['grading_submitted', 'graded', 'sold', 'lost_damaged'])
        .orderBy('quantity', 'desc')
        .executeTakeFirst();

      if (stash) {
        const newStashQty = stash.quantity + qty;
        await db.updateTable('card_instances')
          .set({ quantity: newStashQty, updated_at: new Date() })
          .where('id', '=', stash.id)
          .execute();
        await logAudit(userId, 'card_instances', stash.id, 'updated', stash, { ...stash, quantity: newStashQty });
      } else {
        const created = await db.insertInto('card_instances').values({
          user_id:        userId,
          catalog_id:     bucketId,
          card_game:      card.card_game,
          language:       card.language,
          status:         'inspected',
          decision:       'grade',
          purchase_type:  card.purchase_type,
          quantity:       qty,
          purchase_cost:  card.purchase_cost,
          currency:       card.currency,
        } as any).returningAll().executeTakeFirstOrThrow();
        await logAudit(userId, 'card_instances', created.id, 'created', null, created);
      }

      await logAudit(userId, 'card_instances', card.id, 'deleted', card, null);
      await db.deleteFrom('card_instances')
        .where('id', '=', card.id)
        .where('user_id', '=', userId)
        .execute();
      recreditedToLegacy++;
    } else {
      // Only flip back to inspected when the card is actually in flight
      // (status='grading_submitted'). Without this guard, a back-linked
      // sold slab (decision='already_graded', status='sold') that ever
      // ended up referenced by a batch_item would have its terminal
      // status clobbered to 'inspected' here without anyone touching its
      // sale row — silently corrupting the slab and letting it reappear
      // in raw inventory pickers.
      if (card.status === 'grading_submitted') {
        await db.updateTable('card_instances')
          .set({ status: 'inspected', decision: 'grade' })
          .where('id', '=', card.id)
          .where('user_id', '=', userId)
          .where('status', '=', 'grading_submitted')
          .execute();
        await logAudit(userId, 'card_instances', card.id, 'updated', card, { ...card, status: 'inspected' as const, decision: 'grade' as const });
      }
    }
  }

  await db.deleteFrom('grading_batches')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .execute();
  await logAudit(userId, 'grading_batches', id, 'deleted', existing, null);

  return { deleted: true, kept_slabs: keptSlabs, recredited_to_legacy: recreditedToLegacy };
}

// Bulk variant — add multiple inventory cards to a batch in one call.
//
// The same card_instance can be added multiple times (across rows OR across
// separate add-calls) — useful when a user has qty=N of one card and wants
// each cert graded as its own line item. We validate that the total qty
// across all batch_items for a card_instance doesn't exceed its inventory
// quantity, both within this call and combined with what's already in the
// batch.
const BULK_ADD_MAX = 10;

export async function addItemsBulk(
  userId: string,
  batchId: string,
  items: AddItemInput[]
) {
  if (!items.length) throw new AppError(400, 'No items provided');
  if (items.length > BULK_ADD_MAX) {
    throw new AppError(400, `Maximum ${BULK_ADD_MAX} cards per bulk add (got ${items.length})`);
  }
  // Aggregate input qty per card_instance to validate against inventory.
  const totalRequestedById = new Map<string, number>();
  for (const it of items) {
    const q = it.quantity ?? 1;
    if (q < 1) throw new AppError(400, 'Quantity must be >= 1');
    totalRequestedById.set(it.card_instance_id, (totalRequestedById.get(it.card_instance_id) ?? 0) + q);
  }
  for (const [cardId, requested] of totalRequestedById) {
    const card = await db
      .selectFrom('card_instances')
      .select('quantity')
      .where('id', '=', cardId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!card) throw new AppError(404, 'Card not found');
    const existing = await db
      .selectFrom('grading_batch_items')
      .select(db.fn.sum('quantity').as('total'))
      .where('batch_id', '=', batchId)
      .where('card_instance_id', '=', cardId)
      .executeTakeFirst();
    const alreadyInBatch = Number(existing?.total ?? 0);
    if (alreadyInBatch + requested > card.quantity) {
      throw new AppError(400, `Cannot add ${requested} — only ${card.quantity - alreadyInBatch} of this card available (${alreadyInBatch} already in batch).`);
    }
  }
  const created: Awaited<ReturnType<typeof addItem>>[] = [];
  for (const it of items) {
    created.push(await addItem(userId, batchId, it));
  }
  return created;
}

export async function addItem(userId: string, batchId: string, input: AddItemInput) {
  const batch = await db
    .selectFrom('grading_batches')
    .select('id')
    .where('id', '=', batchId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!batch) throw new Error('Batch not found');

  const requestedQty = input.quantity ?? 1;

  const source = await db
    .selectFrom('card_instances')
    .selectAll()
    .where('id', '=', input.card_instance_id)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!source) throw new Error('Card not found');

  const maxRow = await db
    .selectFrom('grading_batch_items')
    .select(db.fn.max('line_item_num').as('max_num'))
    .where('batch_id', '=', batchId)
    .executeTakeFirst();
  const lineItemNum = (maxRow?.max_num ?? 0) + 1;

  // Split rule: if the source row has strictly more qty than we're submitting,
  // decrement the source and create a fresh sibling ci row in grading_submitted
  // for just the batched qty. This mirrors addLegacyItem so the remainder
  // stays visible in the picker (`inspected` / `grade`) for future line items.
  // Prior behavior flipped the whole source row wholesale, hiding the leftover
  // qty from the picker — which stranded 64 cards across 7 lots on prod
  // before this fix. If source qty == requested, flip in place: no split
  // needed, and any grading-batch-item that already points at this ci id (via
  // an earlier repair or agent path) keeps its link.
  let targetCiId = input.card_instance_id;
  if (source.status !== 'grading_submitted' && (source.quantity ?? 0) > requestedQty) {
    const sourceBefore = { ...source };
    const newQty = (source.quantity ?? 0) - requestedQty;
    await db
      .updateTable('card_instances')
      .set({ quantity: newQty, updated_at: new Date() })
      .where('id', '=', input.card_instance_id)
      .where('user_id', '=', userId)
      .execute();
    await logAudit(userId, 'card_instances', input.card_instance_id, 'updated', sourceBefore, { ...sourceBefore, quantity: newQty });

    const created = await db
      .insertInto('card_instances')
      .values({
        user_id:                  source.user_id,
        catalog_id:               source.catalog_id,
        card_name_override:       source.card_name_override,
        set_name_override:        source.set_name_override,
        card_number_override:     source.card_number_override,
        card_game:                source.card_game,
        language:                 source.language,
        variant:                  source.variant,
        rarity:                   source.rarity,
        notes:                    source.notes,
        status:                   'grading_submitted',
        decision:                 source.decision,
        purchase_type:            source.purchase_type,
        quantity:                 requestedQty,
        purchase_cost:            source.purchase_cost,
        currency:                 source.currency,
        raw_purchase_id:          source.raw_purchase_id,
        condition:                source.condition,
        legacy_source_catalog_id: source.legacy_source_catalog_id,
        location_id:              null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await logAudit(userId, 'card_instances', created.id, 'created', null, created);
    targetCiId = created.id;
  } else if (source.status !== 'grading_submitted') {
    // qty == requested (or 0/undefined): flip source in place.
    const sourceBefore = { ...source };
    await db
      .updateTable('card_instances')
      .set({ status: 'grading_submitted', location_id: null })
      .where('id', '=', input.card_instance_id)
      .where('user_id', '=', userId)
      .execute();
    await logAudit(userId, 'card_instances', input.card_instance_id, 'updated', sourceBefore, { ...sourceBefore, status: 'grading_submitted' as const, location_id: null });
  }

  const item = await db
    .insertInto('grading_batch_items')
    .values({
      batch_id:         batchId,
      card_instance_id: targetCiId,
      line_item_num:    lineItemNum,
      quantity:         requestedQty,
      expected_grade:   input.expected_grade ?? null,
      estimated_value:  input.estimated_value ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return item;
}

// Backs the "Repeat" tab on the Add Card modal. Each entry names a specific
// raw source ci id to pull from — the client picks the lot, the server just
// consumes it. Two paths:
//   - Regular raw source (any inspected/purchased_raw ci with decision=grade):
//     uses addItem (splits the source into a grading_submitted sibling).
//   - Legacy bucket (source's catalog has set_code='LEGACY'): uses
//     addLegacyItem, which decrements the bucket stash and creates a fresh
//     ci row stamped with the anchor's real card identity (card_name,
//     set_name, card_number, language, catalog_id). The anchor's identity
//     is required for legacy repeats — the bucket doesn't know what card
//     you're pulling out. Client supplies it via anchor_batch_item_id.
export interface RepeatItemInput {
  source_ci_id: string;
  count: number;
  anchor_batch_item_id?: string;
}

export async function repeatBatchItems(userId: string, batchId: string, items: RepeatItemInput[]) {
  if (!items.length) throw new AppError(400, 'No items to repeat');

  // Pre-check: aggregate requested count per source ci and verify each has
  // enough qty. Rejects the whole call before any writes — no partial adds.
  const totalPerCi = new Map<string, number>();
  for (const req of items) {
    if (!Number.isFinite(req.count) || req.count < 1) throw new AppError(400, 'Count must be >= 1');
    totalPerCi.set(req.source_ci_id, (totalPerCi.get(req.source_ci_id) ?? 0) + req.count);
  }
  for (const [ciId, requested] of totalPerCi) {
    const ci = await db
      .selectFrom('card_instances')
      .select(['id', 'quantity', 'status', 'decision'])
      .where('id', '=', ciId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!ci) throw new AppError(404, 'Source card not found');
    if (ci.decision !== 'grade') throw new AppError(400, 'Source card is not decisioned for grading');
    if (ci.status !== 'inspected' && ci.status !== 'purchased_raw') {
      throw new AppError(400, 'Source card is not in raw inventory');
    }
    if ((ci.quantity ?? 0) < requested) {
      throw new AppError(400, `Only ${ci.quantity ?? 0} available in source (requested ${requested})`);
    }
  }

  // Resolve source metadata + (for legacy) anchor identity up-front so the
  // main loop below is pure "consume one from source X" — no per-iteration
  // catalog lookup, and each request slot knows how to add one card.
  type Slot =
    | { kind: 'raw'; source_ci_id: string; remaining: number }
    | { kind: 'legacy'; source_ci_id: string; remaining: number; anchor: {
        cardName: string; setName: string | null; cardNumber: string | null;
        language: string; condition: string | null;
        legacy_catalog_id: string; real_catalog_id: string | undefined;
        purchaseCost: number;
      } };
  const slots: Slot[] = [];

  for (const req of items) {
    const source = await db
      .selectFrom('card_instances as ci')
      .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
      .select(['ci.id', 'ci.catalog_id', 'cc.set_code'])
      .where('ci.id', '=', req.source_ci_id)
      .where('ci.user_id', '=', userId)
      .executeTakeFirst();
    if (!source) throw new AppError(404, 'Source card not found');

    const isLegacy = source.set_code === 'LEGACY';
    if (isLegacy) {
      if (!req.anchor_batch_item_id) {
        throw new AppError(400, 'Legacy repeat requires the anchor batch item id — the bucket has no card identity of its own');
      }
      const anchor = await db
        .selectFrom('grading_batch_items as gbi')
        .innerJoin('card_instances as ci', 'ci.id', 'gbi.card_instance_id')
        .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
        .select([
          'ci.catalog_id', 'ci.condition', 'ci.language', 'ci.purchase_cost',
          'ci.card_name_override', 'ci.set_name_override', 'ci.card_number_override',
          'cc.card_name as cc_card_name', 'cc.set_name as cc_set_name', 'cc.card_number as cc_card_number',
        ])
        .where('gbi.id', '=', req.anchor_batch_item_id)
        .where('gbi.batch_id', '=', batchId)
        .where('ci.user_id', '=', userId)
        .executeTakeFirst();
      if (!anchor) throw new AppError(404, 'Anchor batch item not found in this batch');
      if (!source.catalog_id) throw new AppError(500, 'Legacy bucket source missing catalog_id');

      slots.push({
        kind: 'legacy',
        source_ci_id: req.source_ci_id,
        remaining: req.count,
        anchor: {
          cardName: anchor.card_name_override ?? anchor.cc_card_name ?? 'Unknown',
          setName: anchor.cc_set_name ?? anchor.set_name_override ?? null,
          cardNumber: anchor.cc_card_number ?? anchor.card_number_override ?? null,
          language: anchor.language ?? 'EN',
          condition: anchor.condition ?? null,
          legacy_catalog_id: source.catalog_id,
          real_catalog_id: anchor.catalog_id ?? undefined,
          purchaseCost: anchor.purchase_cost ?? 0,
        },
      });
    } else {
      slots.push({ kind: 'raw', source_ci_id: req.source_ci_id, remaining: req.count });
    }
  }

  // Round-robin: cycle through slots one add at a time until every slot's
  // remaining count is drained. This interleaves the resulting line items so
  // duplicates don't bunch consecutively — user's preference for how the sub
  // gets laid out (they don't want same-cert copies next to each other).
  const created: Awaited<ReturnType<typeof addItem>>[] = [];
  while (slots.some(s => s.remaining > 0)) {
    for (const s of slots) {
      if (s.remaining <= 0) continue;
      if (s.kind === 'legacy') {
        const it = await addLegacyItem(userId, batchId, {
          card_name: s.anchor.cardName,
          set_name: s.anchor.setName,
          card_number: s.anchor.cardNumber,
          language: s.anchor.language,
          condition: s.anchor.condition,
          legacy_catalog_id: s.anchor.legacy_catalog_id,
          catalog_id: s.anchor.real_catalog_id,
          quantity: 1,
          purchase_cost: s.anchor.purchaseCost,
        });
        created.push(it.batch_item);
      } else {
        const it = await addItem(userId, batchId, { card_instance_id: s.source_ci_id, quantity: 1 });
        created.push(it);
      }
      s.remaining--;
    }
  }
  return created;
}

export interface RepeatSourceLot {
  ci_id: string;
  raw_purchase_id: string | null;
  raw_purchase_label: string | null;
  quantity_available: number;
  is_legacy_bucket?: boolean;     // when true, source is a LEGACY-bucket ci and
                                  // repeats must go through addLegacyItem with
                                  // the anchor's card identity
}
export interface RepeatSourceGroup {
  key: string;                   // catalog_id|condition|raw_purchase_id
  card_name: string | null;
  set_name: string | null;
  card_number: string | null;
  language: string | null;
  catalog_id: string | null;
  condition: string | null;
  raw_purchase_label: string | null;   // anchor lot label
  times_in_batch: number;
  anchor_batch_item_id: string;        // any batch item id in the group — server uses it
                                       // to look up the card identity for legacy repeats
  primary: RepeatSourceLot | null;     // ci row in the anchor lot with qty > 0, OR the
                                       // matching legacy bucket ci when the anchor is legacy
  alternates: RepeatSourceLot[];       // same-catalog+condition ci rows in OTHER lots
}

/**
 * For each unique (catalog_id, condition, raw_purchase_id) already in the
 * batch, return the primary source lot (anchor) with its current qty, and a
 * separate list of alternate same-catalog+condition raw rows from OTHER lots.
 * The client only offers alternates when the primary lot is drained (or the
 * requested count exceeds primary.quantity_available).
 */
export async function listRepeatSources(userId: string, batchId: string): Promise<RepeatSourceGroup[]> {
  const items = await sql<{
    bi_id: string;
    catalog_id: string | null;
    condition: string | null;
    raw_purchase_id: string | null;
    raw_purchase_label: string | null;
    card_name: string | null;
    set_name: string | null;
    card_number: string | null;
    language: string | null;
    quantity: number;
    legacy_source_catalog_id: string | null;
  }>`
    SELECT gbi.id AS bi_id,
      ci.catalog_id, ci.condition, ci.raw_purchase_id,
      rp.purchase_id AS raw_purchase_label,
      COALESCE(ci.card_name_override, cc.card_name) AS card_name,
      COALESCE(cc.set_name, ci.set_name_override) AS set_name,
      COALESCE(cc.card_number, ci.card_number_override) AS card_number,
      ci.language,
      gbi.quantity,
      ci.legacy_source_catalog_id
    FROM grading_batch_items gbi
    JOIN card_instances ci ON ci.id = gbi.card_instance_id
    LEFT JOIN raw_purchases rp ON rp.id = ci.raw_purchase_id
    LEFT JOIN card_catalog cc ON cc.id = ci.catalog_id
    WHERE gbi.batch_id = ${batchId}
      AND ci.user_id = ${userId}
      AND ci.raw_purchase_id IS NOT NULL
  `.execute(db);

  type GroupPrivate = RepeatSourceGroup & { legacy_source_catalog_id: string | null };
  const groups = new Map<string, GroupPrivate>();
  for (const it of items.rows) {
    const key = `${it.catalog_id ?? '_'}|${it.condition ?? '_'}|${it.raw_purchase_id ?? '_'}`;
    const cur = groups.get(key);
    if (cur) {
      cur.times_in_batch += it.quantity;
    } else {
      groups.set(key, {
        key,
        card_name: it.card_name,
        set_name: it.set_name,
        card_number: it.card_number,
        language: it.language,
        catalog_id: it.catalog_id,
        condition: it.condition,
        raw_purchase_label: it.raw_purchase_label,
        times_in_batch: it.quantity,
        anchor_batch_item_id: it.bi_id,
        primary: null,
        alternates: [],
        legacy_source_catalog_id: it.legacy_source_catalog_id,
      });
    }
  }

  if (groups.size === 0) return [];

  // Regular raw-source candidates (non-legacy path).
  const catalogIds = [...new Set([...groups.values()].map(g => g.catalog_id).filter((v): v is string => !!v))];
  const conds = [...new Set([...groups.values()].map(g => g.condition).filter((v): v is string => !!v))];

  const candidates = await sql<{
    id: string;
    catalog_id: string | null;
    condition: string | null;
    raw_purchase_id: string | null;
    raw_purchase_label: string | null;
    quantity: number;
  }>`
    SELECT ci.id, ci.catalog_id, ci.condition, ci.raw_purchase_id,
           rp.purchase_id AS raw_purchase_label,
           ci.quantity
    FROM card_instances ci
    LEFT JOIN raw_purchases rp ON rp.id = ci.raw_purchase_id
    WHERE ci.user_id = ${userId}
      AND ci.decision = 'grade'
      AND ci.status IN ('inspected', 'purchased_raw')
      AND ci.quantity > 0
      ${catalogIds.length ? sql`AND (ci.catalog_id IN (${sql.join(catalogIds.map(v => sql.val(v)))}) OR ci.catalog_id IS NULL)` : sql``}
      ${conds.length ? sql`AND (ci.condition IN (${sql.join(conds.map(v => sql.val(v)))}) OR ci.condition IS NULL)` : sql``}
    ORDER BY ci.quantity DESC
  `.execute(db);

  // Legacy-bucket candidates: for any anchor with legacy_source_catalog_id set,
  // find the bucket's own stash ci rows (catalog_id = the LEGACY bucket,
  // decision='grade', status inspected/purchased_raw, qty > 0) so the client
  // can present the bucket as a repeat source too.
  const legacyBucketIds = [...new Set(
    [...groups.values()]
      .map(g => g.legacy_source_catalog_id)
      .filter((v): v is string => !!v)
  )];
  const legacyBucketRows = legacyBucketIds.length ? await sql<{
    id: string;
    catalog_id: string;
    condition: string | null;
    raw_purchase_id: string | null;
    raw_purchase_label: string | null;
    quantity: number;
  }>`
    SELECT ci.id, ci.catalog_id, ci.condition, ci.raw_purchase_id,
           rp.purchase_id AS raw_purchase_label,
           ci.quantity
    FROM card_instances ci
    LEFT JOIN raw_purchases rp ON rp.id = ci.raw_purchase_id
    WHERE ci.user_id = ${userId}
      AND ci.catalog_id IN (${sql.join(legacyBucketIds.map(v => sql.val(v)))})
      AND ci.decision = 'grade'
      AND ci.status IN ('inspected', 'purchased_raw')
      AND ci.quantity > 0
    ORDER BY ci.quantity DESC
  `.execute(db) : { rows: [] as any[] };

  for (const g of groups.values()) {
    const matching = candidates.rows.filter(
      c => c.catalog_id === g.catalog_id && c.condition === g.condition
    );
    for (const c of matching) {
      const lot: RepeatSourceLot = {
        ci_id: c.id,
        raw_purchase_id: c.raw_purchase_id,
        raw_purchase_label: c.raw_purchase_label,
        quantity_available: c.quantity,
      };
      if (c.raw_purchase_label === g.raw_purchase_label) {
        if (!g.primary) g.primary = lot;
        else g.primary.quantity_available += lot.quantity_available;
      } else {
        g.alternates.push(lot);
      }
    }

    // Legacy anchors: fold bucket into primary if the anchor lot has no raw
    // sibling for this real catalog. This is the common case — the specific
    // card is drained, but the bucket has plenty. Bucket sources use
    // addLegacyItem instead of addItem, so mark is_legacy_bucket.
    if (g.legacy_source_catalog_id) {
      const bucket = legacyBucketRows.rows.find(
        (r: { catalog_id: string }) => r.catalog_id === g.legacy_source_catalog_id
      );
      if (bucket) {
        const bucketLot: RepeatSourceLot = {
          ci_id: bucket.id,
          raw_purchase_id: bucket.raw_purchase_id,
          raw_purchase_label: bucket.raw_purchase_label,
          quantity_available: bucket.quantity,
          is_legacy_bucket: true,
        };
        if (!g.primary) g.primary = bucketLot;
        else g.alternates.unshift(bucketLot);
      }
    }

    // Collapse alternates by lot label + legacy-ness (bucket stays distinct
    // from raw same-label rows since they consume via different code paths).
    const altByKey = new Map<string, RepeatSourceLot>();
    for (const a of g.alternates) {
      const label = `${a.raw_purchase_label ?? '_'}|${a.is_legacy_bucket ? 'L' : 'R'}`;
      const cur = altByKey.get(label);
      if (cur) cur.quantity_available += a.quantity_available;
      else altByKey.set(label, { ...a });
    }
    g.alternates = Array.from(altByKey.values())
      .sort((a, b) => b.quantity_available - a.quantity_available);
  }

  // Strip private field before returning.
  return Array.from(groups.values()).map(({ legacy_source_catalog_id: _l, ...rest }) => rest);
}

export interface AddLegacyItemInput {
  card_name: string;
  set_name?: string | null;
  card_number?: string | null;
  language: string;
  condition?: string | null;
  quantity?: number;
  purchase_cost?: number;       // in cents, only used in phantom-lot fallback
  expected_grade?: number;
  estimated_value?: number;     // in cents
  catalog_id?: string;          // the REAL part the card is — slab will land under this
  legacy_catalog_id?: string;   // legacy bucket the stash is pulled from (set_code='LEGACY')
}

/**
 * Create a card_instance for a card the user owned before tracking purchases
 * in Reactor, and add it directly to a grading batch.
 *
 * Two paths:
 *   1. legacy_catalog_id provided → catalog-based bucket flow. Find the user's
 *      stash card_instance(s) linked to that legacy catalog entry, decrement
 *      one by qty, carry that row's purchase_cost onto the grading row. Cost
 *      basis flows automatically through standard reports (raw rollups shrink
 *      as the stash decrements; graded rollups grow as the slab returns).
 *      catalog_id (the real part) is what the new grading row carries so the
 *      eventual slab lands under the correct part, not the legacy sentinel.
 *
 *   2. No legacy_catalog_id → phantom-lot fallback (legacy "no lot" original
 *      behavior). Creates a backdated raw_purchases lot of size qty so the
 *      submission still has provenance.
 */
export async function addLegacyItem(userId: string, batchId: string, input: AddLegacyItemInput) {
  const batch = await db
    .selectFrom('grading_batches')
    .select('id')
    .where('id', '=', batchId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!batch) throw new AppError(404, 'Batch not found');

  const qty = input.quantity ?? 1;
  let perCardCost: number;
  let lotId: string | null = null;

  if (input.legacy_catalog_id) {
    // ── Catalog-based bucket flow ────────────────────────────────────────────
    // Verify the picked catalog entry is actually a legacy sentinel.
    const bucket = await db
      .selectFrom('card_catalog')
      .select(['id', 'set_code'])
      .where('id', '=', input.legacy_catalog_id)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!bucket) throw new AppError(404, 'Legacy bucket not found');
    if (!bucket.set_code || bucket.set_code.toUpperCase() !== 'LEGACY') {
      throw new AppError(400, 'Picked catalog entry is not a legacy bucket (set_code must be LEGACY)');
    }

    // Find a stash row tied to this catalog entry with enough qty. Only rows
    // marked decision='grade' count — cards on the same legacy bucket but
    // destined for raw sale (decision='sell_raw') stay out of the picker so
    // pulling for grading can't accidentally drain raw-sale inventory.
    // Largest-first so we drain the bigger pools before fragmenting smaller.
    const stash = await db
      .selectFrom('card_instances')
      .selectAll()
      .where('catalog_id', '=', input.legacy_catalog_id)
      .where('user_id', '=', userId)
      .where('status', 'not in', ['grading_submitted', 'graded', 'sold', 'lost_damaged'])
      .where('decision', '=', 'grade')
      .where('quantity', '>=', qty)
      .orderBy('quantity', 'desc')
      .executeTakeFirst();
    if (!stash) {
      throw new AppError(409, `No 'Grade' decision stash row under this legacy bucket has ${qty} card${qty === 1 ? '' : 's'} available`);
    }
    perCardCost = stash.purchase_cost ?? 0;
    lotId = stash.raw_purchase_id; // preserve lineage if the stash itself came from a lot

    const stashBefore = { ...stash };
    await db
      .updateTable('card_instances')
      .set({ quantity: stash.quantity - qty, updated_at: new Date() })
      .where('id', '=', stash.id)
      .execute();
    await logAudit(userId, 'card_instances', stash.id, 'updated', stashBefore, { ...stashBefore, quantity: stash.quantity - qty });
  } else {
    // ── Phantom-lot fallback (legacy "no lot" — pre-bucket behavior) ─────────
    const { createRawPurchase } = await import('./raw-purchases.service');
    perCardCost = input.purchase_cost ?? 0;
    const lot = await createRawPurchase(userId, {
      type: 'legacy',
      source: 'Legacy (pre-Reactor)',
      language: input.language,
      card_name: input.card_name,
      set_name: input.set_name ?? undefined,
      card_number: input.card_number ?? undefined,
      total_cost_usd: perCardCost * qty,
      card_count: qty,
      status: 'received',
      purchased_at: new Date().toISOString(),
      received_at: new Date().toISOString(),
      notes: 'Auto-created from legacy grading submission',
    });
    lotId = lot.id;
  }

  // If the client already picked or generated a part number for the real card
  // identity, use it directly. Otherwise fall back to the resolver.
  let catalogId: string | null = input.catalog_id ?? null;
  if (!catalogId) {
    const { createCatalogResolver } = await import('./import/import.service');
    const { getOrCreateCatalogId } = await createCatalogResolver(userId);
    try {
      catalogId = await getOrCreateCatalogId(
        input.card_name,
        input.set_name ?? null,
        input.card_number ?? null,
        input.language,
        0,
      );
    } catch { /* unlinked is fine; user can resolve later */ }
  }

  const maxRow = await db
    .selectFrom('grading_batch_items')
    .select(db.fn.max('line_item_num').as('max_num'))
    .where('batch_id', '=', batchId)
    .executeTakeFirst();
  const lineItemNum = (maxRow?.max_num ?? 0) + 1;

  const ci = await db
    .insertInto('card_instances')
    .values({
      user_id: userId,
      catalog_id: catalogId,
      card_name_override: input.card_name,
      set_name_override: input.set_name ?? null,
      card_number_override: normalizeCardNumber(input.card_number) ?? null,
      card_game: 'pokemon',
      language: input.language,
      purchase_type: 'raw',
      status: 'grading_submitted',
      // The reassigned row never goes through inspection, so it would otherwise
      // land with decision=NULL and render as "—" in the lot view. Stamping
      // 'grade' makes it visually consistent with where it was pulled from
      // (the parent legacy bucket's decision='grade' stash) and with how
      // processReturn restores source rows on revert (status='inspected',
      // decision='grade').
      decision: 'grade',
      quantity: qty,
      purchase_cost: perCardCost,
      currency: 'USD',
      condition: input.condition ?? null,
      raw_purchase_id: lotId,
      // Remember the legacy bucket this card was pulled from. processReturn
      // copies this onto the slab so the bucket can cross-tally its returned
      // count even though the slab itself lives under its real catalog_id.
      legacy_source_catalog_id: input.legacy_catalog_id ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const item = await db
    .insertInto('grading_batch_items')
    .values({
      batch_id: batchId,
      card_instance_id: ci.id,
      line_item_num: lineItemNum,
      quantity: qty,
      expected_grade: input.expected_grade ?? null,
      estimated_value: input.estimated_value ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await logAudit(userId, 'card_instances', ci.id, 'created', null, ci);
  return { card_instance: ci, batch_item: item };
}

// ── Relink (swap underlying card_instance on a line item) ────────────────────

export interface RelinkItemInput {
  // Replace the gbi's linked ci with this one (must exist in inventory).
  card_instance_id: string;
  // Optional gbi field updates applied alongside the swap.
  quantity?: number;
  expected_grade?: number | null;
  estimated_value?: number | null;
}

export async function relinkItem(userId: string, itemId: string, input: RelinkItemInput) {
  const existing = await db
    .selectFrom('grading_batch_items as gbi')
    .innerJoin('grading_batches as gb', 'gb.id', 'gbi.batch_id')
    .select(['gbi.id', 'gbi.card_instance_id', 'gbi.quantity as gbi_qty', 'gbi.batch_id', 'gb.status as batch_status'])
    .where('gbi.id', '=', itemId)
    .where('gb.user_id', '=', userId)
    .executeTakeFirst();
  if (!existing) throw new AppError(404, 'Line item not found');
  if (existing.batch_status !== 'pending') {
    throw new AppError(409, 'Sub must be in Adding state to relink a line');
  }

  // No swap — fall through to the regular update path.
  if (input.card_instance_id === existing.card_instance_id) {
    return updateItem(userId, itemId, {
      quantity: input.quantity,
      expected_grade: input.expected_grade,
      estimated_value: input.estimated_value,
    });
  }

  const newCi = await db
    .selectFrom('card_instances')
    .selectAll()
    .where('id', '=', input.card_instance_id)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!newCi) throw new AppError(404, 'New card not found');

  // Reject terminal-state targets. Prevents a direct API call from clobbering
  // a graded slab or sold card by silently flipping its status to
  // grading_submitted further down.
  if (['graded', 'sold', 'lost_damaged'].includes(newCi.status)) {
    throw new AppError(409, `Cannot relink to a card in '${newCi.status}' state`);
  }

  const qty = input.quantity ?? existing.gbi_qty;

  // Sum existing usage of the new ci across the same batch (excluding the row
  // we're about to mutate) so we don't over-allocate.
  const others = await db
    .selectFrom('grading_batch_items')
    .select(db.fn.sum<number>('quantity').as('total'))
    .where('batch_id', '=', existing.batch_id)
    .where('card_instance_id', '=', input.card_instance_id)
    .where('id', '!=', itemId)
    .executeTakeFirst();
  const alreadyInBatch = Number(others?.total ?? 0);
  if (alreadyInBatch + qty > newCi.quantity) {
    throw new AppError(400, `Only ${newCi.quantity - alreadyInBatch} of selected card available (${alreadyInBatch} already in batch).`);
  }

  // Update gbi to point at the new ci with the new field values.
  const update: Record<string, unknown> = {
    card_instance_id: input.card_instance_id,
    quantity:         qty,
  };
  if (input.expected_grade  !== undefined) update.expected_grade  = input.expected_grade;
  if (input.estimated_value !== undefined) update.estimated_value = input.estimated_value;

  const updated = await db
    .updateTable('grading_batch_items')
    .set(update)
    .where('id', '=', itemId)
    .returningAll()
    .executeTakeFirstOrThrow();

  // Restore old ci to inspected/grade — only if no other batch_item still
  // references it and it's currently in flight. Mirrors removeItem guard.
  const stillReferenced = await db
    .selectFrom('grading_batch_items')
    .select('id')
    .where('card_instance_id', '=', existing.card_instance_id)
    .executeTakeFirst();
  if (!stillReferenced) {
    const oldCiBefore = await db
      .selectFrom('card_instances')
      .selectAll()
      .where('id', '=', existing.card_instance_id)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (oldCiBefore && oldCiBefore.status === 'grading_submitted') {
      await db
        .updateTable('card_instances')
        .set({ status: 'inspected', decision: 'grade', updated_at: new Date() })
        .where('id', '=', existing.card_instance_id)
        .where('user_id', '=', userId)
        .where('status', '=', 'grading_submitted')
        .execute();
      await logAudit(userId, 'card_instances', existing.card_instance_id, 'updated', oldCiBefore, { ...oldCiBefore, status: 'inspected' as const, decision: 'grade' as const });
    }
  }

  // Move the new ci into grading_submitted (matches addItem semantics).
  await db
    .updateTable('card_instances')
    .set({ status: 'grading_submitted', location_id: null })
    .where('id', '=', input.card_instance_id)
    .where('user_id', '=', userId)
    .execute();
  await logAudit(userId, 'card_instances', input.card_instance_id, 'updated', newCi, { ...newCi, status: 'grading_submitted' as const, location_id: null });

  return updated;
}

export async function relinkItemLegacy(userId: string, itemId: string, input: AddLegacyItemInput) {
  const existing = await db
    .selectFrom('grading_batch_items as gbi')
    .innerJoin('grading_batches as gb', 'gb.id', 'gbi.batch_id')
    .select(['gbi.id', 'gbi.card_instance_id', 'gbi.batch_id', 'gb.status as batch_status'])
    .where('gbi.id', '=', itemId)
    .where('gb.user_id', '=', userId)
    .executeTakeFirst();
  if (!existing) throw new AppError(404, 'Line item not found');
  if (existing.batch_status !== 'pending') {
    throw new AppError(409, 'Sub must be in Adding state to relink a line');
  }

  // Capture the displaced slot BEFORE we touch addLegacyItem so partial-
  // failure paths don't lose ordering info.
  const oldCiId = existing.card_instance_id;
  const oldRow = await db
    .selectFrom('grading_batch_items')
    .select(['line_item_num'])
    .where('id', '=', itemId)
    .executeTakeFirst();
  const oldLine = oldRow?.line_item_num ?? null;

  // Reuse the addLegacyItem path: it creates a new ci + a new gbi. If this
  // throws (e.g. bucket empty / not legacy), we haven't touched the old gbi
  // so the user can retry.
  const created = await addLegacyItem(userId, existing.batch_id, input);

  // Drop the old gbi.
  await db.deleteFrom('grading_batch_items').where('id', '=', itemId).execute();

  // Restore the old ci if nothing else references it.
  const stillReferenced = await db
    .selectFrom('grading_batch_items')
    .select('id')
    .where('card_instance_id', '=', oldCiId)
    .executeTakeFirst();
  if (!stillReferenced) {
    await db
      .updateTable('card_instances')
      .set({ status: 'inspected', decision: 'grade', updated_at: new Date() })
      .where('id', '=', oldCiId)
      .where('user_id', '=', userId)
      .where('status', '=', 'grading_submitted')
      .execute();
  }

  // Slide the new gbi into the old slot so display order is preserved.
  if (oldLine != null) {
    await db
      .updateTable('grading_batch_items')
      .set({ line_item_num: oldLine })
      .where('id', '=', created.batch_item.id)
      .execute();
  }

  return created.batch_item;
}

export interface UpdateItemInput {
  quantity?: number;
  expected_grade?: number | null;
  estimated_value?: number | null;
  // Identity fixups — propagated to the linked card_instance. When any of the
  // four are present, the catalog link is re-resolved so a typo'd line points
  // at the correct catalog row going forward (slabs created on return inherit
  // the corrected overrides + catalog_id from the source ci).
  card_name_override?: string | null;
  set_name_override?: string | null;
  card_number_override?: string | null;
  language?: string;
  // Pass the human-facing purchase_id label (e.g. "2025R109") to re-link the
  // source card to a different raw lot. Pass empty string or null to detach.
  raw_purchase_label?: string | null;
}

export async function updateItem(userId: string, itemId: string, input: UpdateItemInput) {
  // For legacy-sourced lines the source card_instance.quantity must stay in
  // sync with the batch_item.quantity, and the legacy bucket's stash row
  // absorbs/emits the delta. Fetch the existing item + linked instance up
  // front so we can detect the legacy case and adjust both sides atomically.
  const existing = await db
    .selectFrom('grading_batch_items as gbi')
    .innerJoin('card_instances as ci', 'ci.id', 'gbi.card_instance_id')
    .innerJoin('grading_batches as gb', 'gb.id', 'gbi.batch_id')
    .select([
      'gbi.id',
      'gbi.card_instance_id',
      'gbi.quantity as gbi_qty',
      'ci.quantity as ci_qty',
      'ci.legacy_source_catalog_id',
    ])
    .where('gbi.id', '=', itemId)
    .where('gb.user_id', '=', userId)
    .executeTakeFirst();
  if (!existing) return null;

  // Adjust stash + card_instance.quantity when a legacy line's qty changes.
  if (
    input.quantity !== undefined &&
    input.quantity !== existing.gbi_qty &&
    existing.legacy_source_catalog_id
  ) {
    const delta = input.quantity - existing.gbi_qty;
    const stash = await db
      .selectFrom('card_instances')
      .selectAll()
      .where('catalog_id', '=', existing.legacy_source_catalog_id)
      .where('user_id', '=', userId)
      .where('status', 'not in', ['grading_submitted', 'graded', 'sold', 'lost_damaged'])
      .where('decision', '=', 'grade')
      .orderBy('quantity', 'desc')
      .executeTakeFirst();
    if (!stash) {
      throw new AppError(409, 'No legacy stash row available to pull from / return to');
    }
    if (delta > 0 && stash.quantity < delta) {
      throw new AppError(409, `Only ${stash.quantity} card${stash.quantity === 1 ? '' : 's'} remaining in the legacy stash`);
    }
    // Move delta from stash → card_instance (or back if delta < 0)
    const stashBefore = { ...stash };
    await db.updateTable('card_instances')
      .set({ quantity: stash.quantity - delta, updated_at: new Date() })
      .where('id', '=', stash.id).execute();
    await logAudit(userId, 'card_instances', stash.id, 'updated', stashBefore, { ...stashBefore, quantity: stash.quantity - delta });
    const ciBefore = await db.selectFrom('card_instances').selectAll().where('id', '=', existing.card_instance_id).executeTakeFirst();
    await db.updateTable('card_instances')
      .set({ quantity: existing.ci_qty + delta, updated_at: new Date() })
      .where('id', '=', existing.card_instance_id).execute();
    if (ciBefore) {
      await logAudit(userId, 'card_instances', existing.card_instance_id, 'updated', ciBefore, { ...ciBefore, quantity: existing.ci_qty + delta });
    }
  }

  // Identity fixups on the linked card_instance — names/set/#/language/raw lot.
  // Done first so any failure here aborts before the gbi row is touched.
  const ciFieldsTouched =
    input.card_name_override   !== undefined ||
    input.set_name_override    !== undefined ||
    input.card_number_override !== undefined ||
    input.language             !== undefined ||
    input.raw_purchase_label   !== undefined;

  if (ciFieldsTouched) {
    const ciBefore = await db
      .selectFrom('card_instances')
      .selectAll()
      .where('id', '=', existing.card_instance_id)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!ciBefore) throw new AppError(404, 'Linked card not found');

    const ciUpdate: Record<string, unknown> = { updated_at: new Date() };
    if (input.card_name_override   !== undefined) ciUpdate.card_name_override   = input.card_name_override   || null;
    if (input.set_name_override    !== undefined) ciUpdate.set_name_override    = input.set_name_override    || null;
    if (input.card_number_override !== undefined) ciUpdate.card_number_override = normalizeCardNumber(input.card_number_override) || null;
    if (input.language             !== undefined) ciUpdate.language             = input.language;
    if (input.raw_purchase_label   !== undefined) {
      const label = (input.raw_purchase_label ?? '').trim();
      if (!label) {
        ciUpdate.raw_purchase_id = null;
      } else {
        const rp = await db
          .selectFrom('raw_purchases')
          .select('id')
          .where('purchase_id', '=', label)
          .where('user_id', '=', userId)
          .executeTakeFirst();
        if (!rp) throw new AppError(404, `Raw purchase ${label} not found`);
        ciUpdate.raw_purchase_id = rp.id;
      }
    }

    // Re-resolve catalog link if identity fields changed — typo'd lines link
    // to the wrong (or no) catalog row; refresh so future joins/reports use
    // the right one. Fall back to keeping the existing link on failure.
    const newName = input.card_name_override   ?? ciBefore.card_name_override;
    const newSet  = input.set_name_override    ?? ciBefore.set_name_override;
    const newNum  = input.card_number_override ?? ciBefore.card_number_override;
    const newLang = input.language             ?? ciBefore.language;
    if (newName) {
      try {
        const resolve = await resolveLazyForUser(userId);
        const resolved = await resolve(newName, newSet, newNum, newLang, 0);
        if (resolved) ciUpdate.catalog_id = resolved;
      } catch { /* keep existing catalog_id */ }
    }

    await db
      .updateTable('card_instances')
      .set(ciUpdate)
      .where('id', '=', existing.card_instance_id)
      .where('user_id', '=', userId)
      .execute();
    await logAudit(userId, 'card_instances', existing.card_instance_id, 'updated', ciBefore, { ...ciBefore, ...ciUpdate });
  }

  const update: Record<string, unknown> = {};
  if (input.quantity        !== undefined) update.quantity        = input.quantity;
  if (input.expected_grade  !== undefined) update.expected_grade  = input.expected_grade;
  if (input.estimated_value !== undefined) update.estimated_value = input.estimated_value;

  // No gbi fields to update — bail with a fresh fetch so the controller can
  // still respond with the current row.
  if (Object.keys(update).length === 0) {
    return db
      .selectFrom('grading_batch_items')
      .selectAll()
      .where('id', '=', itemId)
      .executeTakeFirst();
  }

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

// One-shot catalog resolver helper for updateItem — mirrors the lazy import
// pattern processReturn uses, scoped to a single call.
async function resolveLazyForUser(userId: string) {
  const { createCatalogResolver } = await import('./import/import.service');
  const { getOrCreateCatalogId } = await createCatalogResolver(userId);
  return getOrCreateCatalogId;
}

export type ReturnDisposition = 'graded' | 'lost' | 'not_graded' | 'not_submitted';

export interface ReturnItemInput {
  // One physical slab per entry. Multiple entries can share batch_item_id
  // (one sub-line of qty N produces N entries on return). To drop a slot
  // entirely from a return (qty mismatch — handle later), simply omit it
  // from input.items; the source stays in grading_submitted.
  batch_item_id: string;
  grade: number;
  grade_label?: string;
  cert_number?: string;
  actual_value?: number;
  card_name_override?: string;
  // Slot disposition. Defaults to 'graded' (slab created).
  //   'lost'          — write-off; consumes source, no slab, no new raw
  //   'not_graded'    — PSA returned ungraded; consumes source; new raw row
  //                     with cost = original + grading_cost
  //   'not_submitted' — never shipped; consumes source; new raw row with
  //                     cost = original (no grading fee)
  disposition?: ReturnDisposition;
  // Legacy alias for disposition='lost'. Kept for the agent tool path.
  lost?: boolean;
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

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new AppError(400, 'Return must include at least one item');
  }

  // Validate each item up-front so a bad row can't poison a half-applied
  // return. cert_number must coerce to a valid BIGINT for the slab insert;
  // graded slots need a finite grade.
  for (const it of input.items) {
    const disp = it.disposition ?? (it.lost ? 'lost' : 'graded');
    if (disp === 'graded') {
      if (!it.cert_number || !/^\d{1,12}$/.test(String(it.cert_number).trim())) {
        throw new AppError(400, `Cert # must be numeric (1-12 digits). Got: "${it.cert_number ?? ''}"`);
      }
      const g = Number(it.grade);
      if (!Number.isFinite(g) || g < 0 || g > 10) {
        throw new AppError(400, `Grade must be 0-10. Got: ${it.grade}`);
      }
    }
  }

  // Cert-uniqueness guards. Two checks:
  //  (a) Within this payload — same cert across two slots = copy/paste typo.
  //      Caught the 2026-06-10 incident where one Rayquaza slot was filled in
  //      with the Ampharos cert + name override, producing a phantom slab.
  //  (b) Cross-batch — cert already present in slab_details (any company).
  //      Cert numbers are globally unique within their grading company; a
  //      collision means either a typo or an attempt to re-record an
  //      already-returned slab.
  const gradedCerts: { idx: number; cert: string }[] = [];
  for (let i = 0; i < input.items.length; i++) {
    const it = input.items[i];
    const disp = it.disposition ?? (it.lost ? 'lost' : 'graded');
    if (disp === 'graded' && it.cert_number) {
      gradedCerts.push({ idx: i, cert: String(it.cert_number).trim() });
    }
  }
  const seen = new Map<string, number>();
  for (const { idx, cert } of gradedCerts) {
    if (seen.has(cert)) {
      throw new AppError(400, `Cert # ${cert} is used twice in this return (items #${seen.get(cert)! + 1} and #${idx + 1}). Each cert can only appear once.`);
    }
    seen.set(cert, idx);
  }
  if (gradedCerts.length > 0) {
    const certNums = gradedCerts.map((c) => Number(c.cert));
    const existingDupes = await db
      .selectFrom('slab_details')
      .select(['cert_number', 'company'])
      .where('user_id', '=', userId)
      .where('cert_number', 'in', certNums)
      .where('company', '=', batch.company as GradingCompany)
      .execute();
    if (existingDupes.length > 0) {
      const list = existingDupes.map((d) => d.cert_number).join(', ');
      throw new AppError(409, `Cert # ${list} already exist${existingDupes.length === 1 ? 's' : ''} on a returned slab. Each ${batch.company} cert can only be recorded once.`);
    }
  }

  // Lazy-load the catalog resolver — only constructed when needed, but reused
  // across all items in the batch.
  let cachedResolver: ((cardName: string, setName: string | null, cardNum: string | null, lang: string, idx: number) => Promise<string | null>) | null = null;
  async function resolveLazy(): Promise<typeof cachedResolver> {
    if (cachedResolver) return cachedResolver;
    const { createCatalogResolver } = await import('./import/import.service');
    const { getOrCreateCatalogId } = await createCatalogResolver(userId);
    cachedResolver = getOrCreateCatalogId;
    return cachedResolver;
  }

  // Group per-cert entries by batch_item_id so we can resolve the source raw
  // once per sub-line and decrement its quantity by the total returned for it.
  const grouped = new Map<string, ReturnItemInput[]>();
  for (const it of input.items) {
    const arr = grouped.get(it.batch_item_id) ?? [];
    arr.push(it);
    grouped.set(it.batch_item_id, arr);
  }

  for (const [batchItemId, entries] of grouped) {
    const batchItem = await db
      .selectFrom('grading_batch_items')
      .selectAll()
      .where('id', '=', batchItemId)
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

    // Normalize disposition (legacy `lost: true` → 'lost'; missing → 'graded')
    const normalized = entries.map((e) => ({
      ...e,
      disposition: (e.disposition ?? (e.lost ? 'lost' : 'graded')) as ReturnDisposition,
    }));

    const totalConsumed = normalized.length; // every entry in payload consumes one from source

    // Build new raw card_instances rows for not_graded and not_submitted entries.
    //   * not_graded: PSA returned ungraded (altered / not eligible). Decision
    //     is 'sell_raw' — cost basis rolls the grading fee in since it's a
    //     sunk cost we'll recoup on the raw sale. Status lands as 'raw_for_sale'
    //     to match the rest of the app: every "For Sale" view filters
    //     status='raw_for_sale', and the normal sell_raw path (createCard /
    //     updateCard when decision='sell_raw') already promotes to that
    //     status. Landing at 'inspected' hid these cards from every for-sale
    //     view even though they were conceptually ready to list.
    //   * not_submitted: card never actually shipped. No fee added, no
    //     decision assigned — user routes it fresh from the intake / inspection
    //     flow, so keeping status='inspected' is correct.
    for (const item of normalized.filter((e) => e.disposition === 'not_graded' || e.disposition === 'not_submitted')) {
      const isNotGraded = item.disposition === 'not_graded';
      const costAddend = isNotGraded ? batch.grading_cost : 0;
      const newRaw = await db
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
          status:               isNotGraded ? 'raw_for_sale' : 'inspected',
          decision:             isNotGraded ? 'sell_raw' : null,
          purchase_type:        original.purchase_type,
          quantity:             1,
          purchase_cost:        original.purchase_cost + costAddend,
          currency:             original.currency,
          raw_purchase_id:      original.raw_purchase_id,
          condition:            original.condition,
          legacy_source_catalog_id: original.legacy_source_catalog_id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await logAudit(userId, 'card_instances', newRaw.id, 'created', null, newRaw);
    }

    const slabEntries = normalized.filter((e) => e.disposition === 'graded');

    for (const item of slabEntries) {
      // Re-resolve the catalog link on return when either:
      //   (a) the raw had no catalog_id (legacy adds skip resolution at submit), or
      //   (b) the raw was bucketed under a "legacy" placeholder part.
      // Prefer the slab's own corrected name when matching.
      let resolvedCatalogId: string | null = original.catalog_id;
      const isLegacyLinked = resolvedCatalogId
        ? !!(await db
            .selectFrom('card_catalog')
            .select('id')
            .where('id', '=', resolvedCatalogId)
            .where('set_code', 'ilike', 'LEGACY')
            .executeTakeFirst())
        : false;
      if (!resolvedCatalogId || isLegacyLinked) {
        const cardName = item.card_name_override ?? original.card_name_override;
        if (cardName) {
          try {
            const resolve = await resolveLazy();
            const resolved = await resolve!(
              cardName,
              original.set_name_override,
              original.card_number_override,
              original.language,
              0,
            );
            if (resolved) resolvedCatalogId = resolved;
          } catch { /* keep existing link (legacy or null) */ }
        }
      }

      const newInstance = await db
        .insertInto('card_instances')
        .values({
          user_id:              userId,
          catalog_id:           resolvedCatalogId,
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
          quantity:             1,
          purchase_cost:        original.purchase_cost,
          currency:             original.currency,
          raw_purchase_id:      null,
          // Preserve legacy-bucket lineage so the bucket can cross-tally this
          // slab into its returned_count even though catalog_id is the real part.
          legacy_source_catalog_id: original.legacy_source_catalog_id,
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
          grading_batch_id:      batchId,
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
    }

    const newQty = original.quantity - totalConsumed;
    if (newQty <= 0) {
      // All copies converted to slabs — flag as graded_out so the row stays
      // around for lifecycle/audit/sub-display purposes but drops out of any
      // "active raw inventory" view that filters on graded_out=false. The
      // slab carries the cost basis now; the raw row is purely historical.
      await db
        .updateTable('card_instances')
        .set({ graded_out: true, quantity: 0, updated_at: new Date() })
        .where('id', '=', original.id)
        .where('user_id', '=', userId)
        .execute();
      await logAudit(userId, 'card_instances', original.id, 'updated',
        original, { ...original, graded_out: true, quantity: 0 });
    } else {
      await db
        .updateTable('card_instances')
        .set({ quantity: newQty, updated_at: new Date() })
        .where('id', '=', original.id)
        .where('user_id', '=', userId)
        .execute();
      await logAudit(userId, 'card_instances', original.id, 'updated',
        original, { ...original, quantity: newQty });
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

export interface RevertReturnResult {
  batch: Awaited<ReturnType<typeof getBatch>>;
  kept_slabs: { card_instance_id: string; line_item_num: number | null; reason: 'sold' | 'listed' }[];
}

/**
 * Undo a processed return.
 *   - Deletes slabs created from this batch + restores the source raw cards.
 *   - Sets the batch status back to 'submitted'.
 *
 * skipLockedSlabs (default false): when true, slabs that are sold or actively
 * listed are left in place and reported back via `kept_slabs` instead of
 * blocking the whole operation. Used by deleteBatch for cascading delete.
 */
export async function revertReturn(
  userId: string,
  batchId: string,
  opts: { skipLockedSlabs?: boolean } = {},
): Promise<RevertReturnResult | null> {
  const batch = await db
    .selectFrom('grading_batches')
    .selectAll()
    .where('id', '=', batchId)
    .where('user_id', '=', userId)
    .where('status', '=', 'returned')
    .executeTakeFirst();
  if (!batch) return null;

  const batchItems = await db
    .selectFrom('grading_batch_items')
    .selectAll()
    .where('batch_id', '=', batchId)
    .execute();

  const keptSlabs: RevertReturnResult['kept_slabs'] = [];

  // ── Step 1: Delete every slab from this batch ──────────────────────────
  // Key on grading_batch_id (always preserved). source_raw_instance_id is
  // also preserved now that processReturn marks sources graded_out=true
  // instead of hard-deleting (migration 057) — so the SET NULL cascade no
  // longer fires. We use it to attribute slab deletions back to the right
  // source for quantity restoration.
  const allSlabs = await db
    .selectFrom('slab_details')
    .select(['card_instance_id', 'source_raw_instance_id'])
    .where('grading_batch_id', '=', batchId)
    .execute();

  const slabsDeletedBySource = new Map<string, number>();

  for (const slab of allSlabs) {
    const slabCard = await db
      .selectFrom('card_instances')
      .select('status')
      .where('id', '=', slab.card_instance_id)
      .executeTakeFirst();
    const activeListing = await db
      .selectFrom('listings')
      .select('id')
      .where('card_instance_id', '=', slab.card_instance_id)
      .where('listing_status', '=', 'active')
      .executeTakeFirst();
    const locked: 'sold' | 'listed' | null =
      slabCard?.status === 'sold' ? 'sold' :
      activeListing                ? 'listed' :
                                     null;

    if (locked) {
      if (!opts.skipLockedSlabs) {
        throw new AppError(400, `Cannot revert — a slab from this batch is ${locked}. Unwind first or use Delete Batch.`);
      }
      keptSlabs.push({
        card_instance_id: slab.card_instance_id,
        line_item_num:    null,
        reason:           locked,
      });
      continue;
    }

    await db.deleteFrom('slab_details').where('card_instance_id', '=', slab.card_instance_id).execute();
    await db.deleteFrom('card_instances')
      .where('id', '=', slab.card_instance_id)
      .where('user_id', '=', userId)
      .execute();

    if (slab.source_raw_instance_id) {
      slabsDeletedBySource.set(
        slab.source_raw_instance_id,
        (slabsDeletedBySource.get(slab.source_raw_instance_id) ?? 0) + 1,
      );
    }
  }

  // ── Step 2: Restore each batch_item's source raw card to status=inspected,
  // graded_out=false. After migration 057 the source row is always present
  // (graded_out=true at quantity=0 when fully consumed), so a simple UPDATE
  // covers both partial and full-consumption cases. The earlier audit-log
  // re-insertion branch is no longer needed.
  for (const batchItem of batchItems) {
    const addBack = slabsDeletedBySource.get(batchItem.card_instance_id) ?? 0;
    const original = await db
      .selectFrom('card_instances')
      .selectAll()
      .where('id', '=', batchItem.card_instance_id)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!original) continue;
    const restored = {
      ...original,
      quantity:   original.quantity + addBack,
      graded_out: false,
      status:     'inspected' as const,
      decision:   'grade' as const,
    };
    await db.updateTable('card_instances')
      .set({
        quantity:   restored.quantity,
        graded_out: false,
        status:     'inspected',
        decision:   'grade',
        updated_at: new Date(),
      })
      .where('id', '=', original.id).execute();
    await logAudit(userId, 'card_instances', original.id, 'updated', original, restored);
  }

  await db
    .updateTable('grading_batches')
    .set({ status: 'submitted', updated_at: new Date() })
    .where('id', '=', batchId)
    .execute();

  return { batch: await getBatch(userId, batchId), kept_slabs: keptSlabs };
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
    // Guarded for the same reason as deleteBatch above — only flip a card
    // back to inspected when its current status is grading_submitted.
    // Otherwise a back-linked sold slab gets its terminal status silently
    // clobbered on batch_item removal.
    const ciBefore = await db
      .selectFrom('card_instances')
      .selectAll()
      .where('id', '=', item.card_instance_id)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (ciBefore && ciBefore.status === 'grading_submitted') {
      await db
        .updateTable('card_instances')
        .set({ status: 'inspected', decision: 'grade' })
        .where('id', '=', item.card_instance_id)
        .where('user_id', '=', userId)
        .where('status', '=', 'grading_submitted')
        .execute();
      await logAudit(userId, 'card_instances', item.card_instance_id, 'updated', ciBefore, { ...ciBefore, status: 'inspected' as const, decision: 'grade' as const });
    }
  }
}
