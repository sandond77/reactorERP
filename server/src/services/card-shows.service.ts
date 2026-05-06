import { db } from '../config/database';
import { sql } from 'kysely';
import { logAudit } from '../utils/audit';

/**
 * Auto-link platform='card_show' sales that have no card_show_id to a card_shows
 * row by matching DATE(sold_at) = show_date. Skips sales whose order_details_link
 * points at eBay (so an eBay sale that happened to fall on a show date doesn't get
 * mis-attributed). Idempotent — safe to call repeatedly.
 *
 * Optionally scoped to a single show_date when called right after createCardShow,
 * so we only update sales for that specific date instead of scanning the user's
 * full sales history.
 */
export async function backfillCardShowLinks(userId: string, opts?: { showDate?: Date }) {
  const result = await sql<{ id: string }>`
    UPDATE sales s
    SET card_show_id = cs.id
    FROM card_shows cs
    WHERE s.user_id = ${userId}
      AND cs.user_id = ${userId}
      AND s.platform = 'card_show'
      AND s.card_show_id IS NULL
      AND DATE(s.sold_at) = cs.show_date
      AND (s.order_details_link IS NULL OR s.order_details_link NOT ILIKE '%ebay.%')
      ${opts?.showDate ? sql`AND DATE(s.sold_at) = ${opts.showDate}` : sql``}
    RETURNING s.id
  `.execute(db);
  return Number(result.numAffectedRows ?? 0);
}

export async function listCardShows(userId: string) {
  return db
    .selectFrom('card_shows as cs')
    .select([
      'cs.id', 'cs.name', 'cs.location', 'cs.show_date', 'cs.end_date', 'cs.num_days', 'cs.num_tables', 'cs.notes', 'cs.created_at',
    ])
    .where('cs.user_id', '=', userId)
    .orderBy('cs.show_date', 'desc')
    .execute();
}

export async function createCardShow(userId: string, data: {
  name: string;
  location?: string | null;
  show_date: string;
  end_date?: string | null;
  num_days?: number;
  num_tables?: number | string | null;
  notes?: string | null;
}) {
  const numDays = data.num_days ?? 1;
  const row = await db
    .insertInto('card_shows')
    .values({
      user_id: userId,
      name: data.name,
      location: data.location ?? null,
      show_date: new Date(data.show_date) as any,
      end_date: numDays > 1 && data.end_date ? new Date(data.end_date) as any : null,
      num_days: numDays,
      num_tables: data.num_tables != null ? String(data.num_tables) : null,
      notes: data.notes ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await logAudit(userId, 'card_shows', row.id, 'created', null, row);
  // Link any past unassigned card_show sales that fell on this date
  await backfillCardShowLinks(userId, { showDate: row.show_date as unknown as Date });
  return row;
}

export async function updateCardShow(userId: string, id: string, data: {
  name?: string;
  location?: string | null;
  show_date?: string;
  end_date?: string | null;
  num_days?: number;
  num_tables?: number | string | null;
  notes?: string | null;
}) {
  const updates: Record<string, any> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.location !== undefined) updates.location = data.location;
  if (data.show_date !== undefined) updates.show_date = new Date(data.show_date);
  if (data.end_date !== undefined) updates.end_date = data.end_date ? new Date(data.end_date) : null;
  if (data.num_days !== undefined) updates.num_days = data.num_days;
  if (data.num_tables !== undefined) updates.num_tables = data.num_tables != null ? String(data.num_tables) : null;
  if (data.notes !== undefined) updates.notes = data.notes;

  const existing = await db
    .selectFrom('card_shows')
    .selectAll()
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  const updated = await db
    .updateTable('card_shows')
    .set(updates)
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .returningAll()
    .executeTakeFirst();

  if (updated) await logAudit(userId, 'card_shows', id, 'updated', existing ?? null, updated);
  if (updated && data.show_date !== undefined) {
    await backfillCardShowLinks(userId, { showDate: updated.show_date as unknown as Date });
  }
  return updated;
}

export async function addCardsToCardShow(userId: string, cards: { id: string; card_show_price: number }[]) {
  const now = new Date();
  for (const { id, card_show_price } of cards) {
    const existing = await db
      .selectFrom('card_instances')
      .selectAll()
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!existing || existing.is_personal_collection) continue;
    await db
      .updateTable('card_instances')
      .set({ is_card_show: true, card_show_added_at: now, card_show_price })
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .execute();
    await logAudit(userId, 'card_instances', id, 'updated', existing, { ...existing, is_card_show: true, card_show_price });
  }
}

export async function deleteCardShow(userId: string, id: string) {
  const existing = await db
    .selectFrom('card_shows')
    .selectAll()
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  const result = await db
    .deleteFrom('card_shows')
    .where('id', '=', id)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (existing) await logAudit(userId, 'card_shows', id, 'deleted', existing, null);
  return result;
}
