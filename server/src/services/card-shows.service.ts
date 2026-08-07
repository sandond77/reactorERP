import { db } from '../config/database';
import { sql } from 'kysely';
import { logAudit } from '../utils/audit';
import { ensureCardShowLocation } from './locations.service';

/**
 * Auto-link platform='card_show' sales that have no card_show_id to a card_shows
 * row by matching DATE(sold_at) within the show's date range
 * (show_date through end_date inclusive — multi-day shows). Skips sales whose
 * order_details_link looks like an eBay URL. Idempotent.
 *
 * Optionally scoped to a single show row when called right after
 * createCardShow / updateCardShow so we only touch sales for that show's date
 * range instead of scanning the user's full sales history.
 */
export async function backfillCardShowLinks(userId: string, opts?: { showId?: string }) {
  const result = await sql<{ id: string }>`
    UPDATE sales s
    SET card_show_id = cs.id
    FROM card_shows cs
    WHERE s.user_id = ${userId}
      AND cs.user_id = ${userId}
      AND s.platform = 'card_show'
      AND s.card_show_id IS NULL
      AND DATE(s.sold_at) BETWEEN cs.show_date AND COALESCE(cs.end_date, cs.show_date)
      AND (s.order_details_link IS NULL OR s.order_details_link NOT ILIKE '%ebay.%')
      ${opts?.showId ? sql`AND cs.id = ${opts.showId}` : sql``}
    RETURNING s.id
  `.execute(db);
  return Number(result.numAffectedRows ?? 0);
}

export async function listCardShows(userId: string, tz?: string) {
  // Order by proximity to today so the Record Sale dropdown surfaces the
  // show the user is most likely working on (currently attending, just
  // wrapped, or about to attend). Previously ORDER BY show_date DESC
  // pushed shows scheduled months out to the top, burying the show the
  // user actually needs. Proximity is computed against the caller's local
  // date (not CURRENT_DATE, which resolves in the DB's UTC session tz — an
  // evening PST user near midnight would otherwise get "tomorrow's" show
  // sorted ahead of today's).
  const { safeTz } = await import('../utils/tz');
  const effectiveTz = safeTz(tz);
  return db
    .selectFrom('card_shows as cs')
    .select([
      'cs.id', 'cs.name', 'cs.location', 'cs.show_date', 'cs.end_date', 'cs.num_days', 'cs.num_tables', 'cs.notes', 'cs.created_at',
    ])
    .where('cs.user_id', '=', userId)
    .orderBy(sql`ABS(cs.show_date - (now() AT TIME ZONE ${effectiveTz})::date)`, 'asc')
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
  // Link any past unassigned card_show sales that fell within this show's date range
  await backfillCardShowLinks(userId, { showId: row.id });
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
  if (updated && (data.show_date !== undefined || data.end_date !== undefined || data.num_days !== undefined)) {
    await backfillCardShowLinks(userId, { showId: updated.id });
  }
  return updated;
}

export async function addCardsToCardShow(userId: string, cards: { id: string; card_show_price: number }[]) {
  const now = new Date();
  const cardShowLocationId = await ensureCardShowLocation(userId);
  for (const { id, card_show_price } of cards) {
    const existing = await db
      .selectFrom('card_instances')
      .selectAll()
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!existing || existing.is_personal_collection) continue;
    // Only auto-assign location if the card isn't already in a card-show location
    // (root or sub). Preserves any sub-location the user has manually set.
    let nextLocationId: string | null = existing.location_id;
    if (existing.location_id) {
      const currentLoc = await db.selectFrom('locations')
        .select(['id', 'is_card_show', 'parent_id'])
        .where('id', '=', existing.location_id)
        .where('user_id', '=', userId)
        .executeTakeFirst();
      const isInCardShowTree = currentLoc?.is_card_show
        || (currentLoc?.parent_id != null && await isUnderCardShow(userId, currentLoc.parent_id, cardShowLocationId));
      if (!isInCardShowTree) nextLocationId = cardShowLocationId;
    } else {
      nextLocationId = cardShowLocationId;
    }
    await db
      .updateTable('card_instances')
      .set({ is_card_show: true, card_show_added_at: now, card_show_price, location_id: nextLocationId })
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .execute();
    await logAudit(userId, 'card_instances', id, 'updated', existing, { ...existing, is_card_show: true, card_show_price, location_id: nextLocationId });
  }
}

async function isUnderCardShow(userId: string, locationId: string, cardShowRootId: string): Promise<boolean> {
  let currentId: string | null = locationId;
  while (currentId) {
    if (currentId === cardShowRootId) return true;
    const row: { parent_id: string | null } | undefined = await db.selectFrom('locations')
      .select('parent_id')
      .where('id', '=', currentId)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (!row) return false;
    currentId = row.parent_id;
  }
  return false;
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
