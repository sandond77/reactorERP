import { sql } from 'kysely';
import { db } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { logAudit } from '../utils/audit';
import type { NewListing } from '../types/db';
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination';
import type { PaginationParams } from '../utils/pagination';

export type CertDetail = {
  cert_number: string | null;
  grade_label: string | null;
  list_price: number | null;
  ebay_listing_url: string | null;
  listing_group_id?: string | null;
  card_name?: string | null;
};

export type ListingAggRow = {
  card_name: string | null;
  set_name: string | null;
  part_number: string | null;
  grade_label: string | null;
  grading_company: string | null;
  condition: string | null;
  platform: string;
  list_price: number | null;
  currency: string;
  ebay_listing_url: string | null;
  listed_at: string | null;
  num_listed: number;
  num_sold: number;
  raw_purchase_label: string | null;
  cert_details: CertDetail[] | null;
  listing_group_id?: string | null;
  listing_group_name?: string | null;
};

const LISTINGS_SORT_COLS: Record<string, string> = {
  card_name: 'card_name',
  platform: 'platform',
  list_price: 'list_price',
  listed_at: 'listed_at',
  num_listed: 'num_listed',
  num_sold: 'num_sold',
};

const ORDER_URL_PATTERN = `'(/mesh/|/sh/ord|/vod/fetchorderdetails|/ord/|orderid=|order_id=)'`;

function isOrderUrlSql() {
  return sql`ebay_listing_url ILIKE '%ebay.%' AND ebay_listing_url ~* ${sql.raw(ORDER_URL_PATTERN)}`;
}

export async function getListingFilterOptions(userId: string) {
  const [platforms, grades, companies, partNumbers, numListedOpts, numSoldOpts, cardNames, prices, orderUrlCount] = await Promise.all([
    sql<{ value: string }>`
      SELECT DISTINCT l.platform AS value
      FROM listings l
      WHERE l.user_id = ${userId}
      AND l.listing_status = 'active'
      AND l.platform != 'card_show'
      ORDER BY value
    `.execute(db),
    sql<{ value: string }>`
      SELECT DISTINCT (sd.company || ' ' || sd.grade_label) AS value
      FROM listings l
      JOIN card_instances ci ON ci.id = l.card_instance_id
      JOIN slab_details sd ON sd.card_instance_id = ci.id
      WHERE l.user_id = ${userId}
      AND l.listing_status = 'active'
      AND sd.grade_label IS NOT NULL
      ORDER BY value
    `.execute(db),
    sql<{ value: string }>`
      SELECT DISTINCT sd.company AS value
      FROM listings l
      JOIN card_instances ci ON ci.id = l.card_instance_id
      JOIN slab_details sd ON sd.card_instance_id = ci.id
      WHERE l.user_id = ${userId}
      AND l.listing_status = 'active'
      AND sd.company IS NOT NULL
      ORDER BY value
    `.execute(db),
    sql<{ value: string }>`
      SELECT DISTINCT cc.sku AS value
      FROM listings l
      JOIN card_instances ci ON ci.id = l.card_instance_id
      LEFT JOIN card_catalog cc ON cc.id = ci.catalog_id
      WHERE l.user_id = ${userId}
      AND l.listing_status = 'active'
      AND cc.sku IS NOT NULL
      ORDER BY value
    `.execute(db),
    sql<{ value: string }>`
      SELECT DISTINCT COUNT(DISTINCT l.id)::text AS value
      FROM listings l
      JOIN card_instances ci ON ci.id = l.card_instance_id
      LEFT JOIN card_catalog cc ON cc.id = ci.catalog_id
      LEFT JOIN slab_details sd ON sd.card_instance_id = ci.id
      WHERE l.user_id = ${userId}
      AND l.listing_status = 'active'
      GROUP BY
        COALESCE(ci.card_name_override, cc.card_name),
        COALESCE(cc.set_name, ci.set_name_override),
        cc.sku, sd.grade_label, sd.company,
        l.platform, l.list_price, l.currency, l.ebay_listing_url
      ORDER BY 1
    `.execute(db),
    sql<{ value: string }>`
      SELECT DISTINCT COUNT(*)::text AS value
      FROM sales s
      JOIN card_instances ci ON ci.id = s.card_instance_id
      LEFT JOIN slab_details sd ON sd.card_instance_id = ci.id
      LEFT JOIN card_catalog cc ON cc.id = ci.catalog_id
      WHERE s.user_id = ${userId}
      GROUP BY
        COALESCE(ci.card_name_override, cc.card_name),
        sd.grade_label, sd.company, s.platform
      ORDER BY 1
    `.execute(db),
    sql<{ value: string }>`
      SELECT DISTINCT COALESCE(ci.card_name_override, cc.card_name) AS value
      FROM listings l
      JOIN card_instances ci ON ci.id = l.card_instance_id
      LEFT JOIN card_catalog cc ON cc.id = ci.catalog_id
      WHERE l.user_id = ${userId}
      AND l.listing_status = 'active'
      AND COALESCE(ci.card_name_override, cc.card_name) IS NOT NULL
      ORDER BY value
    `.execute(db),
    sql<{ value: string }>`
      SELECT DISTINCT ROUND(l.list_price / 100.0, 2)::text AS value
      FROM listings l
      WHERE l.user_id = ${userId}
      AND l.listing_status = 'active'
      ORDER BY 1
    `.execute(db),

    sql<{ count: string }>`
      SELECT COUNT(*) AS count
      FROM listings l
      WHERE l.user_id = ${userId}
      AND l.listing_status = 'active'
      AND l.ebay_listing_url IS NOT NULL
      AND ${isOrderUrlSql()}
    `.execute(db),
  ]);
  return {
    platforms: platforms.rows.map((r) => r.value),
    grades: grades.rows.map((r) => r.value),
    companies: companies.rows.map((r) => r.value),
    part_numbers: partNumbers.rows.map((r) => r.value),
    num_listed: numListedOpts.rows.map((r) => r.value),
    num_sold: numSoldOpts.rows.map((r) => r.value),
    card_names: cardNames.rows.map((r) => r.value),
    prices: prices.rows.map((r) => r.value),
    order_url_count: Number(orderUrlCount.rows[0]?.count ?? 0),
  };
}

export async function listListings(
  userId: string,
  filters: { platforms?: string[]; search?: string; grades?: string[]; companies?: string[]; part_numbers?: string[]; num_listed?: string[]; num_sold?: string[]; card_names?: string[]; prices?: string[]; listing_type?: 'graded' | 'raw' | 'graded_set' | 'raw_set' },
  pagination: PaginationParams,
  sortBy?: string,
  sortDir?: 'asc' | 'desc'
) {
  const sortCol = LISTINGS_SORT_COLS[sortBy ?? ''] ?? 'listed_at';
  const sortDirSafe = sortDir === 'asc' ? sql.raw('ASC') : sql.raw('DESC');

  const platformCond =
    filters.platforms !== undefined
      ? filters.platforms.length === 0
        ? sql`AND 1=0`
        : sql`AND l.platform IN (${sql.join(filters.platforms.map((p) => sql.val(p)))})`
      : sql``;

  const searchCond = filters.search
    ? sql`AND COALESCE(ci.card_name_override, cc.card_name) ILIKE ${`%${filters.search}%`}`
    : sql``;

  const gradeCond =
    filters.grades !== undefined
      ? filters.grades.length === 0
        ? sql`AND 1=0`
        : sql`AND (sd.company || ' ' || sd.grade_label) IN (${sql.join(filters.grades.map((g) => sql.val(g)))})`
      : sql``;

  const companyCond =
    filters.companies !== undefined
      ? filters.companies.length === 0
        ? sql`AND 1=0`
        : sql`AND sd.company IN (${sql.join(filters.companies.map((c) => sql.val(c)))})`
      : sql``;

  const partNumberCond =
    filters.part_numbers !== undefined
      ? filters.part_numbers.length === 0
        ? sql`AND 1=0`
        : sql`AND cc.sku IN (${sql.join(filters.part_numbers.map((p) => sql.val(p)))})`
      : sql``;

  const cardNameCond =
    filters.card_names !== undefined
      ? filters.card_names.length === 0
        ? sql`AND 1=0`
        : sql`AND COALESCE(ci.card_name_override, cc.card_name) IN (${sql.join(filters.card_names.map((n) => sql.val(n)))})`
      : sql``;

  const priceCond =
    filters.prices !== undefined
      ? filters.prices.length === 0
        ? sql`AND 1=0`
        : sql`AND l.list_price IN (${sql.join(filters.prices.map((p) => sql.val(Math.round(parseFloat(p) * 100))))})`
      : sql``;

  const numListedCond =
    filters.num_listed !== undefined
      ? filters.num_listed.length === 0
        ? sql`AND 1=0`
        : sql`AND num_listed IN (${sql.join(filters.num_listed.map((n) => sql.val(Number(n))))})`
      : sql``;

  const numSoldCond =
    filters.num_sold !== undefined
      ? filters.num_sold.length === 0
        ? sql`AND 1=0`
        : sql`AND num_sold IN (${sql.join(filters.num_sold.map((n) => sql.val(Number(n))))})`
      : sql``;

  const listingTypeCond =
    filters.listing_type === 'raw'        ? sql`AND sd.id IS NULL AND l.listing_group_id IS NULL` :
    filters.listing_type === 'graded'     ? sql`AND sd.id IS NOT NULL AND l.listing_group_id IS NULL` :
    filters.listing_type === 'graded_set' ? sql`AND sd.id IS NOT NULL AND l.listing_group_id IS NOT NULL` :
    filters.listing_type === 'raw_set'    ? sql`AND sd.id IS NULL AND l.listing_group_id IS NOT NULL` :
    sql``;

  // ── Graded Set: separate query grouped by listing_group_id ──────────────────
  if (filters.listing_type === 'graded_set') {
    const setResult = await sql<ListingAggRow & { total_count: number }>`
      WITH grouped AS (
        SELECT
          l.listing_group_id,
          (ARRAY_AGG(l.listing_group_name ORDER BY l.listed_at DESC NULLS LAST))[1]  AS listing_group_name,
          NULL::text                                                                  AS card_name,
          NULL::text                                                                  AS set_name,
          NULL::text                                                                  AS part_number,
          NULL::text                                                                  AS grade_label,
          NULL::text                                                                  AS grading_company,
          NULL::text                                                                  AS condition,
          l.platform,
          SUM(l.list_price)::int                                                      AS list_price,
          l.currency,
          (ARRAY_AGG(l.ebay_listing_url ORDER BY l.listed_at DESC NULLS LAST))[1]    AS ebay_listing_url,
          MIN(l.listed_at)                                                            AS listed_at,
          COUNT(DISTINCT l.id)::int                                                   AS num_listed,
          0::int                                                                      AS num_sold,
          NULL::text                                                                  AS raw_purchase_label,
          JSON_AGG(JSON_BUILD_OBJECT(
            'listing_id',       l.id,
            'cert_number',      sd.cert_number,
            'grade_label',      sd.grade_label,
            'list_price',       l.list_price,
            'ebay_listing_url', l.ebay_listing_url,
            'listing_group_id', l.listing_group_id,
            'card_name',        COALESCE(ci.card_name_override, cc.card_name),
            'part_number',      cc.sku,
            'company',          sd.company
          ) ORDER BY l.listed_at DESC NULLS LAST)
          FILTER (WHERE sd.id IS NOT NULL)                                            AS cert_details
        FROM listings l
        JOIN card_instances ci ON ci.id = l.card_instance_id
        LEFT JOIN card_catalog cc ON cc.id = ci.catalog_id
        LEFT JOIN slab_details sd ON sd.card_instance_id = ci.id
        WHERE l.user_id = ${userId}
        AND l.listing_status = 'active'
        AND l.platform != 'card_show'
        AND l.listing_group_id IS NOT NULL
        AND sd.id IS NOT NULL
        ${platformCond}
        ${searchCond}
        GROUP BY l.listing_group_id, l.platform, l.currency
      )
      SELECT *, COUNT(*) OVER ()::int AS total_count
      FROM grouped
      ORDER BY ${sql.raw(sortCol)} ${sortDirSafe}
      LIMIT ${pagination.limit}
      OFFSET ${getPaginationOffset(pagination.page, pagination.limit)}
    `.execute(db);
    const total = Number(setResult.rows[0]?.total_count ?? 0);
    const rows = setResult.rows.map(({ total_count: _, ...rest }) => rest as ListingAggRow);
    return buildPaginatedResult(rows, total, pagination.page, pagination.limit);
  }

  const result = await sql<ListingAggRow & { total_count: number }>`
    WITH sales_agg AS (
      SELECT
        cc2.sku                                                                          AS sku,
        CASE WHEN cc2.sku IS NULL THEN COALESCE(ci2.card_name_override, cc2.card_name) END AS card_name_key,
        sd2.grade_label,
        s.platform,
        COUNT(*) AS num_sold
      FROM sales s
      JOIN card_instances ci2 ON ci2.id = s.card_instance_id
      LEFT JOIN slab_details sd2 ON sd2.card_instance_id = ci2.id
      LEFT JOIN card_catalog cc2 ON cc2.id = ci2.catalog_id
      WHERE s.user_id = ${userId}
      GROUP BY 1, 2, 3, 4
    ),
    grouped AS (
      SELECT
        (ARRAY_AGG(COALESCE(ci.card_name_override, cc.card_name) ORDER BY l.listed_at DESC NULLS LAST))[1] AS card_name,
        (ARRAY_AGG(COALESCE(cc.set_name, ci.set_name_override)   ORDER BY l.listed_at DESC NULLS LAST))[1] AS set_name,
        cc.sku                                                                                              AS part_number,
        sd.grade_label,
        sd.company                                                                                          AS grading_company,
        (ARRAY_AGG(ci.condition ORDER BY l.listed_at DESC NULLS LAST))[1]                                  AS condition,
        l.platform,
        (ARRAY_AGG(l.list_price       ORDER BY l.listed_at DESC NULLS LAST))[1]                            AS list_price,
        l.currency,
        (ARRAY_AGG(l.ebay_listing_url ORDER BY l.listed_at DESC NULLS LAST))[1]                            AS ebay_listing_url,
        MIN(l.listed_at)                                                                                    AS listed_at,
        COUNT(DISTINCT l.id)::int                                                                           AS num_listed,
        MAX(COALESCE(sa.num_sold, 0))::int                                                                  AS num_sold,
        (ARRAY_AGG(rp.purchase_id ORDER BY l.listed_at DESC NULLS LAST))[1]                                AS raw_purchase_label,
        JSON_AGG(JSON_BUILD_OBJECT(
          'listing_id',       l.id,
          'cert_number',      sd.cert_number,
          'grade_label',      sd.grade_label,
          'list_price',       l.list_price,
          'ebay_listing_url', l.ebay_listing_url,
          'listing_group_id', l.listing_group_id
        ) ORDER BY l.listed_at DESC NULLS LAST)
        FILTER (WHERE sd.id IS NOT NULL)                                                                    AS cert_details
      FROM listings l
      JOIN card_instances ci ON ci.id = l.card_instance_id
      LEFT JOIN card_catalog cc ON cc.id = ci.catalog_id
      LEFT JOIN slab_details sd ON sd.card_instance_id = ci.id
      LEFT JOIN raw_purchases rp ON rp.id = ci.raw_purchase_id
      LEFT JOIN sales_agg sa ON
        (
          cc.sku IS NOT NULL AND sa.sku IS NOT DISTINCT FROM cc.sku
          OR cc.sku IS NULL AND sa.sku IS NULL
             AND sa.card_name_key IS NOT DISTINCT FROM COALESCE(ci.card_name_override, cc.card_name)
        )
        AND sa.grade_label IS NOT DISTINCT FROM sd.grade_label
        AND sa.platform = l.platform
      WHERE l.user_id = ${userId}
      AND l.listing_status = 'active'
      AND l.platform != 'card_show'
      ${platformCond}
      ${searchCond}
      ${cardNameCond}
      ${gradeCond}
      ${companyCond}
      ${partNumberCond}
      ${priceCond}
      ${listingTypeCond}
      GROUP BY
        cc.sku,
        CASE WHEN cc.sku IS NULL THEN COALESCE(ci.card_name_override, cc.card_name) END,
        CASE WHEN cc.sku IS NULL THEN COALESCE(cc.set_name, ci.set_name_override) END,
        sd.grade_label,
        sd.company,
        l.platform,
        l.currency,
        CASE WHEN cc.sku IS NULL THEN l.list_price END,
        CASE WHEN cc.sku IS NULL THEN l.ebay_listing_url END
    )
    SELECT *, COUNT(*) OVER ()::int AS total_count
    FROM grouped
    WHERE 1=1 ${numListedCond} ${numSoldCond}
    ORDER BY ${sql.raw(sortCol)} ${sortDirSafe}
    LIMIT ${pagination.limit}
    OFFSET ${getPaginationOffset(pagination.page, pagination.limit)}
  `.execute(db);

  const total = Number(result.rows[0]?.total_count ?? 0);
  const rows = result.rows.map(({ total_count: _, ...rest }) => rest as ListingAggRow);
  return buildPaginatedResult(rows, total, pagination.page, pagination.limit);
}

export type CreateListingInput = Omit<NewListing, 'user_id'>;

export async function createListing(userId: string, input: CreateListingInput) {
  const card = await db
    .selectFrom('card_instances')
    .select(['id', 'status', 'is_personal_collection'])
    .where('id', '=', input.card_instance_id)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (!card) throw new AppError(404, 'Card not found');
  if (card.is_personal_collection) throw new AppError(400, 'Personal collection cards cannot be listed. Remove from personal collection first.');

  const existing = await db
    .selectFrom('listings')
    .select('id')
    .where('card_instance_id', '=', input.card_instance_id)
    .where('user_id', '=', userId)
    .where('listing_status', '=', 'active')
    .executeTakeFirst();
  if (existing) throw new AppError(409, 'This card already has an active listing');

  const listing = await db
    .insertInto('listings')
    .values({ ...input, user_id: userId })
    .returningAll()
    .executeTakeFirstOrThrow();

  // Only transition raw cards to raw_for_sale; graded cards stay graded
  if (['inspected', 'purchased_raw'].includes(card.status)) {
    await db
      .updateTable('card_instances')
      .set({ status: 'raw_for_sale' })
      .where('id', '=', input.card_instance_id)
      .execute();
  }

  await logAudit(userId, 'listings', listing.id, 'created', null, listing);
  return listing;
}

export async function updateListing(
  userId: string,
  listingId: string,
  data: Partial<NewListing>
) {
  const existing = await db
    .selectFrom('listings')
    .selectAll()
    .where('id', '=', listingId)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (!existing) throw new AppError(404, 'Listing not found');

  const updated = await db
    .updateTable('listings')
    .set(data as any)
    .where('id', '=', listingId)
    .returningAll()
    .executeTakeFirstOrThrow();
  await logAudit(userId, 'listings', listingId, 'updated', existing, updated);
  return updated;
}

export async function updateSetGroup(userId: string, groupId: string, data: { listing_group_name?: string; ebay_listing_url?: string | null; list_price?: number }) {
  // Get active listing ids first so we know the count for price splitting
  const existing = await db
    .selectFrom('listings')
    .select('id')
    .where('user_id', '=', userId)
    .where('listing_group_id', '=', groupId)
    .where('listing_status', '=', 'active')
    .execute();
  if (existing.length === 0) throw new AppError(404, 'No listings found for that set group');

  const updateData: Record<string, unknown> = {};
  if (data.listing_group_name !== undefined) updateData.listing_group_name = data.listing_group_name;
  if (data.ebay_listing_url !== undefined) updateData.ebay_listing_url = data.ebay_listing_url;
  // list_price from client is total set price — split evenly per listing
  if (data.list_price !== undefined) updateData.list_price = Math.round(data.list_price / existing.length);

  await db
    .updateTable('listings')
    .set(updateData as any)
    .where('id', 'in', existing.map(r => r.id))
    .execute();
  return { updated: existing.length };
}

export async function cancelSingleListing(userId: string, listingId: string) {
  const listing = await db
    .selectFrom('listings')
    .select(['id', 'card_instance_id'])
    .where('id', '=', listingId)
    .where('user_id', '=', userId)
    .where('listing_status', '=', 'active')
    .executeTakeFirst();
  if (!listing) throw new AppError(404, 'Active listing not found');

  await db
    .updateTable('listings')
    .set({ listing_status: 'cancelled' })
    .where('id', '=', listingId)
    .execute();

  // Revert raw_for_sale back to purchased_raw if no remaining active listings
  const remaining = await db
    .selectFrom('listings')
    .select('id')
    .where('card_instance_id', '=', listing.card_instance_id)
    .where('listing_status', '=', 'active')
    .executeTakeFirst();
  if (!remaining) {
    await db
      .updateTable('card_instances')
      .set({ status: 'purchased_raw' })
      .where('id', '=', listing.card_instance_id)
      .where('status', '=', 'raw_for_sale')
      .where('user_id', '=', userId)
      .execute();
  }
  return { cancelled: 1 };
}

export async function cancelSetGroup(userId: string, groupId: string) {
  const listingRows = await db
    .selectFrom('listings')
    .select(['id', 'card_instance_id'])
    .where('user_id', '=', userId)
    .where('listing_group_id', '=', groupId)
    .where('listing_status', '=', 'active')
    .execute();
  if (listingRows.length === 0) throw new AppError(404, 'No active listings found for this set group');
  await db
    .updateTable('listings')
    .set({ listing_status: 'cancelled' })
    .where('id', 'in', listingRows.map(r => r.id))
    .execute();
  return { cancelled: listingRows.length };
}

// ── Group operations (act on all listings belonging to an aggregated row) ─────

export interface ListingGroupKey {
  part_number: string | null;
  card_name: string | null;
  grade_label: string | null;
  grading_company: string | null;
  platform: string;
  currency: string;
}

function groupIdSubquery(userId: string, key: ListingGroupKey) {
  const skuCond = key.part_number !== null
    ? sql`cc.sku IS NOT NULL AND cc.sku = ${key.part_number}`
    : sql`cc.sku IS NULL AND COALESCE(ci.card_name_override, cc.card_name) = ${key.card_name}`;
  const gradeCond = key.grade_label !== null
    ? sql`sd.grade_label = ${key.grade_label}`
    : sql`sd.grade_label IS NULL`;
  const companyCond = key.grading_company !== null
    ? sql`sd.company = ${key.grading_company}`
    : sql`sd.company IS NULL`;
  return sql<{ id: string }>`
    SELECT l.id
    FROM listings l
    JOIN card_instances ci ON ci.id = l.card_instance_id
    LEFT JOIN card_catalog cc ON cc.id = ci.catalog_id
    LEFT JOIN slab_details sd ON sd.card_instance_id = ci.id
    WHERE l.user_id = ${userId}
    AND l.listing_status = 'active'
    AND l.platform = ${key.platform}
    AND l.currency = ${key.currency}
    AND (${skuCond})
    AND (${gradeCond})
    AND (${companyCond})
  `;
}

export async function updateListingsByGroup(
  userId: string,
  key: ListingGroupKey,
  updates: { list_price?: number; platform?: string; currency?: string; ebay_listing_url?: string | null }
) {
  const ids = await groupIdSubquery(userId, key).execute(db);
  if (ids.rows.length === 0) throw new AppError(404, 'No active listings found for this group');
  await db
    .updateTable('listings')
    .set(updates as any)
    .where('id', 'in', ids.rows.map(r => r.id))
    .execute();
  return { updated: ids.rows.length };
}

export async function cancelListingsByGroup(userId: string, key: ListingGroupKey) {
  // Fetch the listings so we know which card_instance_ids are affected
  const ids = await groupIdSubquery(userId, key).execute(db);
  if (ids.rows.length === 0) throw new AppError(404, 'No active listings found for this group');

  // Get card_instance_ids from these listings
  const listingRows = await db
    .selectFrom('listings')
    .select(['id', 'card_instance_id'])
    .where('id', 'in', ids.rows.map(r => r.id))
    .execute();

  await db
    .updateTable('listings')
    .set({ listing_status: 'cancelled' })
    .where('id', 'in', ids.rows.map(r => r.id))
    .execute();

  // Revert raw_for_sale cards back to purchased_raw if they have no remaining active listings
  const cardIds = [...new Set(listingRows.map(r => r.card_instance_id))];
  for (const cardId of cardIds) {
    const remaining = await db
      .selectFrom('listings')
      .select('id')
      .where('card_instance_id', '=', cardId)
      .where('listing_status', '=', 'active')
      .executeTakeFirst();
    if (!remaining) {
      await db
        .updateTable('card_instances')
        .set({ status: 'purchased_raw' })
        .where('id', '=', cardId)
        .where('status', '=', 'raw_for_sale')
        .where('user_id', '=', userId)
        .execute();
    }
  }

  return { cancelled: ids.rows.length };
}

export async function migrateOrderUrlListings(userId: string) {
  const listings = await sql<{
    id: string;
    card_instance_id: string;
    list_price: number;
    platform: string;
    currency: string;
    ebay_listing_url: string;
    listed_at: Date | null;
  }>`
    SELECT l.id, l.card_instance_id, l.list_price, l.platform, l.currency, l.ebay_listing_url, l.listed_at
    FROM listings l
    WHERE l.user_id = ${userId}
    AND l.listing_status = 'active'
    AND l.ebay_listing_url IS NOT NULL
    AND ${isOrderUrlSql()}
  `.execute(db);

  let migrated = 0;
  for (const listing of listings.rows) {
    const prevCard = await db
      .selectFrom('card_instances')
      .select(['id', 'status'])
      .where('id', '=', listing.card_instance_id)
      .where('user_id', '=', userId)
      .executeTakeFirst();

    const sale = await db
      .insertInto('sales')
      .values({
        user_id: userId,
        card_instance_id: listing.card_instance_id,
        listing_id: listing.id,
        platform: listing.platform as any,
        sale_price: listing.list_price,
        platform_fees: 0,
        shipping_cost: 0,
        currency: listing.currency,
        order_details_link: listing.ebay_listing_url,
        sold_at: listing.listed_at ?? new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await db
      .updateTable('listings')
      .set({ listing_status: 'cancelled' })
      .where('id', '=', listing.id)
      .execute();

    await db
      .updateTable('card_instances')
      .set({ status: 'sold' })
      .where('id', '=', listing.card_instance_id)
      .where('user_id', '=', userId)
      .execute();

    await logAudit(userId, 'sales', sale.id, 'created', null, sale);
    await logAudit(userId, 'listings', listing.id, 'status_changed',
      { listing_status: 'active', ebay_listing_url: listing.ebay_listing_url },
      { listing_status: 'cancelled', migrated_to_sale_id: sale.id }
    );
    if (prevCard) {
      await logAudit(userId, 'card_instances', listing.card_instance_id, 'status_changed',
        { status: prevCard.status },
        { status: 'sold' }
      );
    }

    migrated++;
  }

  return { migrated };
}

export async function cancelListing(userId: string, listingId: string) {
  const listing = await db
    .selectFrom('listings')
    .selectAll()
    .where('id', '=', listingId)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (!listing) throw new AppError(404, 'Listing not found');

  await db
    .updateTable('listings')
    .set({ listing_status: 'cancelled' })
    .where('id', '=', listingId)
    .execute();
  await logAudit(userId, 'listings', listingId, 'status_changed', { listing_status: listing.listing_status }, { listing_status: 'cancelled' });
}
