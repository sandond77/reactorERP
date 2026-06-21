import { db } from '../config/database';
import { sql } from 'kysely';
import type { LocationCardType } from '../types/db';
import { logAudit } from '../utils/audit';

export interface CreateLocationInput {
  name: string;
  card_type: LocationCardType;
  is_card_show?: boolean;
  is_container?: boolean;
  notes?: string;
  parent_id?: string | null;
}

/**
 * Ensure the user has a "Card Show" root location. Auto-seeded on first read so
 * every user always sees it. Returns the location id.
 */
export async function ensureCardShowLocation(userId: string): Promise<string> {
  const existing = await db.selectFrom('locations')
    .select('id')
    .where('user_id', '=', userId)
    .where('is_card_show', '=', true)
    .where('parent_id', 'is', null)
    .executeTakeFirst();
  if (existing) return existing.id;

  const created = await db.insertInto('locations')
    .values({
      user_id: userId,
      parent_id: null,
      name: 'Card Show',
      card_type: 'both',
      is_card_show: true,
      is_container: false,
      notes: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return created.id;
}

export async function listLocations(userId: string) {
  await ensureCardShowLocation(userId);
  const rows = await sql<{
    id: string;
    parent_id: string | null;
    name: string;
    card_type: LocationCardType;
    is_card_show: boolean;
    is_container: boolean;
    notes: string | null;
    created_at: string;
    total_count: number;
    graded_count: number;
    raw_count: number;
  }>`
    SELECT
      l.id,
      l.parent_id,
      l.name,
      l.card_type,
      l.is_card_show,
      l.is_container,
      l.notes,
      l.created_at,
      COUNT(ci.id)::int AS total_count,
      COUNT(ci.id) FILTER (WHERE ci.purchase_type = 'pre_graded')::int AS graded_count,
      COUNT(ci.id) FILTER (WHERE ci.purchase_type != 'pre_graded')::int AS raw_count
    FROM locations l
    LEFT JOIN card_instances ci ON ci.location_id = l.id
    WHERE l.user_id = ${userId}
    GROUP BY l.id
    ORDER BY l.name ASC
  `.execute(db);
  return rows.rows;
}

export async function getLocationDepth(locationId: string): Promise<number> {
  // Walk up parent chain to find depth (0 = root, 1 = sub, 2 = sub-sub)
  let depth = 0;
  let currentId: string | null = locationId;
  while (currentId) {
    const row = await db.selectFrom('locations').select('parent_id').where('id', '=', currentId).executeTakeFirst();
    if (!row || !row.parent_id) break;
    depth++;
    currentId = row.parent_id;
  }
  return depth;
}

export async function getLocation(userId: string, locationId: string) {
  return db.selectFrom('locations')
    .selectAll()
    .where('id', '=', locationId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
}

export async function createLocation(userId: string, input: CreateLocationInput) {
  if (input.parent_id) {
    // Verify parent belongs to user
    const parent = await db.selectFrom('locations').select('id').where('id', '=', input.parent_id).where('user_id', '=', userId).executeTakeFirst();
    if (!parent) throw new Error('Parent location not found');
    // Enforce max depth (root=0, sub=1, sub-sub=2)
    const parentDepth = await getLocationDepth(input.parent_id);
    if (parentDepth >= 4) throw new Error('Maximum 5 levels of nesting allowed');
  }

  return db.insertInto('locations')
    .values({
      user_id: userId,
      parent_id: input.parent_id ?? null,
      name: input.name,
      card_type: input.card_type,
      is_card_show: input.is_card_show ?? false,
      is_container: input.is_container ?? false,
      notes: input.notes ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function updateLocation(userId: string, locationId: string, input: Partial<CreateLocationInput>) {
  const loc = await db.selectFrom('locations').select('id').where('id', '=', locationId).where('user_id', '=', userId).executeTakeFirst();
  if (!loc) throw new Error('Location not found');

  return db.updateTable('locations')
    .set({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.card_type !== undefined && { card_type: input.card_type }),
      ...(input.is_card_show !== undefined && { is_card_show: input.is_card_show }),
      ...(input.is_container !== undefined && { is_container: input.is_container }),
      ...(input.notes !== undefined && { notes: input.notes || null }),
      updated_at: new Date(),
    })
    .where('id', '=', locationId)
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function deleteLocation(userId: string, locationId: string) {
  const loc = await db.selectFrom('locations')
    .select(['id', 'is_card_show', 'parent_id'])
    .where('id', '=', locationId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!loc) throw new Error('Location not found');
  if (loc.is_card_show && loc.parent_id === null) {
    throw new Error('The Card Show root location cannot be deleted');
  }

  // Unassign all cards from this location before deleting (audit each so the
  // pre-delete location is recoverable from the log)
  const cardsToUnassign = await db
    .selectFrom('card_instances')
    .selectAll()
    .where('location_id', '=', locationId)
    .where('user_id', '=', userId)
    .execute();
  await db.updateTable('card_instances')
    .set({ location_id: null })
    .where('location_id', '=', locationId)
    .execute();
  for (const card of cardsToUnassign) {
    await logAudit(userId, 'card_instances', card.id, 'updated', card, { ...card, location_id: null });
  }

  await db.deleteFrom('locations').where('id', '=', locationId).execute();
  await logAudit(userId, 'locations', locationId, 'deleted', loc, null);
}

export async function getLocationCards(userId: string, locationId: string) {
  const loc = await db.selectFrom('locations').select('id').where('id', '=', locationId).where('user_id', '=', userId).executeTakeFirst();
  if (!loc) throw new Error('Location not found');

  const rows = await sql<{
    id: string;
    card_name: string | null;
    set_name: string | null;
    card_number: string | null;
    purchase_type: string;
    condition: string | null;
    status: string;
    quantity: number;
    company: string | null;
    grade_label: string | null;
    cert_number: string | null;
    raw_label: string | null;
    purchase_cost: number;
    currency: string;
    location_name: string;
  }>`
    WITH RECURSIVE descendants AS (
      SELECT id, name FROM locations WHERE id = ${locationId} AND user_id = ${userId}
      UNION ALL
      SELECT l.id, l.name FROM locations l
      JOIN descendants d ON l.parent_id = d.id
      WHERE l.user_id = ${userId}
    )
    SELECT
      ci.id,
      COALESCE(ci.card_name_override, cc.card_name) AS card_name,
      COALESCE(cc.set_name, ci.set_name_override) AS set_name,
      COALESCE(cc.card_number, ci.card_number_override) AS card_number,
      ci.purchase_type,
      ci.condition,
      ci.status,
      ci.quantity,
      sd.company,
      sd.grade_label,
      sd.cert_number,
      rp.purchase_id AS raw_label,
      ci.purchase_cost,
      ci.currency,
      d.name AS location_name
    FROM card_instances ci
    JOIN descendants d ON ci.location_id = d.id
    LEFT JOIN card_catalog cc ON cc.id = ci.catalog_id
    LEFT JOIN slab_details sd ON sd.card_instance_id = ci.id
    LEFT JOIN raw_purchases rp ON rp.id = ci.raw_purchase_id
    WHERE ci.user_id = ${userId}
    ORDER BY card_name ASC
  `.execute(db);
  return rows.rows;
}

export async function assignLocation(userId: string, cardInstanceId: string, locationId: string | null) {
  // Verify the card belongs to user
  const card = await db.selectFrom('card_instances').select(['id', 'purchase_type']).where('id', '=', cardInstanceId).where('user_id', '=', userId).executeTakeFirst();
  if (!card) throw new Error('Card not found');

  const fullBefore = await db.selectFrom('card_instances').selectAll().where('id', '=', cardInstanceId).where('user_id', '=', userId).executeTakeFirst();
  if (locationId) {
    // Verify location belongs to user and is compatible with card type
    const loc = await db.selectFrom('locations').select(['id', 'card_type', 'is_card_show', 'is_container']).where('id', '=', locationId).where('user_id', '=', userId).executeTakeFirst();
    if (!loc) throw new Error('Location not found');
    if (loc.is_container) throw new Error('This is a container location — assign cards to one of its sub-locations');

    const isGraded = card.purchase_type === 'pre_graded';
    if (loc.card_type === 'graded' && !isGraded) throw new Error('This location is for graded cards only');
    if (loc.card_type === 'raw' && isGraded) throw new Error('This location is for raw cards only');

    // Sync is_card_show flag; stamp card_show_added_at when transitioning to card show
    const wasCardShow = fullBefore?.is_card_show ?? false;
    const addedAt = loc.is_card_show && !wasCardShow ? new Date() : (loc.is_card_show ? (fullBefore?.card_show_added_at ?? new Date()) : null);
    await db.updateTable('card_instances')
      .set({ location_id: locationId, is_card_show: loc.is_card_show, card_show_added_at: addedAt })
      .where('id', '=', cardInstanceId)
      .execute();
    if (fullBefore) {
      await logAudit(userId, 'card_instances', cardInstanceId, 'updated', fullBefore, { ...fullBefore, location_id: locationId, is_card_show: loc.is_card_show, card_show_added_at: addedAt });
    }
  } else {
    await db.updateTable('card_instances')
      .set({ location_id: null, is_card_show: false, card_show_added_at: null })
      .where('id', '=', cardInstanceId)
      .execute();
    if (fullBefore) {
      await logAudit(userId, 'card_instances', cardInstanceId, 'updated', fullBefore, { ...fullBefore, location_id: null, is_card_show: false, card_show_added_at: null });
    }
  }
}

export async function bulkAssignLocation(userId: string, cardInstanceIds: string[], locationId: string | null) {
  await Promise.all(cardInstanceIds.map(id => assignLocation(userId, id, locationId)));
}
