import { Router } from 'express';
import multer from 'multer';
import * as importController from '../controllers/import.controller';
import { requireAuth } from '../middleware/auth';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  },
});

export const importRouter = Router();

importRouter.use(requireAuth);

importRouter.get('/template/:type', importController.getTemplate);
importRouter.get('/', importController.listImports);
importRouter.post('/upload', upload.single('file'), importController.uploadCsv);
importRouter.post('/:id/mapping', importController.saveMapping);
importRouter.post('/:id/execute', upload.single('file'), importController.executeImport);
importRouter.get('/:id/status', importController.getImportStatus);
