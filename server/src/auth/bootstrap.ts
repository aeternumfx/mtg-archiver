import { systemSqlite } from '../db/system';
import { createUser, listUsers } from './users';
import { generateTempPassword } from './password';
import { ensureSetupToken, isInstanceSetupDone } from '../services/setupStatus';

export function bootstrapAdmin() {
  const count = systemSqlite.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
  if (count.c > 0) return;

  const username = (process.env.INITIAL_ADMIN_USERNAME || 'admin').trim();
  const password = process.env.INITIAL_ADMIN_PASSWORD || '';
  if (!username) {
    throw new Error('INITIAL_ADMIN_USERNAME is empty. Set it (or INITIAL_ADMIN_PASSWORD) before first boot.');
  }
  if (!password || password === 'admin') {
    const temp = generateTempPassword(16);
    console.warn(
      '========================================================================\n' +
      '  No secure INITIAL_ADMIN_PASSWORD was provided on first boot.\n' +
      `  A temporary admin password is: ${temp}\n` +
      '  You MUST change it immediately via the in-app password reset, or set\n' +
      '  INITIAL_ADMIN_PASSWORD before the next fresh boot.\n' +
      '========================================================================'
    );
    createUser(username, temp, 'admin', true);
  } else {
    createUser(username, password, 'admin', false);
  }

  if (!isInstanceSetupDone()) {
    const setupToken = ensureSetupToken();
    console.log(
      '========================================================================\n' +
      '  First-time setup is ready.\n' +
      `  Open the app and use this ONE-TIME setup token:\n` +
      `    ${setupToken}\n` +
      '  (This token is only accepted before the instance setup is completed.)\n' +
      '========================================================================'
    );
  }
}
