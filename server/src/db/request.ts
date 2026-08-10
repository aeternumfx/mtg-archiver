import { AsyncLocalStorage } from 'async_hooks';
import { getUserSqlite, getUserDb } from './user';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';
import type * as schema from './schema';

export interface UserSessionContext {
  userId: number;
  role: 'admin' | 'user';
  username: string;
}

const als = new AsyncLocalStorage<UserSessionContext | null>();

export function runWithUser(ctx: UserSessionContext | null, fn: () => void) {
  if (!ctx) {
    als.run(null, fn);
    return;
  }
  als.run(ctx, fn);
}

export function getSessionContext(): UserSessionContext | null {
  return als.getStore() ?? null;
}

function makeUserProxy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop, _recv) {
      const target = resolve();
      const val = (target as Record<PropertyKey, unknown>)[prop];
      if (typeof val === 'function') return (val as (...args: unknown[]) => unknown).bind(target);
      return val;
    },
    has(_target, prop) {
      return prop in resolve();
    },
  });
}

export const db = makeUserProxy(() => {
  const ctx = getSessionContext();
  if (!ctx) throw new Error('No user context for database access');
  return getUserDb(ctx.userId);
}) as BetterSQLite3Database<typeof schema>;

export const sqlite = makeUserProxy(() => {
  const ctx = getSessionContext();
  if (!ctx) throw new Error('No user context for database access');
  return getUserSqlite(ctx.userId);
}) as DatabaseType;
