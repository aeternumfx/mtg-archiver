import { systemSqlite } from '../db/system';
import { initSystemSchema } from '../db/initSystem';
import { createUser, listUsers } from '../auth/users';

function parseArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  const val = process.argv[idx + 1];
  return val && !val.startsWith('--') ? val : undefined;
}

const username = parseArg('username');
const password = parseArg('password');
const role = parseArg('role') === 'admin' ? 'admin' : parseArg('role') === 'moderator' ? 'moderator' : 'user';
const dataDir = parseArg('data-dir');
if (dataDir) process.env.DATA_DIR = dataDir;

initSystemSchema(systemSqlite);

if (!username || !password) {
  console.error('Usage: npm run create-admin -- --username <name> --password <pass> [--role admin|user] [--data-dir <dir>]');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const existing = listUsers().find(u => u.username.toLowerCase() === username.toLowerCase());
if (existing) {
  console.error(`User "${username}" already exists.`);
  process.exit(1);
}

const user = createUser(username, password, role, false);
console.log(`Created ${role} user "${user.username}" (id ${user.id}).`);
process.exit(0);
