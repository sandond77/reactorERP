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
  is_multi_qty?: boolean;
  listing_id?: string;
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
  has_multi_qty?: boolean;
  is_drained_multi_qty?: boolean;
  any_listing_id?: string | null;
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
  filters: { platforms?: string[]; search?: string; grades?: string[]; companies?: string[]; part_numbers?: string[]; num_listed?: string[]; num_sold?: string[]; card_names?: string[]; prices?: string[]; multi_qty?: string[]; listing_type?: 'graded' | 'raw' | 'graded_set' | 'raw_set' },
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

  // Search hits multiple identifiers: card name (substring), slab cert
  // number (exact-substring on the text rep), part number (SKU), and the
  // parent raw_purchase id (e.g. "2026R49"). Lets the user paste a cert,
  // SKU, or purchase id into the same box that takes card names.
  const searchCond = filters.search
    ? sql`AND (
        COALESCE(ci.card_name_override, cc.card_name) ILIKE ${`%${filters.search}%`}
        OR sd.cert_number::text ILIKE ${`%${filters.search}%`}
        OR cc.sku ILIKE ${`%${filters.search}%`}
        OR rp.purchase_id ILIKE ${`%${filters.search}%`}
      )`
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

  // Multi-qty filter maps display labels → grouped-row flags:
  //   'Multi-Qty' → has_multi_qty AND NOT is_drained_multi_qty (active multi-qty)
  //   'Sold Out'  → is_drained_multi_qty (persistent drained group)
  //   'Solo'      → NOT has_multi_qty (single-cert listings)
  const multiQtyCond = (() => {
    if (filters.multi_qty === undefined) return sql``;
    if (filters.multi_qty.length === 0) return sql`AND 1=0`;
    const parts: ReturnType<typeof sql>[] = [];
    if (filters.multi_qty.includes('Multi-Qty')) parts.push(sql`(has_multi_qty AND NOT is_drained_multi_qty)`);
    if (filters.multi_qty.includes('Sold Out'))  parts.push(sql`is_drained_multi_qty`);
    if (filters.multi_qty.includes('Single') || filters.multi_qty.includes('Solo')) parts.push(sql`NOT has_multi_qty`);
    if (parts.length === 0) return sql`AND 1=0`;
    return sql`AND (${sql.join(parts, sql` OR `)})`;
  })();

  const listingTypeCond =
    filters.listing_type === 'raw'        ? sql`AND sd.id IS NULL AND l.listing_group_id IS NULL` :
    filters.listing_type === 'graded'     ? sql`AND sd.id IS NOT NULL AND l.listing_group_id IS NULL` :
    filters.listing_type === 'graded_set' ? sql`AND sd.id IS NOT NULL AND l.listing_group_id IS NOT NULL` :
    filters.listing_type === 'raw_set'    ? sql`AND sd.id IS NULL AND l.listing_group_id IS NOT NULL` :
    sql``;

  // ── Graded Set: aggregate by listing_group, then count peers by composition ─
  // Each row is still one listing_group_id (so $375 and $301.50 stay separate
  // rows). num_listed / num_sold count distinct groups that share the same set
  // composition (sorted card_name + grade + company tuples). This lets a sold
  // set surface as num_sold=1 on the matching active row, and avoids the old
  // bug where num_listed showed the # of cards in the set.
  if (filters.listing_type === 'graded_set') {
    const setSearchPattern = filters.search ? `%${filters.search}%` : null;
    const setResult = await sql<ListingAggRow & { total_count: number }>`
      WITH per_group AS (
        SELECT
          l.listing_group_id,
          l.platform,
          l.currency,
          BOOL_OR(l.listing_status = 'active')                                          AS has_active,
          BOOL_AND(l.listing_status = 'sold')                                            AS all_sold,
          BOOL_OR(l.is_multi_qty)                                                        AS is_multi_qty,
          BOOL_OR(l.is_ended)                                                            AS is_ended,
          -- Any ebay identifier from the group (active or not) — needed so
          -- drained multi-set groups can still resolve their URL / collapse
          -- against sibling copies.
          (ARRAY_AGG(l.ebay_listing_id ORDER BY l.listed_at DESC NULLS LAST))[1]         AS any_ebay_listing_id,
          (ARRAY_AGG(l.id ORDER BY l.listed_at DESC NULLS LAST))[1]                      AS any_listing_id,
          JSONB_AGG(JSONB_BUILD_OBJECT(
            'n', LOWER(COALESCE(ci.card_name_override, cc.card_name, '')),
            'g', sd.grade_label,
            'c', sd.company
          ) ORDER BY LOWER(COALESCE(ci.card_name_override, cc.card_name, '')), sd.grade_label, sd.company) AS composition,
          STRING_AGG(LOWER(COALESCE(ci.card_name_override, cc.card_name, '')), ' | ')   AS names_concat,
          STRING_AGG(COALESCE(sd.cert_number::text, ''), ' | ')                         AS certs_concat,
          (ARRAY_AGG(l.listing_group_name ORDER BY l.listed_at DESC NULLS LAST))[1]    AS listing_group_name,
          -- Prices / URL prefer active rows but fall back to any row for
          -- drained groups so the row still has something to render.
          COALESCE(
            SUM(l.list_price) FILTER (WHERE l.listing_status = 'active'),
            SUM(l.list_price)
          )::int                                                                        AS list_price,
          COALESCE(
            MIN(l.listed_at)  FILTER (WHERE l.listing_status = 'active'),
            MIN(l.listed_at)
          )                                                                             AS listed_at,
          COALESCE(
            (ARRAY_AGG(l.ebay_listing_url ORDER BY l.listed_at DESC NULLS LAST)
              FILTER (WHERE l.listing_status = 'active'))[1],
            (ARRAY_AGG(l.ebay_listing_url ORDER BY l.listed_at DESC NULLS LAST))[1]
          )                                                                             AS ebay_listing_url,
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
          FILTER (WHERE sd.id IS NOT NULL)                                              AS cert_details
        FROM listings l
        JOIN card_instances ci ON ci.id = l.card_instance_id
        LEFT JOIN card_catalog cc ON cc.id = ci.catalog_id
        LEFT JOIN slab_details sd ON sd.card_instance_id = ci.id
        WHERE l.user_id = ${userId}
          AND l.platform != 'card_show'
          AND l.listing_group_id IS NOT NULL
          AND sd.id IS NOT NULL
        GROUP BY l.listing_group_id, l.platform, l.currency
      ),
      comp_counts AS (
        SELECT composition, platform, currency,
          COUNT(*) FILTER (WHERE has_active)::int AS num_listed,
          COUNT(*) FILTER (WHERE all_sold)::int    AS num_sold
        FROM per_group
        GROUP BY composition, platform, currency
      ),
      grouped AS (
        SELECT
          pg.listing_group_id,
          pg.listing_group_name,
          NULL::text                  AS card_name,
          NULL::text                  AS set_name,
          NULL::text                  AS part_number,
          NULL::text                  AS grade_label,
          NULL::text                  AS grading_company,
          NULL::text                  AS condition,
          pg.platform,
          pg.list_price,
          pg.currency,
          pg.ebay_listing_url,
          pg.listed_at,
          cc.num_listed,
          cc.num_sold,
          NULL::text                  AS raw_purchase_label,
          pg.cert_details,
          pg.names_concat,
          pg.is_multi_qty                                                        AS has_multi_qty,
          -- A row is "drained multi-set" when the whole group is inactive AND
          -- no sibling copy on the same eBay URL is active either — same
          -- concept the graded (non-set) query already exposes.
          (
            pg.is_multi_qty
            AND NOT pg.has_active
            AND NOT EXISTS (
              SELECT 1 FROM per_group pg2
              WHERE pg2.any_ebay_listing_id IS NOT DISTINCT FROM pg.any_ebay_listing_id
                AND pg2.has_active = true
            )
          )                                                                      AS is_drained_multi_qty,
          pg.any_listing_id
        FROM per_group pg
        JOIN comp_counts cc
          ON cc.composition = pg.composition
         AND cc.platform = pg.platform
         AND cc.currency = pg.currency
        WHERE (
          pg.has_active = true
          OR (
            -- Drained multi-set copies persist so users can Add Cert (spawn
            -- another copy) or End Listing to close the URL explicitly.
            pg.is_multi_qty = true
            AND pg.is_ended = false
            AND NOT EXISTS (
              SELECT 1 FROM per_group pg2
              WHERE pg2.any_ebay_listing_id IS NOT DISTINCT FROM pg.any_ebay_listing_id
                AND pg2.has_active = true
            )
          )
        )
          ${filters.platforms !== undefined
            ? filters.platforms.length === 0 ? sql`AND 1=0`
              : sql`AND pg.platform IN (${sql.join(filters.platforms.map((p) => sql.val(p)))})`
            : sql``}
          ${setSearchPattern ? sql`AND (pg.names_concat ILIKE ${setSearchPattern} OR pg.certs_concat ILIKE ${setSearchPattern})` : sql``}
      )
      SELECT
        listing_group_id, listing_group_name, card_name, set_name, part_number,
        grade_label, grading_company, condition, platform, list_price, currency,
        ebay_listing_url, listed_at, num_listed, num_sold, raw_purchase_label, cert_details,
        has_multi_qty, is_drained_multi_qty, any_listing_id,
        COUNT(*) OVER ()::int AS total_count
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
        COUNT(DISTINCT l.id) FILTER (WHERE l.listing_status = 'active')::int                              AS num_listed,
        MAX(COALESCE(sa.num_sold, 0))::int                                                                  AS num_sold,
        BOOL_OR(l.is_multi_qty)                                                                             AS has_multi_qty,
        -- Drained multi-qty groups have no active rows but still show up in
        -- the aggregation. Flag them so the client can badge / gate actions.
        BOOL_OR(l.is_multi_qty AND l.listing_status != 'active') AND NOT BOOL_OR(l.listing_status = 'active') AS is_drained_multi_qty,
        -- Any listing_id in the group — needed as a fallback for drained
        -- multi-qty rows whose cert_details is empty (FILTER strips sold
        -- rows). Powers Add-cert / End on drained groups.
        (ARRAY_AGG(l.id ORDER BY l.listed_at DESC NULLS LAST))[1]                                          AS any_listing_id,
        (ARRAY_AGG(rp.purchase_id ORDER BY l.listed_at DESC NULLS LAST))[1]                                AS raw_purchase_label,
        JSON_AGG(JSON_BUILD_OBJECT(
          'listing_id',         l.id,
          'cert_number',        sd.cert_number,
          'grade_label',        sd.grade_label,
          'list_price',         l.list_price,
          'ebay_listing_url',   l.ebay_listing_url,
          'listing_group_id',   l.listing_group_id,
          'is_multi_qty',       l.is_multi_qty,
          'condition',          ci.condition,
          'raw_purchase_label', rp.purchase_id
        ) ORDER BY l.listed_at DESC NULLS LAST) FILTER (WHERE l.listing_status = 'active')                 AS cert_details
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
      AND (
        l.listing_status = 'active'
        OR (
          -- Drained multi-qty listings persist so the user can add certs back to
          -- the same eBay URL. is_ended is the explicit "close it" flag.
          l.is_multi_qty = true
          AND l.is_ended = false
          AND NOT EXISTS (
            SELECT 1 FROM listings l3
            WHERE l3.user_id = ${userId}
              AND l3.ebay_listing_id IS NOT DISTINCT FROM l.ebay_listing_id
              AND l3.ebay_listing_url IS NOT DISTINCT FROM l.ebay_listing_url
              AND l3.listing_status = 'active'
          )
        )
      )
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
        l.currency
    )
    SELECT *, COUNT(*) OVER ()::int AS total_count
    FROM grouped
    WHERE 1=1 ${numListedCond} ${numSoldCond} ${multiQtyCond}
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

  const ids = existing.map(r => r.id);
  const before = await db.selectFrom('listings').selectAll().where('id', 'in', ids).execute();
  await db
    .updateTable('listings')
    .set(updateData as any)
    .where('id', 'in', ids)
    .execute();
  for (const row of before) {
    await logAudit(userId, 'listings', row.id, 'updated', row, { ...row, ...updateData });
  }
  return { updated: existing.length };
}

export async function cancelSingleListing(userId: string, listingId: string) {
  const listingFull = await db
    .selectFrom('listings')
    .selectAll()
    .where('id', '=', listingId)
    .where('user_id', '=', userId)
    .where('listing_status', '=', 'active')
    .executeTakeFirst();
  if (!listingFull) throw new AppError(404, 'Active listing not found');

  await db
    .updateTable('listings')
    .set({ listing_status: 'cancelled' })
    .where('id', '=', listingId)
    .execute();
  await logAudit(userId, 'listings', listingId, 'updated', listingFull, { ...listingFull, listing_status: 'cancelled' as const });

  // Revert raw_for_sale back to purchased_raw if no remaining active listings
  const remaining = await db
    .selectFrom('listings')
    .select('id')
    .where('card_instance_id', '=', listingFull.card_instance_id)
    .where('listing_status', '=', 'active')
    .executeTakeFirst();
  if (!remaining) {
    const ciBefore = await db
      .selectFrom('card_instances')
      .selectAll()
      .where('id', '=', listingFull.card_instance_id)
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (ciBefore && ciBefore.status === 'raw_for_sale') {
      await db
        .updateTable('card_instances')
        .set({ status: 'purchased_raw' })
        .where('id', '=', listingFull.card_instance_id)
        .where('status', '=', 'raw_for_sale')
        .where('user_id', '=', userId)
        .execute();
      await logAudit(userId, 'card_instances', listingFull.card_instance_id, 'updated', ciBefore, { ...ciBefore, status: 'purchased_raw' as const });
    }
  }
  return { cancelled: 1 };
}

export async function cancelSetGroup(userId: string, groupId: string) {
  const listingRows = await db
    .selectFrom('listings')
    .selectAll()
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
  for (const row of listingRows) {
    await logAudit(userId, 'listings', row.id, 'updated', row, { ...row, listing_status: 'cancelled' as const });
  }
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
  const listingIds = ids.rows.map(r => r.id);
  const before = await db.selectFrom('listings').selectAll().where('id', 'in', listingIds).execute();
  await db
    .updateTable('listings')
    .set(updates as any)
    .where('id', 'in', listingIds)
    .execute();
  for (const row of before) {
    await logAudit(userId, 'listings', row.id, 'updated', row, { ...row, ...updates });
  }
  return { updated: ids.rows.length };
}

export async function cancelListingsByGroup(userId: string, key: ListingGroupKey) {
  // Fetch the listings so we know which card_instance_ids are affected
  const ids = await groupIdSubquery(userId, key).execute(db);
  if (ids.rows.length === 0) throw new AppError(404, 'No active listings found for this group');

  // Get full listing rows so we can audit + know the affected card_instance_ids
  const listingRows = await db
    .selectFrom('listings')
    .selectAll()
    .where('id', 'in', ids.rows.map(r => r.id))
    .execute();

  await db
    .updateTable('listings')
    .set({ listing_status: 'cancelled' })
    .where('id', 'in', ids.rows.map(r => r.id))
    .execute();
  for (const row of listingRows) {
    await logAudit(userId, 'listings', row.id, 'updated', row, { ...row, listing_status: 'cancelled' as const });
  }

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
      const ciBefore = await db
        .selectFrom('card_instances')
        .selectAll()
        .where('id', '=', cardId)
        .where('user_id', '=', userId)
        .executeTakeFirst();
      if (ciBefore && ciBefore.status === 'raw_for_sale') {
        await db
          .updateTable('card_instances')
          .set({ status: 'purchased_raw' })
          .where('id', '=', cardId)
          .where('status', '=', 'raw_for_sale')
          .where('user_id', '=', userId)
          .execute();
        await logAudit(userId, 'card_instances', cardId, 'updated', ciBefore, { ...ciBefore, status: 'purchased_raw' as const });
      }
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

// ────────────────────────────────────────────────────────────────────────────
// Multi-qty listings
//
// Model: `listings` stays 1:1 with card_instance so every cert keeps its own
// cost basis, sale linkage, and audit trail. When multiple rows share the
// same ebay_listing_id (or ebay_listing_url as a fallback) AND have
// is_multi_qty=true, they are one eBay listing with qty = # active rows in
// that group. Views collapse by (user_id, group-key) where is_multi_qty=true.
// Solo listings are always is_multi_qty=false so unrelated URLs never
// accidentally group.
// ────────────────────────────────────────────────────────────────────────────

// Prefer ebay_listing_id; fall back to ebay_listing_url. One of the two must
// be non-null for a listing to be promotable to multi-qty (there's nothing
// else to group by).
function groupKeyColOf(listing: { ebay_listing_id: string | null; ebay_listing_url: string | null }): 'ebay_listing_id' | 'ebay_listing_url' | null {
  if (listing.ebay_listing_id) return 'ebay_listing_id';
  if (listing.ebay_listing_url) return 'ebay_listing_url';
  return null;
}

async function loadListingOr404(userId: string, listingId: string) {
  const row = await db
    .selectFrom('listings')
    .selectAll()
    .where('id', '=', listingId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (!row) throw new AppError(404, 'Listing not found');
  return row;
}

/**
 * Flip an existing active listing (and every sibling row already sharing its
 * ebay_listing_id/url) to is_multi_qty=true. Idempotent; safe to call on
 * a listing that's already multi-qty.
 */
export async function promoteToMultiQty(userId: string, listingId: string) {
  const listing = await loadListingOr404(userId, listingId);
  if (listing.listing_status !== 'active') throw new AppError(400, 'Only active listings can be promoted to multi-qty');
  const keyCol = groupKeyColOf(listing);
  if (!keyCol) throw new AppError(400, 'Listing needs an eBay listing ID or URL before it can be multi-qty');
  const keyVal = listing[keyCol] as string;

  const siblings = await db
    .selectFrom('listings')
    .selectAll()
    .where('user_id', '=', userId)
    .where(keyCol, '=', keyVal)
    .where('is_multi_qty', '=', false)
    .execute();
  if (siblings.length === 0) return { promoted: 0 };

  await db
    .updateTable('listings')
    .set({ is_multi_qty: true })
    .where('user_id', '=', userId)
    .where(keyCol, '=', keyVal)
    .where('is_multi_qty', '=', false)
    .execute();
  for (const s of siblings) {
    await logAudit(userId, 'listings', s.id, 'updated', s, { ...s, is_multi_qty: true });
  }
  return { promoted: siblings.length };
}

/**
 * Add certs to an existing multi-qty listing. Creates one new listings row
 * per cert, cloning the group's URL / list_price / listed_at / platform /
 * currency / show info / listing_group_* / is_multi_qty=true. Each cert
 * must:
 *   - belong to the caller
 *   - be a graded slab (pre_graded)
 *   - share catalog_id with the parent listing's cert
 *   - not already be on another active listing
 *   - not be personal-collection
 */
export async function addCertsToListing(userId: string, listingId: string, certInstanceIds: string[]) {
  if (certInstanceIds.length === 0) throw new AppError(400, 'Pick at least one cert');
  const parent = await loadListingOr404(userId, listingId);
  if (!parent.is_multi_qty) throw new AppError(400, 'Parent listing is not multi-qty — promote it first');
  // Drained multi-qty parents (all rows sold/cancelled) are valid targets so
  // the user can re-add certs to the same eBay URL without spinning up a
  // fresh listing. Only `is_ended` groups are rejected — that's the explicit
  // user-initiated close.
  if (parent.is_ended) throw new AppError(400, 'This listing has been ended — start a new one to add certs');

  const parentCert = await db
    .selectFrom('card_instances as ci')
    .leftJoin('slab_details as sd', 'sd.card_instance_id', 'ci.id')
    .select(['ci.id', 'ci.catalog_id', 'ci.purchase_type', 'sd.grade_label', 'sd.company'])
    .where('ci.id', '=', parent.card_instance_id)
    .where('ci.user_id', '=', userId)
    .executeTakeFirst();
  if (!parentCert) throw new AppError(404, 'Parent cert not found');
  if (parentCert.purchase_type !== 'pre_graded') throw new AppError(400, 'Multi-qty only supported for graded listings today');

  const certs = await db
    .selectFrom('card_instances as ci')
    .leftJoin('slab_details as sd', 'sd.card_instance_id', 'ci.id')
    .select(['ci.id', 'ci.catalog_id', 'ci.purchase_type', 'ci.is_personal_collection', 'ci.status', 'sd.grade_label', 'sd.company'])
    .where('ci.user_id', '=', userId)
    .where('ci.id', 'in', certInstanceIds)
    .execute();
  if (certs.length !== certInstanceIds.length) throw new AppError(404, 'One or more certs not found');

  for (const c of certs) {
    if (c.id === parent.card_instance_id) throw new AppError(400, 'Parent cert is already on this listing');
    if (c.purchase_type !== 'pre_graded') throw new AppError(400, 'Only graded slabs can be added to a graded multi-qty listing');
    if (c.is_personal_collection) throw new AppError(400, 'Personal collection cards cannot be listed');
    if (c.catalog_id !== parentCert.catalog_id) throw new AppError(400, 'All certs must share the same catalog entry as the parent listing');
    if (c.grade_label !== parentCert.grade_label) throw new AppError(400, 'All certs must share the same grade as the parent listing');
    if (c.company !== parentCert.company) throw new AppError(400, 'All certs must share the same slab company as the parent listing');
  }

  const existingActive = await db
    .selectFrom('listings')
    .select('card_instance_id')
    .where('user_id', '=', userId)
    .where('card_instance_id', 'in', certInstanceIds)
    .where('listing_status', '=', 'active')
    .execute();
  if (existingActive.length > 0) {
    throw new AppError(409, `${existingActive.length} cert(s) already have an active listing`);
  }

  const rowsToInsert = certInstanceIds.map((cid) => ({
    user_id: userId,
    card_instance_id: cid,
    platform: parent.platform,
    listing_status: 'active' as const,
    ebay_listing_id: parent.ebay_listing_id,
    ebay_listing_url: parent.ebay_listing_url,
    show_name: parent.show_name,
    show_date: parent.show_date,
    booth_cost: parent.booth_cost,
    list_price: parent.list_price,
    asking_price: parent.asking_price,
    currency: parent.currency,
    listed_at: parent.listed_at,
    listing_group_id: parent.listing_group_id,
    listing_group_name: parent.listing_group_name,
    is_multi_qty: true,
  }));
  const created = await db
    .insertInto('listings')
    .values(rowsToInsert)
    .returningAll()
    .execute();
  for (const row of created) {
    await logAudit(userId, 'listings', row.id, 'created', null, row);
  }
  return { added: created.length, listing_ids: created.map((r) => r.id) };
}

export type MultiQtyCandidate = {
  id: string;
  card_name: string | null;
  cert_number: string | null;
  grade_label: string | null;
  company: string | null;
  purchase_cost: number;
};

/**
 * Certs eligible to be added to a multi-qty listing: same catalog + same
 * grade + same slab company as the parent listing's cert, graded, owned,
 * not on another active listing, not in personal collection. Grade + company
 * are part of the match because a multi-qty eBay listing represents ONE
 * item — a PSA 10 pool must not absorb a PSA 9 copy of the same card.
 * Powers the "Add cert" picker.
 */
export async function listCandidateCertsForListing(userId: string, listingId: string): Promise<MultiQtyCandidate[]> {
  const parent = await loadListingOr404(userId, listingId);
  const parentInfo = await db
    .selectFrom('card_instances as ci')
    .leftJoin('slab_details as sd', 'sd.card_instance_id', 'ci.id')
    .select(['ci.id', 'ci.catalog_id', 'sd.grade_label', 'sd.company'])
    .where('ci.id', '=', parent.card_instance_id)
    .where('ci.user_id', '=', userId)
    .executeTakeFirst();
  if (!parentInfo) throw new AppError(404, 'Parent cert not found');

  const rows = await sql<MultiQtyCandidate>`
    SELECT
      ci.id,
      COALESCE(ci.card_name_override, cc.card_name) AS card_name,
      sd.cert_number,
      sd.grade_label,
      sd.company,
      ci.purchase_cost
    FROM card_instances ci
    LEFT JOIN card_catalog cc ON cc.id = ci.catalog_id
    INNER JOIN slab_details sd ON sd.card_instance_id = ci.id
    WHERE ci.user_id = ${userId}
      AND ci.catalog_id ${parentInfo.catalog_id === null ? sql`IS NULL` : sql`= ${parentInfo.catalog_id}`}
      AND sd.grade_label ${parentInfo.grade_label === null ? sql`IS NULL` : sql`= ${parentInfo.grade_label}`}
      AND sd.company     ${parentInfo.company     === null ? sql`IS NULL` : sql`= ${parentInfo.company}`}
      AND ci.purchase_type = 'pre_graded'
      AND ci.status != 'sold'
      AND ci.is_personal_collection = false
      AND ci.id != ${parent.card_instance_id}
      AND NOT EXISTS (
        SELECT 1 FROM listings l2
        WHERE l2.card_instance_id = ci.id
          AND l2.listing_status = 'active'
      )
    ORDER BY ci.created_at
  `.execute(db);
  return rows.rows;
}

/**
 * End every active row on the same multi-qty group. Sold rows are left
 * untouched — their sales rows still point at them for receipt history.
 * Unsold cert instances aren't demoted here; the same status logic used by
 * cancelSingleListing already covers "no more active listings → drop back to
 * raw", but for graded slabs (the only supported type) that transition is a
 * no-op because slabs stay `graded` regardless of listing state.
 */
export async function cancelMultiQtyGroup(userId: string, listingId: string) {
  const listing = await loadListingOr404(userId, listingId);
  if (!listing.is_multi_qty) throw new AppError(400, 'Not a multi-qty listing — use the single-listing cancel endpoint');
  const keyCol = groupKeyColOf(listing);
  if (!keyCol) throw new AppError(400, 'Multi-qty listing is missing its group key (ebay id/url)');
  const keyVal = listing[keyCol] as string;

  const active = await db
    .selectFrom('listings')
    .selectAll()
    .where('user_id', '=', userId)
    .where(keyCol, '=', keyVal)
    .where('is_multi_qty', '=', true)
    .where('listing_status', '=', 'active')
    .execute();
  if (active.length === 0) return { cancelled: 0 };

  const ids = active.map((r) => r.id);
  await db
    .updateTable('listings')
    .set({ listing_status: 'cancelled' })
    .where('id', 'in', ids)
    .execute();
  for (const row of active) {
    await logAudit(userId, 'listings', row.id, 'updated', row, { ...row, listing_status: 'cancelled' as const });
  }
  return { cancelled: active.length };
}

/**
 * User-initiated close of a persistent multi-qty listing. Flips
 * `is_ended=true` on every row sharing the group's ebay id/url — sold rows
 * stay sold (sales trail preserved), the group stops appearing in the
 * Listings aggregation, and addCertsToListing rejects further adds. This is
 * a group-level intent flag, not a cert-level state; cert rows keep their
 * own listing_status. Idempotent — calling on an already-ended group is a
 * no-op.
 */
export async function endMultiQtyListing(userId: string, listingId: string) {
  const listing = await loadListingOr404(userId, listingId);
  if (!listing.is_multi_qty) throw new AppError(400, 'Not a multi-qty listing');
  const keyCol = groupKeyColOf(listing);
  if (!keyCol) throw new AppError(400, 'Multi-qty listing is missing its group key (ebay id/url)');
  const keyVal = listing[keyCol] as string;

  const rows = await db
    .selectFrom('listings')
    .selectAll()
    .where('user_id', '=', userId)
    .where(keyCol, '=', keyVal)
    .where('is_multi_qty', '=', true)
    .where('is_ended', '=', false)
    .execute();
  if (rows.length === 0) return { ended: 0 };

  // Also cancel any lingering active rows so the sales trail is consistent:
  // we're closing the URL, so any still-active cert should go cancelled
  // rather than staying floating.
  const ids = rows.map(r => r.id);
  await db
    .updateTable('listings')
    .set({
      is_ended: true,
      // Only touch listing_status for rows still active — sold/cancelled rows
      // keep their historical state.
    })
    .where('id', 'in', ids)
    .execute();
  const activeIds = rows.filter(r => r.listing_status === 'active').map(r => r.id);
  if (activeIds.length > 0) {
    await db
      .updateTable('listings')
      .set({ listing_status: 'cancelled' })
      .where('id', 'in', activeIds)
      .execute();
  }
  for (const row of rows) {
    const after = {
      ...row,
      is_ended: true,
      ...(row.listing_status === 'active' ? { listing_status: 'cancelled' as const } : {}),
    };
    await logAudit(userId, 'listings', row.id, 'updated', row, after);
  }
  return { ended: rows.length };
}

// ────────────────────────────────────────────────────────────────────────────
// Set listings — Add Copy
//
// Users want to sell the same set N times without maintaining N parallel
// eBay listings. The flow: pick a parent set (existing listing_group_id),
// walk each of its member cards as a "slot" with a strict identity
// (catalog_id + grade_label + company), and let the user fill each slot
// with another matching unsold slab. The new copy spawns its own
// listing_group_id but shares the parent's ebay_listing_id/url + per-cert
// list_price, and both the parent's rows and the new rows flip to
// is_multi_qty=true so aggregation can collapse them under one URL later.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Flip is_multi_qty=true on every row in a set group AND every sibling on
 * the same eBay id/url. Mirrors promoteToMultiQty for single listings so
 * user can pre-mark a set as multi-qty before adding copies (and, once
 * flipped, the group persists as SOLD OUT after all copies sell). Safe to
 * call on an already-multi-qty set (returns { promoted: 0 }).
 */
export async function promoteSetToMultiQty(userId: string, groupId: string) {
  const rows = await db
    .selectFrom('listings')
    .selectAll()
    .where('user_id', '=', userId)
    .where('listing_group_id', '=', groupId)
    .execute();
  if (rows.length === 0) throw new AppError(404, 'Set listing not found');

  const promoted: typeof rows = [];
  const seenKeys = new Set<string>();
  for (const r of rows) {
    const keyCol = r.ebay_listing_id ? 'ebay_listing_id' as const
      : r.ebay_listing_url ? 'ebay_listing_url' as const
      : null;
    if (!keyCol) continue;
    const keyVal = r[keyCol] as string;
    const keyKey = `${keyCol}:${keyVal}`;
    if (seenKeys.has(keyKey)) continue;
    seenKeys.add(keyKey);
    const siblings = await db
      .selectFrom('listings')
      .selectAll()
      .where('user_id', '=', userId)
      .where(keyCol, '=', keyVal)
      .where('is_multi_qty', '=', false)
      .execute();
    if (siblings.length === 0) continue;
    await db
      .updateTable('listings')
      .set({ is_multi_qty: true })
      .where('user_id', '=', userId)
      .where(keyCol, '=', keyVal)
      .where('is_multi_qty', '=', false)
      .execute();
    for (const s of siblings) {
      await logAudit(userId, 'listings', s.id, 'updated', s, { ...s, is_multi_qty: true });
    }
    promoted.push(...siblings);
  }
  return { promoted: promoted.length };
}

/**
 * User-initiated close of a persistent multi-qty set listing — flip
 * is_ended=true on every row sharing the eBay id/url. Sold rows keep their
 * historical status; any still-active gets cancelled as part of the close.
 */
export async function endMultiQtySet(userId: string, groupId: string) {
  const anyRow = await db
    .selectFrom('listings')
    .selectAll()
    .where('user_id', '=', userId)
    .where('listing_group_id', '=', groupId)
    .executeTakeFirst();
  if (!anyRow) throw new AppError(404, 'Set listing not found');
  if (!anyRow.is_multi_qty) throw new AppError(400, 'Not a multi-qty set — promote it first');

  const keyCol = anyRow.ebay_listing_id ? 'ebay_listing_id' as const
    : anyRow.ebay_listing_url ? 'ebay_listing_url' as const
    : null;
  if (!keyCol) throw new AppError(400, 'Multi-qty set is missing its group key (ebay id/url)');
  const keyVal = anyRow[keyCol] as string;

  const rows = await db
    .selectFrom('listings')
    .selectAll()
    .where('user_id', '=', userId)
    .where(keyCol, '=', keyVal)
    .where('is_multi_qty', '=', true)
    .where('is_ended', '=', false)
    .execute();
  if (rows.length === 0) return { ended: 0 };

  const ids = rows.map(r => r.id);
  await db
    .updateTable('listings')
    .set({ is_ended: true })
    .where('id', 'in', ids)
    .execute();
  const activeIds = rows.filter(r => r.listing_status === 'active').map(r => r.id);
  if (activeIds.length > 0) {
    await db
      .updateTable('listings')
      .set({ listing_status: 'cancelled' })
      .where('id', 'in', activeIds)
      .execute();
  }
  for (const row of rows) {
    const after = {
      ...row,
      is_ended: true,
      ...(row.listing_status === 'active' ? { listing_status: 'cancelled' as const } : {}),
    };
    await logAudit(userId, 'listings', row.id, 'updated', row, after);
  }
  return { ended: rows.length };
}

export interface SetCopySlot {
  slot_index: number;
  catalog_id: string | null;
  grade_label: string | null;
  company: string | null;
  card_name: string | null;
  set_name: string | null;
  card_number: string | null;
  candidates: {
    card_instance_id: string;
    cert_number: string | null;
    grade_label: string | null;
    company: string | null;
    raw_purchase_label: string | null;
    purchase_cost: number;
  }[];
}
export interface SetCopyContext {
  listing_group_id: string;
  listing_group_name: string | null;
  ebay_listing_id: string | null;
  ebay_listing_url: string | null;
  parent_total_list_price: number;   // sum of per-cert list_prices on the parent
  slots: SetCopySlot[];
}

/**
 * Load the parent set's composition + a candidate list per slot. Candidates
 * are the caller's own unsold, unlisted, non-personal-collection slabs that
 * match the slot's (catalog_id, grade_label, company).
 */
export async function listSetCopySlots(userId: string, groupId: string): Promise<SetCopyContext> {
  const parentRows = await sql<{
    ci_id: string;
    catalog_id: string | null;
    grade_label: string | null;
    company: string | null;
    card_name: string | null;
    set_name: string | null;
    card_number: string | null;
    listing_group_name: string | null;
    ebay_listing_id: string | null;
    ebay_listing_url: string | null;
    list_price: number;
    listed_at: Date | null;
  }>`
    SELECT ci.id AS ci_id, ci.catalog_id, sd.grade_label, sd.company,
      COALESCE(ci.card_name_override, cc.card_name) AS card_name,
      COALESCE(cc.set_name, ci.set_name_override) AS set_name,
      COALESCE(cc.card_number, ci.card_number_override) AS card_number,
      l.listing_group_name, l.ebay_listing_id, l.ebay_listing_url, l.list_price,
      l.listed_at
    FROM listings l
    JOIN card_instances ci ON ci.id = l.card_instance_id
    LEFT JOIN card_catalog cc ON cc.id = ci.catalog_id
    LEFT JOIN slab_details sd ON sd.card_instance_id = ci.id
    WHERE l.user_id = ${userId}
      AND l.listing_group_id = ${groupId}
      AND sd.id IS NOT NULL
    ORDER BY l.listed_at ASC NULLS LAST, l.id ASC
  `.execute(db);
  if (parentRows.rows.length === 0) throw new AppError(404, 'Set listing not found');

  const parentTotalListPrice = parentRows.rows.reduce((s, r) => s + r.list_price, 0);

  // Build slots + candidate lookups. Query candidates once per slot with an
  // OR-fanout keyed by (catalog_id, grade_label, company). Filter to only
  // slabs not already on any active listing.
  const slots: SetCopySlot[] = [];
  for (let i = 0; i < parentRows.rows.length; i++) {
    const row = parentRows.rows[i];
    const candidates = await sql<{
      card_instance_id: string;
      cert_number: string | null;
      grade_label: string | null;
      company: string | null;
      raw_purchase_label: string | null;
      purchase_cost: number;
    }>`
      SELECT ci.id AS card_instance_id, sd.cert_number, sd.grade_label, sd.company,
        rp.purchase_id AS raw_purchase_label, ci.purchase_cost
      FROM card_instances ci
      INNER JOIN slab_details sd ON sd.card_instance_id = ci.id
      LEFT JOIN raw_purchases rp ON rp.id = ci.raw_purchase_id
      WHERE ci.user_id = ${userId}
        AND ci.purchase_type = 'pre_graded'
        AND ci.status != 'sold'
        AND ci.is_personal_collection = false
        AND ci.catalog_id ${row.catalog_id === null ? sql`IS NULL` : sql`= ${row.catalog_id}`}
        AND sd.grade_label ${row.grade_label === null ? sql`IS NULL` : sql`= ${row.grade_label}`}
        AND sd.company     ${row.company === null ? sql`IS NULL` : sql`= ${row.company}`}
        AND NOT EXISTS (
          SELECT 1 FROM listings l2
          WHERE l2.card_instance_id = ci.id
            AND l2.listing_status = 'active'
        )
      ORDER BY sd.cert_number ASC
    `.execute(db);
    slots.push({
      slot_index: i,
      catalog_id: row.catalog_id,
      grade_label: row.grade_label,
      company: row.company,
      card_name: row.card_name,
      set_name: row.set_name,
      card_number: row.card_number,
      candidates: candidates.rows,
    });
  }

  const first = parentRows.rows[0];
  return {
    listing_group_id: groupId,
    listing_group_name: first.listing_group_name,
    ebay_listing_id: first.ebay_listing_id,
    ebay_listing_url: first.ebay_listing_url,
    parent_total_list_price: parentTotalListPrice,
    slots,
  };
}

/**
 * Create a new copy of the set: N new listings rows sharing a fresh
 * listing_group_id but the parent's ebay_listing_id/url + per-cert
 * list_price. Slot order matches the parent set's slot order — callers pass
 * an array of card_instance_ids in that same order. Server validates each
 * slot's (catalog_id, grade_label, company) matches its picked slab and no
 * slab is already on an active listing. On success, every row sharing the
 * parent's ebay id/url is promoted to is_multi_qty=true so the aggregation
 * layer knows to collapse them.
 */
export async function addSetCopy(userId: string, groupId: string, cardInstanceIdsRaw: string[]) {
  const ctx = await listSetCopySlots(userId, groupId);
  if (cardInstanceIdsRaw.length !== ctx.slots.length) {
    throw new AppError(400, `Set has ${ctx.slots.length} slots — got ${cardInstanceIdsRaw.length} certs`);
  }

  // Auto-map the picked certs to slot order by identity so callers can send
  // ids in any order. Reject on any slot with no matching cert (unmatched
  // identity) or on duplicate assignments to the same slot.
  const chosenIdentities = await sql<{
    id: string;
    catalog_id: string | null;
    grade_label: string | null;
    company: string | null;
  }>`
    SELECT ci.id, ci.catalog_id, sd.grade_label, sd.company
    FROM card_instances ci
    LEFT JOIN slab_details sd ON sd.card_instance_id = ci.id
    WHERE ci.user_id = ${userId}
      AND ci.id IN (${sql.join(cardInstanceIdsRaw.map(id => sql.val(id)))})
  `.execute(db);
  if (chosenIdentities.rows.length !== cardInstanceIdsRaw.length) {
    throw new AppError(404, 'One or more certs not found');
  }
  const used = new Set<string>();
  const cardInstanceIds: string[] = [];
  for (const slot of ctx.slots) {
    const match = chosenIdentities.rows.find(c =>
      c.catalog_id === slot.catalog_id &&
      c.grade_label === slot.grade_label &&
      c.company === slot.company &&
      !used.has(c.id)
    );
    if (!match) throw new AppError(400, `No matching cert for slot ${slot.slot_index + 1} (${slot.card_name ?? 'unknown'} · ${slot.company ?? ''} ${slot.grade_label ?? ''})`);
    used.add(match.id);
    cardInstanceIds.push(match.id);
  }

  // Load parent rows to copy per-cert list_price + platform/currency/listed_at.
  const parentRows = await db
    .selectFrom('listings')
    .selectAll()
    .where('user_id', '=', userId)
    .where('listing_group_id', '=', groupId)
    .orderBy('listed_at', 'asc')
    .orderBy('id', 'asc')
    .execute();
  if (parentRows.length !== ctx.slots.length) {
    throw new AppError(500, 'Parent set row count drifted from slot count — refresh and retry');
  }

  // Fetch chosen certs + slab_details in one shot, then validate.
  const chosen = await sql<{
    id: string;
    catalog_id: string | null;
    status: string;
    is_personal_collection: boolean;
    purchase_type: string;
    grade_label: string | null;
    company: string | null;
  }>`
    SELECT ci.id, ci.catalog_id, ci.status, ci.is_personal_collection, ci.purchase_type,
      sd.grade_label, sd.company
    FROM card_instances ci
    LEFT JOIN slab_details sd ON sd.card_instance_id = ci.id
    WHERE ci.user_id = ${userId}
      AND ci.id IN (${sql.join(cardInstanceIds.map(id => sql.val(id)))})
  `.execute(db);
  const chosenById = new Map(chosen.rows.map(r => [r.id, r]));

  for (let i = 0; i < cardInstanceIds.length; i++) {
    const id = cardInstanceIds[i];
    const slot = ctx.slots[i];
    const c = chosenById.get(id);
    if (!c) throw new AppError(404, `Slot ${i + 1}: cert not found`);
    if (c.purchase_type !== 'pre_graded') throw new AppError(400, `Slot ${i + 1}: cert is not a graded slab`);
    if (c.status === 'sold') throw new AppError(400, `Slot ${i + 1}: cert is already sold`);
    if (c.is_personal_collection) throw new AppError(400, `Slot ${i + 1}: cert is in personal collection`);
    if (c.catalog_id !== slot.catalog_id) throw new AppError(400, `Slot ${i + 1}: cert catalog doesn't match slot`);
    if (c.grade_label !== slot.grade_label) throw new AppError(400, `Slot ${i + 1}: cert grade doesn't match slot`);
    if (c.company !== slot.company) throw new AppError(400, `Slot ${i + 1}: cert company doesn't match slot`);
  }

  // No slab may already be on an active listing.
  const conflicting = await db
    .selectFrom('listings')
    .select('card_instance_id')
    .where('user_id', '=', userId)
    .where('card_instance_id', 'in', cardInstanceIds)
    .where('listing_status', '=', 'active')
    .execute();
  if (conflicting.length > 0) throw new AppError(409, `${conflicting.length} cert(s) already have an active listing`);

  // Create the new copy: fresh listing_group_id, same ebay id/url + per-cert
  // list_price copied from the parent's row at the same slot index.
  const newGroupId = crypto.randomUUID();
  const rowsToInsert = cardInstanceIds.map((cid, i) => ({
    user_id: userId,
    card_instance_id: cid,
    platform: parentRows[i].platform,
    listing_status: 'active' as const,
    ebay_listing_id: parentRows[i].ebay_listing_id,
    ebay_listing_url: parentRows[i].ebay_listing_url,
    show_name: parentRows[i].show_name,
    show_date: parentRows[i].show_date,
    booth_cost: parentRows[i].booth_cost,
    list_price: parentRows[i].list_price,
    asking_price: parentRows[i].asking_price,
    currency: parentRows[i].currency,
    listed_at: parentRows[i].listed_at,
    listing_group_id: newGroupId,
    listing_group_name: parentRows[i].listing_group_name,
    is_multi_qty: true,
  }));
  const created = await db.insertInto('listings').values(rowsToInsert).returningAll().execute();
  for (const row of created) {
    await logAudit(userId, 'listings', row.id, 'created', null, row);
  }

  // Promote every row sharing the parent's ebay id/url to multi-qty so the
  // aggregation layer collapses copies. Skip if there's no eBay identifier
  // (rare — a set without an eBay URL still gets multi-qty on the group's
  // own rows, matched via listing_group_id).
  const promoteKeyCol = parentRows[0].ebay_listing_id
    ? 'ebay_listing_id' as const
    : parentRows[0].ebay_listing_url
      ? 'ebay_listing_url' as const
      : null;
  if (promoteKeyCol) {
    const keyVal = parentRows[0][promoteKeyCol]!;
    const siblings = await db
      .selectFrom('listings')
      .selectAll()
      .where('user_id', '=', userId)
      .where(promoteKeyCol, '=', keyVal)
      .where('is_multi_qty', '=', false)
      .execute();
    if (siblings.length > 0) {
      await db
        .updateTable('listings')
        .set({ is_multi_qty: true })
        .where('user_id', '=', userId)
        .where(promoteKeyCol, '=', keyVal)
        .where('is_multi_qty', '=', false)
        .execute();
      for (const s of siblings) {
        await logAudit(userId, 'listings', s.id, 'updated', s, { ...s, is_multi_qty: true });
      }
    }
  }

  return { new_group_id: newGroupId, added: created.length };
}
