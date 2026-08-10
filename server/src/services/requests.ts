import { systemSqlite } from '../db/system';

export const REQUEST_TYPES = ['help', 'feature', 'bug', 'feedback', 'other'] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];
export const REQUEST_STATUSES = ['open', 'resolved'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export interface UserRequest {
  id: number;
  userId: number;
  username: string;
  type: RequestType;
  subject: string;
  message: string | null;
  urgent: number;
  status: RequestStatus;
  createdAt: string;
}

export function createRequest(input: {
  userId: number;
  username: string;
  type: RequestType;
  subject: string;
  message?: string | null;
  urgent: boolean;
}): UserRequest {
  const result = systemSqlite.prepare(
    'INSERT INTO user_requests (user_id, username, type, subject, message, urgent) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(input.userId, input.username, input.type, input.subject, input.message ?? null, input.urgent ? 1 : 0);
  const id = Number(result.lastInsertRowid);
  return systemSqlite.prepare('SELECT * FROM user_requests WHERE id = ?').get(id) as UserRequest;
}

export function listRequests(filter?: { type?: RequestType | 'all'; status?: RequestStatus | 'all' }): UserRequest[] {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.type && filter.type !== 'all') {
    conditions.push('type = ?');
    params.push(filter.type);
  }
  if (filter?.status && filter.status !== 'all') {
    conditions.push('status = ?');
    params.push(filter.status);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return systemSqlite.prepare(
    `SELECT id, user_id as userId, username, type, subject, message, urgent, status, created_at as createdAt
     FROM user_requests ${where} ORDER BY urgent DESC, created_at DESC`
  ).all(...params) as UserRequest[];
}

export function requestCounts(): Record<string, number> {
  const rows = systemSqlite.prepare('SELECT type, COUNT(*) as c FROM user_requests GROUP BY type').all() as Array<{ type: string; c: number }>;
  const counts: Record<string, number> = { all: 0 };
  for (const r of rows) {
    counts[r.type] = r.c;
    counts.all += r.c;
  }
  for (const t of REQUEST_TYPES) {
    if (!counts[t]) counts[t] = 0;
  }
  return counts;
}

export function pendingRequestCounts(): Record<string, number> {
  const rows = systemSqlite.prepare("SELECT type, COUNT(*) as c FROM user_requests WHERE status = 'open' GROUP BY type").all() as Array<{ type: string; c: number }>;
  const counts: Record<string, number> = { all: 0 };
  for (const r of rows) {
    counts[r.type] = r.c;
    counts.all += r.c;
  }
  for (const t of REQUEST_TYPES) {
    if (!counts[t]) counts[t] = 0;
  }
  return counts;
}

export function setRequestStatus(id: number, status: RequestStatus): UserRequest | undefined {
  systemSqlite.prepare('UPDATE user_requests SET status = ? WHERE id = ?').run(status, id);
  return systemSqlite.prepare('SELECT * FROM user_requests WHERE id = ?').get(id) as UserRequest | undefined;
}

export function deleteRequest(id: number): boolean {
  const result = systemSqlite.prepare('DELETE FROM user_requests WHERE id = ?').run(id);
  return result.changes > 0;
}

export function restoreRequest(r: UserRequest): void {
  systemSqlite.prepare(
    `INSERT OR REPLACE INTO user_requests (id, user_id, username, type, subject, message, urgent, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(r.id, r.userId, r.username, r.type, r.subject, r.message ?? null, r.urgent ? 1 : 0, r.status, r.createdAt ?? new Date().toISOString());
}

export function clearAllRequests() {
  systemSqlite.prepare('DELETE FROM user_requests').run();
}
