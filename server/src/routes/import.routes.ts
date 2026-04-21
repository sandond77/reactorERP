import { Router } from 'express';
import multer from 'multer';
import * as importController from '../controllers/import.controller';
import { requireAuth } from '../middleware/auth';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const name = file.originalname.toLowerCase();
    const allowed = name.endsWith('.csv') || name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.ods');
    if (allowed) cb(null, true);
    else cb(new Error('Only CSV or Excel files are allowed'));
  },
});

export const importRouter = Router();

importRouter.use(requireAuth);

importRouter.get('/template/:type', importController.getTemplate);
importRouter.get('/', importController.listImports);
importRouter.post('/upload', upload.single('file'), importController.uploadCsv);
importRouter.post('/:id/mapping', importController.saveMapping);
importRouter.post('/:id/preflight', upload.single('file'), importController.preflightImport);
importRouter.post('/:id/preflight-unlinked', upload.single('file'), importController.preflightUnlinked);
importRouter.post('/:id/execute', upload.single('file'), importController.executeImport);
importRouter.get('/:id/status', importController.getImportStatus);
importRouter.delete('/:id', importController.deletePendingImport);
