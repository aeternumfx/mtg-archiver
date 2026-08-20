import type { Database as DatabaseType } from 'better-sqlite3';

export const SCHEMA_VERSION = 7;

export const SCHEMA_TABLES: Record<string, string[]> = {
  location_groups: ['id', 'name', 'description', 'sort_order', 'created_at'],
  locations: ['id', 'name', 'description', 'type', 'group_id', 'deck_id', 'built_in', 'created_at'],
  collection_items: ['id', 'card_id', 'location_id', 'destination_id', 'deck_id', 'foil', 'foreign_language', 'condition', 'quantity', 'purchase_price', 'price_autofilled', 'pack_opened', 'proxy', 'misprint', 'altered', 'notes', 'acquired_at', 'created_at'],
  collection_history: ['id', 'date', 'total_cards', 'total_value', 'purchase_value', 'created_at'],
  decks: ['id', 'name', 'description', 'card_id', 'deck_type', 'commander_card_id', 'partner_card_id', 'background_card_id', 'commander_item_id', 'partner_item_id', 'background_item_id', 'group_id', 'created_at'],
  deck_required_cards: ['id', 'deck_id', 'card_id', 'card_name', 'set_code', 'collector_number', 'quantity', 'fill_item_id', 'created_at'],
  wantlist_items: ['id', 'card_id', 'card_name', 'set_code', 'collector_number', 'foil', 'condition', 'quantity', 'notes', 'destination_id', 'collection_goal_id', 'deck_required_id', 'trade_id', 'persistent', 'created_at'],
  booster_sessions: ['id', 'set_code', 'booster_type', 'booster_price', 'total_value', 'completed', 'created_at'],
  booster_pulls: ['id', 'session_id', 'card_id', 'foil', 'slot_index', 'location_id', 'added_to_collection', 'created_at'],
  collection_goals: ['id', 'location_id', 'kind', 'card_id', 'card_name', 'set_codes', 'target_count', 'fulfilled_count', 'status', 'created_at'],
  movement_history: ['id', 'item_id', 'card_id', 'card_name', 'action', 'from_location_id', 'to_location_id', 'quantity', 'details', 'undone', 'created_at'],
  trades: ['id', 'title', 'status', 'your_cash', 'their_cash', 'contact_info', 'notes', 'received_location_id', 'received_destination_id', 'completed_at', 'created_at', 'updated_at'],
  trade_items: ['id', 'trade_id', 'side', 'card_id', 'card_name', 'set_code', 'collector_number', 'foil', 'condition', 'quantity', 'price', 'location_id', 'destination_id'],
};

export interface TableAudit {
  table: string;
  exists: boolean;
  missing: string[];
  extra: string[];
}

export interface SchemaAudit {
  version: number;
  tables: TableAudit[];
  unknownTables: string[];
  hasDifferences: boolean;
}

export function auditUserSchema(sqlite: DatabaseType): SchemaAudit {
  const tables: TableAudit[] = [];
  for (const [table, expected] of Object.entries(SCHEMA_TABLES)) {
    let actual: string[] = [];
    try {
      actual = (sqlite.pragma(`table_info(${table})`) as Array<{ name: string }>).map(c => c.name);
    } catch {
      /* table missing */
    }
    const expectedSet = new Set(expected);
    const actualSet = new Set(actual);
    tables.push({
      table,
      exists: actual.length > 0,
      missing: expected.filter(c => !actualSet.has(c)),
      extra: actual.filter(c => !expectedSet.has(c)),
    });
  }

  const allTables = new Set<string>();
  const rows = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
  for (const r of rows) allTables.add(r.name);

  const unknownTables = [...allTables]
    .filter(t => !SCHEMA_TABLES[t])
    .filter(t => !t.startsWith('sqlite_') && !t.startsWith('_') && t !== 'inbox');

  const hasDifferences = tables.some(t => t.missing.length > 0 || t.extra.length > 0) || unknownTables.length > 0;

  return {
    version: readUserVersion(sqlite),
    tables,
    unknownTables,
    hasDifferences,
  };
}

export function readUserVersion(sqlite: DatabaseType): number {
  try {
    return sqlite.pragma('user_version', { simple: true }) as number;
  } catch {
    return 0;
  }
}

export function stampUserVersion(sqlite: DatabaseType, version: number = SCHEMA_VERSION) {
  sqlite.pragma(`user_version = ${version}`);
}

export function pruneExtraColumns(sqlite: DatabaseType): { removed: string[]; errors: string[] } {
  const removed: string[] = [];
  const errors: string[] = [];
  for (const [table, expected] of Object.entries(SCHEMA_TABLES)) {
    let actual: string[] = [];
    try {
      actual = (sqlite.pragma(`table_info(${table})`) as Array<{ name: string }>).map(c => c.name);
    } catch {
      continue;
    }
    const expectedSet = new Set(expected);
    for (const col of actual) {
      if (expectedSet.has(col)) continue;
      try {
        sqlite.exec(`ALTER TABLE ${table} DROP COLUMN ${col}`);
        removed.push(`${table}.${col}`);
      } catch (err: any) {
        errors.push(`${table}.${col}: ${err?.message ?? String(err)}`);
      }
    }
  }
  return { removed, errors };
}
