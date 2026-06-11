import { db } from '../config/database';
import { sql } from 'kysely';
import { logAudit } from '../utils/audit';
import { AppError } from '../middleware/errorHandler';
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

/**
 * Back-link an existing graded slab to a raw_purchases lot. Used when
 * manually migrating legacy data where the slab was imported separately
 * but originated from a raw lot we're now adding. Prevents the
 * "lot exists, but no card_instances" limbo state and avoids the
 * double-count of running the slab through the inspect → grade → return
 * pipeline a second time.
 *
 * Sets card_instances.raw_purchase_id on the slab. Optionally also updates
 * purchase_cost on the slab (the per-card cost from the lot) for cost-basis
 * traceability — left as-is by default.
 */
/** Remove the back-link from a slab — sets raw_purchase_id and decision to NULL.
 *  Does NOT delete the slab itself. Use when the user wants to disassociate a
 *  back-linked slab from its lot (e.g., wrong slab was picked).
 */
export async function unlinkBackLinkedSlab(userId: string, slabId: string) {
  const before = await db.selectFrom('card_instances')
    .selectAll()
    .where('id', '=', slabId)
    .where('user_id', '=', userId)
    .where('decision', '=', 'already_graded')
    .executeTakeFirst();
  if (!before) return;

  const after = await db.updateTable('card_instances')
    .set({ raw_purchase_id: null, decision: null, updated_at: new Date() })
    .where('id', '=', slabId)
    .where('user_id', '=', userId)
    .where('decision', '=', 'already_graded')   // safety: only unlink already-graded back-links
    .returningAll()
    .executeTakeFirst();

  if (after) await logAudit(userId, 'card_instances', slabId, 'updated', before, after);
}

export async function backLinkSlabsToLot(userId: string, lotId: string, slabIds: string[]) {
  if (!slabIds.length) throw new Error('At least one slab id required');

  const lot = await db.selectFrom('raw_purchases')
    .select(['id', 'card_count', 'total_cost_usd'])
    .where('id', '=', lotId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!lot) throw new Error('Raw purchase lot not found');

  const slabs = await db.selectFrom('card_instances as ci')
    .innerJoin('slab_details as sd', 'sd.card_instance_id', 'ci.id')
    .select(['ci.id', 'ci.quantity', 'ci.status', 'ci.raw_purchase_id', 'ci.purchase_cost'])
    .where('ci.id', 'in', slabIds)
    .where('ci.user_id', '=', userId)
    .execute();
  if (slabs.length !== slabIds.length) throw new Error('One or more slabs not found');
  // Allow graded and sold slabs — sold slabs are real, just no longer in inventory
  for (const s of slabs) {
    if (s.status !== 'graded' && s.status !== 'sold') {
      throw new Error(`Card ${s.id} is not a graded slab (status=${s.status})`);
    }
  }

  // Check remaining qty on the lot
  const usedRow = await sql<{ total: number }>`
    SELECT COALESCE(SUM(quantity), 0)::int AS total
    FROM card_instances
    WHERE raw_purchase_id = ${lotId} AND user_id = ${userId}
  `.execute(db);
  const used = Number(usedRow.rows[0].total);
  const remaining = lot.card_count - used;
  const incomingQty = slabs.reduce((s, x) => s + x.quantity, 0);
  if (incomingQty > remaining) {
    throw new Error(`Only ${remaining} card${remaining === 1 ? '' : 's'} remaining in lot — cannot back-link ${slabs.length} slab${slabs.length === 1 ? '' : 's'} (qty ${incomingQty})`);
  }

  // Update lineage on every slab. For slabs with no existing cost basis (edge case
  // where the slab was imported with $0), backfill with the lot's per-card cost so
  // P&L isn't underreported. Slabs that already have a cost basis are left alone.
  const perCardCost = (lot.total_cost_usd && lot.card_count > 0)
    ? Math.round(lot.total_cost_usd / lot.card_count)
    : 0;

  let backfilled = 0;
  for (const s of slabs) {
    const before = await db.selectFrom('card_instances').selectAll()
      .where('id', '=', s.id).where('user_id', '=', userId).executeTakeFirst();
    const update: Record<string, unknown> = {
      raw_purchase_id: lotId,
      decision: 'already_graded',
      updated_at: new Date(),
    };
    if ((s.purchase_cost ?? 0) === 0 && perCardCost > 0) {
      update.purchase_cost = perCardCost;
      backfilled++;
    }
    const after = await db.updateTable('card_instances')
      .set(update)
      .where('id', '=', s.id)
      .where('user_id', '=', userId)
      .returningAll()
      .executeTakeFirst();
    if (before && after) await logAudit(userId, 'card_instances', s.id, 'updated', before, after);
  }

  return { ok: true, lotId, linked: slabs.length, total_qty: incomingQty, cost_backfilled: backfilled };
}

async function nextPurchaseId(userId: string, type: RawPurchaseType, year: number): Promise<string> {
  const letter = type === 'raw' ? 'R' : type === 'bulk' ? 'B' : 'L';

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

const RAW_PURCHASES_SORT_COLS: Record<string, string> = {
  // purchase_id is a string like "2026R99" — sort by year + numeric tail so
  // R9 lands between R8 and R10, not after R89.
  purchase_id:     `(SUBSTRING(rp.purchase_id FROM '^\\d+'))::int, NULLIF(SUBSTRING(rp.purchase_id FROM '\\d+$'), '')::int`,
  type:            'rp.type',
  card_name:       'rp.card_name',
  source:          'rp.source',
  order_number:    'rp.order_number',
  language:        'rp.language',
  card_count:      'rp.card_count',
  total_cost_usd:  'rp.total_cost_usd',
  avg_cost_usd:    `(CASE WHEN rp.card_count > 0 THEN rp.total_cost_usd::numeric / rp.card_count ELSE NULL END)`,
  status:          'rp.status',
  purchased_at:    'rp.purchased_at',
  inspected_count: `COALESCE(SUM(ci.quantity), 0)`,
};

export async function listRawPurchases(
  userId: string,
  filters: {
    type?: RawPurchaseType;
    status?: RawPurchaseStatus;
    exclude_cancelled?: boolean;
    needs_inspection?: boolean;
    inspection_state?: 'needs' | 'done';
    search?: string;
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
  } = {}
) {
  const { type, status, exclude_cancelled, needs_inspection, inspection_state, search, page = 1, pageSize = 50, sortBy, sortDir } = filters;
  const offset = (page - 1) * pageSize;
  const sortExpr = RAW_PURCHASES_SORT_COLS[sortBy ?? ''] ?? 'rp.purchased_at';
  const dir = sortDir === 'asc' ? 'asc' : 'desc';

  let query = db
    .selectFrom('raw_purchases as rp')
    .leftJoin('card_instances as ci', (join) =>
      join.onRef('ci.raw_purchase_id', '=', 'rp.id')
    )
    .leftJoin('card_catalog as cc', 'cc.id', 'rp.catalog_id')
    .select([
      'rp.id',
      'rp.purchase_id',
      'rp.type',
      'rp.source',
      'rp.order_number',
      'rp.language',
      'rp.catalog_id',
      sql<string | null>`cc.sku`.as('catalog_sku'),
      // Fall back to the catalog row when raw_purchases has its own field
      // empty (typical for mass-imported rows that matched a catalog entry —
      // import didn't bother to copy the name/set/# since the catalog has it).
      sql<string | null>`COALESCE(rp.card_name,   cc.card_name)`.as('card_name'),
      sql<string | null>`COALESCE(rp.set_name,    cc.set_name)`.as('set_name'),
      sql<string | null>`COALESCE(rp.card_number, cc.card_number)`.as('card_number'),
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
      // Includes slabs whose source raw came from this lot. processReturn
      // creates the new slab card_instance with raw_purchase_id=null and zeroes
      // the source raw row's quantity (graded_out=true), so without the slab
      // subcount a fully-graded lot would falsely drop back to 0/N and reappear
      // in "Needs Inspection."
      sql<number>`COALESCE(SUM(ci.quantity), 0) + COALESCE((
        SELECT COUNT(*)::int FROM slab_details sd
        JOIN card_instances src ON src.id = sd.source_raw_instance_id
        WHERE src.raw_purchase_id = rp.id
      ), 0)`.as('inspected_count'),
      sql<number>`COALESCE(SUM(CASE WHEN ci.decision = 'sell_raw' THEN ci.quantity END), 0)`.as('sell_raw_count'),
      sql<number>`COALESCE(SUM(CASE WHEN ci.decision = 'grade' THEN ci.quantity END), 0) + COALESCE((
        SELECT COUNT(*)::int FROM slab_details sd
        JOIN card_instances src ON src.id = sd.source_raw_instance_id
        WHERE src.raw_purchase_id = rp.id
      ), 0)`.as('grade_count'),
    ])
    .where('rp.user_id', '=', userId)
    .groupBy(['rp.id', 'cc.sku', 'cc.card_name', 'cc.set_name', 'cc.card_number'])
    .orderBy(sql.raw(
      // purchase_id needs the direction applied to BOTH sub-expressions so
      // year and tail sort the same way.
      sortBy === 'purchase_id'
        ? `(SUBSTRING(rp.purchase_id FROM '^\\d+'))::int ${dir} NULLS LAST, NULLIF(SUBSTRING(rp.purchase_id FROM '\\d+$'), '')::int ${dir} NULLS LAST`
        : `${sortExpr} ${dir} NULLS LAST`
    ))
    .orderBy('rp.purchase_id', 'desc');

  if (type) query = query.where('rp.type', '=', type);
  if (status) query = query.where('rp.status', '=', status);
  if (exclude_cancelled) query = query.where('rp.status', '!=', 'cancelled');
  if (needs_inspection || inspection_state === 'needs') {
    query = query
      .where('rp.status', '=', 'received')
      .having(sql<boolean>`COALESCE(SUM(ci.quantity), 0) + COALESCE((
        SELECT COUNT(*)::int FROM slab_details sd
        JOIN card_instances src ON src.id = sd.source_raw_instance_id
        WHERE src.raw_purchase_id = rp.id
      ), 0) < rp.card_count`);
  } else if (inspection_state === 'done') {
    query = query
      .where('rp.status', '=', 'received')
      .having(sql<boolean>`COALESCE(SUM(ci.quantity), 0) + COALESCE((
        SELECT COUNT(*)::int FROM slab_details sd
        JOIN card_instances src ON src.id = sd.source_raw_instance_id
        WHERE src.raw_purchase_id = rp.id
      ), 0) >= rp.card_count`);
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

  const usingInspectionFilter = needs_inspection || inspection_state === 'needs' || inspection_state === 'done';
  const inspectionDoneSide = inspection_state === 'done';
  const [rows, countResult] = await Promise.all([
    query.limit(pageSize).offset(offset).execute(),
    usingInspectionFilter
      ? db
          .selectFrom('raw_purchases as rp')
          .leftJoin('card_instances as ci', (join) =>
            join.onRef('ci.raw_purchase_id', '=', 'rp.id')
          )
          .select('rp.id')
          .where('rp.user_id', '=', userId)
          .where('rp.status', '=', 'received')
          .$if(!!type, (q) => q.where('rp.type', '=', type!))
          .groupBy(['rp.id'])
          .having(inspectionDoneSide
            ? sql<boolean>`COALESCE(SUM(ci.quantity), 0) + COALESCE((
                SELECT COUNT(*)::int FROM slab_details sd
                JOIN card_instances src ON src.id = sd.source_raw_instance_id
                WHERE src.raw_purchase_id = rp.id
              ), 0) >= rp.card_count`
            : sql<boolean>`COALESCE(SUM(ci.quantity), 0) + COALESCE((
                SELECT COUNT(*)::int FROM slab_details sd
                JOIN card_instances src ON src.id = sd.source_raw_instance_id
                WHERE src.raw_purchase_id = rp.id
              ), 0) < rp.card_count`)
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
  const row = await db
    .selectFrom('raw_purchases as rp')
    .leftJoin('card_catalog as cc', 'cc.id', 'rp.catalog_id')
    .selectAll('rp')
    .where('rp.id', '=', id)
    .where('rp.user_id', '=', userId)
    .select([
      sql<string | null>`cc.sku`.as('catalog_sku'),
      sql<string | null>`COALESCE(rp.card_name,   cc.card_name)`.as('coalesced_card_name'),
      sql<string | null>`COALESCE(rp.set_name,    cc.set_name)`.as('coalesced_set_name'),
      sql<string | null>`COALESCE(rp.card_number, cc.card_number)`.as('coalesced_card_number'),
    ])
    .executeTakeFirst();

  if (!row) return null;
  // Surface the catalog-fallback values under the canonical names the UI
  // already reads.
  const purchase = {
    ...row,
    card_name: row.coalesced_card_name ?? row.card_name ?? null,
    set_name: row.coalesced_set_name ?? row.set_name ?? null,
    card_number: row.coalesced_card_number ?? row.card_number ?? null,
  };

  // Cards linked to this purchase
  const cards = await db
    .selectFrom('card_instances as ci')
    .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
    .leftJoin('slab_details as sd', 'sd.card_instance_id', 'ci.id')
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
      sql<string | null>`COALESCE(cc.sku, CASE WHEN ci.catalog_id IS NOT NULL AND cc.set_code IS NOT NULL THEN COALESCE((SELECT abbreviation FROM card_games WHERE LOWER(name) = LOWER(cc.game)), 'PKMN') || '-' || UPPER(ci.language) || '-' || UPPER(cc.set_code) ELSE NULL END)`.as('part_number'),
      sql<string | null>`sd.cert_number::text`.as('cert_number'),
      sql<string | null>`sd.grade_label`.as('grade_label'),
      sql<number | null>`sd.grade`.as('grade'),
      sql<string | null>`sd.company`.as('company'),
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

  // Backfill child card_instances on every save when the purchase has a
  // catalog_id / card identity, since inspection lines snapshot these from
  // the parent at add-time and lines added before those fields were filled
  // in stay disconnected. Only touches rows where the corresponding column
  // is still NULL, so user-edited lines aren't overwritten.
  if (updated) {
    const fill: Record<string, unknown> = {};
    if (updated.catalog_id != null)  fill.catalog_id = updated.catalog_id;
    if (updated.card_name != null)   fill.card_name_override = updated.card_name;
    if (updated.set_name != null)    fill.set_name_override = updated.set_name;
    if (updated.card_number != null) fill.card_number_override = updated.card_number;
    for (const [col, val] of Object.entries(fill)) {
      await db
        .updateTable('card_instances')
        .set({ [col]: val })
        .where('raw_purchase_id', '=', id)
        .where('user_id', '=', userId)
        .where(col as any, 'is', null)
        .execute();
    }
  }

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
  location_id?: string | null;
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

  if (!purchase) throw new AppError(404, 'Purchase not found');
  if (purchase.status === 'cancelled') {
    throw new AppError(409, `Can't add a line to a cancelled purchase. Revert it to Ordered first.`);
  }

  // Block over-allocation: existing inspection-line quantities + this new line
  // must not exceed the purchase's card_count.
  const usedRow = await sql<{ total: number }>`
    SELECT COALESCE(SUM(quantity), 0)::int AS total
    FROM card_instances
    WHERE raw_purchase_id = ${purchaseId} AND user_id = ${userId}
  `.execute(db);
  const used = Number(usedRow.rows[0].total);
  const remaining = purchase.card_count - used;
  if (input.quantity > remaining) {
    throw new AppError(409,
      `Can't add ${input.quantity} — only ${remaining} of ${purchase.card_count} card${purchase.card_count === 1 ? '' : 's'} remain unallocated on this purchase.`
    );
  }

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
      location_id: input.location_id ?? null,
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

  // Block over-allocation when quantity is increasing on a row tied to a
  // raw purchase. Sum the other lines and require that other_total + new_qty
  // ≤ purchase.card_count. Also pulls total_cost_usd so we can auto-recalc
  // per-card cost on a single-line lot when qty changes.
  let parentLot: { card_count: number; total_cost_usd: number | null } | null = null;
  let otherLinesTotal = 0;
  if (input.quantity !== undefined && existing?.raw_purchase_id) {
    const purchase = await db
      .selectFrom('raw_purchases')
      .select(['card_count', 'total_cost_usd', 'type'])
      .where('id', '=', existing.raw_purchase_id)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (purchase) {
      parentLot = { card_count: purchase.card_count, total_cost_usd: purchase.total_cost_usd };
      const otherRow = await sql<{ total: number }>`
        SELECT COALESCE(SUM(quantity), 0)::int AS total
        FROM card_instances
        WHERE raw_purchase_id = ${existing.raw_purchase_id}
          AND user_id = ${userId}
          AND id != ${cardInstanceId}
      `.execute(db);
      otherLinesTotal = Number(otherRow.rows[0].total);
      if (otherLinesTotal + input.quantity > purchase.card_count) {
        const remaining = purchase.card_count - otherLinesTotal;
        throw new AppError(409,
          `Can't set quantity to ${input.quantity} — only ${remaining} of ${purchase.card_count} card${purchase.card_count === 1 ? '' : 's'} remain unallocated on this purchase.`
        );
      }
    }
  }

  const update: Record<string, unknown> = {};
  if (input.condition !== undefined)     update.condition = input.condition;
  if (input.decision !== undefined) {
    update.decision = input.decision;
    update.status = input.decision === 'sell_raw' ? 'raw_for_sale' : 'inspected';
  }
  if (input.quantity !== undefined)      update.quantity = input.quantity;
  if (input.purchase_cost !== undefined) update.purchase_cost = input.purchase_cost;
  if (input.notes !== undefined)         update.notes = input.notes;
  if (input.location_id !== undefined)   update.location_id = input.location_id;

  // Auto-recalc per-card cost when qty changes on a SINGLE-line lot and the
  // user didn't explicitly set purchase_cost. The line's per-card cost
  // should match the lot's avg ($total / card_count). Skipped for multi-
  // line lots because each line may have a custom allocation.
  if (
    input.quantity !== undefined &&
    input.purchase_cost === undefined &&
    parentLot &&
    parentLot.total_cost_usd != null &&
    parentLot.card_count > 0 &&
    otherLinesTotal === 0
  ) {
    update.purchase_cost = Math.round(parentLot.total_cost_usd / parentLot.card_count);
  }

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

/**
 * Unreceive a purchase: flip status from 'received' back to 'ordered'.
 * Refuses if any inspection lines (card_instances) exist — caller must revert
 * inspection first. Used to undo an accidental "Mark Received" action without
 * deleting the underlying record.
 */
export async function unreceiveRawPurchase(userId: string, purchaseId: string) {
  const purchase = await db
    .selectFrom('raw_purchases')
    .selectAll()
    .where('id', '=', purchaseId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!purchase) throw new AppError(404, 'Purchase not found');
  if (purchase.status !== 'received') {
    throw new AppError(409, `Can't unreceive — status is "${purchase.status}", not "received"`);
  }

  const cards = await db
    .selectFrom('card_instances')
    .select('id')
    .where('raw_purchase_id', '=', purchaseId)
    .where('user_id', '=', userId)
    .execute();
  if (cards.length > 0) {
    throw new AppError(409, `Can't unreceive — ${cards.length} inspection line${cards.length === 1 ? '' : 's'} exist. Revert inspection first.`);
  }

  await db
    .updateTable('raw_purchases')
    .set({ status: 'ordered', received_at: null })
    .where('id', '=', purchaseId)
    .where('user_id', '=', userId)
    .execute();
  await logAudit(userId, 'raw_purchases', purchaseId, 'updated', purchase, { ...purchase, status: 'ordered', received_at: null });
  return { id: purchaseId };
}

/**
 * Revert a fully-inspected purchase back to "needs inspection" by deleting all
 * linked card_instances. Refuses if any linked card has progressed beyond the
 * inspectable lifecycle (submitted, graded, sold, etc.) — those would need to
 * be reverted manually first.
 */
export async function revertInspection(userId: string, purchaseId: string) {
  const purchase = await db
    .selectFrom('raw_purchases')
    .selectAll()
    .where('id', '=', purchaseId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!purchase) throw new AppError(404, 'Purchase not found');

  const cards = await db
    .selectFrom('card_instances')
    .selectAll()
    .where('raw_purchase_id', '=', purchaseId)
    .where('user_id', '=', userId)
    .execute();

  const blockedStatuses = new Set(['grading_submitted', 'graded', 'sold', 'lost_damaged']);
  const blocked = cards.filter((c) => blockedStatuses.has(c.status));
  if (blocked.length > 0) {
    throw new AppError(409,
      `Can't revert — ${blocked.length} card${blocked.length === 1 ? ' has' : 's have'} progressed beyond inspection (${[...new Set(blocked.map((c) => c.status))].join(', ')}). Revert those individually first.`
    );
  }

  for (const c of cards) {
    await logAudit(userId, 'card_instances', c.id, 'deleted', c, null);
  }
  await db
    .deleteFrom('card_instances')
    .where('raw_purchase_id', '=', purchaseId)
    .where('user_id', '=', userId)
    .execute();
  return { deleted: cards.length };
}
