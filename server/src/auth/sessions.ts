import { randomBytes, createHash } from 'crypto';
import { systemSqlite } from '../db/system';
import { getSystemSettings } from '../services/systemSettings';

export const COOKIE_NAME = 'mtg_session';
export const IMPERSONATE_COOKIE = 'mtg_impersonate';

function sessionTtlMs(): number {
  return getSystemSettings().sessionTtlDays * 24 * 60 * 60 * 1000;
}

/** Impersonation sessions are short-lived so a forgotten preview can't linger. */
const IMPERSONATE_TTL_MS = 12 * 60 * 60 * 1000;

export interface SessionUser {
  userId: number;
  username: string;
  role: 'admin' | 'user';
  disabled: number;
  mustChangePassword: number;
  demo: number;
  impersonatedBy: number | null;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createSession(userId: number): { token: string; expiresAt: string } {
  return insertSession(userId, null, sessionTtlMs());
}

export function createImpersonationSession(targetUserId: number, adminUserId: number): { token: string; expiresAt: string } {
  return insertSession(targetUserId, adminUserId, Math.min(sessionTtlMs(), IMPERSONATE_TTL_MS));
}

function insertSession(userId: number, impersonatedBy: number | null, ttlMs: number): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  systemSqlite.prepare(
    'INSERT INTO sessions (token_hash, user_id, impersonated_by, expires_at) VALUES (?, ?, ?, ?)'
  ).run(hashToken(token), userId, impersonatedBy, expiresAt);
  return { token, expiresAt };
}

export function getSessionUser(token: string | undefined | null): SessionUser | null {
  if (!token) return null;
  const row = systemSqlite.prepare(`
    SELECT s.user_id as userId, u.username, u.role, u.disabled, u.must_change_password as mustChangePassword,
      u.demo as demo, s.impersonated_by as impersonatedBy
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(hashToken(token), new Date().toISOString()) as SessionUser | undefined;
  if (!row || row.disabled) return null;
  return row;
}

export function deleteSession(token: string | undefined | null) {
  if (!token) return;
  systemSqlite.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function deleteUserSessions(userId: number) {
  systemSqlite.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function sessionCountsByUser(): Map<number, number> {
  const rows = systemSqlite.prepare(
    'SELECT user_id as userId, COUNT(*) as c FROM sessions WHERE expires_at > ? GROUP BY user_id'
  ).all(new Date().toISOString()) as Array<{ userId: number; c: number }>;
  return new Map(rows.map(r => [r.userId, r.c]));
}

export function readSessionCookie(req: { headers: { cookie?: string } }): string | undefined {
  return readCookie(req, COOKIE_NAME);
}

export function readImpersonationCookie(req: { headers: { cookie?: string } }): string | undefined {
  return readCookie(req, IMPERSONATE_COOKIE);
}

function readCookie(req: { headers: { cookie?: string } }, name: string): string | undefined {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return part.slice(idx + 1).trim();
      }
    }
  }
  return undefined;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: sessionTtlMs(),
  };
}
