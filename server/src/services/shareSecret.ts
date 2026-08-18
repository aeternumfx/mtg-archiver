import { randomBytes } from 'crypto';
import { systemSqlite } from '../db/system';

const SECRET_KEY = 'share_view_secret';

export function getSharesSecret(): string | null {
  const row = systemSqlite.prepare('SELECT value FROM sync_meta WHERE key = ?').get(SECRET_KEY) as { value: string } | undefined;
  return row?.value ?? null;
}

export function ensureSharesSecret(): void {
  const existing = getSharesSecret();
  if (existing) return;
  const secret = randomBytes(32).toString('base64url');
  systemSqlite.prepare('INSERT OR IGNORE INTO sync_meta (key, value) VALUES (?, ?)').run(SECRET_KEY, secret);
}
