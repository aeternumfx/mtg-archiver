import { systemSqlite } from '../db/system';

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

export function isInstanceSetupDone(): boolean {
  const row = systemSqlite.prepare('SELECT value FROM sync_meta WHERE key = ?').get(INSTANCE_SETUP_KEY) as { value: string } | undefined;
  return row?.value === '1';
}

export function markInstanceSetupDone() {
  systemSqlite.prepare("INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, '1')").run(INSTANCE_SETUP_KEY);
}

export function markInstanceSetupPending() {
  systemSqlite.prepare('DELETE FROM sync_meta WHERE key = ?').run(INSTANCE_SETUP_KEY);
}
