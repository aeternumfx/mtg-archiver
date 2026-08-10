import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { systemDbPath } from './paths';

const systemSqlite: DatabaseType = new Database(systemDbPath);
systemSqlite.pragma('journal_mode = WAL');
systemSqlite.pragma('foreign_keys = ON');

const systemDb = drizzle(systemSqlite, { schema });

export { systemSqlite, systemDb };
