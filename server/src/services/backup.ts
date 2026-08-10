import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { systemDbPath, usersDir, dataDir, imagesDir } from '../db/paths';
import { listUsers } from '../auth/users';
import type { Archiver } from 'archiver';

const require = createRequire(import.meta.url);
const archiver = require('archiver') as (format: string, options?: Record<string, unknown>) => Archiver;

export interface BackupResult {
  file: string;
  filename: string;
  size: number;
}

const MAX_BACKUPS = 10;

function pruneOldBackups(dir: string) {
  try {
    const zips = fs.readdirSync(dir)
      .filter(f => f.endsWith('.zip'))
      .map(f => ({ f, stat: fs.statSync(path.join(dir, f)) }))
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    for (const old of zips.slice(MAX_BACKUPS)) {
      fs.rmSync(path.join(dir, old.f), { force: true });
    }
  } catch { /* best effort */ }
}

function timestamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

async function snapshotDb(src: string, dest: string): Promise<void> {
  // Open a dedicated connection so the WAL is checkpointed into a consistent copy.
  const db = new Database(src, { readonly: true });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }
}

// Only user/instance data — excludes the shared Scryfall catalog (re-downloadable).
const USER_SYSTEM_TABLES = ['users', 'sessions', 'user_requests', 'sync_meta'];

function snapshotSystemUserData(dest: string): void {
  const out = new Database(dest);
  out.pragma('foreign_keys = OFF');
  out.prepare('ATTACH DATABASE ? AS src').run(systemDbPath);
  try {
    for (const t of USER_SYSTEM_TABLES) {
      out.exec(`CREATE TABLE ${t} AS SELECT * FROM src.${t}`);
    }
  } finally {
    out.exec('DETACH DATABASE src');
    out.close();
  }
}

export async function createBackupZip(options: { includeImages?: boolean; dir?: string } = {}): Promise<BackupResult> {
  const outDir = options.dir ?? path.join(dataDir, 'backups');
  fs.mkdirSync(outDir, { recursive: true });
  const filename = `mtg-archiver-backup-${timestamp()}.zip`;
  const file = path.join(outDir, filename);

  const staging = fs.mkdtempSync(path.join(dataDir, '.backup-staging-'));
  try {
    fs.mkdirSync(path.join(staging, 'users'), { recursive: true });

    snapshotSystemUserData(path.join(staging, 'system.db'));

    const users = listUsers();
    for (const u of users) {
      const src = path.join(usersDir, `user_${u.id}.db`);
      if (fs.existsSync(src)) {
        await snapshotDb(src, path.join(staging, 'users', `user_${u.id}.db`));
      }
    }

    if (options.includeImages && fs.existsSync(imagesDir)) {
      fs.cpSync(imagesDir, path.join(staging, 'images'), { recursive: true });
    }

    fs.writeFileSync(
      path.join(staging, 'manifest.json'),
      JSON.stringify({
        app: 'mtg-archiver',
        version: process.env.APP_VERSION || 'dev',
        createdAt: new Date().toISOString(),
        users: users.length,
        includesImages: !!options.includeImages,
      }, null, 2),
    );

    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(file);
      const archive: Archiver = archiver('zip', { zlib: { level: 6 } });
      output.on('close', () => resolve());
      archive.on('error', reject);
      archive.pipe(output);
      archive.directory(staging, false);
      archive.finalize();
    });
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }

  pruneOldBackups(outDir);

  return { file, filename, size: fs.statSync(file).size };
}