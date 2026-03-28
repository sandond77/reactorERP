import { sql } from 'kysely';
import { db } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination';
import { createRawPurchase } from './raw-purchases.service';
import type { CardStatus, NewCardInstance, CardInstanceUpdate } from '../types/db';
import type { PaginationParams } from '../utils/pagination';

// Valid state machine transitions
const VALID_TRANSITIONS: Record<CardStatus, CardStatus[]> = {
  purchased_raw: ['inspected', 'graded'],
  inspected: ['grading_submitted', 'raw_for_sale'],
  grading_submitted: ['graded', 'purchased_raw'],
  graded: ['raw_for_sale', 'sold'],
  raw_for_sale: ['sold', 'grading_submitted'],
  sold: [],
  lost_damaged: [],
};

export interface CardFilters {
  status?: CardStatus;
  search?: string;
  card_game?: string;
  language?: string;
  condition?: string;
  purchase_type?: string;
  decision?: string;
  exclude_decision?: string;
}

export async function listCards(
  userId: string,
  filters: CardFilters,
  pagination: PaginationParams
) {
  let query = db
    .selectFrom('card_instances as ci')
    .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
    .leftJoin('slab_details as sd', 'sd.card_instance_id', 'ci.id')
    .leftJoin('raw_purchases as rp', 'rp.id', 'ci.raw_purchase_id')
    .leftJoin(
      db.selectFrom('listings').select('card_instance_id').where('listing_status', '=', 'active').as('al'),
      'al.card_instance_id', 'ci.id'
    )
    .select([
      'ci.id',
      'ci.status',
      'ci.purchase_type',
      'ci.card_game',
      'ci.language',
      'ci.condition',
      'ci.purchase_cost',
      'ci.currency',
      'ci.quantity',
      'ci.purchased_at',
      'ci.created_at',
      'ci.image_front_url',
      'ci.image_back_url',
      sql<string>`COALESCE(ci.card_name_override, cc.card_name)`.as('card_name'),
      sql<string>`COALESCE(cc.set_name, ci.set_name_override)`.as('set_name'),
      sql<string>`COALESCE(cc.card_number, ci.card_number_override)`.as('card_number'),
      'cc.rarity',
      'cc.image_url as catalog_image_url',
      'sd.grade',
      'sd.grade_label',
      'sd.company as grading_company',
      'sd.cert_number',
      'ci.decision',
      'ci.notes',
      'rp.purchase_id as raw_purchase_label',
      sql<boolean>`(al.card_instance_id IS NOT NULL)`.as('is_listed'),
    ])
    .where('ci.user_id', '=', userId)
    .where('ci.deleted_at', 'is', null);

  if (filters.status) {
    const statuses = filters.status.split(',').map((s: string) => s.trim()).filter(Boolean);
    if (statuses.length === 1) {
      query = query.where('ci.status', '=', statuses[0]);
    } else if (statuses.length > 1) {
      query = query.where('ci.status', 'in', statuses as any);
    }
  }
  if (filters.card_game) {
    const vals = filters.card_game.split(',').map((s: string) => s.trim()).filter(Boolean);
    query = vals.length === 1 ? query.where('ci.card_game', '=', vals[0]) : query.where('ci.card_game', 'in', vals as any);
  }
  if (filters.language) {
    const vals = filters.language.split(',').map((s: string) => s.trim()).filter(Boolean);
    query = vals.length === 1 ? query.where('ci.language', '=', vals[0]) : query.where('ci.language', 'in', vals as any);
  }
  if (filters.condition) {
    const vals = filters.condition.split(',').map((s: string) => s.trim()).filter(Boolean);
    query = vals.length === 1 ? query.where('ci.condition', '=', vals[0]) : query.where('ci.condition', 'in', vals as any);
  }
  if (filters.purchase_type) query = query.where('ci.purchase_type', '=', filters.purchase_type as any);
  if (filters.decision) query = query.where('ci.decision', '=', filters.decision as any);
  if (filters.exclude_decision) query = query.where((eb) => eb.or([
    eb('ci.decision', 'is', null),
    eb('ci.decision', '!=', filters.exclude_decision as any),
  ]));
  if (filters.search) {
    const words = filters.search.trim().split(/\s+/).filter(Boolean);
    for (const word of words) {
      const term = `%${word}%`;
      query = query.where((eb) =>
        eb.or([
          eb('cc.card_name', 'ilike', term),
          eb('ci.card_name_override', 'ilike', term),
          eb('cc.set_name', 'ilike', term),
          eb('ci.set_name_override', 'ilike', term),
          sql<boolean>`sd.cert_number::text ilike ${term}`,
          eb('rp.purchase_id', 'ilike', term),
        ])
      );
    }
  }

  // Count via separate query
  const countResult = await db
    .selectFrom('card_instances as ci')
    .leftJoin('slab_details as sd', 'sd.card_instance_id', 'ci.id')
    .select((eb) => eb.fn.count<number>('ci.id').as('count'))
    .where('ci.user_id', '=', userId)
    .where('ci.deleted_at', 'is', null)
    .$if(!!filters.status, (qb) => {
      const ss = filters.status!.split(',').map((s: string) => s.trim()).filter(Boolean);
      return ss.length === 1 ? qb.where('ci.status', '=', ss[0]) : qb.where('ci.status', 'in', ss as any);
    })
    .$if(!!filters.card_game, (qb) => {
      const vals = filters.card_game!.split(',').map((s: string) => s.trim()).filter(Boolean);
      return vals.length === 1 ? qb.where('ci.card_game', '=', vals[0]) : qb.where('ci.card_game', 'in', vals as any);
    })
    .$if(!!filters.language, (qb) => {
      const vals = filters.language!.split(',').map((s: string) => s.trim()).filter(Boolean);
      return vals.length === 1 ? qb.where('ci.language', '=', vals[0]) : qb.where('ci.language', 'in', vals as any);
    })
    .$if(!!filters.condition, (qb) => {
      const vals = filters.condition!.split(',').map((s: string) => s.trim()).filter(Boolean);
      return vals.length === 1 ? qb.where('ci.condition', '=', vals[0]) : qb.where('ci.condition', 'in', vals as any);
    })
    .executeTakeFirst();
  const total = Number(countResult?.count ?? 0);

  const data = await query
    .orderBy('ci.created_at', 'desc')
    .limit(pagination.limit)
    .offset(getPaginationOffset(pagination.page, pagination.limit))
    .execute();

  return buildPaginatedResult(data, total, pagination.page, pagination.limit);
}

export async function getCardFilterOptions(userId: string) {
  const statuses = ['purchased_raw', 'inspected'];
  const [games, languages, conditions] = await Promise.all([
    sql<{ value: string }>`
      SELECT DISTINCT card_game AS value FROM card_instances
      WHERE user_id = ${userId} AND deleted_at IS NULL AND status IN ('purchased_raw', 'inspected')
      ORDER BY value
    `.execute(db),
    sql<{ value: string }>`
      SELECT DISTINCT language AS value FROM card_instances
      WHERE user_id = ${userId} AND deleted_at IS NULL AND status IN ('purchased_raw', 'inspected')
      ORDER BY value
    `.execute(db),
    sql<{ value: string }>`
      SELECT DISTINCT condition AS value FROM card_instances
      WHERE user_id = ${userId} AND deleted_at IS NULL AND status IN ('purchased_raw', 'inspected') AND condition IS NOT NULL
      ORDER BY value
    `.execute(db),
  ]);
  return {
    statuses,
    games: games.rows.map((r) => r.value),
    languages: languages.rows.map((r) => r.value),
    conditions: conditions.rows.map((r) => r.value),
  };
}

export async function listCardsGroupedByPart(
  userId: string,
  options: { search?: string; pipeline?: 'sell' | 'grade'; purchase_type?: string } = {}
) {
  const { search, pipeline, purchase_type } = options;

  let query = db
    .selectFrom('card_instances as ci')
    .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
    .leftJoin('raw_purchases as rp', 'rp.id', 'ci.raw_purchase_id')
    .leftJoin(
      db.selectFrom('grading_batch_items')
        .select(['card_instance_id', db.fn.sum<number>('quantity').as('batch_qty')])
        .groupBy('card_instance_id')
        .as('gbi'),
      'gbi.card_instance_id', 'ci.id'
    )
    .select([
      'ci.id',
      'ci.catalog_id',
      'ci.status',
      'ci.decision',
      'ci.condition',
      'ci.quantity',
      'ci.purchase_cost',
      'ci.currency',
      'ci.purchased_at',
      'ci.notes',
      'ci.language',
      'ci.card_game',
      'cc.sku',
      'rp.purchase_id as raw_purchase_label',
      sql<string>`COALESCE(ci.card_name_override, cc.card_name)`.as('card_name'),
      sql<string>`COALESCE(cc.set_name, ci.set_name_override)`.as('set_name'),
      sql<string>`COALESCE(cc.card_number, ci.card_number_override)`.as('card_number'),
      sql<number>`COALESCE(gbi.batch_qty, 0)`.as('batch_qty'),
    ])
    .where('ci.user_id', '=', userId)
    .where('ci.deleted_at', 'is', null)
    .where('ci.raw_purchase_id', 'is not', null)
    .orderBy('ci.purchased_at', 'desc');

  if (pipeline === 'sell') {
    query = query.where((eb) =>
      eb.or([
        eb('ci.status', 'in', ['purchased_raw', 'raw_for_sale', 'sold']),
        eb('ci.status', '=', 'inspected').and('ci.decision', '=', 'sell_raw'),
      ])
    );
  } else if (pipeline === 'grade') {
    query = query.where((eb) =>
      eb.or([
        eb('ci.status', '=', 'inspected').and('ci.decision', '=', 'grade'),
        eb('ci.status', 'in', ['grading_submitted', 'graded', 'sold']),
      ])
    );
  } else {
    // default: raw pipeline (excludes graded)
    query = query.where('ci.status', 'in', ['purchased_raw', 'inspected', 'raw_for_sale', 'grading_submitted', 'sold']);
  }

  if (purchase_type) {
    query = query.where('rp.type', '=', purchase_type as any);
  }

  if (search) {
    const words = search.trim().split(/\s+/).filter(Boolean);
    for (const word of words) {
      const term = `%${word}%`;
      query = query.where((eb) =>
        eb.or([
          eb('cc.card_name', 'ilike', term),
          eb('ci.card_name_override', 'ilike', term),
          eb('cc.set_name', 'ilike', term),
          eb('ci.set_name_override', 'ilike', term),
          eb('rp.purchase_id', 'ilike', term),
        ])
      );
    }
  }

  const rows = await query.execute();

  const groupMap = new Map<string, {
    catalog_id: string | null;
    sku: string | null;
    card_name: string;
    set_name: string | null;
    card_number: string | null;
    language: string;
    card_game: string;
    total: number;
    for_sale_count: number;
    to_grade_count: number;
    grading_count: number;
    returned_count: number;
    sold_count: number;
    instances: typeof rows;
  }>();

  for (const row of rows) {
    const key = row.catalog_id
      ?? `${row.card_name}|${row.set_name}|${row.card_number}|${row.language}`;

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        catalog_id: row.catalog_id ?? null,
        sku: row.sku ?? null,
        card_name: row.card_name,
        set_name: row.set_name ?? null,
        card_number: row.card_number ?? null,
        language: row.language,
        card_game: row.card_game,
        total: 0,
        for_sale_count: 0,
        to_grade_count: 0,
        grading_count: 0,
        returned_count: 0,
        sold_count: 0,
        instances: [],
      });
    }

    const group = groupMap.get(key)!;
    const qty = row.quantity ?? 1;
    const batchQty = Number(row.batch_qty) || 0;
    group.total += qty;
    if (row.status === 'sold')                    group.sold_count     += qty;
    else if (row.status === 'graded')             group.returned_count += qty;
    else if (row.status === 'grading_submitted') {
      group.grading_count  += batchQty;
      group.to_grade_count += Math.max(0, qty - batchQty);
    }
    else if (row.status === 'raw_for_sale')       group.for_sale_count += qty;
    else if (row.decision === 'grade')            group.to_grade_count += qty;
    group.instances.push(row);
  }

  return Array.from(groupMap.values());
}

export async function getCardById(userId: string, cardId: string) {
  const card = await db
    .selectFrom('card_instances as ci')
    .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
    .leftJoin('slab_details as sd', 'sd.card_instance_id', 'ci.id')
    .leftJoin('grading_submissions as gs', 'gs.id', 'sd.grading_submission_id')
    .leftJoin('raw_purchases as rp', 'rp.id', 'ci.raw_purchase_id')
    .selectAll('ci')
    .select([
      sql<string>`COALESCE(ci.card_name_override, cc.card_name)`.as('card_name'),
      sql<string>`COALESCE(cc.set_name, ci.set_name_override)`.as('set_name'),
      sql<string>`COALESCE(cc.card_number, ci.card_number_override)`.as('card_number'),
      'cc.image_url as catalog_image_url',
      'cc.rarity',
      'sd.grade',
      'sd.grade_label',
      'sd.company as grading_company',
      'sd.cert_number',
      'gs.service_level',
      'gs.submitted_at',
      'gs.estimated_return',
      'rp.purchase_id as raw_purchase_label',
    ])
    .where('ci.id', '=', cardId)
    .where('ci.user_id', '=', userId)
    .where('ci.deleted_at', 'is', null)
    .executeTakeFirst();

  if (!card) throw new AppError(404, 'Card not found');
  return card;
}

export async function createCard(
  userId: string,
  data: Omit<NewCardInstance, 'user_id'>,
  slab?: { company: string; grade: number; grade_label?: string; cert_number?: string; additional_cost?: number }
) {
  // 'bulk' is a raw_purchases.type, not a card_instances.purchase_type — map it to 'raw'
  const incomingType = slab ? 'pre_graded' : (data.purchase_type ?? 'raw');
  const rawPurchaseType = incomingType === 'bulk' ? 'bulk' : 'raw';
  const purchaseType = (incomingType === 'bulk' ? 'raw' : incomingType) as 'raw' | 'pre_graded';
  const status = slab ? 'graded' : ((data as any).decision === 'sell_raw' ? 'raw_for_sale' : (data.status ?? 'purchased_raw'));

  // Auto-create a raw_purchase record for raw cards added outside the intake workflow
  let rawPurchaseId = (data as any).raw_purchase_id ?? null;
  if ((purchaseType === 'raw') && !rawPurchaseId) {
    const purchase = await createRawPurchase(userId, {
      type: rawPurchaseType,
      language: (data.language as string) ?? 'EN',
      catalog_id: (data as any).catalog_id ?? undefined,
      card_name: (data as any).card_name_override ?? undefined,
      set_name: (data as any).set_name_override ?? undefined,
      card_number: (data as any).card_number_override ?? undefined,
      total_cost_usd: (data.purchase_cost as number) ?? undefined,
      card_count: (data.quantity as number) ?? 1,
      status: 'received',
      purchased_at: data.purchased_at ? new Date(data.purchased_at as any).toISOString() : undefined,
    });
    rawPurchaseId = purchase.id;
  }

  const card = await db
    .insertInto('card_instances')
    .values({ ...data, user_id: userId, status, purchase_type: purchaseType, raw_purchase_id: rawPurchaseId })
    .returningAll()
    .executeTakeFirstOrThrow();

  if (slab) {
    await db.insertInto('slab_details').values({
      card_instance_id: card.id,
      user_id: userId,
      company: slab.company as any,
      grade: slab.grade,
      grade_label: slab.grade_label ?? null,
      cert_number: slab.cert_number ? Number(slab.cert_number) : null,
      source_raw_instance_id: null,
      grading_submission_id: null,
      additional_cost: slab.additional_cost ?? 0,
      grading_cost: slab.additional_cost ?? 0,
      currency: data.currency ?? 'USD',
    }).execute();
  }

  await logAudit(userId, 'card_instances', card.id, 'created', null, card);
  return card;
}

export async function updateCard(
  userId: string,
  cardId: string,
  data: CardInstanceUpdate & {
    slab_cert_number?: number | null;
    slab_grade?: number | null;
    slab_grade_label?: string | null;
    slab_grading_cost?: number | null;
  }
) {
  const existing = await db
    .selectFrom('card_instances')
    .selectAll()
    .where('id', '=', cardId)
    .where('user_id', '=', userId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();

  if (!existing) throw new AppError(404, 'Card not found');

  const { slab_cert_number, slab_grade, slab_grade_label, slab_grading_cost, ...instanceData } = data;

  // When decision changes to sell_raw on a raw card, promote status to raw_for_sale
  if (instanceData.decision === 'sell_raw' && ['purchased_raw', 'inspected'].includes(existing.status)) {
    (instanceData as any).status = 'raw_for_sale';
  }
  // When decision changes away from sell_raw on a non-listed raw card, revert status
  if (instanceData.decision === 'grade' && existing.status === 'raw_for_sale' && existing.decision === 'sell_raw') {
    (instanceData as any).status = 'purchased_raw';
  }

  const updated = await db
    .updateTable('card_instances')
    .set({ ...instanceData, updated_at: new Date() })
    .where('id', '=', cardId)
    .where('user_id', '=', userId)
    .returningAll()
    .executeTakeFirstOrThrow();

  // Update slab_details if any slab fields were provided
  const hasSlabFields = slab_cert_number !== undefined || slab_grade !== undefined ||
    slab_grade_label !== undefined || slab_grading_cost !== undefined;
  if (hasSlabFields) {
    const slabUpdate: Record<string, unknown> = { updated_at: new Date() };
    if (slab_cert_number !== undefined) slabUpdate.cert_number = slab_cert_number;
    if (slab_grade !== undefined)       slabUpdate.grade = slab_grade;
    if (slab_grade_label !== undefined) slabUpdate.grade_label = slab_grade_label;
    if (slab_grading_cost !== undefined) slabUpdate.grading_cost = slab_grading_cost;
    await db.updateTable('slab_details')
      .set(slabUpdate)
      .where('card_instance_id', '=', cardId)
      .where('user_id', '=', userId)
      .execute();
  }

  await logAudit(userId, 'card_instances', cardId, 'updated', existing, updated);
  return updated;
}

export async function transitionCardStatus(userId: string, cardId: string, newStatus: CardStatus) {
  const card = await db
    .selectFrom('card_instances')
    .select(['id', 'status'])
    .where('id', '=', cardId)
    .where('user_id', '=', userId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();

  if (!card) throw new AppError(404, 'Card not found');

  const allowed = VALID_TRANSITIONS[card.status];
  if (!allowed.includes(newStatus)) {
    throw new AppError(
      422,
      `Cannot transition from '${card.status}' to '${newStatus}'`,
      'INVALID_TRANSITION'
    );
  }

  const updated = await db
    .updateTable('card_instances')
    .set({ status: newStatus })
    .where('id', '=', cardId)
    .returningAll()
    .executeTakeFirstOrThrow();

  await logAudit(userId, 'card_instances', cardId, 'status_changed', { status: card.status }, { status: newStatus });
  return updated;
}

export async function softDeleteCard(userId: string, cardId: string) {
  const card = await db
    .selectFrom('card_instances')
    .select('id')
    .where('id', '=', cardId)
    .where('user_id', '=', userId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();

  if (!card) throw new AppError(404, 'Card not found');

  await db
    .updateTable('card_instances')
    .set({ deleted_at: new Date() })
    .where('id', '=', cardId)
    .execute();
}

export async function computeCostBasis(cardId: string): Promise<number> {
  const card = await db
    .selectFrom('card_instances')
    .select(['purchase_cost', 'purchase_type'])
    .where('id', '=', cardId)
    .executeTakeFirst();

  if (!card) return 0;
  let basis = card.purchase_cost;

  const submission = await db
    .selectFrom('grading_submissions')
    .select(['grading_fee', 'shipping_cost'])
    .where('card_instance_id', '=', cardId)
    .where('status', '=', 'returned')
    .executeTakeFirst();

  if (submission) basis += submission.grading_fee + submission.shipping_cost;

  const slab = await db
    .selectFrom('slab_details')
    .select('grading_cost')
    .where('card_instance_id', '=', cardId)
    .executeTakeFirst();

  if (slab) basis += slab.grading_cost ?? 0;

  return basis;
}

async function logAudit(
  userId: string,
  entityType: string,
  entityId: string,
  action: string,
  oldData: unknown,
  newData: unknown
) {
  await db
    .insertInto('audit_log')
    .values({
      user_id: userId,
      entity_type: entityType,
      entity_id: entityId,
      action,
      old_data: oldData as any,
      new_data: newData as any,
    })
    .execute()
    .catch((err) => console.error('[audit] Failed to write audit log:', err));
}
