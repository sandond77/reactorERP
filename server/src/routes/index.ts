import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authRouter } from './auth.routes';
import { cardsRouter } from './cards.routes';
import { gradingRouter } from './grading.routes';
import { salesRouter } from './sales.routes';
import { reportsRouter } from './reports.routes';
import { agentRouter } from './agent.routes';
import { importRouter } from './import.routes';
import { catalogRouter } from './catalog.routes';
import { listingsRouter } from './listings.routes';
import { setsRouter } from './sets.routes';
import rawPurchasesRouter from './raw-purchases.routes';

export const apiRouter = Router();

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

const agentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,  // AI calls are expensive
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI requests. Please wait a moment.' },
});

apiRouter.use(limiter);

apiRouter.use('/auth', authRouter);
apiRouter.use('/cards', cardsRouter);
apiRouter.use('/grading', gradingRouter);
apiRouter.use('/sales', salesRouter);
apiRouter.use('/reports', reportsRouter);
apiRouter.use('/agent', agentLimiter, agentRouter);
apiRouter.use('/import', importRouter);
apiRouter.use('/catalog', catalogRouter);
apiRouter.use('/listings', listingsRouter);
apiRouter.use('/sets', setsRouter);
apiRouter.use('/raw-purchases', rawPurchasesRouter);
