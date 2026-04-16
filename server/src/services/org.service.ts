import { db } from '../config/database';
import crypto from 'crypto';

export async function getOrg(userId: string) {
  const org = await db
    .selectFrom('org_members as m')
    .innerJoin('organizations as o', 'o.id', 'm.org_id')
    .select(['o.id', 'o.name', 'o.max_members', 'o.created_at', 'm.role'])
    .where('m.user_id', '=', userId)
    .executeTakeFirst();

  if (org) return org;

  // No org found — auto-create a solo org for this user (handles pre-migration accounts)
  const user = await db.selectFrom('users').select(['display_name', 'email']).where('id', '=', userId).executeTakeFirst();
  const orgName = user?.display_name ?? user?.email ?? 'My Organization';
  const created = await db.insertInto('organizations').values({ name: orgName }).returning(['id', 'name', 'max_members', 'created_at']).executeTakeFirstOrThrow();
  await db.insertInto('org_members').values({ org_id: created.id, user_id: userId, role: 'owner' }).execute();
  return { ...created, role: 'owner' as const };
}

export async function getMembers(orgId: string) {
  return db
    .selectFrom('org_members as m')
    .innerJoin('users as u', 'u.id', 'm.user_id')
    .select([
      'm.id',
      'm.user_id',
      'm.role',
      'm.joined_at',
      'u.email',
      'u.display_name',
      'u.avatar_url',
    ])
    .where('m.org_id', '=', orgId)
    .orderBy('m.joined_at', 'asc')
    .execute();
}

export async function getPendingInvites(orgId: string) {
  return db
    .selectFrom('org_invites')
    .select(['id', 'name', 'email', 'token', 'expires_at', 'created_at'])
    .where('org_id', '=', orgId)
    .where('used_at', 'is', null)
    .where('expires_at', '>', new Date())
    .orderBy('created_at', 'desc')
    .execute();
}

export async function createInvite(orgId: string, invitedBy: string, email?: string, name?: string) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

  const record = await db
    .insertInto('org_invites')
    .values({ org_id: orgId, invited_by: invitedBy, token, email: email ?? null, name: name ?? null, expires_at: expiresAt })
    .returningAll()
    .executeTakeFirstOrThrow();

  return record;
}

export async function deleteInvite(orgId: string, inviteId: string) {
  const result = await db
    .deleteFrom('org_invites')
    .where('id', '=', inviteId)
    .where('org_id', '=', orgId)
    .where('used_at', 'is', null)
    .executeTakeFirst();
  return (result?.numDeletedRows ?? 0n) > 0n;
}

async function getSoloDataCounts(userId: string) {
  const [cards, expenses, purchases] = await Promise.all([
    db.selectFrom('card_instances').select((eb) => eb.fn.countAll<number>().as('n')).where('user_id', '=', userId).executeTakeFirst(),
    db.selectFrom('expenses').select((eb) => eb.fn.countAll<number>().as('n')).where('user_id', '=', userId).executeTakeFirst(),
    db.selectFrom('raw_purchases').select((eb) => eb.fn.countAll<number>().as('n')).where('user_id', '=', userId).executeTakeFirst(),
  ]);
  return {
    cards: Number(cards?.n ?? 0),
    expenses: Number(expenses?.n ?? 0),
    purchases: Number(purchases?.n ?? 0),
  };
}

export async function acceptInvite(token: string, userId: string, force = false) {
  return db.transaction().execute(async (trx) => {
    const invite = await trx
      .selectFrom('org_invites')
      .selectAll()
      .where('token', '=', token)
      .where('used_at', 'is', null)
      .where('expires_at', '>', new Date())
      .executeTakeFirst();

    if (!invite) return { error: 'Invalid or expired invite' };

    // Check max_members
    const org = await trx
      .selectFrom('organizations')
      .select(['id', 'max_members'])
      .where('id', '=', invite.org_id)
      .executeTakeFirstOrThrow();

    const memberCount = await trx
      .selectFrom('org_members')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('org_id', '=', invite.org_id)
      .executeTakeFirstOrThrow();

    if (Number(memberCount.count) >= org.max_members) {
      return { error: 'Organization is at max capacity' };
    }

    // Check if user already in an org
    const existing = await trx
      .selectFrom('org_members')
      .select(['id', 'org_id', 'role'])
      .where('user_id', '=', userId)
      .executeTakeFirst();

    if (existing) {
      if (existing.role !== 'owner') {
        return { error: 'You are already a member of a team. Leave that team first before joining another.' };
      }

      const soloMemberCount = await trx
        .selectFrom('org_members')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('org_id', '=', existing.org_id)
        .executeTakeFirstOrThrow();

      if (Number(soloMemberCount.count) > 1) {
        return { error: 'You are the owner of a team with other members. Transfer ownership or have all members leave before joining another team.' };
      }

      // Solo org — check for existing data
      if (!force) {
        const counts = await getSoloDataCounts(userId);
        const total = counts.cards + counts.expenses + counts.purchases;
        if (total > 0) {
          return {
            warning: true,
            message: `Your current account has ${[
              counts.cards > 0 && `${counts.cards} card${counts.cards !== 1 ? 's' : ''}`,
              counts.purchases > 0 && `${counts.purchases} purchase${counts.purchases !== 1 ? 's' : ''}`,
              counts.expenses > 0 && `${counts.expenses} expense${counts.expenses !== 1 ? 's' : ''}`,
            ].filter(Boolean).join(', ')}. This data will no longer be accessible after joining the new team. Continue?`,
            counts,
          };
        }
      }

      // Dissolve solo org
      await trx.deleteFrom('organizations').where('id', '=', existing.org_id).execute();
    }

    // Add member
    await trx
      .insertInto('org_members')
      .values({ org_id: invite.org_id, user_id: userId, role: 'member' })
      .execute();

    // Mark invite used
    await trx
      .updateTable('org_invites')
      .set({ used_at: new Date(), used_by: userId })
      .where('id', '=', invite.id)
      .execute();

    return { success: true, orgId: invite.org_id };
  });
}

export async function leaveOrg(userId: string) {
  const membership = await db
    .selectFrom('org_members')
    .select(['id', 'org_id', 'role'])
    .where('user_id', '=', userId)
    .executeTakeFirst();

  if (!membership) return { error: 'You are not a member of any organization' };
  if (membership.role === 'owner') return { error: 'Owners cannot leave. Transfer ownership or delete the organization first.' };

  await db.deleteFrom('org_members').where('id', '=', membership.id).execute();

  // Create a solo org for the user so they are not left org-less
  const org = await db
    .insertInto('organizations')
    .values({ name: (await db.selectFrom('users').select(['display_name', 'email']).where('id', '=', userId).executeTakeFirstOrThrow()).display_name ?? userId })
    .returning('id')
    .executeTakeFirstOrThrow();

  await db.insertInto('org_members').values({ org_id: org.id, user_id: userId, role: 'owner' }).execute();

  return { success: true };
}

export async function removeMember(orgId: string, ownerId: string, targetUserId: string) {
  if (targetUserId === ownerId) return { error: 'Cannot remove yourself as owner' };

  const result = await db
    .deleteFrom('org_members')
    .where('org_id', '=', orgId)
    .where('user_id', '=', targetUserId)
    .where('role', '=', 'member')
    .executeTakeFirst();

  return (result?.numDeletedRows ?? 0n) > 0n ? { success: true } : { error: 'Member not found' };
}

export async function updateOrgName(orgId: string, name: string) {
  return db
    .updateTable('organizations')
    .set({ name, updated_at: new Date() })
    .where('id', '=', orgId)
    .returningAll()
    .executeTakeFirstOrThrow();
}
