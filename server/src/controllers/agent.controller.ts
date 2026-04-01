import type { Request, Response, NextFunction } from 'express';
import * as agentService from '../services/agent.service';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import sharp from 'sharp';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

// Receipt image parsing
export async function parseReceipt(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new AppError(400, 'No image file provided');

    const imageBase64 = req.file.buffer.toString('base64');
    const mediaType = req.file.mimetype as 'image/jpeg' | 'image/png' | 'image/webp';
    const hint = req.body.hint as 'purchase' | 'sale' | undefined;

    const result = await agentService.parseReceiptImage(imageBase64, mediaType, hint);
    res.json({ data: result });
  } catch (err) { next(err); }
}

// Card info auto-fill
const lookupSchema = z.object({
  query: z.string().min(1),
  game: z.string().default('pokemon'),
});

export async function lookupCard(req: Request, res: Response, next: NextFunction) {
  try {
    const { query, game } = lookupSchema.parse(req.query);
    const results = await agentService.lookupCardInfo(query, game);
    res.json({ data: results });
  } catch (err) { next(err); }
}

// Auto-fill from partial input or card image
export async function autoFill(req: Request, res: Response, next: NextFunction) {
  try {
    let imageBuffer = req.file?.buffer;
    if (imageBuffer) {
      imageBuffer = await sharp(imageBuffer)
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
    }
    const imageBase64 = imageBuffer?.toString('base64');
    const mediaType = imageBuffer ? 'image/jpeg' as const : undefined;

    const result = await agentService.autoFillCardData({
      partial_name: req.body.partial_name,
      cert_number: req.body.cert_number,
      game: req.body.game ?? 'pokemon',
      image_base64: imageBase64,
      image_media_type: mediaType,
    });
    res.json({ data: result });
  } catch (err) { next(err); }
}

// Inventory chat
const chatSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().max(10000),
    }).superRefine((msg, ctx) => {
      if (msg.role === 'user' && msg.content.length > 600) {
        ctx.addIssue({ code: 'too_big', maximum: 600, type: 'string', inclusive: true, exact: false, message: 'User message must be 600 characters or less' });
      }
    })
  ).min(1).max(40),
});

function parseSpreadsheet(file: Express.Multer.File): string {
  const name = file.originalname;
  try {
    if (file.mimetype === 'text/csv' || file.mimetype === 'text/plain') {
      const csv = file.buffer.toString('utf-8');
      const result = Papa.parse<string[]>(csv, { skipEmptyLines: true });
      const rows = result.data as string[][];
      if (!rows.length) return `[Empty file: ${name}]`;
      return `File: ${name}\n` + rows.map(r => r.join('\t')).join('\n');
    } else {
      // Excel (.xls / .xlsx)
      const wb = XLSX.read(file.buffer, { type: 'buffer' });
      const parts: string[] = [];
      for (const sheetName of wb.SheetNames) {
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' }) as string[][];
        if (rows.length) {
          parts.push(`Sheet "${sheetName}":\n` + rows.map(r => r.join('\t')).join('\n'));
        }
      }
      return `File: ${name}\n` + (parts.join('\n\n') || '[Empty workbook]');
    }
  } catch {
    return `[Could not parse file: ${name}]`;
  }
}

export async function chat(req: Request, res: Response, next: NextFunction) {
  try {
    // Support both JSON body and multipart/form-data (when image is attached)
    const rawMessages = typeof req.body.messages === 'string'
      ? JSON.parse(req.body.messages)
      : req.body.messages;
    const { messages } = chatSchema.parse({ messages: rawMessages });

    const uploadedFiles = req.files as Record<string, Express.Multer.File[]> | Express.Multer.File[] | undefined;
    const imageFiles: Express.Multer.File[] = [];
    const spreadsheetFiles: Express.Multer.File[] = [];

    const allFiles = Array.isArray(uploadedFiles)
      ? uploadedFiles
      : [...(uploadedFiles?.['images'] ?? []), ...(uploadedFiles?.['files'] ?? [])];

    const spreadsheetMimes = ['text/csv', 'text/plain', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'];
    for (const f of allFiles) {
      if (spreadsheetMimes.includes(f.mimetype)) spreadsheetFiles.push(f);
      else imageFiles.push(f);
    }

    const images: agentService.AgentImage[] = await Promise.all(
      imageFiles.map(async (file) => {
        const resized = await sharp(file.buffer)
          .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
        return { base64: resized.toString('base64'), mediaType: 'image/jpeg' as const };
      })
    );

    // Parse spreadsheets and inject as text context appended to the last user message
    let spreadsheetText: string | undefined;
    if (spreadsheetFiles.length > 0) {
      spreadsheetText = spreadsheetFiles.map(parseSpreadsheet).join('\n\n---\n\n');
    }

    const { reply, mutated } = await agentService.chatWithAgent(
      req.user!.id,
      messages,
      images.length > 0 ? images : undefined,
      spreadsheetText,
    );
    res.json({ data: { reply, mutated } });
  } catch (err: any) {
    if (err?.status === 529 || err?.error?.error?.type === 'overloaded_error') {
      return res.status(503).json({ data: { reply: "Anthropic's API is currently overloaded. Please try again in a moment." } });
    }
    next(err);
  }
}
