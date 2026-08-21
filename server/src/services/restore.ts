import AdmZip from 'adm-zip';
import fs from 'fs';
import path from 'path';
import { systemSqlite } from '../db/system';
import { usersDir, dataDir } from '../db/paths';
import { closeAllUserConnections } from '../db/user';
import { ensurePaymentRefs } from '../auth/users';

const SYSTEM_TABLES = ['users', 'sessions', 'user_requests', 'sync_meta'];

// Column names for a table in the given schema ('main' or 'snap'). Uses the
// PRAGMA table_info form which correctly reads ATTACHed schemas (unlike the
// pragma_table_info table-valued function, which ignores the schema qualifier).
function tableCols(schema: string, table: string): string[] {
  const rows = systemSqlite.pragma(
    schema === 'main' ? `table_info(${table})` : `${schema}.table_info(${table})`,
  ) as unknown as Array<{ name: string }>;
  return rows.map(r => r.name);
}

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
    // Copy by column intersection so a backup from an older app version (whose
    // tables have fewer columns, e.g. pre-billing) still restores cleanly into
    // the current schema, leaving new columns to their defaults.
    systemSqlite.pragma('foreign_keys = OFF');
    systemSqlite.exec('DELETE FROM user_requests; DELETE FROM sessions; DELETE FROM sync_meta; DELETE FROM users;');
    systemSqlite.prepare('ATTACH DATABASE ? AS snap').run(systemSnapshot);
    try {
      for (const t of SYSTEM_TABLES) {
        const destCols = tableCols('main', t);
        const snapCols = tableCols('snap', t);
        const common = destCols.filter(c => snapCols.includes(c));
        if (common.length === 0) continue;
        const cols = common.join(', ');
        // Bare column names are sufficient since only one table is selected;
        // the schema qualifier belongs on the table (snap.${t}).
        systemSqlite.exec(`INSERT INTO ${t} (${cols}) SELECT ${cols} FROM snap.${t}`);
      }

      // For users restored from an older backup that predates billing, default
      // them to a fresh complimentary plan. New columns already carry their
      // schema defaults; this guards against NULL/empty values from odd backups.
      systemSqlite.exec(
        `UPDATE users SET membership_tier = 'complimentary' WHERE membership_tier IS NULL OR membership_tier = ''`
      );
      systemSqlite.exec(`UPDATE users SET free_months = 0, paid_months = 0, trial_weeks = 0 WHERE free_months IS NULL OR paid_months IS NULL OR trial_weeks IS NULL`);
      systemSqlite.exec(`UPDATE users SET paid_until = NULL, paid_on = NULL, billing_notes = NULL WHERE paid_until IS NOT NULL AND paid_until = ''`);
    } finally {
      systemSqlite.exec('DETACH DATABASE snap');
    }
    systemSqlite.pragma('foreign_keys = ON');

    // Ensure every restored user has a unique payment reference code.
    ensurePaymentRefs();

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
