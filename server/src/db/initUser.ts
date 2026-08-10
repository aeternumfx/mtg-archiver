import type { Database as DatabaseType } from 'better-sqlite3';

export function initUserSchema(sqlite: DatabaseType) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS location_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      type TEXT NOT NULL DEFAULT 'binder',
      group_id INTEGER REFERENCES location_groups(id),
      built_in INTEGER NOT NULL DEFAULT 0,
      deck_id INTEGER REFERENCES decks(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS collection_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT NOT NULL,
      location_id INTEGER NOT NULL REFERENCES locations(id),
      destination_id INTEGER REFERENCES locations(id),
      deck_id INTEGER REFERENCES decks(id),
      foil INTEGER NOT NULL DEFAULT 0,
      condition TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      purchase_price REAL,
      price_autofilled INTEGER NOT NULL DEFAULT 0,
      pack_opened INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      acquired_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS collection_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      total_cards INTEGER NOT NULL,
      total_value REAL NOT NULL,
      purchase_value REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS decks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      card_id TEXT,
      deck_type TEXT NOT NULL DEFAULT 'custom',
      commander_card_id TEXT,
      partner_card_id TEXT,
      background_card_id TEXT,
      commander_item_id INTEGER REFERENCES collection_items(id),
      partner_item_id INTEGER REFERENCES collection_items(id),
      background_item_id INTEGER REFERENCES collection_items(id),
      group_id INTEGER REFERENCES location_groups(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS deck_required_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deck_id INTEGER NOT NULL REFERENCES decks(id),
      card_id TEXT,
      card_name TEXT NOT NULL,
      set_code TEXT,
      collector_number TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS wantlist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT,
      card_name TEXT NOT NULL,
      set_code TEXT,
      collector_number TEXT,
      foil INTEGER NOT NULL DEFAULT 0,
      condition TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      destination_id INTEGER,
      collection_goal_id INTEGER,
      deck_required_id INTEGER,
      persistent INTEGER NOT NULL DEFAULT 0,
      trade_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS booster_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      set_code TEXT NOT NULL,
      booster_type TEXT NOT NULL,
      booster_price REAL NOT NULL,
      total_value REAL NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS booster_pulls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES booster_sessions(id),
      card_id TEXT NOT NULL,
      foil INTEGER NOT NULL DEFAULT 0,
      slot_index INTEGER NOT NULL,
      location_id INTEGER REFERENCES locations(id),
      added_to_collection INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS collection_goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER NOT NULL REFERENCES locations(id),
      kind TEXT NOT NULL,
      card_id TEXT,
      card_name TEXT,
      set_codes TEXT,
      target_count INTEGER,
      fulfilled_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS movement_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER,
      card_id TEXT,
      card_name TEXT,
      action TEXT NOT NULL,
      from_location_id INTEGER,
      to_location_id INTEGER,
      quantity INTEGER NOT NULL DEFAULT 1,
      details TEXT,
      undone INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      your_cash REAL NOT NULL DEFAULT 0,
      their_cash REAL NOT NULL DEFAULT 0,
      contact_info TEXT,
      notes TEXT,
      received_location_id INTEGER,
      received_destination_id INTEGER,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS trade_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id INTEGER NOT NULL REFERENCES trades(id),
      side TEXT NOT NULL,
      card_id TEXT,
      card_name TEXT NOT NULL,
      set_code TEXT,
      collector_number TEXT,
      foil INTEGER NOT NULL DEFAULT 0,
      condition TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      price REAL,
      location_id INTEGER,
      destination_id INTEGER
    )
  `);

  const tradeCols = (sqlite.pragma('table_info(trades)') as Array<{ name: string }>).map(c => c.name);
  if (!tradeCols.includes('received_location_id')) sqlite.exec('ALTER TABLE trades ADD COLUMN received_location_id INTEGER');
  if (!tradeCols.includes('received_destination_id')) sqlite.exec('ALTER TABLE trades ADD COLUMN received_destination_id INTEGER');

  const tiCols = (sqlite.pragma('table_info(trade_items)') as Array<{ name: string }>).map(c => c.name);
  if (!tiCols.includes('location_id')) sqlite.exec('ALTER TABLE trade_items ADD COLUMN location_id INTEGER');
  if (!tiCols.includes('destination_id')) sqlite.exec('ALTER TABLE trade_items ADD COLUMN destination_id INTEGER');

  const locCols = (sqlite.pragma('table_info(locations)') as Array<{ name: string }>).map(c => c.name);
  if (!locCols.includes('group_id')) sqlite.exec('ALTER TABLE locations ADD COLUMN group_id INTEGER REFERENCES location_groups(id)');
  if (!locCols.includes('type')) sqlite.exec("ALTER TABLE locations ADD COLUMN type TEXT NOT NULL DEFAULT 'binder'");
  if (!locCols.includes('built_in')) sqlite.exec("ALTER TABLE locations ADD COLUMN built_in INTEGER NOT NULL DEFAULT 0");
  if (!locCols.includes('deck_id')) sqlite.exec('ALTER TABLE locations ADD COLUMN deck_id INTEGER REFERENCES decks(id)');

  const inboxExists = sqlite.prepare("SELECT id FROM locations WHERE name = 'Inbox'").get();
  if (!inboxExists) {
    sqlite.prepare("INSERT INTO locations (name, description, type, built_in) VALUES ('Inbox', 'Default location for new cards. Cannot be renamed or deleted.', 'other', 1)").run();
  }

  const ciCols = (sqlite.pragma('table_info(collection_items)') as Array<{ name: string }>).map(c => c.name);
  if (!ciCols.includes('deck_id')) sqlite.exec('ALTER TABLE collection_items ADD COLUMN deck_id INTEGER REFERENCES decks(id)');
  if (!ciCols.includes('destination_id')) sqlite.exec('ALTER TABLE collection_items ADD COLUMN destination_id INTEGER REFERENCES locations(id)');

  const chCols = (sqlite.pragma('table_info(collection_history)') as Array<{ name: string }>).map(c => c.name);
  if (!chCols.includes('purchase_value')) sqlite.exec('ALTER TABLE collection_history ADD COLUMN purchase_value REAL');

  const deckCols = (sqlite.pragma('table_info(decks)') as Array<{ name: string }>).map(c => c.name);
  if (!deckCols.includes('group_id')) sqlite.exec('ALTER TABLE decks ADD COLUMN group_id INTEGER REFERENCES location_groups(id)');
  if (!deckCols.includes('deck_type')) sqlite.exec("ALTER TABLE decks ADD COLUMN deck_type TEXT NOT NULL DEFAULT 'custom'");
  if (!deckCols.includes('commander_card_id')) sqlite.exec('ALTER TABLE decks ADD COLUMN commander_card_id TEXT');
  if (!deckCols.includes('partner_card_id')) sqlite.exec('ALTER TABLE decks ADD COLUMN partner_card_id TEXT');
  if (!deckCols.includes('background_card_id')) sqlite.exec('ALTER TABLE decks ADD COLUMN background_card_id TEXT');
  if (!deckCols.includes('commander_item_id')) sqlite.exec('ALTER TABLE decks ADD COLUMN commander_item_id INTEGER REFERENCES collection_items(id)');
  if (!deckCols.includes('partner_item_id')) sqlite.exec('ALTER TABLE decks ADD COLUMN partner_item_id INTEGER REFERENCES collection_items(id)');
  if (!deckCols.includes('background_item_id')) sqlite.exec('ALTER TABLE decks ADD COLUMN background_item_id INTEGER REFERENCES collection_items(id)');

  const decksMissingLoc = sqlite.prepare(`
    SELECT d.id, d.name, d.description, d.group_id as groupId
    FROM decks d
    WHERE NOT EXISTS (SELECT 1 FROM locations l WHERE l.deck_id = d.id)
  `).all() as Array<{ id: number; name: string; description: string | null; groupId: number | null }>;
  for (const d of decksMissingLoc) {
    try {
      sqlite.prepare(`
        INSERT INTO locations (name, description, type, group_id, deck_id)
        VALUES (?, ?, 'deck', ?, ?)
      `).run(d.name, d.description ? `Deck location for ${d.name}` : null, d.groupId, d.id);
    } catch { /* name collision; deck location can be created lazily */ }
  }

  const wlCols = (sqlite.pragma('table_info(wantlist_items)') as Array<{ name: string }>).map(c => c.name);
  if (!wlCols.includes('foil')) sqlite.exec("ALTER TABLE wantlist_items ADD COLUMN foil INTEGER NOT NULL DEFAULT 0");
  if (!wlCols.includes('condition')) sqlite.exec("ALTER TABLE wantlist_items ADD COLUMN condition TEXT");
  if (!wlCols.includes('destination_id')) sqlite.exec("ALTER TABLE wantlist_items ADD COLUMN destination_id INTEGER");
  if (!wlCols.includes('collection_goal_id')) sqlite.exec("ALTER TABLE wantlist_items ADD COLUMN collection_goal_id INTEGER");
  if (!wlCols.includes('persistent')) sqlite.exec("ALTER TABLE wantlist_items ADD COLUMN persistent INTEGER NOT NULL DEFAULT 0");
  if (!wlCols.includes('deck_required_id')) sqlite.exec("ALTER TABLE wantlist_items ADD COLUMN deck_required_id INTEGER");
  if (!wlCols.includes('trade_id')) sqlite.exec("ALTER TABLE wantlist_items ADD COLUMN trade_id INTEGER");

  const mhCols = sqlite.prepare(`PRAGMA table_info(movement_history)`).all() as Array<{ name: string }>;
  if (!mhCols.some(c => c.name === 'undone')) {
    sqlite.exec("ALTER TABLE movement_history ADD COLUMN undone INTEGER NOT NULL DEFAULT 0");
  }

  const indexes: Array<[string, string]> = [
    ['idx_ci_location', 'CREATE INDEX IF NOT EXISTS idx_ci_location ON collection_items(location_id)'],
    ['idx_ci_card', 'CREATE INDEX IF NOT EXISTS idx_ci_card ON collection_items(card_id)'],
    ['idx_ci_deck', 'CREATE INDEX IF NOT EXISTS idx_ci_deck ON collection_items(deck_id)'],
    ['idx_ci_dest', 'CREATE INDEX IF NOT EXISTS idx_ci_dest ON collection_items(destination_id)'],
    ['idx_wl_dest', 'CREATE INDEX IF NOT EXISTS idx_wl_dest ON wantlist_items(destination_id)'],
    ['idx_wl_goal', 'CREATE INDEX IF NOT EXISTS idx_wl_goal ON wantlist_items(collection_goal_id)'],
    ['idx_decks_group', 'CREATE INDEX IF NOT EXISTS idx_decks_group ON decks(group_id)'],
    ['idx_mh_item', 'CREATE INDEX IF NOT EXISTS idx_mh_item ON movement_history(item_id)'],
    ['idx_ti_trade', 'CREATE INDEX IF NOT EXISTS idx_ti_trade ON trade_items(trade_id)'],
    ['idx_req_deck', 'CREATE INDEX IF NOT EXISTS idx_req_deck ON deck_required_cards(deck_id)'],
  ];
  for (const [, stmt] of indexes) {
    sqlite.exec(stmt);
  }
}
