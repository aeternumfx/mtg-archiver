import { systemSqlite } from '../db/system';
import { randomBytes, timingSafeEqual } from 'crypto';

export function isUserSetupDone(userId: number): boolean {
  const row = systemSqlite.prepare('SELECT value FROM sync_meta WHERE key = ?').get(`setup_done:${userId}`) as { value: string } | undefined;
  return row?.value === '1';
}

export function resetUserTour(userId: number) {
  systemSqlite.prepare("INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, '0')").run(`setup_done:${userId}`);
}

export function clearUserSetup(userId: number) {
  systemSqlite.prepare('DELETE FROM sync_meta WHERE key = ?').run(`setup_done:${userId}`);
  systemSqlite.prepare('DELETE FROM sync_meta WHERE key = ?').run(`setup_mode:${userId}`);
}

export function markUserSetupDone(userId: number) {
  systemSqlite.prepare("INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, '1')").run(`setup_done:${userId}`);
}

const INSTANCE_SETUP_KEY = 'instance_setup_done';
const SETUP_TOKEN_KEY = 'setup_token';

export function isInstanceSetupDone(): boolean {
  const row = systemSqlite.prepare('SELECT value FROM sync_meta WHERE key = ?').get(INSTANCE_SETUP_KEY) as { value: string } | undefined;
  return row?.value === '1';
}

export function markInstanceSetupDone() {
  systemSqlite.prepare("INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, '1')").run(INSTANCE_SETUP_KEY);
  // The one-time setup token is no longer needed once setup completes.
  systemSqlite.prepare('DELETE FROM sync_meta WHERE key = ?').run(SETUP_TOKEN_KEY);
}

export function markInstanceSetupPending() {
  systemSqlite.prepare('DELETE FROM sync_meta WHERE key = ?').run(INSTANCE_SETUP_KEY);
  // A fresh token is generated for the next setup attempt.
  systemSqlite.prepare('DELETE FROM sync_meta WHERE key = ?').run(SETUP_TOKEN_KEY);
}

// The one-time setup token gates the passwordless setup-login endpoint. It is
// generated on first boot (and on instance reset) and printed to the server
// console so the operator can begin setup. It is cleared once setup completes.
export function ensureSetupToken(): string {
  const row = systemSqlite.prepare('SELECT value FROM sync_meta WHERE key = ?').get(SETUP_TOKEN_KEY) as { value: string } | undefined;
  if (row?.value) return row.value;
  const token = randomBytes(24).toString('base64url');
  systemSqlite.prepare('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)').run(SETUP_TOKEN_KEY, token);
  return token;
}

export function verifySetupToken(token: string): boolean {
  const row = systemSqlite.prepare('SELECT value FROM sync_meta WHERE key = ?').get(SETUP_TOKEN_KEY) as { value: string } | undefined;
  if (!row?.value || !token) return false;
  const a = Buffer.from(row.value);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
