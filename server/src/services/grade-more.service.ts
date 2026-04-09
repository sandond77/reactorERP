import { db } from '../config/database';
import { sql } from 'kysely';

export interface GradeMoreAlert {
  threshold_id: string;
  catalog_id: string;
  card_name: string;
  set_name: string | null;
  card_number: string | null;
  sku: string | null;
  company: string;
  grade: number | null;
  grade_label: string | null;
  unsold_graded: number;
  in_grading: number;
  min_quantity: number;
  is_ignored: boolean;
  muted_until: Date | null;
}

export async function getGradeMoreAlerts(userId: string): Promise<GradeMoreAlert[]> {
  const rows = await sql<GradeMoreAlert & { is_ignored: boolean; muted_until: Date | null }>`
    SELECT
      gt.id             AS threshold_id,
      gt.catalog_id,
      cc.card_name,
      cc.set_name,
      cc.card_number,
      cc.sku,
      gt.company,
      gt.grade,
      gt.grade_label,
      gt.min_quantity,
      gt.is_ignored,
      gt.muted_until,
      COALESCE((
        SELECT COUNT(*)
        FROM card_instances ci
        INNER JOIN slab_details sd ON sd.card_instance_id = ci.id
        WHERE ci.user_id = gt.user_id
          AND ci.catalog_id = gt.catalog_id
          AND sd.company::text = gt.company
          AND (gt.grade IS NULL OR sd.grade = gt.grade)
          AND ci.status = 'graded'
      ), 0)::int AS unsold_graded,
      COALESCE((
        SELECT COUNT(*)
        FROM card_instances ci
        INNER JOIN slab_details sd ON sd.card_instance_id = ci.id
        WHERE ci.user_id = gt.user_id
          AND ci.catalog_id = gt.catalog_id
          AND sd.company::text = gt.company
          AND (gt.grade IS NULL OR sd.grade = gt.grade)
          AND ci.status = 'grading_submitted'
      ), 0)::int AS in_grading
    FROM grade_more_thresholds gt
    INNER JOIN card_catalog cc ON cc.id = gt.catalog_id
    WHERE gt.user_id = ${userId}
    ORDER BY cc.card_name, gt.company, gt.grade
  `.execute(db);

  return rows.rows;
}

export async function getActiveGradeMoreAlerts(userId: string): Promise<GradeMoreAlert[]> {
  const all = await getGradeMoreAlerts(userId);
  const now = new Date();
  return all.filter((r) => {
    if (r.is_ignored) return false;
    if (r.muted_until && new Date(r.muted_until) > now) return false;
    return (r.unsold_graded + r.in_grading) < r.min_quantity;
  });
}

export async function listGradeMoreThresholds(userId: string) {
  return (await getGradeMoreAlerts(userId));
}

export async function upsertGradeMoreThreshold(
  userId: string,
  catalogId: string,
  company: string,
  grade: number | null,
  gradeLabel: string | null,
  minQuantity: number,
) {
  await db
    .insertInto('grade_more_thresholds')
    .values({
      user_id: userId,
      catalog_id: catalogId,
      company,
      grade,
      grade_label: gradeLabel,
      min_quantity: minQuantity,
      is_ignored: false,
      muted_until: null,
    })
    .onConflict((oc) =>
      oc.columns(['user_id', 'catalog_id', 'company', 'grade']).doUpdateSet({
        min_quantity: minQuantity,
        grade_label: gradeLabel ?? undefined,
        is_ignored: false,
        muted_until: null,
      }),
    )
    .execute();
}

export async function ignoreGradeMoreThreshold(userId: string, thresholdId: string) {
  await db.updateTable('grade_more_thresholds').set({ is_ignored: true })
    .where('id', '=', thresholdId).where('user_id', '=', userId).execute();
}

export async function muteGradeMoreThreshold(userId: string, thresholdId: string) {
  const mutedUntil = new Date();
  mutedUntil.setDate(mutedUntil.getDate() + 30);
  await db.updateTable('grade_more_thresholds').set({ muted_until: mutedUntil })
    .where('id', '=', thresholdId).where('user_id', '=', userId).execute();
}

export async function resetGradeMoreThreshold(userId: string, thresholdId: string) {
  await db.updateTable('grade_more_thresholds').set({ is_ignored: false, muted_until: null })
    .where('id', '=', thresholdId).where('user_id', '=', userId).execute();
}

export async function deleteGradeMoreThreshold(userId: string, thresholdId: string) {
  await db.deleteFrom('grade_more_thresholds')
    .where('id', '=', thresholdId).where('user_id', '=', userId).execute();
}

/**
 * All unique catalog+company+grade combos the user has graded cards for.
 * Used in the threshold management table so every row can have its own Min Qty.
 */
export async function listGradedCardsByGrade(userId: string) {
  const rows = await sql<{
    catalog_id: string;
    card_name: string;
    set_name: string | null;
    card_number: string | null;
    sku: string | null;
    company: string;
    grade: number | null;
    grade_label: string | null;
    threshold_id: string | null;
    min_quantity: number | null;
    is_ignored: boolean | null;
    muted_until: Date | null;
    unsold_graded: number;
    in_grading: number;
  }>`
    SELECT
      ci.catalog_id,
      MAX(COALESCE(ci.card_name_override, cc.card_name)) AS card_name,
      MAX(cc.set_name)    AS set_name,
      MAX(cc.card_number) AS card_number,
      MAX(cc.sku)         AS sku,
      sd.company,
      sd.grade,
      MAX(sd.grade_label) AS grade_label,
      gt.id           AS threshold_id,
      gt.min_quantity,
      gt.is_ignored,
      gt.muted_until,
      COUNT(*) FILTER (WHERE ci.status = 'graded')::int          AS unsold_graded,
      COUNT(*) FILTER (WHERE ci.status = 'grading_submitted')::int AS in_grading
    FROM card_instances ci
    INNER JOIN slab_details sd ON sd.card_instance_id = ci.id
    LEFT JOIN card_catalog cc ON cc.id = ci.catalog_id
    LEFT JOIN grade_more_thresholds gt
      ON gt.user_id = ci.user_id
      AND gt.catalog_id = ci.catalog_id
      AND gt.company = sd.company::text
      AND (gt.grade = sd.grade OR (gt.grade IS NULL AND sd.grade IS NULL))
    WHERE ci.user_id = ${userId}
      AND ci.catalog_id IS NOT NULL
    GROUP BY ci.catalog_id, sd.company, sd.grade,
             gt.id, gt.min_quantity, gt.is_ignored, gt.muted_until
    ORDER BY card_name, sd.company, sd.grade
  `.execute(db);

  return rows.rows;
}
