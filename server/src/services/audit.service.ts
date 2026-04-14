import { db } from '../config/database';
import { AppError } from '../middleware/errorHandler';

export interface AuditLogEntry {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor: string;
  actor_name: string | null;
  old_data: unknown;
  new_data: unknown;
  created_at: Date;
}

export async function listAuditLog(
  userId: string,
  opts: { page?: number; limit?: number; actor?: string; action?: string; entity_type?: string; actor_name?: string } = {}
) {
  const page = opts.page ?? 1;
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = (page - 1) * limit;

  const resolvedName = db.fn.coalesce('audit_log.actor_name', 'users.display_name', 'users.email');

  let q = db
    .selectFrom('audit_log')
    .leftJoin('users', 'users.id', 'audit_log.user_id')
    .select([
      'audit_log.id', 'entity_type', 'entity_id', 'action', 'actor',
      'old_data', 'new_data', 'audit_log.created_at',
      resolvedName.as('actor_name'),
    ])
    .where('audit_log.user_id', '=', userId)
    .orderBy('audit_log.created_at', 'desc');

  if (opts.actor) q = q.where('actor', '=', opts.actor);
  if (opts.action) q = q.where('action', '=', opts.action);
  if (opts.entity_type) q = q.where('entity_type', '=', opts.entity_type);
  if (opts.actor_name) q = q.where(resolvedName, '=', opts.actor_name);

  const [rows, countResult] = await Promise.all([
    q.limit(limit).offset(offset).execute(),
    db
      .selectFrom('audit_log')
      .leftJoin('users', 'users.id', 'audit_log.user_id')
      .select((eb) => eb.fn.countAll<number>().as('total'))
      .where('audit_log.user_id', '=', userId)
      .$if(!!opts.actor, (q) => q.where('actor', '=', opts.actor!))
      .$if(!!opts.action, (q) => q.where('action', '=', opts.action!))
      .$if(!!opts.entity_type, (q) => q.where('entity_type', '=', opts.entity_type!))
      .$if(!!opts.actor_name, (q) => q.where(resolvedName, '=', opts.actor_name!))
      .executeTakeFirst(),
  ]);

  const total = Number(countResult?.total ?? 0);
  return {
    data: rows.map((r) => ({ ...r, id: String(r.id) })),
    total,
    page,
    limit,
    total_pages: Math.ceil(total / limit),
  };
}

export async function getAuditActors(userId: string) {
  const rows = await db
    .selectFrom('audit_log')
    .leftJoin('users', 'users.id', 'audit_log.user_id')
    .select([
      'actor',
      db.fn.coalesce('audit_log.actor_name', 'users.display_name', 'users.email').as('name'),
    ])
    .where('audit_log.user_id', '=', userId)
    .where(db.fn.coalesce('audit_log.actor_name', 'users.display_name', 'users.email'), 'is not', null)
    .groupBy(['actor', db.fn.coalesce('audit_log.actor_name', 'users.display_name', 'users.email')])
    .orderBy('name', 'asc')
    .execute();
  return rows;
}

export async function revertDeletion(userId: string, auditLogId: string) {
  const entry = await db
    .selectFrom('audit_log')
    .select(['id', 'entity_type', 'entity_id', 'action', 'old_data'])
    .where('id', '=', auditLogId as any)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (!entry) throw new AppError(404, 'Audit log entry not found');
  if (entry.action !== 'deleted') throw new AppError(400, 'Only deleted records can be reverted');
  if (entry.entity_type !== 'card_instances') throw new AppError(400, `Revert not supported for ${entry.entity_type}`);
  if (!entry.old_data) throw new AppError(400, 'No snapshot data available to restore');

  // Check it doesn't already exist (e.g. already reverted)
  const existing = await db
    .selectFrom('card_instances')
    .select('id')
    .where('id', '=', entry.entity_id)
    .executeTakeFirst();

  if (existing) throw new AppError(409, 'Record already exists — may have already been reverted');

  const snap = entry.old_data as Record<string, any>;
  const slabSnap = snap._slab as Record<string, any> | undefined;

  await db.insertInto('card_instances').values({
    id: snap.id,
    user_id: snap.user_id,
    catalog_id: snap.catalog_id ?? null,
    card_name_override: snap.card_name_override ?? null,
    set_name_override: snap.set_name_override ?? null,
    card_number_override: snap.card_number_override ?? null,
    card_game: snap.card_game ?? 'pokemon',
    language: snap.language ?? 'JP',
    variant: snap.variant ?? null,
    rarity: snap.rarity ?? null,
    notes: snap.notes ?? null,
    purchase_type: snap.purchase_type ?? 'raw',
    status: snap.status ?? 'purchased_raw',
    quantity: snap.quantity ?? 1,
    purchase_cost: snap.purchase_cost ?? 0,
    currency: snap.currency ?? 'USD',
    source_link: snap.source_link ?? null,
    order_number: snap.order_number ?? null,
    condition: snap.condition ?? null,
    condition_notes: snap.condition_notes ?? null,
    image_front_url: snap.image_front_url ?? null,
    image_back_url: snap.image_back_url ?? null,
    purchased_at: snap.purchased_at ? new Date(snap.purchased_at) : null,
    raw_purchase_id: snap.raw_purchase_id ?? null,
    trade_id: snap.trade_id ?? null,
    location_id: snap.location_id ?? null,
    decision: snap.decision ?? null,
    is_card_show: snap.is_card_show ?? false,
    is_personal_collection: snap.is_personal_collection ?? false,
    created_at: snap.created_at ? new Date(snap.created_at) : new Date(),
    updated_at: new Date(),
  } as any).execute();

  // Restore slab_details if the snapshot includes one (graded cards)
  if (slabSnap) {
    await db.insertInto('slab_details').values({
      id: slabSnap.id,
      card_instance_id: snap.id,
      user_id: userId,
      source_raw_instance_id: slabSnap.source_raw_instance_id ?? null,
      grading_submission_id: slabSnap.grading_submission_id ?? null,
      company: slabSnap.company,
      grade: slabSnap.grade,
      grade_label: slabSnap.grade_label ?? null,
      cert_number: slabSnap.cert_number ?? null,
      grading_cost: slabSnap.grading_cost ?? 0,
      additional_cost: slabSnap.additional_cost ?? 0,
      currency: slabSnap.currency ?? 'USD',
    } as any).execute();
  }

  // Write a restoration entry to the audit log
  await db.insertInto('audit_log').values({
    user_id: userId,
    entity_type: 'card_instances',
    entity_id: entry.entity_id,
    action: 'restored',
    actor: 'user',
    old_data: null,
    new_data: snap as any,
  }).execute();

  return { entity_id: entry.entity_id };
}
