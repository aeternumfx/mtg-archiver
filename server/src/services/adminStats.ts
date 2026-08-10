import fs from 'fs';
import path from 'path';
import { systemSqlite } from '../db/system';
import { systemDbPath, usersDir, imagesDir, dataDir } from '../db/paths';
import { getSchedulerStatus } from '../scheduler';
import { getCallCounts } from './apiCalls';
import { getSystemSettings } from './systemSettings';

function dirSize(dir: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  if (!fs.existsSync(dir)) return { bytes: 0, files: 0 };
  const walk = (p: string) => {
    for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        try { bytes += fs.statSync(full).size; files += 1; } catch { /* ignore */ }
      }
    }
  };
  walk(dir);
  return { bytes, files };
}

export function getAdminStats() {
  const totalUsers = (systemSqlite.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  const admins = (systemSqlite.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get() as { c: number }).c;
  const disabled = (systemSqlite.prepare('SELECT COUNT(*) as c FROM users WHERE disabled = 1').get() as { c: number }).c;

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const countActive = (days: number) => {
    const cutoff = new Date(now - days * DAY).toISOString();
    return (systemSqlite.prepare('SELECT COUNT(*) as c FROM users WHERE last_login_at IS NOT NULL AND last_login_at >= ?').get(cutoff) as { c: number }).c;
  };
  const activeSessions = (systemSqlite.prepare('SELECT COUNT(*) as c FROM sessions WHERE expires_at > ?').get(new Date().toISOString()) as { c: number }).c;

  const users = systemSqlite.prepare('SELECT id, username FROM users').all() as Array<{ id: number; username: string }>;
  const perUser: Array<{ userId: number; username: string; bytes: number }> = [];
  let usersBytes = 0;
  if (fs.existsSync(usersDir)) {
    for (const f of fs.readdirSync(usersDir)) {
      const m = f.match(/^user_(\d+)\.db$/);
      if (!m) continue;
      const userId = Number(m[1]);
      try {
        const size = fs.statSync(path.join(usersDir, f)).size;
        usersBytes += size;
        const uname = users.find(u => u.id === userId)?.username ?? `#${userId}`;
        perUser.push({ userId, username: uname, bytes: size });
      } catch { /* ignore */ }
    }
  }
  perUser.sort((a, b) => b.bytes - a.bytes);

  const img = dirSize(imagesDir);
  let systemDbBytes = 0;
  try { systemDbBytes = fs.statSync(systemDbPath).size; } catch { /* ignore */ }

  const cards = (systemSqlite.prepare('SELECT COUNT(*) as c FROM scryfall_cards').get() as { c: number }).c;
  const sets = (systemSqlite.prepare('SELECT COUNT(*) as c FROM sets').get() as { c: number }).c;

  const sync = getSchedulerStatus();
  let nextSyncDue: string | null = null;
  if (sync.lastSync) {
    nextSyncDue = new Date(new Date(sync.lastSync).getTime() + getSystemSettings().scryfallStaleHours * 60 * 60 * 1000).toISOString();
  }

  const calls = getCallCounts();

  let dataDirFree = 0;
  try { dataDirFree = fs.statfsSync(dataDir).bavail * fs.statfsSync(dataDir).bsize; } catch { /* ignore */ }

  return {
    users: { total: totalUsers, admins, disabled, active7d: countActive(7), active30d: countActive(30), activeSessions },
    storage: {
      systemDbBytes,
      usersBytes,
      perUser,
      images: { files: img.files, bytes: img.bytes },
      dataDirFree,
    },
    catalog: { cards, sets, syncing: sync.syncing, lastSync: sync.lastSync, stage: sync.stage, nextSyncDue, jobs: sync.jobs },
    calls,
  };
}
