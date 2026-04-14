import { Router } from 'express';
import * as ctrl from '../controllers/org.controller';
import { requireAuth } from '../middleware/auth';

export const orgRouter = Router();

orgRouter.use(requireAuth);

orgRouter.get('/', ctrl.getOrgSettings);
orgRouter.patch('/name', ctrl.updateOrgName);
orgRouter.get('/members', ctrl.getOrgMembers);
orgRouter.post('/leave', ctrl.leaveOrg);
orgRouter.delete('/members/:userId', ctrl.removeMember);
orgRouter.get('/invites', ctrl.getPendingInvites);
orgRouter.post('/invites', ctrl.createInvite);
orgRouter.delete('/invites/:id', ctrl.deleteInvite);
orgRouter.post('/invites/accept', ctrl.acceptInvite);
