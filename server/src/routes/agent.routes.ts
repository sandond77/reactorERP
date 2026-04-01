import { Router } from 'express';
import multer from 'multer';
import * as agentController from '../controllers/agent.controller';
import { requireAuth } from '../middleware/auth';

const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/webp',
  'text/csv', 'text/plain',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only images (JPEG, PNG, WebP) and spreadsheets (CSV, XLS, XLSX) are allowed'));
    }
  },
});

export const agentRouter = Router();

agentRouter.use(requireAuth);

// Parse a receipt/invoice image
agentRouter.post('/parse-receipt', upload.single('image'), agentController.parseReceipt);

// Look up card info by name/query
agentRouter.get('/card-lookup', agentController.lookupCard);

// Auto-fill card data (text or image)
agentRouter.post('/auto-fill', upload.single('image'), agentController.autoFill);

// Chat with the AI agent about inventory (optional image attachments, max 5)
agentRouter.post('/chat', upload.fields([{ name: 'images', maxCount: 5 }, { name: 'files', maxCount: 5 }]), agentController.chat);
