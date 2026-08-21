import { systemSqlite } from '../db/system';
import { getSystemSettings } from './systemSettings';

// Periodically disables accounts whose arrears grace period has fully elapsed,
// but only when the admin has configured the arrears action to 'disable'.
// Admins and the demo/shared account are never auto-disabled.
export function enforceArrears(): { disabled: number; ran: boolean } {
  const settings = getSystemSettings();
  if (settings.arrearsAction !== 'disable' || settings.arrearsDays <= 0) {
    return { disabled: 0, ran: false };
  }
  const graceMs = settings.arrearsDays * 86400000;
  const cutoff = new Date(Date.now() - graceMs).toISOString().slice(0, 10);

  const rows = systemSqlite.prepare(
    `SELECT id FROM users
     WHERE demo = 0 AND role != 'admin' AND disabled = 0
       AND paid_until IS NOT NULL AND paid_until != '' AND paid_until <= ?`
  ).all(cutoff) as Array<{ id: number }>;

  let disabled = 0;
  for (const { id } of rows) {
    systemSqlite.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(id);
    disabled++;
  }
  return { disabled, ran: true };
}
