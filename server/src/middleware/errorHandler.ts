import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
  }

  // Validation errors from Zod-parsed request bodies. These are the caller's
  // fault, not the server's — return 400 with a readable summary so the
  // client sees a real message instead of "Internal server error" and we
  // stop the console.error spam on every bad payload.
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const path = first?.path.join('.') || 'body';
    const msg = first?.message ?? 'Invalid request';
    return res.status(400).json({
      error: `${path}: ${msg}`,
      code: 'validation_error',
    });
  }

  console.error('[reactor] Unhandled error:', err);

  res.status(500).json({
    error: 'Internal server error',
  });
}
