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
        .resize(2400, 2400, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 92 })
        .toBuffer();
    }
    const imageBase64 = imageBuffer?.toString('base64');
    const mediaType = imageBuffer ? 'image/jpeg' as const : undefined;

    const result = await agentService.autoFillCardData(req.dataUserId, {
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
      // Assistant replies that list many cards can comfortably exceed 10k
      // chars; cap is mostly to prevent runaway abuse, not to constrain
      // legitimate AI output.
      content: z.string().max(100000),
    }).superRefine((msg, ctx) => {
      if (msg.role === 'user' && msg.content.length > 600) {
        ctx.addIssue({ code: 'too_big', maximum: 600, type: 'string', inclusive: true, exact: false, message: 'User message must be 600 characters or less' });
      }
    })
  )
  // Loose upper bound just to prevent absurd payloads. Conversation length
  // is actually controlled by trimAndSummarize in agent.service.ts, which
  // drops oldest turns and replaces them with a Haiku summary as the chat
  // grows. The user shouldn't ever need to clear the chat manually.
  .min(1).max(500),
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
        // Anthropic vision rejects images over 5MB raw. We aim for ~3.5MB
        // worst-case to leave headroom. Single resize pass with sharp's
        // lanczos3 kernel, then progressively drop quality if the encode
        // is still too large for a particularly detailed photo.
        const ANTHROPIC_MAX_BYTES = 4_500_000;
        const meta = await sharp(file.buffer).metadata();
        const qualities = [92, 88, 82, 75];
        let resized: Buffer | null = null;
        let usedQuality = qualities[0];
        for (const q of qualities) {
          const buf = await sharp(file.buffer)
            .resize(3200, 3200, { fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3' })
            .jpeg({ quality: q, mozjpeg: true })
            .toBuffer();
          resized = buf;
          usedQuality = q;
          if (buf.length <= ANTHROPIC_MAX_BYTES) break;
        }
        const finalBuf = resized!;
        const out = await sharp(finalBuf).metadata();
        console.log(`[agent.chat] image ${file.originalname ?? '(unnamed)'}: ` +
          `${meta.width}x${meta.height} (${file.size} bytes) → ` +
          `${out.width}x${out.height} (${finalBuf.length} bytes, q=${usedQuality})`);
        return { base64: finalBuf.toString('base64'), mediaType: 'image/jpeg' as const };
      })
    );

    // Parse spreadsheets and inject as text context appended to the last user message
    let spreadsheetText: string | undefined;
    if (spreadsheetFiles.length > 0) {
      spreadsheetText = spreadsheetFiles.map(parseSpreadsheet).join('\n\n---\n\n');
    }

    const actorName = req.user!.display_name ?? req.user!.email;
    const tz = typeof req.body.tz === 'string' ? req.body.tz : undefined;
    const { reply, mutated } = await agentService.chatWithAgent(
      req.dataUserId,
      messages,
      images.length > 0 ? images : undefined,
      spreadsheetText,
      actorName,
      tz,
    );
    res.json({ data: { reply, mutated } });
  } catch (err: any) {
    if (err?.status === 529 || err?.error?.error?.type === 'overloaded_error') {
      return res.status(503).json({ data: { reply: "Anthropic's API is currently overloaded. Please try again in a moment." } });
    }
    // Schema rejection (oversized prior message, too many turns, etc.) — give
    // the user a concrete reason instead of a 500.
    if (err?.name === 'ZodError') {
      const first = err.issues?.[0];
      const reason = first?.message ?? 'Message validation failed';
      return res.status(400).json({ data: { reply: `Couldn't process that request: ${reason}. Try clearing the chat and starting fresh.` } });
    }
    console.error('[agent.chat] error:', err);
    next(err);
  }
}
