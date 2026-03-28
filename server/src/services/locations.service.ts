import { db } from '../config/database';
import { sql } from 'kysely';
import type { LocationCardType } from '../types/db';

export interface CreateLocationInput {
  name: string;
  card_type: LocationCardType;
  is_card_show?: boolean;
  is_container?: boolean;
  notes?: string;
  parent_id?: string | null;
}

export async function listLocations(userId: string) {
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
    LEFT JOIN card_instances ci ON ci.location_id = l.id AND ci.deleted_at IS NULL
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
  const loc = await db.selectFrom('locations').select('id').where('id', '=', locationId).where('user_id', '=', userId).executeTakeFirst();
  if (!loc) throw new Error('Location not found');

  // Unassign all cards from this location before deleting
  await db.updateTable('card_instances')
    .set({ location_id: null })
    .where('location_id', '=', locationId)
    .execute();

  await db.deleteFrom('locations').where('id', '=', locationId).execute();
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
  }>`
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
      ci.currency
    FROM card_instances ci
    LEFT JOIN card_catalog cc ON cc.id = ci.catalog_id
    LEFT JOIN slab_details sd ON sd.card_instance_id = ci.id
    LEFT JOIN raw_purchases rp ON rp.id = ci.raw_purchase_id
    WHERE ci.location_id = ${locationId}
    AND ci.user_id = ${userId}
    AND ci.deleted_at IS NULL
    ORDER BY card_name ASC
  `.execute(db);
  return rows.rows;
}

export async function assignLocation(userId: string, cardInstanceId: string, locationId: string | null) {
  // Verify the card belongs to user
  const card = await db.selectFrom('card_instances').select(['id', 'purchase_type']).where('id', '=', cardInstanceId).where('user_id', '=', userId).where('deleted_at', 'is', null).executeTakeFirst();
  if (!card) throw new Error('Card not found');

  if (locationId) {
    // Verify location belongs to user and is compatible with card type
    const loc = await db.selectFrom('locations').select(['id', 'card_type', 'is_card_show', 'is_container']).where('id', '=', locationId).where('user_id', '=', userId).executeTakeFirst();
    if (!loc) throw new Error('Location not found');
    if (loc.is_container) throw new Error('This is a container location — assign cards to one of its sub-locations');

    const isGraded = card.purchase_type === 'pre_graded';
    if (loc.card_type === 'graded' && !isGraded) throw new Error('This location is for graded cards only');
    if (loc.card_type === 'raw' && isGraded) throw new Error('This location is for raw cards only');

    // Sync is_card_show flag
    await db.updateTable('card_instances')
      .set({ location_id: locationId, is_card_show: loc.is_card_show })
      .where('id', '=', cardInstanceId)
      .execute();
  } else {
    await db.updateTable('card_instances')
      .set({ location_id: null, is_card_show: false })
      .where('id', '=', cardInstanceId)
      .execute();
  }
}

export async function bulkAssignLocation(userId: string, cardInstanceIds: string[], locationId: string | null) {
  await Promise.all(cardInstanceIds.map(id => assignLocation(userId, id, locationId)));
}
