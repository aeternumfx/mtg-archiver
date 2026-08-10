import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';
import { systemSqlite } from '../db/system';
import { usersDir, dataDir } from '../db/paths';
import { closeAllUserConnections } from '../db/user';

const SYSTEM_TABLES = ['users', 'sessions', 'user_requests', 'sync_meta'];

export async function restoreFromBackup(zipPath: string): Promise<void> {
  const staging = fs.mkdtempSync(path.join(dataDir, '.restore-staging-'));
  try {
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(staging, true);

    const manifestPath = path.join(staging, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('Invalid backup: missing manifest.json');
    }
    let manifest: { app?: string };
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      throw new Error('Invalid backup: could not read manifest.json');
    }
    if (manifest.app !== 'mtg-archiver') {
      throw new Error('Invalid backup: not an mtg-archiver backup');
    }

    const systemSnapshot = path.join(staging, 'system.db');
    if (!fs.existsSync(systemSnapshot)) {
      throw new Error('Invalid backup: missing system.db');
    }

    // Replace user-facing system tables; the shared Scryfall catalog is kept.
    systemSqlite.pragma('foreign_keys = OFF');
    systemSqlite.exec('DELETE FROM user_requests; DELETE FROM sessions; DELETE FROM sync_meta; DELETE FROM users;');
    systemSqlite.prepare('ATTACH DATABASE ? AS snap').run(systemSnapshot);
    try {
      for (const t of SYSTEM_TABLES) {
        systemSqlite.exec(`INSERT INTO ${t} SELECT * FROM snap.${t}`);
      }
    } finally {
      systemSqlite.exec('DETACH DATABASE snap');
    }
    systemSqlite.pragma('foreign_keys = ON');

    // Replace every per-user database with the ones from the backup.
    closeAllUserConnections();
    if (fs.existsSync(usersDir)) {
      for (const f of fs.readdirSync(usersDir)) {
        if (f.endsWith('.db') || f.endsWith('.db-wal') || f.endsWith('.db-shm')) {
          fs.rmSync(path.join(usersDir, f), { force: true });
        }
      }
    }
    fs.mkdirSync(usersDir, { recursive: true });
    const userSnapshots = path.join(staging, 'users');
    if (fs.existsSync(userSnapshots)) {
      for (const f of fs.readdirSync(userSnapshots)) {
        if (f.endsWith('.db')) {
          fs.copyFileSync(path.join(userSnapshots, f), path.join(usersDir, f));
        }
      }
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
