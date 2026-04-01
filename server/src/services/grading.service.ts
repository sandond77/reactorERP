import { sql } from 'kysely';
import { db } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import type { GradingCompany } from '../types/db';
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
      WHERE ci.user_id = ${userId} AND ci.deleted_at IS NULL
      ORDER BY value
    `.execute(db),

    sql<{ value: string }>`
      SELECT DISTINCT sd.grade_label AS value
      FROM slab_details sd
      INNER JOIN card_instances ci ON ci.id = sd.card_instance_id
      WHERE ci.user_id = ${userId} AND ci.deleted_at IS NULL AND sd.grade_label IS NOT NULL
      ORDER BY value
    `.execute(db),

    sql<{ value: string }>`
      SELECT DISTINCT EXTRACT(YEAR FROM ci.purchased_at)::int::text AS value
      FROM card_instances ci
      INNER JOIN slab_details sd ON sd.card_instance_id = ci.id
      WHERE ci.user_id = ${userId} AND ci.deleted_at IS NULL AND ci.purchased_at IS NOT NULL
        AND EXTRACT(YEAR FROM ci.purchased_at) >= 2000
      ORDER BY value
    `.execute(db),

    sql<{ value: string }>`
      SELECT DISTINCT EXTRACT(YEAR FROM l.listed_at)::int::text AS value
      FROM listings l
      INNER JOIN card_instances ci ON ci.id = l.card_instance_id
      INNER JOIN slab_details sd ON sd.card_instance_id = ci.id
      WHERE ci.user_id = ${userId} AND ci.deleted_at IS NULL AND l.listed_at IS NOT NULL
        AND EXTRACT(YEAR FROM l.listed_at) >= 2000
      ORDER BY value
    `.execute(db),

    sql<{ value: string }>`
      SELECT DISTINCT EXTRACT(YEAR FROM s.sold_at)::int::text AS value
      FROM sales s
      INNER JOIN card_instances ci ON ci.id = s.card_instance_id
      INNER JOIN slab_details sd ON sd.card_instance_id = ci.id
      WHERE ci.user_id = ${userId} AND ci.deleted_at IS NULL
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
    AND ci.deleted_at IS NULL
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
    AND ci.deleted_at IS NULL
    ${unsold ? sql`AND ci.status != 'sold'` : status === 'graded' ? sql`AND ci.status IN ('graded', 'sold')` : status ? sql`AND ci.status = ${status}` : sql``}
    ${fuzzyNameClause(search, 'ci.card_name_override', 'sd.cert_number::text')}
    ${companyIn} ${gradeIn} ${listedCond} ${cardShowCond} ${personalCollectionCond} ${purchaseYearIn} ${listedYearIn} ${soldYearIn} ${forSaleCond} ${purchaseDateCond} ${listedDateCond} ${soldDateCond}
    ORDER BY ${sql.raw(sortExpr)} ${dir} NULLS LAST
    LIMIT ${pagination.limit} OFFSET ${offset}
  `.execute(db);

  return buildPaginatedResult(rows.rows, total, pagination.page, pagination.limit);
}

const SUBMISSION_SORT_COLS: Record<string, string> = {
  card_name: `COALESCE(ci.card_name_override, cc.card_name)`,
  company: 'gs.company',
  status: 'gs.status',
  grading_fee: 'gs.grading_fee',
  submitted_at: 'gs.submitted_at',
  estimated_return: 'gs.estimated_return',
};

export async function getSubmissionFilterOptions(userId: string) {
  const [companies, statuses] = await Promise.all([
    sql<{ value: string }>`
      SELECT DISTINCT gs.company AS value
      FROM grading_submissions gs
      WHERE gs.user_id = ${userId}
      ORDER BY value
    `.execute(db),
    sql<{ value: string }>`
      SELECT DISTINCT gs.status AS value
      FROM grading_submissions gs
      WHERE gs.user_id = ${userId}
      ORDER BY value
    `.execute(db),
  ]);
  return {
    companies: companies.rows.map((r) => r.value),
    statuses: statuses.rows.map((r) => r.value),
  };
}

export async function listSubmissions(
  userId: string,
  pagination: PaginationParams,
  sortBy?: string,
  sortDir?: 'asc' | 'desc',
  filterCompanies?: string[],
  filterStatuses?: string[],
  search?: string
) {
  const sortExpr = SUBMISSION_SORT_COLS[sortBy ?? ''] ?? 'gs.created_at';
  const dir = sortDir === 'asc' ? sql`ASC` : sql`DESC`;

  const companyIn    = filterCompanies === undefined ? sql`` : filterCompanies.length ? sql`AND gs.company IN (${sql.join(filterCompanies.map((v) => sql.val(v)))})` : sql`AND 1=0`;
  const statusIn     = filterStatuses  === undefined ? sql`` : filterStatuses.length  ? sql`AND gs.status  IN (${sql.join(filterStatuses.map((v) => sql.val(v)))})` : sql`AND 1=0`;
  const searchClause = fuzzyNameClause(search, 'COALESCE(ci.card_name_override, cc.card_name)');

  const countResult = await sql<{ count: string }>`
    SELECT COUNT(*) AS count
    FROM grading_submissions gs
    INNER JOIN card_instances ci ON ci.id = gs.card_instance_id
    LEFT JOIN card_catalog cc ON cc.id = ci.catalog_id
    WHERE gs.user_id = ${userId}
    ${companyIn} ${statusIn} ${searchClause}
  `.execute(db);

  const total = Number(countResult.rows[0]?.count ?? 0);

  const dataResult = await sql<{
    id: string;
    company: string;
    submission_number: string | null;
    service_level: string | null;
    status: string;
    grading_fee: number;
    shipping_cost: number;
    currency: string;
    submitted_at: string | null;
    estimated_return: string | null;
    returned_at: string | null;
    created_at: string;
    card_instance_id: string;
    card_name: string | null;
    set_name: string | null;
    image_front_url: string | null;
    catalog_image_url: string | null;
  }>`
    SELECT
      gs.id,
      gs.company,
      gs.submission_number,
      gs.service_level,
      gs.status,
      gs.grading_fee,
      gs.shipping_cost,
      gs.currency,
      gs.submitted_at,
      gs.estimated_return,
      gs.returned_at,
      gs.created_at,
      ci.id AS card_instance_id,
      COALESCE(ci.card_name_override, cc.card_name) AS card_name,
      COALESCE(cc.set_name, ci.set_name_override) AS set_name,
      ci.image_front_url,
      cc.image_url AS catalog_image_url
    FROM grading_submissions gs
    INNER JOIN card_instances ci ON ci.id = gs.card_instance_id
    LEFT JOIN card_catalog cc ON cc.id = ci.catalog_id
    WHERE gs.user_id = ${userId}
    ${companyIn} ${statusIn} ${searchClause}
    ORDER BY ${sql.raw(sortExpr)} ${dir} NULLS LAST
    LIMIT ${pagination.limit} OFFSET ${getPaginationOffset(pagination.page, pagination.limit)}
  `.execute(db);

  return buildPaginatedResult(dataResult.rows, total, pagination.page, pagination.limit);
}

export interface SubmitToGradingInput {
  card_instance_id: string;
  company: GradingCompany;
  submission_number?: string;
  service_level?: string;
  grading_fee?: number;
  shipping_cost?: number;
  currency?: string;
  submitted_at?: Date;
  estimated_return?: Date;
}

export async function submitForGrading(userId: string, input: SubmitToGradingInput) {
  const card = await db
    .selectFrom('card_instances')
    .select(['id', 'status'])
    .where('id', '=', input.card_instance_id)
    .where('user_id', '=', userId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();

  if (!card) throw new AppError(404, 'Card not found');
  if (!['inspected', 'raw_for_sale', 'purchased_raw'].includes(card.status)) {
    throw new AppError(422, `Card status '${card.status}' cannot be submitted for grading`);
  }

  const submission = await db
    .insertInto('grading_submissions')
    .values({
      user_id: userId,
      card_instance_id: input.card_instance_id,
      company: input.company,
      status: 'submitted',
      submission_number: input.submission_number ?? null,
      service_level: input.service_level ?? null,
      grading_fee: input.grading_fee ?? 0,
      shipping_cost: input.shipping_cost ?? 0,
      currency: input.currency ?? 'USD',
      submitted_at: input.submitted_at ?? null,
      estimated_return: input.estimated_return ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await db
    .updateTable('card_instances')
    .set({ status: 'grading_submitted' })
    .where('id', '=', input.card_instance_id)
    .execute();

  return submission;
}

export interface RecordGradeReturnInput {
  submission_id: string;
  grade: number;
  grade_label?: string;
  cert_number?: string;
  subgrades?: Record<string, number>;
  returned_at?: Date;
}

export async function recordGradeReturn(userId: string, input: RecordGradeReturnInput) {
  const submission = await db
    .selectFrom('grading_submissions')
    .selectAll()
    .where('id', '=', input.submission_id)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (!submission) throw new AppError(404, 'Submission not found');
  if (submission.status === 'returned') throw new AppError(409, 'Already marked as returned');

  await db
    .updateTable('grading_submissions')
    .set({ status: 'returned', returned_at: input.returned_at ?? new Date() })
    .where('id', '=', input.submission_id)
    .execute();

  const slab = await db
    .insertInto('slab_details')
    .values({
      card_instance_id: submission.card_instance_id,
      user_id: userId,
      source_raw_instance_id: submission.card_instance_id,
      grading_submission_id: submission.id,
      company: submission.company,
      cert_number: input.cert_number ? Number(input.cert_number) : null,
      grade: input.grade,
      grade_label: input.grade_label ?? null,
      subgrades: input.subgrades ? (input.subgrades as any) : null,
      additional_cost: 0,
      currency: submission.currency,
    })
    .onConflict((oc) =>
      oc.column('card_instance_id').doUpdateSet({
        grade: input.grade,
        grade_label: input.grade_label ?? null,
        cert_number: input.cert_number ? Number(input.cert_number) : null,
      })
    )
    .returningAll()
    .executeTakeFirstOrThrow();

  await db
    .updateTable('card_instances')
    .set({ status: 'graded' })
    .where('id', '=', submission.card_instance_id)
    .execute();

  return slab;
}
