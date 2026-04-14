import { db } from '../config/database';
import { auditContext } from './audit-context';

export async function logAudit(
  userId: string,
  entityType: string,
  entityId: string,
  action: string,
  oldData: unknown,
  newData: unknown,
  actor?: 'user' | 'agent',
) {
  const ctx = auditContext.getStore();
  const resolvedActor = actor ?? ctx?.actor ?? 'user';
  const resolvedActorName = ctx?.actor_name ?? null;
  await db
    .insertInto('audit_log')
    .values({
      user_id: userId,
      entity_type: entityType,
      entity_id: entityId,
      action,
      actor: resolvedActor,
      actor_name: resolvedActorName,
      old_data: oldData as any,
      new_data: newData as any,
    })
    .execute()
    .catch((err) => console.error('[audit] Failed to write audit log:', err));
}
