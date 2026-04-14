import type { Request, Response } from 'express';
import { z } from 'zod';
import * as svc from '../services/org.service';

export async function getOrgSettings(req: Request, res: Response) {
  const org = await svc.getOrg(req.user!.id);
  if (!org) return res.status(404).json({ error: 'No organization found' });
  res.json(org);
}

export async function getOrgMembers(req: Request, res: Response) {
  const org = await svc.getOrg(req.user!.id);
  if (!org) return res.status(404).json({ error: 'No organization found' });
  const members = await svc.getMembers(org.id);
  res.json(members);
}

export async function getPendingInvites(req: Request, res: Response) {
  const org = await svc.getOrg(req.user!.id);
  if (!org || org.role !== 'owner') return res.status(403).json({ error: 'Only the org owner can manage invites' });
  const invites = await svc.getPendingInvites(org.id);
  res.json(invites);
}

export async function createInvite(req: Request, res: Response) {
  const org = await svc.getOrg(req.user!.id);
  if (!org || org.role !== 'owner') return res.status(403).json({ error: 'Only the org owner can invite members' });

  const schema = z.object({ email: z.string().email().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

  const invite = await svc.createInvite(org.id, req.user!.id, parsed.data.email);
  res.status(201).json(invite);
}

export async function deleteInvite(req: Request, res: Response) {
  const org = await svc.getOrg(req.user!.id);
  if (!org || org.role !== 'owner') return res.status(403).json({ error: 'Only the org owner can delete invites' });

  const deleted = await svc.deleteInvite(org.id, req.params['id'] as string);
  if (!deleted) return res.status(404).json({ error: 'Invite not found or already used' });
  res.status(204).send();
}

export async function acceptInvite(req: Request, res: Response) {
  const schema = z.object({ token: z.string().min(1), force: z.boolean().optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Token is required' });

  const result = await svc.acceptInvite(parsed.data.token, req.user!.id, parsed.data.force ?? false);
  if ('error' in result) return res.status(400).json({ error: result.error });
  if ('warning' in result) return res.status(200).json({ warning: true, message: result.message, counts: result.counts });
  res.json({ success: true });
}

export async function leaveOrg(req: Request, res: Response) {
  const result = await svc.leaveOrg(req.user!.id);
  if ('error' in result) return res.status(400).json({ error: result.error });
  res.json({ success: true });
}

export async function removeMember(req: Request, res: Response) {
  const org = await svc.getOrg(req.user!.id);
  if (!org || org.role !== 'owner') return res.status(403).json({ error: 'Only the org owner can remove members' });

  const result = await svc.removeMember(org.id, req.user!.id, req.params['userId'] as string);
  if ('error' in result) return res.status(400).json({ error: result.error });
  res.status(204).send();
}

export async function updateOrgName(req: Request, res: Response) {
  const org = await svc.getOrg(req.user!.id);
  if (!org || org.role !== 'owner') return res.status(403).json({ error: 'Only the org owner can rename the organization' });

  const schema = z.object({ name: z.string().min(1).max(100) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message });

  const updated = await svc.updateOrgName(org.id, parsed.data.name);
  res.json(updated);
}
