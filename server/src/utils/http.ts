import type { Response } from 'express';

export function fail(res: Response, err: unknown, status = 500) {
  console.error('API error:', err);
  const message = status === 500 ? 'Something went wrong' : (err instanceof Error ? err.message : String(err));
  res.status(status).json({ error: message });
}
