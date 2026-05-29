import { db } from '../config/database';
import { sql } from 'kysely';
import { logAudit } from '../utils/audit';
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
    const affected = await db
      .updateTable('slab_details')
      .set({ grading_cost: update.grading_cost as number, updated_at: new Date() })
      .where('grading_batch_id', '=', id)
      .where('user_id', '=', userId)
      .returning('card_instance_id')
      .execute();

    if (affected.length > 0) {
      const cardIds = affected.map((r) => r.card_instance_id);
      const sales = await db
        .selectFrom('sales')
        .select(['id', 'card_instance_id'])
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
        await db.updateTable('card_instances')
          .set({ quantity: stash.quantity + qty, updated_at: new Date() })
          .where('id', '=', stash.id)
          .execute();
      } else {
        await db.insertInto('card_instances').values({
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
        } as any).execute();
      }

      await logAudit(userId, 'card_instances', card.id, 'deleted', card, null);
      await db.deleteFrom('card_instances')
        .where('id', '=', card.id)
        .where('user_id', '=', userId)
        .execute();
      recreditedToLegacy++;
    } else {
      await db.updateTable('card_instances')
        .set({ status: 'inspected', decision: 'grade' })
        .where('id', '=', card.id)
        .where('user_id', '=', userId)
        .execute();
    }
  }

  await db.deleteFrom('grading_batches')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .execute();
  await logAudit(userId, 'grading_batches', id, 'deleted', existing, null);

  return { deleted: true, kept_slabs: keptSlabs, recredited_to_legacy: recreditedToLegacy };
}

// Bulk variant — add multiple inventory cards to a batch in one call. Rejects
// duplicate card_instance_ids in the input (qty on the row is the right knob
// for "more of the same card"), enforces a per-call cap so the modal can't
// over-submit, and uses the existing addItem path for each so per-row
// validation matches the single-add behavior.
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
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.card_instance_id)) {
      throw new AppError(400, 'Duplicate card in the batch add — pick each card once and use qty on its row');
    }
    seen.add(it.card_instance_id);
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

  // Move card instance to grading_submitted and clear physical location —
  // the card is at the grader, not in any of our locations.
  await db
    .updateTable('card_instances')
    .set({ status: 'grading_submitted', location_id: null })
    .where('id', '=', input.card_instance_id)
    .where('user_id', '=', userId)
    .execute();

  return item;
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
      card_number_override: input.card_number ?? null,
      card_game: 'pokemon',
      language: input.language,
      purchase_type: 'raw',
      status: 'grading_submitted',
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

export interface UpdateItemInput {
  quantity?: number;
  expected_grade?: number | null;
  estimated_value?: number | null;
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
    await db.updateTable('card_instances')
      .set({ quantity: existing.ci_qty + delta, updated_at: new Date() })
      .where('id', '=', existing.card_instance_id).execute();
  }

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

    // Build new raw card_instances rows for not_graded and not_submitted entries
    // (returned-raw cards land back in inventory under their original part with
    // an inspected status so the user can route them to sell_raw or re-submit).
    for (const item of normalized.filter((e) => e.disposition === 'not_graded' || e.disposition === 'not_submitted')) {
      const costAddend = item.disposition === 'not_graded' ? batch.grading_cost : 0;
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
          status:               'inspected',
          decision:             item.disposition === 'not_graded' ? 'sell_raw' : null,
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
      // All copies consumed — hard-delete the raw instance
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

export interface RevertReturnResult {
  batch: Awaited<ReturnType<typeof getBatch>>;
  kept_slabs: { card_instance_id: string; line_item_num: number; reason: 'sold' | 'listed' }[];
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

  for (const batchItem of batchItems) {
    // Per-cert model produces one slab per physical card — there may be many
    // slabs per batch_item. Re-collect them all via source_raw_instance_id.
    const slabs = await db
      .selectFrom('slab_details')
      .select(['card_instance_id'])
      .where('source_raw_instance_id', '=', batchItem.card_instance_id)
      .execute();

    let slabsDeleted = 0;
    for (const slab of slabs) {
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
          throw new AppError(400, `Cannot revert — line ${batchItem.line_item_num} slab is ${locked}. Unwind first or use Delete Batch.`);
        }
        keptSlabs.push({
          card_instance_id: slab.card_instance_id,
          line_item_num:    batchItem.line_item_num,
          reason:           locked,
        });
        continue;
      }

      await db
        .deleteFrom('slab_details')
        .where('card_instance_id', '=', slab.card_instance_id)
        .execute();
      await db
        .deleteFrom('card_instances')
        .where('id', '=', slab.card_instance_id)
        .where('user_id', '=', userId)
        .execute();
      slabsDeleted++;
    }

    // Only restore the source raw for the quantity we actually undid (kept
    // slabs leave their share of the source unrestored — the slab itself
    // still represents that physical card in inventory).
    if (slabsDeleted === 0) continue;

    const original = await db
      .selectFrom('card_instances')
      .selectAll()
      .where('id', '=', batchItem.card_instance_id)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (original) {
      await db.updateTable('card_instances')
        .set({ quantity: original.quantity + slabsDeleted, updated_at: new Date() })
        .where('id', '=', original.id).execute();
    } else {
      // Fully consumed — restore the deleted source from the audit snapshot.
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
          quantity: slabsDeleted,
          purchase_cost: snap.purchase_cost ?? 0,
          currency: snap.currency ?? 'USD',
          purchase_type: snap.purchase_type ?? 'raw',
          condition: snap.condition ?? null,
          decision: snap.decision ?? null,
          notes: snap.notes ?? null,
          catalog_id: snap.catalog_id ?? null,
          legacy_source_catalog_id: snap.legacy_source_catalog_id ?? null,
          // Card is at the grader — no physical location while submitted
          location_id: null,
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
    await db
      .updateTable('card_instances')
      .set({ status: 'inspected', decision: 'grade' })
      .where('id', '=', item.card_instance_id)
      .where('user_id', '=', userId)
      .execute();
  }
}
