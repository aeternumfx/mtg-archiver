import { systemSqlite } from '../db/system';
import { hashPassword, generateTempPassword } from './password';
import { deleteUserSessions } from './sessions';
import fs from 'fs';
import { userDbPath, usersDir } from '../db/paths';
import { closeUserConnection } from '../db/user';

export interface UserRow {
  id: number;
  username: string;
  role: string;
  disabled: number;
  mustChangePassword: number;
  demo: number;
  createdAt: string;
  lastLoginAt: string | null;
}

const USER_COLS = `id, username, role, disabled, must_change_password as mustChangePassword, demo,
  created_at as createdAt, last_login_at as lastLoginAt`;

export function getUserByUsername(username: string): UserRow | undefined {
  return systemSqlite.prepare(`SELECT ${USER_COLS} FROM users WHERE username = ?`).get(username) as UserRow | undefined;
}

export function getUserById(id: number): UserRow | undefined {
  return systemSqlite.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id) as UserRow | undefined;
}

export function getUserPasswordHash(userId: number): string {
  const row = systemSqlite.prepare('SELECT password_hash as hash FROM users WHERE id = ?').get(userId) as { hash: string } | undefined;
  return row?.hash ?? '';
}

export function createUser(username: string, password: string, role: 'admin' | 'moderator' | 'user', mustChangePassword: boolean, demo = false): UserRow {
  const hash = hashPassword(password);
  const result = systemSqlite.prepare(
    'INSERT INTO users (username, password_hash, role, must_change_password, demo) VALUES (?, ?, ?, ?, ?)'
  ).run(username, hash, role, mustChangePassword ? 1 : 0, demo ? 1 : 0);
  const id = Number(result.lastInsertRowid);
  return getUserById(id)!;
}

export function setUserPassword(userId: number, password: string, mustChangePassword: boolean) {
  const hash = hashPassword(password);
  systemSqlite.prepare(
    'UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?'
  ).run(hash, mustChangePassword ? 1 : 0, userId);
  deleteUserSessions(userId);
}

export function updateUser(userId: number, fields: { disabled?: boolean; role?: 'admin' | 'moderator' | 'user'; mustChangePassword?: boolean; username?: string }) {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (fields.disabled !== undefined) { sets.push('disabled = ?'); params.push(fields.disabled ? 1 : 0); }
  if (fields.role !== undefined) { sets.push('role = ?'); params.push(fields.role); }
  if (fields.mustChangePassword !== undefined) { sets.push('must_change_password = ?'); params.push(fields.mustChangePassword ? 1 : 0); }
  if (fields.username !== undefined) { sets.push('username = ?'); params.push(fields.username); }
  if (sets.length === 0) return;
  params.push(userId);
  systemSqlite.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  if (fields.disabled) deleteUserSessions(userId);
}

export function touchLastLogin(userId: number) {
  systemSqlite.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), userId);
}

export function listUsers(): UserRow[] {
  return systemSqlite.prepare(
    `SELECT ${USER_COLS} FROM users ORDER BY username`
  ).all() as UserRow[];
}

export function permanentlyDeleteUser(userId: number) {
  deleteUserSessions(userId);
  systemSqlite.prepare('DELETE FROM user_requests WHERE user_id = ?').run(userId);
  systemSqlite.prepare('DELETE FROM users WHERE id = ?').run(userId);
  closeUserConnection(userId);
  try {
    fs.rmSync(userDbPath(userId), { force: true });
    for (const suffix of ['-wal', '-shm']) {
      fs.rmSync(userDbPath(userId) + suffix, { force: true });
    }
  } catch { /* best effort */ }
}

export function deleteAllUsersExcept(userId: number) {
  const others = systemSqlite.prepare('SELECT id FROM users WHERE id != ?').all(userId) as Array<{ id: number }>;
  for (const u of others) {
    permanentlyDeleteUser(u.id);
  }
}

export function adminStats() {
  const users = systemSqlite.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
  const admins = systemSqlite.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get() as { c: number };
  const disabled = systemSqlite.prepare('SELECT COUNT(*) as c FROM users WHERE disabled = 1').get() as { c: number };
  const dirExists = fs.existsSync(usersDir);
  const userDbs = dirExists ? fs.readdirSync(usersDir).filter(f => f.endsWith('.db')).length : 0;
  return { users: users.c, admins: admins.c, disabled: disabled.c, userDbs };
}

export { generateTempPassword };
