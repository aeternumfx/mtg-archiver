import { systemSqlite } from '../db/system';
import { createUser, listUsers } from './users';

export function bootstrapAdmin() {
  const count = systemSqlite.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
  if (count.c > 0) return;

  const username = process.env.INITIAL_ADMIN_USERNAME || 'admin';
  const password = process.env.INITIAL_ADMIN_PASSWORD || 'admin';
  if (!username || !password) {
    console.warn(
      'No users exist yet. Set INITIAL_ADMIN_USERNAME/INITIAL_ADMIN_PASSWORD on first boot, or run: npm run create-admin -- --username <name> --password <pass>'
    );
    return;
  }
  if (listUsers().some(u => u.username.toLowerCase() === username.toLowerCase())) return;
  createUser(username, password, 'admin', false);
  if (!process.env.INITIAL_ADMIN_PASSWORD) {
    console.warn(
      `Bootstrap admin user "${username}" created with the default password. Change it immediately: Settings -> user menu -> reset password, or set INITIAL_ADMIN_PASSWORD before first boot.`
    );
  } else {
    console.log(`Bootstrap admin user "${username}" created.`);
  }
}
