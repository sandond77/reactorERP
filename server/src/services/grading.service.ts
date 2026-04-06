import { sql } from 'kysely';
import { db } from '../config/database';
import { getPaginationOffset, buildPaginatedResult } from '../utils/pagination';
import type { PaginationParams } from '../utils/pagination';

// Build a word-split fuzzy search clause: each word must appear in the name (AND logic)
function fuzzyNameClause(search: string | undefined, nameExpr: string, certExpr?: string) {
  if (!search) return sql``;
  const words = search.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return sql``;
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
  cert_number:       'sd.cert_number',
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
  purchaseDate?: string,
  listedDate?: string,
  soldDate?: string
) {
  const offset = getPaginationOffset(pagination.page, pagination.limit);
  const status = statusFilter === 'all' || !statusFilter ? null : statusFilter;
  const unsold = statusFilter === 'unsold';
  const sortExpr = SLAB_SORT_COLS[sortBy ?? ''] ?? 'ci.created_at';
  const dir = sortDir === 'asc' ? sql`ASC` : sql`DESC`;

  const companyIn    = filterCompanies === undefined ? sql`` : filterCompanies.length ? sql`AND sd.company     IN (${sql.join(filterCompanies.map((v) => sql.val(v)))})` : sql`AND 1=0`;
  const gradeIn      = filterGrades    === undefined ? sql`` : filterGrades.length    ? sql`AND sd.grade_label IN (${sql.join(filterGrades.map((v) => sql.val(v)))})` : sql`AND 1=0`;
  const listedCond   = isListed === 'yes' ? sql`AND EXISTS (SELECT 1 FROM listings l2 WHERE l2.card_instance_id = ci.id)`
                     : isListed === 'no'  ? sql`AND NOT EXISTS (SELECT 1 FROM listings l2 WHERE l2.card_instance_id = ci.id)`
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
  const purchaseYearIn   = purchaseYears === undefined ? sql`` : purchaseYears.length ? sql`AND EXTRACT(YEAR FROM ci.purchased_at)::int::text IN (${sql.join(purchaseYears.map((v) => sql.val(v)))})` : sql`AND 1=0`;
  const listedYearIn     = listedYears   === undefined ? sql`` : listedYears.length   ? sql`AND EXISTS (SELECT 1 FROM listings l2 WHERE l2.card_instance_id = ci.id AND EXTRACT(YEAR FROM l2.listed_at)::int::text IN (${sql.join(listedYears.map((v) => sql.val(v)))}))` : sql`AND 1=0`;
  const soldYearIn       = soldYears     === undefined ? sql`` : soldYears.length     ? sql`AND EXISTS (SELECT 1 FROM sales s2 WHERE s2.card_instance_id = ci.id AND EXTRACT(YEAR FROM s2.sold_at)::int::text IN (${sql.join(soldYears.map((v) => sql.val(v)))}))` : sql`AND 1=0`;
  const purchaseDateCond = purchaseDate ? sql`AND ci.purchased_at = ${purchaseDate}::date` : sql``;
  const listedDateCond   = listedDate   ? sql`AND EXISTS (SELECT 1 FROM listings l2 WHERE l2.card_instance_id = ci.id AND l2.listed_at::date = ${listedDate}::date)` : sql``;
  const soldDateCond     = soldDate     ? sql`AND EXISTS (SELECT 1 FROM sales s2 WHERE s2.card_instance_id = ci.id AND s2.sold_at::date = ${soldDate}::date)` : sql``;

  const countResult = await sql<{ count: string }>`
    SELECT COUNT(*) AS count
    FROM card_instances ci
    INNER JOIN slab_details sd ON sd.card_instance_id = ci.id
    WHERE ci.user_id = ${userId}
    ${unsold ? sql`AND ci.status != 'sold'` : status === 'graded' ? sql`AND ci.status IN ('graded', 'sold')` : status ? sql`AND ci.status = ${status}` : sql``}
    ${fuzzyNameClause(search, 'ci.card_name_override', 'sd.cert_number::text')}
    ${companyIn} ${gradeIn} ${listedCond} ${cardShowCond} ${personalCollectionCond} ${purchaseYearIn} ${listedYearIn} ${soldYearIn} ${forSaleCond} ${purchaseDateCond} ${listedDateCond} ${soldDateCond}
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
    is_personal_collection: boolean;
    order_details_link: string | null;
    location_name: string | null;
    location_id: string | null;
    raw_purchase_label: string | null;
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
      ci.purchased_at                                 AS raw_purchase_date,
      l.listed_at                                     AS date_listed,
      s.sold_at                                       AS date_sold,
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
      ci.is_personal_collection,
      s.order_details_link,
      loc.name AS location_name,
      ci.location_id,
      rp.purchase_id AS raw_purchase_label
    FROM card_instances ci
    LEFT JOIN card_catalog cc ON cc.id = ci.catalog_id
    INNER JOIN slab_details sd ON sd.card_instance_id = ci.id
    LEFT JOIN locations loc ON loc.id = ci.location_id
    LEFT JOIN raw_purchases rp ON rp.id = ci.raw_purchase_id
    LEFT JOIN LATERAL (
      SELECT id, list_price, platform, ebay_listing_url, listed_at
      FROM listings
      WHERE card_instance_id = ci.id ORDER BY created_at DESC LIMIT 1
    ) l ON true
    LEFT JOIN LATERAL (
      SELECT sale_price, platform, platform_fees, shipping_cost, sold_at, order_details_link
      FROM sales
      WHERE card_instance_id = ci.id ORDER BY created_at DESC LIMIT 1
    ) s ON true
    WHERE ci.user_id = ${userId}
    ${unsold ? sql`AND ci.status != 'sold'` : status === 'graded' ? sql`AND ci.status IN ('graded', 'sold')` : status ? sql`AND ci.status = ${status}` : sql``}
    ${fuzzyNameClause(search, 'ci.card_name_override', 'sd.cert_number::text')}
    ${companyIn} ${gradeIn} ${listedCond} ${cardShowCond} ${personalCollectionCond} ${purchaseYearIn} ${listedYearIn} ${soldYearIn} ${forSaleCond} ${purchaseDateCond} ${listedDateCond} ${soldDateCond}
    ORDER BY ${sql.raw(sortExpr)} ${dir} NULLS LAST
    LIMIT ${pagination.limit} OFFSET ${offset}
  `.execute(db);

  return buildPaginatedResult(rows.rows, total, pagination.page, pagination.limit);
}


