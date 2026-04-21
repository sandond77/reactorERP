import { Router } from 'express';
import passport from 'passport';
import { getMe, logout } from '../controllers/auth.controller';
import { requireAuth } from '../middleware/auth';
import { env } from '../config/env';

export const authRouter = Router();

// Redirect to Google
authRouter.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// Google callback
authRouter.get(
  '/google/callback',
  passport.authenticate('google', { failureRedirect: `${env.CLIENT_URL}/login?error=not_allowed` }),
  (_req, res) => res.redirect(env.CLIENT_URL)
);

authRouter.get('/me', requireAuth, getMe);
authRouter.post('/logout', requireAuth, logout);
