import { sql } from 'kysely';
import { db } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination';
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
  purchase_type?: string;
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
      'cc.image_url as catalog_image_url',
      'sd.grade',
      'sd.grade_label',
      'sd.company as grading_company',
      'sd.cert_number',
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
  if (filters.card_game) query = query.where('ci.card_game', '=', filters.card_game);
  if (filters.purchase_type) query = query.where('ci.purchase_type', '=', filters.purchase_type as any);
  if (filters.search) {
    const term = `%${filters.search}%`;
    query = query.where((eb) =>
      eb.or([
        eb('cc.card_name', 'ilike', term),
        eb('ci.card_name_override', 'ilike', term),
        eb('cc.set_name', 'ilike', term),
        eb('ci.set_name_override', 'ilike', term),
        sql<boolean>`sd.cert_number::text ilike ${term}`,
      ])
    );
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
    .$if(!!filters.card_game, (qb) => qb.where('ci.card_game', '=', filters.card_game!))
    .executeTakeFirst();
  const total = Number(countResult?.count ?? 0);

  const data = await query
    .orderBy('ci.created_at', 'desc')
    .limit(pagination.limit)
    .offset(getPaginationOffset(pagination.page, pagination.limit))
    .execute();

  return buildPaginatedResult(data, total, pagination.page, pagination.limit);
}

export async function getCardById(userId: string, cardId: string) {
  const card = await db
    .selectFrom('card_instances as ci')
    .leftJoin('card_catalog as cc', 'cc.id', 'ci.catalog_id')
    .leftJoin('slab_details as sd', 'sd.card_instance_id', 'ci.id')
    .leftJoin('grading_submissions as gs', 'gs.id', 'sd.grading_submission_id')
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
  const status = slab ? 'graded' : data.status ?? 'purchased_raw';
  const card = await db
    .insertInto('card_instances')
    .values({ ...data, user_id: userId, status, purchase_type: slab ? 'pre_graded' : (data.purchase_type ?? 'raw') })
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

export async function updateCard(userId: string, cardId: string, data: CardInstanceUpdate) {
  const existing = await db
    .selectFrom('card_instances')
    .selectAll()
    .where('id', '=', cardId)
    .where('user_id', '=', userId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();

  if (!existing) throw new AppError(404, 'Card not found');

  const updated = await db
    .updateTable('card_instances')
    .set(data)
    .where('id', '=', cardId)
    .where('user_id', '=', userId)
    .returningAll()
    .executeTakeFirstOrThrow();

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
    .select('additional_cost')
    .where('card_instance_id', '=', cardId)
    .executeTakeFirst();

  if (slab) basis += slab.additional_cost;

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
