import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const MAX_PX = 1600;
const QUALITY = 85;

/**
 * Save a receipt image buffer to disk and return the public URL.
 * Resizes to max 1600px and converts to JPEG.
 */
export async function saveReceiptImage(
  userId: string,
  recordId: string,
  buffer: Buffer,
): Promise<string> {
  const dir = path.join(__dirname, '../../../uploads/receipts', userId);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${recordId}.jpg`;
  const dest = path.join(dir, filename);
  await sharp(buffer)
    .resize(MAX_PX, MAX_PX, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: QUALITY })
    .toFile(dest);
  return `/uploads/receipts/${userId}/${filename}`;
}

/**
 * Save a receipt from base64-encoded image data (used by AI agent).
 */
export async function saveReceiptFromBase64(
  userId: string,
  recordId: string,
  base64: string,
): Promise<string> {
  return saveReceiptImage(userId, recordId, Buffer.from(base64, 'base64'));
}
