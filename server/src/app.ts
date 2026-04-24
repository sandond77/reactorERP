import path from 'path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import passport from 'passport';
import connectPgSimple from 'connect-pg-simple';
import { pool } from './config/database';
import { env } from './config/env';
import { configurePassport } from './config/passport';
import { errorHandler } from './middleware/errorHandler';
import { apiRouter } from './routes';

const PgSession = connectPgSimple(session);

configurePassport();

export const app = express();

// Trust Railway's reverse proxy so req.secure is correct and secure cookies work
app.set('trust proxy', 1);

// Security
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'img-src': ["'self'", 'data:', 'blob:', 'https://lh3.googleusercontent.com'],
    },
  },
}));
app.use(cors({
  origin: env.CLIENT_URL,
  credentials: true,
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Sessions backed by PostgreSQL
app.use(session({
  store: new PgSession({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: true,
  }),
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
}));

// Passport
app.use(passport.initialize());
app.use(passport.session());

// Static uploads
app.use('/uploads', express.static(path.join(__dirname, '../../uploads')));

// Routes
app.use('/api/v1', apiRouter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve React client in production
if (env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Error handler (must be last)
app.use(errorHandler);
