import type { Request, Response, NextFunction } from 'express';
import { auditContext } from '../utils/audit-context';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.isAuthenticated() && req.user) {
    const actor_name = req.user.display_name ?? req.user.email;
    return auditContext.run({ actor: 'user', actor_name }, next);
  }
  res.status(401).json({ error: 'Unauthorized' });
}
