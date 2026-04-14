import { Router } from 'express';
import multer from 'multer';
import * as ctrl from '../controllers/expenses.controller';
import { requireAuth } from '../middleware/auth';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) ? true : false as any);
  },
});

export const expensesRouter = Router();

expensesRouter.use(requireAuth);

expensesRouter.get('/filters', ctrl.getFilterOptions);
expensesRouter.get('/export', ctrl.exportExpenses);
expensesRouter.post('/parse-receipt', upload.single('image'), ctrl.parseExpenseReceipt);
expensesRouter.get('/', ctrl.listExpenses);
expensesRouter.post('/', ctrl.createExpense);
expensesRouter.put('/:id', ctrl.updateExpense);
expensesRouter.delete('/:id', ctrl.deleteExpense);
expensesRouter.post('/:id/receipt', upload.single('image'), ctrl.uploadExpenseReceipt);
