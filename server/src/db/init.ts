import { systemSqlite } from './system';
import { initSystemSchema } from './initSystem';

export function initDb() {
  initSystemSchema(systemSqlite);
  console.log('System database initialized');
}
