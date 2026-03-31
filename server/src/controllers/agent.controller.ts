import type { Request, Response, NextFunction } from 'express';
import * as agentService from '../services/agent.service';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import sharp from 'sharp';

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

export async function chat(req: Request, res: Response, next: NextFunction) {
  try {
    // Support both JSON body and multipart/form-data (when image is attached)
    const rawMessages = typeof req.body.messages === 'string'
      ? JSON.parse(req.body.messages)
      : req.body.messages;
    const { messages } = chatSchema.parse({ messages: rawMessages });

    const files = (req.files as Express.Multer.File[]) ?? [];
    const images: agentService.AgentImage[] = await Promise.all(
      files.map(async (file) => {
        const resized = await sharp(file.buffer)
          .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
        return { base64: resized.toString('base64'), mediaType: 'image/jpeg' as const };
      })
    );

    const reply = await agentService.chatWithAgent(req.user!.id, messages, images.length > 0 ? images : undefined);
    res.json({ data: { reply } });
  } catch (err: any) {
    if (err?.status === 529 || err?.error?.error?.type === 'overloaded_error') {
      return res.status(503).json({ data: { reply: "Anthropic's API is currently overloaded. Please try again in a moment." } });
    }
    next(err);
  }
}
