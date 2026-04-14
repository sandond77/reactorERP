import type { Request, Response, NextFunction } from 'express';
import { db } from '../config/database';
import { auditContext } from '../utils/audit-context';

/**
 * Resolves the org owner's user_id for data scoping.
 * - If the user owns an org → their own id
 * - If the user is a member of an org → the owner's id
 * - If no org exists (new user) → their own id (solo until org is created)
 * Fails closed: returns null if anything goes wrong — caller must 401.
 */
async function resolveDataUserId(userId: string): Promise<string | null> {
  try {
    const membership = await db
      .selectFrom('org_members as m')
      .leftJoin('org_members as owner', (join) =>
        join.onRef('owner.org_id', '=', 'm.org_id').on('owner.role', '=', 'owner')
      )
      .select(['m.role', 'owner.user_id as owner_user_id'])
      .where('m.user_id', '=', userId)
      .executeTakeFirst();

    if (!membership) {
      // No org yet — new user, scoped to themselves until org is created
      return userId;
    }

    if (membership.role === 'owner') return userId;
    if (membership.owner_user_id) return membership.owner_user_id;

    // Shouldn't happen — org with no owner
    return null;
  } catch (err) {
    // DB error — fall back to userId so a transient failure doesn't log the user out
    console.error('[requireAuth] resolveDataUserId failed, falling back to userId:', err);
    return userId;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const dataUserId = await resolveDataUserId(req.user.id);
  if (!dataUserId) {
    return res.status(401).json({ error: 'Could not resolve data scope' });
  }

  req.dataUserId = dataUserId;
  const actor_name = req.user.display_name ?? req.user.email;
  return auditContext.run({ actor: 'user', actor_name }, next);
}
