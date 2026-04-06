import { sql } from 'kysely';
import { db } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination';
import { createRawPurchase } from './raw-purchases.service';
import { logAudit } from '../utils/audit';
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
    .leftJoin('locations as loc', 'loc.id', 'ci.location_id')
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
      'loc.name as location_name',
    ])
    .where('ci.user_id', '=', userId);

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
      WHERE user_id = ${userId} AND status IN ('purchased_raw', 'inspected')
      ORDER BY value
    `.execute(db),
    sql<{ value: string }>`
      SELECT DISTINCT language AS value FROM card_instances
      WHERE user_id = ${userId} AND status IN ('purchased_raw', 'inspected')
      ORDER BY value
    `.execute(db),
    sql<{ value: string }>`
      SELECT DISTINCT condition AS value FROM card_instances
      WHERE user_id = ${userId} AND status IN ('purchased_raw', 'inspected') AND condition IS NOT NULL
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
    .leftJoin('locations as loc', 'loc.id', 'ci.location_id')
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
      'loc.name as location_name',
    ])
    .where('ci.user_id', '=', userId)
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
    .leftJoin('raw_purchases as rp', 'rp.id', 'ci.raw_purchase_id')
    .leftJoin('locations as loc', 'loc.id', 'ci.location_id')
    .selectAll('ci')
    .select([
      sql<string>`COALESCE(ci.card_name_override, cc.card_name)`.as('card_name'),
      sql<string>`COALESCE(cc.set_name, ci.set_name_override)`.as('set_name'),
      sql<string>`COALESCE(cc.card_number, ci.card_number_override)`.as('card_number'),
      'cc.sku',
      'cc.image_url as catalog_image_url',
      'cc.rarity',
      'sd.grade',
      'sd.grade_label',
      'sd.company as grading_company',
      'sd.cert_number',
      'rp.purchase_id as raw_purchase_label',
      'loc.name as location_name',
    ])
    .where('ci.id', '=', cardId)
    .where('ci.user_id', '=', userId)
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

  // Sync is_card_show from location if location_id provided
  let isCardShow = (data as any).is_card_show ?? false;
  const locationId = (data as any).location_id ?? null;
  if (locationId) {
    const loc = await db.selectFrom('locations').select('is_card_show').where('id', '=', locationId).executeTakeFirst();
    if (loc) isCardShow = loc.is_card_show;
  }

  const card = await db
    .insertInto('card_instances')
    .values({ ...data, user_id: userId, status, purchase_type: purchaseType, raw_purchase_id: rawPurchaseId, is_card_show: isCardShow })
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

export async function softDeleteCard(userId: string, cardId: string, actor: 'user' | 'agent' = 'user') {
  // Fetch full snapshot before deleting so the audit log has the complete record
  const card = await db
    .selectFrom('card_instances')
    .selectAll()
    .where('id', '=', cardId)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (!card) throw new AppError(404, 'Card not found');

  // Include slab_details in snapshot if this is a graded card (needed for revert)
  const slab = await db
    .selectFrom('slab_details')
    .selectAll()
    .where('card_instance_id', '=', cardId)
    .executeTakeFirst();

  // Hard delete (slab_details cascades via FK)
  await db
    .deleteFrom('card_instances')
    .where('id', '=', cardId)
    .where('user_id', '=', userId)
    .execute();

  // Write full snapshot (card + slab) to audit log so the record can be fully restored
  const snapshot = slab ? { ...card, _slab: slab } : card;
  await logAudit(userId, 'card_instances', cardId, 'deleted', snapshot, null, actor);
}

export async function computeCostBasis(cardId: string): Promise<number> {
  const card = await db
    .selectFrom('card_instances')
    .select(['purchase_cost', 'purchase_type'])
    .where('id', '=', cardId)
    .executeTakeFirst();

  if (!card) return 0;
  let basis = card.purchase_cost;

  const slab = await db
    .selectFrom('slab_details')
    .select('grading_cost')
    .where('card_instance_id', '=', cardId)
    .executeTakeFirst();

  if (slab) basis += slab.grading_cost ?? 0;

  return basis;
}

// ─── Raw flat overview ────────────────────────────────────────────────────────

function fuzzyRawClause(search: string | undefined) {
  if (!search) return sql``;
  const words = search.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return sql``;
  const parts = words.map((w) => {
    const term = `%${w}%`;
    return sql`AND (COALESCE(ci.card_name_override, cc.card_name) ILIKE ${term} OR rp.purchase_id ILIKE ${term} OR COALESCE(cc.set_name, ci.set_name_override) ILIKE ${term})`;
  });
  return sql.join(parts, sql` `);
}

const RAW_FLAT_SORT_COLS: Record<string, string> = {
  card_name:          `COALESCE(ci.card_name_override, cc.card_name)`,
  condition:          'ci.condition',
  raw_purchase_label: 'rp.purchase_id',
  listed_price:       'l.list_price',
  raw_cost:           'ci.purchase_cost',
  after_ebay:         'after_ebay',
  raw_purchase_date:  'ci.purchased_at',
  date_listed:        'l.listed_at',
  date_sold:          's.sold_at',
  roi_pct:            'roi_pct',
  location_name:      'loc.name',
};

export async function getRawFlatFilterOptions(userId: string) {
  const [conditions, purchaseYears, listedYears, soldYears] = await Promise.all([
    sql<{ value: string }>`
      SELECT DISTINCT ci.condition AS value FROM card_instances ci
      WHERE ci.user_id = ${userId}
        AND ci.raw_purchase_id IS NOT NULL AND ci.condition IS NOT NULL
      ORDER BY value
    `.execute(db),
    sql<{ value: string }>`
      SELECT DISTINCT EXTRACT(YEAR FROM ci.purchased_at)::int::text AS value FROM card_instances ci
      WHERE ci.user_id = ${userId}
        AND ci.raw_purchase_id IS NOT NULL AND ci.purchased_at IS NOT NULL
        AND EXTRACT(YEAR FROM ci.purchased_at) >= 2000
      ORDER BY value
    `.execute(db),
    sql<{ value: string }>`
      SELECT DISTINCT EXTRACT(YEAR FROM l.listed_at)::int::text AS value
      FROM listings l INNER JOIN card_instances ci ON ci.id = l.card_instance_id
      WHERE ci.user_id = ${userId}
        AND ci.raw_purchase_id IS NOT NULL AND l.listed_at IS NOT NULL
        AND EXTRACT(YEAR FROM l.listed_at) >= 2000
      ORDER BY value
    `.execute(db),
    sql<{ value: string }>`
      SELECT DISTINCT EXTRACT(YEAR FROM s.sold_at)::int::text AS value
      FROM sales s INNER JOIN card_instances ci ON ci.id = s.card_instance_id
      WHERE ci.user_id = ${userId}
        AND ci.raw_purchase_id IS NOT NULL AND EXTRACT(YEAR FROM s.sold_at) >= 2000
      ORDER BY value
    `.execute(db),
  ]);
  return {
    conditions: conditions.rows.map((r) => r.value),
    listed: ['Yes', 'No'],
    purchase_years: purchaseYears.rows.map((r) => r.value),
    listed_years:   listedYears.rows.map((r) => r.value),
    sold_years:     soldYears.rows.map((r) => r.value),
  };
}

export async function listRawFlat(
  userId: string,
  pagination: PaginationParams,
  search?: string,
  statusFilter?: 'all' | 'unsold' | 'sold' | 'for_sale' | 'to_grade' | 'submitted',
  sortBy?: string,
  sortDir?: 'asc' | 'desc',
  filterConditions?: string[],
  isListed?: string,
  purchaseYears?: string[],
  listedYears?: string[],
  soldYears?: string[],
  purchaseDate?: string,
  listedDate?: string,
  soldDate?: string,
) {
  const offset = getPaginationOffset(pagination.page, pagination.limit);
  const dir = sortDir === 'asc' ? sql`ASC` : sql`DESC`;
  const sortExpr = RAW_FLAT_SORT_COLS[sortBy ?? ''] ?? 'ci.created_at';

  const statusCond = statusFilter === 'unsold' ? sql`AND ci.status NOT IN ('sold')`
    : statusFilter === 'sold'     ? sql`AND ci.status = 'sold'`
    : statusFilter === 'for_sale' ? sql`AND ci.status = 'raw_for_sale'`
    : statusFilter === 'to_grade'  ? sql`AND ci.decision = 'grade' AND ci.status IN ('purchased_raw', 'inspected', 'raw_for_sale')`
    : statusFilter === 'submitted' ? sql`AND ci.status = 'grading_submitted'`
    : sql``;

  const conditionIn   = filterConditions === undefined ? sql`` : filterConditions.length ? sql`AND ci.condition IN (${sql.join(filterConditions.map((v) => sql.val(v)))})` : sql`AND 1=0`;
  const listedCond    = isListed === 'yes' ? sql`AND l.id IS NOT NULL` : isListed === 'no' ? sql`AND l.id IS NULL` : sql``;
  const purchaseYearIn = purchaseYears === undefined ? sql`` : purchaseYears.length ? sql`AND EXTRACT(YEAR FROM ci.purchased_at)::int::text IN (${sql.join(purchaseYears.map((v) => sql.val(v)))})` : sql`AND 1=0`;
  const listedYearIn   = listedYears   === undefined ? sql`` : listedYears.length   ? sql`AND EXISTS (SELECT 1 FROM listings l2 WHERE l2.card_instance_id = ci.id AND EXTRACT(YEAR FROM l2.listed_at)::int::text IN (${sql.join(listedYears.map((v) => sql.val(v)))}))` : sql`AND 1=0`;
  const soldYearIn     = soldYears     === undefined ? sql`` : soldYears.length     ? sql`AND EXISTS (SELECT 1 FROM sales s2 WHERE s2.card_instance_id = ci.id AND EXTRACT(YEAR FROM s2.sold_at)::int::text IN (${sql.join(soldYears.map((v) => sql.val(v)))}))` : sql`AND 1=0`;
  const purchaseDateCond = purchaseDate ? sql`AND ci.purchased_at = ${purchaseDate}::date` : sql``;
  const listedDateCond   = listedDate   ? sql`AND EXISTS (SELECT 1 FROM listings l2 WHERE l2.card_instance_id = ci.id AND l2.listed_at::date = ${listedDate}::date)` : sql``;
  const soldDateCond     = soldDate     ? sql`AND EXISTS (SELECT 1 FROM sales s2 WHERE s2.card_instance_id = ci.id AND s2.sold_at::date = ${soldDate}::date)` : sql``;
  const searchCond = fuzzyRawClause(search);

  const BASE_FROM = sql`
    FROM card_instances ci
    LEFT JOIN card_catalog cc ON cc.id = ci.catalog_id
    LEFT JOIN raw_purchases rp ON rp.id = ci.raw_purchase_id
    LEFT JOIN locations loc ON loc.id = ci.location_id
    LEFT JOIN LATERAL (
      SELECT id, list_price, ebay_listing_url, listed_at
      FROM listings WHERE card_instance_id = ci.id ORDER BY created_at DESC LIMIT 1
    ) l ON true
    LEFT JOIN LATERAL (
      SELECT sale_price, platform, platform_fees, shipping_cost, sold_at, order_details_link
      FROM sales WHERE card_instance_id = ci.id ORDER BY created_at DESC LIMIT 1
    ) s ON true
    WHERE ci.user_id = ${userId} AND ci.raw_purchase_id IS NOT NULL
    ${statusCond} ${conditionIn} ${listedCond}
    ${purchaseYearIn} ${listedYearIn} ${soldYearIn}
    ${purchaseDateCond} ${listedDateCond} ${soldDateCond}
    ${searchCond}
  `;

  const countResult = await sql<{ count: string }>`SELECT COUNT(*) AS count ${BASE_FROM}`.execute(db);
  const total = Number(countResult.rows[0]?.count ?? 0);

  const rows = await sql<{
    id: string;
    raw_purchase_label: string | null;
    sku: string | null;
    card_name: string | null;
    set_name: string | null;
    card_number: string | null;
    condition: string | null;
    is_listed: boolean;
    listed_price: number | null;
    listing_url: string | null;
    listing_id: string | null;
    raw_cost: number;
    strike_price: number | null;
    after_ebay: number | null;
    raw_purchase_date: string | null;
    date_listed: string | null;
    date_sold: string | null;
    roi_pct: number | null;
    notes: string | null;
    location_name: string | null;
    location_id: string | null;
    order_details_link: string | null;
  }>`
    SELECT
      ci.id,
      rp.purchase_id                                      AS raw_purchase_label,
      cc.sku,
      COALESCE(ci.card_name_override, cc.card_name)      AS card_name,
      COALESCE(cc.set_name, ci.set_name_override)        AS set_name,
      COALESCE(cc.card_number, ci.card_number_override)  AS card_number,
      ci.condition,
      (l.id IS NOT NULL)                                 AS is_listed,
      l.list_price                                       AS listed_price,
      l.ebay_listing_url                                 AS listing_url,
      l.id                                               AS listing_id,
      ci.purchase_cost                                   AS raw_cost,
      s.sale_price                                       AS strike_price,
      CASE
        WHEN s.sale_price IS NOT NULL AND s.platform = 'ebay'
          THEN s.sale_price - s.platform_fees - s.shipping_cost
        WHEN s.sale_price IS NOT NULL
          THEN s.sale_price
        ELSE NULL
      END                                                AS after_ebay,
      ci.purchased_at                                    AS raw_purchase_date,
      l.listed_at                                        AS date_listed,
      s.sold_at                                          AS date_sold,
      CASE
        WHEN ci.purchase_cost > 0 AND s.sale_price IS NOT NULL AND s.platform = 'ebay'
          THEN ROUND((s.sale_price - s.platform_fees - s.shipping_cost - ci.purchase_cost)::numeric / ci.purchase_cost * 100, 2)
        WHEN ci.purchase_cost > 0 AND s.sale_price IS NOT NULL
          THEN ROUND((s.sale_price - ci.purchase_cost)::numeric / ci.purchase_cost * 100, 2)
        ELSE NULL
      END                                                AS roi_pct,
      ci.notes,
      loc.name                                           AS location_name,
      ci.location_id,
      s.order_details_link
    ${BASE_FROM}
    ORDER BY ${sql.raw(sortExpr)} ${dir} NULLS LAST
    LIMIT ${pagination.limit} OFFSET ${offset}
  `.execute(db);

  return buildPaginatedResult(rows.rows, total, pagination.page, pagination.limit);
}
