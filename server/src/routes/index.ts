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
import { gradingSubsRouter } from './grading-submissions.routes';
import { tradesRouter } from './trades.routes';
import { locationsRouter } from './locations.routes';
import { expensesRouter } from './expenses.routes';
import { auditRouter } from './audit.routes';
import { cardShowsRouter } from './card-shows.routes';
import { reorderRouter } from './reorder.routes';
import { gradeMoreRouter } from './grade-more.routes';
import { alertOverridesRouter } from './alert-overrides.routes';

export const apiRouter = Router();

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
});

const agentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
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
apiRouter.use('/grading-subs', gradingSubsRouter);
apiRouter.use('/trades', tradesRouter);
apiRouter.use('/locations', locationsRouter);
apiRouter.use('/expenses', expensesRouter);
apiRouter.use('/audit', auditRouter);
apiRouter.use('/card-shows', cardShowsRouter);
apiRouter.use('/reorder', reorderRouter);
apiRouter.use('/grade-more', gradeMoreRouter);
apiRouter.use('/alerts', alertOverridesRouter);
