import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import fs from 'fs';
import { usersDir, userDbPath } from './paths';
import { initUserSchema } from './initUser';
import { auditUserSchema, stampUserVersion } from './schemaAudit';

fs.mkdirSync(usersDir, { recursive: true });

const connections = new Map<number, DatabaseType>();
const MAX_CONNECTIONS = 500;

export function getUserSqlite(userId: number): DatabaseType {
  let c = connections.get(userId);
  if (!c) {
    const p = userDbPath(userId);
    c = new Database(p);
    c.pragma('journal_mode = WAL');
    c.pragma('foreign_keys = ON');
    try {
      fs.chmodSync(p, 0o600);
    } catch {
      /* best effort on platforms without chmod */
    }
    connections.set(userId, c);
    initUserSchema(c);
    stampUserVersion(c);
    try {
      const audit = auditUserSchema(c);
      const extra = audit.tables.flatMap(t => t.extra.map(col => `${t.table}.${col}`));
      const missing = audit.tables.flatMap(t => t.missing.map(col => `${t.table}.${col}`));
      if (missing.length) {
        console.warn(`[db] user ${userId}: schema missing columns (auto-migrated): ${missing.join(', ')}`);
      }
      if (extra.length || audit.unknownTables.length) {
        console.warn(`[db] user ${userId}: schema has columns/tables not in this build: ${extra.join(', ')}${audit.unknownTables.length ? ` unknown tables: ${audit.unknownTables.join(', ')}` : ''}`);
      }
    } catch {
      /* audit is best-effort */
    }
    if (connections.size > MAX_CONNECTIONS) {
      const oldest = connections.keys().next().value;
      if (oldest !== undefined && oldest !== userId) {
        const conn = connections.get(oldest);
        connections.delete(oldest);
        try { conn?.close(); } catch { /* ignore */ }
      }
    }
  }
  return c;
}

export function getUserDb(userId: number) {
  return drizzle(getUserSqlite(userId), { schema });
}

export function closeUserConnection(userId: number) {
  const c = connections.get(userId);
  if (c) {
    connections.delete(userId);
    try { c.close(); } catch { /* ignore */ }
  }
}

export function closeAllUserConnections() {
  for (const [, c] of connections) {
    try { c.close(); } catch { /* ignore */ }
  }
  connections.clear();
}
