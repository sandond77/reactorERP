import { Router } from 'express';
import multer from 'multer';
import * as agentController from '../controllers/agent.controller';
import { requireAuth } from '../middleware/auth';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
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

// Chat with the AI agent about inventory
agentRouter.post('/chat', agentController.chat);
