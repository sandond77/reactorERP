import { sql } from 'kysely';
import { db } from '../config/database';
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination';
import type { PaginationParams } from '../utils/pagination';

// Build a word-split fuzzy search clause.
//
// Default: each token must appear in the name (AND logic) — good for
// card-name searches like "Charizard EX Base Set".
//
// Special-case: if the caller pasted 2+ tokens AND every token looks
// like a pure cert number (>=3 digits, digits only), switch to an
// OR match against certExpr with EXACT equality. Otherwise the AND
// joins reduce to zero for any real pasted cert list. Split delimiter
// widens to whitespace / comma / semicolon so a pasted "1,2,3" or
// "1; 2; 3" or "1 2 3" all work.
function fuzzyNameClause(search: string | undefined, nameExpr: string, certExpr?: string) {
  if (!search) return sql``;
  const words = search.trim().split(/[\s,;]+/).filter(Boolean);
  if (words.length === 0) return sql``;

  if (certExpr && words.length >= 2 && words.every(w => /^\d{3,}$/.test(w))) {
    const or = words.map(w => sql`${sql.raw(certExpr)} = ${w}`);
    return sql`AND (${sql.join(or, sql` OR `)})`;
  }

  const parts = words.map((w) => {
    const term = `%${w}%`;
    if (certExpr) {
      return sql`AND (${sql.raw(nameExpr)} ILIKE ${term} OR ${sql.raw(certExpr)} ILIKE ${term})`;
    }
    return sql`AND ${sql.raw(nameExpr)} ILIKE ${term}`;
  });
  return sql.join(parts, sql` `);
}

// Whitelist of sortable columns → SQL expression
const SLAB_SORT_COLS: Record<string, string> = {
  cert_number:       'sd.cert_number::bigint',
  card_name:         'COALESCE(ci.card_name_override, cc.card_name)',
  grade:             'sd.grade',
  is_listed:         '(l.id IS NOT NULL)',
  listed_price:      'l.list_price',
  raw_cost:          'ci.purchase_cost',
  grading_cost:      'sd.grading_cost',
  strike_price:      's.sale_price',
  after_ebay:        'CASE WHEN s.platform = \'ebay\' THEN (s.sale_price - s.platform_fees - s.shipping_cost) ELSE s.sale_price END',
  net:               'CASE WHEN s.platform = \'ebay\' THEN (s.sale_price - s.platform_fees - s.shipping_cost) ELSE s.sale_price END - ci.purchase_cost - sd.grading_cost',
  raw_purchase_date: 'ci.purchased_at',
  date_listed:       'l.listed_at',
  date_sold:         's.sold_at',
  roi_pct:           'ROUND((CASE WHEN s.platform = \'ebay\' THEN s.sale_price - s.platform_fees - s.shipping_cost ELSE s.sale_price END - ci.purchase_cost - sd.grading_cost)::numeric / NULLIF(ci.purchase_cost + sd.grading_cost, 0) * 100, 2)',
};

export async function getSlabFilterOptions(userId: string) {
  const [companies, grades, purchaseYears, listedYears, soldYears] = await Promise.all([
    sql<{ value: string }>`
      SELECT DISTINCT sd.company AS value
      FROM slab_details sd
      INNER JOIN card_instances ci ON ci.id = sd.card_instance_id
      WHERE ci.user_id = ${userId}
      ORDER BY value
    `.execute(db),

    sql<{ value: string }>`
      SELECT DISTINCT sd.grade_label AS value
      FROM slab_details sd
      INNER JOIN card_instances ci ON ci.id = sd.card_instance_id
      WHERE ci.user_id = ${userId} AND sd.grade_label IS NOT NULL
      ORDER BY value
    `.execute(db),

    sql<{ value: string }>`
      SELECT DISTINCT EXTRACT(YEAR FROM ci.purchased_at)::int::text AS value
      FROM card_instances ci
      INNER JOIN slab_details sd ON sd.card_instance_id = ci.id
      WHERE ci.user_id = ${userId} AND ci.purchased_at IS NOT NULL
        AND EXTRACT(YEAR FROM ci.purchased_at) >= 2000
      ORDER BY value
    `.execute(db),

    sql<{ value: string }>`
      SELECT DISTINCT EXTRACT(YEAR FROM l.listed_at)::int::text AS value
      FROM listings l
      INNER JOIN card_instances ci ON ci.id = l.card_instance_id
      INNER JOIN slab_details sd ON sd.card_instance_id = ci.id
      WHERE ci.user_id = ${userId} AND l.listed_at IS NOT NULL
        AND EXTRACT(YEAR FROM l.listed_at) >= 2000
      ORDER BY value
    `.execute(db),

    sql<{ value: string }>`
      SELECT DISTINCT EXTRACT(YEAR FROM s.sold_at)::int::text AS value
      FROM sales s
      INNER JOIN card_instances ci ON ci.id = s.card_instance_id
      INNER JOIN slab_details sd ON sd.card_instance_id = ci.id
      WHERE ci.user_id = ${userId}
        AND EXTRACT(YEAR FROM s.sold_at) >= 2000
      ORDER BY value
    `.execute(db),
  ]);

  return {
    companies: companies.rows.map((r) => r.value),
    grades: grades.rows.map((r) => r.value),
    listed: ['Yes', 'No'],
    card_show: ['Yes', 'No'],
    personal_collection: ['Yes', 'No'],
    purchase_years: purchaseYears.rows.map((r) => r.value),
    listed_years: listedYears.rows.map((r) => r.value),
    sold_years: soldYears.rows.map((r) => r.value),
  };
}

export async function listSlabs(
  userId: string,
  pagination: PaginationParams,
  search?: string,
  statusFilter?: 'graded' | 'sold' | 'unsold' | 'all',
  sortBy?: string,
  sortDir?: 'asc' | 'desc',
  filterCompanies?: string[] | undefined,
  filterGrades?: string[] | undefined,
  isListed?: string,
  isCardShow?: string,
  purchaseYears?: string[],
  listedYears?: string[],
  soldYears?: string[],
  personalCollection?: string,
  forSale?: string,
  purchaseDates?: string[],
  listedDates?: string[],
  soldDates?: string[],
  inSetListing?: string
) {
  const offset = getPaginationOffset(pagination.page, pagination.limit);
  const status = statusFilter === 'all' || !statusFilter ? null : statusFilter;
  const unsold = statusFilter === 'unsold';
  const sortExpr = SLAB_SORT_COLS[sortBy ?? ''] ?? 'ci.created_at';
  const dir = sortDir === 'asc' ? sql`ASC` : sql`DESC`;

  const companyIn    = filterCompanies === undefined ? sql`` : filterCompanies.length ? sql`AND sd.company     IN (${sql.join(filterCompanies.map((v) => sql.val(v)))})` : sql`AND 1=0`;
  const gradeIn      = filterGrades    === undefined ? sql`` : filterGrades.length    ? sql`AND sd.grade_label IN (${sql.join(filterGrades.map((v) => sql.val(v)))})` : sql`AND 1=0`;
  const listedCond   = isListed === 'yes' ? sql`AND EXISTS (SELECT 1 FROM listings l2 WHERE l2.card_instance_id = ci.id AND l2.listing_status = 'active')`
                     : isListed === 'no'  ? sql`AND NOT EXISTS (SELECT 1 FROM listings l2 WHERE l2.card_instance_id = ci.id AND l2.listing_status = 'active')`
                     : sql``;
  const cardShowCond = isCardShow === 'yes' ? sql`AND ci.is_card_show = true`
                     : isCardShow === 'no'  ? sql`AND ci.is_card_show = false`
                     : sql``;
  const personalCollectionCond = personalCollection === 'yes' ? sql`AND ci.is_personal_collection = true`
                                : personalCollection === 'no'  ? sql`AND ci.is_personal_collection = false`
                                : sql``;
  const forSaleCond = forSale === 'yes'
    ? sql`AND (EXISTS (SELECT 1 FROM listings l2 WHERE l2.card_instance_id = ci.id AND l2.listing_status = 'active') OR ci.is_card_show = true)`
    : sql``;
  const inSetListingCond = inSetListing === 'yes'
    ? sql`AND EXISTS (SELECT 1 FROM listings l2 WHERE l2.card_instance_id = ci.id AND l2.listing_status = 'active' AND l2.listing_group_id IS NOT NULL)`
    : sql``;
  const purchaseYearIn   = purchaseYears === undefined ? sql`` : purchaseYears.length ? sql`AND EXTRACT(YEAR FROM ci.purchased_at AT TIME ZONE 'UTC')::int::text IN (${sql.join(purchaseYears.map((v) => sql.val(v)))})` : sql`AND 1=0`;
  const listedYearIn     = listedYears   === undefined ? sql`` : listedYears.length   ? sql`AND EXISTS (SELECT 1 FROM listings l2 WHERE l2.card_instance_id = ci.id AND EXTRACT(YEAR FROM l2.listed_at AT TIME ZONE 'UTC')::int::text IN (${sql.join(listedYears.map((v) => sql.val(v)))}))` : sql`AND 1=0`;
  const soldYearIn       = soldYears     === undefined ? sql`` : soldYears.length     ? sql`AND EXISTS (SELECT 1 FROM sales s2 WHERE s2.card_instance_id = ci.id AND EXTRACT(YEAR FROM s2.sold_at AT TIME ZONE 'UTC')::int::text IN (${sql.join(soldYears.map((v) => sql.val(v)))}))` : sql`AND 1=0`;
  const purchaseDateCond = purchaseDates?.length ? sql`AND (ci.purchased_at AT TIME ZONE 'UTC')::date IN (${sql.join(purchaseDates.map((v) => sql`${v}::date`))})` : sql``;
  const listedDateCond   = listedDates?.length   ? sql`AND EXISTS (SELECT 1 FROM listings l2 WHERE l2.card_instance_id = ci.id AND (l2.listed_at AT TIME ZONE 'UTC')::date IN (${sql.join(listedDates.map((v) => sql`${v}::date`))}))` : sql``;
  const soldDateCond     = soldDates?.length      ? sql`AND EXISTS (SELECT 1 FROM sales s2 WHERE s2.card_instance_id = ci.id AND (s2.sold_at AT TIME ZONE 'UTC')::date IN (${sql.join(soldDates.map((v) => sql`${v}::date`))}))` : sql``;

  const countResult = await sql<{ count: string }>`
    SELECT COUNT(*) AS count
    FROM card_instances ci
    INNER JOIN slab_details sd ON sd.card_instance_id = ci.id
    WHERE ci.user_id = ${userId}
    ${unsold ? sql`AND ci.status != 'sold'` : status === 'graded' ? sql`AND ci.status IN ('graded', 'sold')` : status ? sql`AND ci.status = ${status}` : sql``}
    ${fuzzyNameClause(search, 'ci.card_name_override', 'sd.cert_number::text')}
    ${companyIn} ${gradeIn} ${listedCond} ${cardShowCond} ${personalCollectionCond} ${purchaseYearIn} ${listedYearIn} ${soldYearIn} ${forSaleCond} ${inSetListingCond} ${purchaseDateCond} ${listedDateCond} ${soldDateCond}
  `.execute(db);

  const total = Number(countResult.rows[0]?.count ?? 0);

  const rows = await sql<{
    id: string;
    card_name: string | null;
    set_name: string | null;
    cert_number: string | null;
    grade_label: string | null;
    numeric_grade: number | null;
    company: string;
    is_listed: boolean;
    listed_price: number | null;
    listing_url: string | null;
    listing_platform: string | null;
    listing_id: string | null;
    is_set_listing: boolean;
    raw_cost: number;
    grading_cost: number;
    strike_price: number | null;
    after_ebay: number | null;
    raw_purchase_date: string | null;
    date_listed: string | null;
    date_sold: string | null;
    roi_pct: number | null;
    notes: string | null;
    is_card_show: boolean;
    card_show_price: number | null;
    is_personal_collection: boolean;
    order_details_link: string | null;
    location_name: string | null;
    location_id: string | null;
    raw_purchase_label: string | null;
    sku: string | null;
  }>`
    SELECT
      ci.id,
      COALESCE(ci.card_name_override, cc.card_name)  AS card_name,
      COALESCE(cc.set_name,  ci.set_name_override)   AS set_name,
      sd.cert_number,
      sd.grade_label,
      sd.grade                                        AS numeric_grade,
      sd.company,
      (l.id IS NOT NULL)                              AS is_listed,
      l.list_price                                    AS listed_price,
      l.ebay_listing_url                              AS listing_url,
      l.platform                                      AS listing_platform,
      l.id                                            AS listing_id,
      -- A "set listing" is an eBay URL that holds active listings for
      -- multiple DIFFERENT cards. Multiple copies of the SAME card sharing
      -- the URL (a multi-qty single listing) is NOT a set. We detect by
      -- checking for any sibling active listing under the same URL whose
      -- card identity differs from this one.
      COALESCE((
        l.ebay_listing_url IS NOT NULL AND EXISTS (
          SELECT 1
          FROM listings l2
          JOIN card_instances ci2 ON ci2.id = l2.card_instance_id
          LEFT JOIN card_catalog cc2 ON cc2.id = ci2.catalog_id
          WHERE l2.ebay_listing_url = l.ebay_listing_url
            AND l2.listing_status = 'active'
            AND l2.id <> l.id
            AND COALESCE(ci2.card_name_override, cc2.card_name) IS DISTINCT FROM
                COALESCE(ci.card_name_override, cc.card_name)
        )
      ), false)                                       AS is_set_listing,
      ci.purchase_cost                                AS raw_cost,
      sd.grading_cost,
      s.sale_price                                    AS strike_price,
      CASE
        WHEN s.sale_price IS NOT NULL AND s.platform = 'ebay'
          THEN s.sale_price - s.platform_fees - s.shipping_cost
        WHEN s.sale_price IS NOT NULL
          THEN s.sale_price
        ELSE NULL
      END                                             AS after_ebay,
      (ci.purchased_at AT TIME ZONE 'UTC')::date      AS raw_purchase_date,
      (l.listed_at AT TIME ZONE 'UTC')::date          AS date_listed,
      (s.sold_at AT TIME ZONE 'UTC')::date            AS date_sold,
      CASE
        WHEN (ci.purchase_cost + sd.grading_cost) > 0 AND s.sale_price IS NOT NULL
        THEN ROUND(
          (CASE WHEN s.platform = 'ebay'
            THEN s.sale_price - s.platform_fees - s.shipping_cost
            ELSE s.sale_price END
           - ci.purchase_cost - sd.grading_cost)::numeric
          / (ci.purchase_cost + sd.grading_cost) * 100, 2
        )
        ELSE NULL
      END                                             AS roi_pct,
      ci.notes,
      ci.is_card_show,
      ci.card_show_price,
      ci.is_personal_collection,
      s.order_details_link,
      loc.name AS location_name,
      ci.location_id,
      rp.purchase_id AS raw_purchase_label,
      cc.sku
    FROM card_instances ci
    LEFT JOIN card_catalog cc ON cc.id = ci.catalog_id
    INNER JOIN slab_details sd ON sd.card_instance_id = ci.id
    LEFT JOIN locations loc ON loc.id = ci.location_id
    LEFT JOIN raw_purchases rp ON rp.id = ci.raw_purchase_id
    LEFT JOIN LATERAL (
      SELECT id, list_price, platform, ebay_listing_url, listed_at
      FROM listings
      WHERE card_instance_id = ci.id AND listing_status = 'active'
      ORDER BY created_at DESC LIMIT 1
    ) l ON true
    LEFT JOIN LATERAL (
      SELECT sale_price, platform, platform_fees, shipping_cost, sold_at, order_details_link
      FROM sales
      WHERE card_instance_id = ci.id ORDER BY created_at DESC LIMIT 1
    ) s ON true
    WHERE ci.user_id = ${userId}
    ${unsold ? sql`AND ci.status != 'sold'` : status === 'graded' ? sql`AND ci.status IN ('graded', 'sold')` : status ? sql`AND ci.status = ${status}` : sql``}
    ${fuzzyNameClause(search, 'ci.card_name_override', 'sd.cert_number::text')}
    ${companyIn} ${gradeIn} ${listedCond} ${cardShowCond} ${personalCollectionCond} ${purchaseYearIn} ${listedYearIn} ${soldYearIn} ${forSaleCond} ${inSetListingCond} ${purchaseDateCond} ${listedDateCond} ${soldDateCond}
    ORDER BY ${sql.raw(sortExpr)} ${dir} NULLS LAST
    LIMIT ${pagination.limit} OFFSET ${offset}
  `.execute(db);

  return buildPaginatedResult(rows.rows, total, pagination.page, pagination.limit);
}

// ── Card-show pricing suggestions ────────────────────────────────────────────
//
// For a set of slabs the user is about to add to a card show, look up what
// price they've already put on OTHER slabs of the same (card_name,
// grade_label, company) already sitting in card-show inventory. The point
// is consistency within a show — if you priced a PSA 9 Ralts at $45
// yesterday, the next PSA 9 Ralts you add should default to $45. The
// suggestion is the most recent card_show_price for that identity; sample
// count comes back too so the client can distinguish "based on 1 slab"
// from "based on 8 slabs."
//
// Also returns per-slab total_cost (raw purchase + grading + any additional
// slab cost) so the client can render a Total Cost column next to the
// asking-price input. Cost basis is already computed elsewhere, we just
// package it here so the whole Add-to-Card-Show pricing step is one round
// trip instead of two.

export interface CardShowPricingSuggestion {
  slab_id: string;
  total_cost_cents: number;
  // Suggested asking price in cents. Null when no other slab of the same
  // (card, grade, company) is currently in card-show inventory.
  suggested_price_cents: number | null;
  // How many other slabs the suggestion was drawn from — 0 means "none,
  // no suggestion available." A count of 1 says "you only priced this
  // once before" so the client can display that context if useful.
  sample_count: number;
}

export async function getCardShowPricingSuggestions(
  userId: string,
  slabIds: string[],
): Promise<CardShowPricingSuggestion[]> {
  if (slabIds.length === 0) return [];

  const rows = await sql<{
    slab_id: string;
    total_cost_cents: number;
    suggested_price_cents: number | null;
    sample_count: number;
  }>`
    WITH target AS (
      SELECT
        ci.id  AS slab_id,
        COALESCE(ci.card_name_override, cc.card_name) AS card_name_key,
        sd.grade_label,
        sd.company,
        (COALESCE(ci.purchase_cost, 0)
          + COALESCE(sd.grading_cost, 0)
          + COALESCE(sd.additional_cost, 0))::int AS total_cost_cents
      FROM card_instances ci
      INNER JOIN slab_details sd ON sd.card_instance_id = ci.id
      LEFT JOIN card_catalog cc ON cc.id = ci.catalog_id
      WHERE ci.user_id = ${userId}
        AND ci.id IN (${sql.join(slabIds.map((v) => sql.val(v)))})
    ),
    -- The most recent card_show_price this user has set for each (card,
    -- grade, company) combo — excluding the slab we're pricing NOW so a
    -- re-add of a card previously in the show doesn't just echo its own
    -- old value.
    latest AS (
      SELECT DISTINCT ON (t.slab_id)
        t.slab_id,
        ci2.card_show_price AS suggested_price_cents,
        ci2.updated_at
      FROM target t
      INNER JOIN card_instances ci2 ON ci2.user_id = ${userId}
      INNER JOIN slab_details    sd2 ON sd2.card_instance_id = ci2.id
      LEFT  JOIN card_catalog    cc2 ON cc2.id = ci2.catalog_id
      WHERE ci2.is_card_show = true
        AND ci2.card_show_price IS NOT NULL
        AND ci2.id <> t.slab_id
        AND COALESCE(ci2.card_name_override, cc2.card_name) = t.card_name_key
        AND sd2.grade_label = t.grade_label
        AND sd2.company     = t.company
      ORDER BY t.slab_id, ci2.updated_at DESC
    ),
    -- Sample count across the same identity so the UI can show "based on N."
    samples AS (
      SELECT t.slab_id, COUNT(*)::int AS sample_count
      FROM target t
      INNER JOIN card_instances ci2 ON ci2.user_id = ${userId}
      INNER JOIN slab_details    sd2 ON sd2.card_instance_id = ci2.id
      LEFT  JOIN card_catalog    cc2 ON cc2.id = ci2.catalog_id
      WHERE ci2.is_card_show = true
        AND ci2.card_show_price IS NOT NULL
        AND ci2.id <> t.slab_id
        AND COALESCE(ci2.card_name_override, cc2.card_name) = t.card_name_key
        AND sd2.grade_label = t.grade_label
        AND sd2.company     = t.company
      GROUP BY t.slab_id
    )
    SELECT
      t.slab_id,
      t.total_cost_cents,
      latest.suggested_price_cents,
      COALESCE(samples.sample_count, 0) AS sample_count
    FROM target t
    LEFT JOIN latest  ON latest.slab_id  = t.slab_id
    LEFT JOIN samples ON samples.slab_id = t.slab_id
  `.execute(db);

  return rows.rows;
}

