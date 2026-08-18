import type { Database as DatabaseType } from 'better-sqlite3';

export function initSystemSchema(sqlite: DatabaseType) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS scryfall_cards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      set_name TEXT NOT NULL,
      set_code TEXT NOT NULL,
      collector_number TEXT NOT NULL,
      rarity TEXT,
      mana_cost TEXT,
      cmc REAL,
      type_line TEXT,
      oracle_text TEXT,
      colors TEXT,
      color_identity TEXT,
      image_uris TEXT,
      prices TEXT,
      power TEXT,
      toughness TEXT,
      loyalty TEXT,
      legalities TEXT,
      released_at TEXT,
      layout TEXT,
      updated_at TEXT NOT NULL
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sets (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      set_type TEXT NOT NULL,
      has_boosters INTEGER NOT NULL DEFAULT 0,
      released_at TEXT,
      updated_at TEXT
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      must_change_password INTEGER NOT NULL DEFAULT 0,
      disabled INTEGER NOT NULL DEFAULT 0,
      demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT
    )
  `);

  const userCols = (sqlite.pragma('table_info(users)') as Array<{ name: string }>).map(c => c.name);
  if (!userCols.includes('demo')) {
    sqlite.exec('ALTER TABLE users ADD COLUMN demo INTEGER NOT NULL DEFAULT 0');
  }
  if (!userCols.includes('display_name')) {
    sqlite.exec('ALTER TABLE users ADD COLUMN display_name TEXT');
  }
  if (!userCols.includes('avatar')) {
    sqlite.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
  }
  if (!userCols.includes('collection_privacy')) {
    sqlite.exec("ALTER TABLE users ADD COLUMN collection_privacy TEXT NOT NULL DEFAULT 'private'");
  }
  if (!userCols.includes('wantlist_privacy')) {
    sqlite.exec("ALTER TABLE users ADD COLUMN wantlist_privacy TEXT NOT NULL DEFAULT 'private'");
  }
  if (!userCols.includes('collection_password')) {
    sqlite.exec('ALTER TABLE users ADD COLUMN collection_password TEXT');
  }
  if (!userCols.includes('wantlist_password')) {
    sqlite.exec('ALTER TABLE users ADD COLUMN wantlist_password TEXT');
  }
  if (!userCols.includes('share_token')) {
    sqlite.exec('ALTER TABLE users ADD COLUMN share_token TEXT');
  }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      impersonated_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    )
  `);

  const sessCols = (sqlite.pragma('table_info(sessions)') as Array<{ name: string }>).map(c => c.name);
  if (!sessCols.includes('impersonated_by')) {
    sqlite.exec('ALTER TABLE sessions ADD COLUMN impersonated_by INTEGER REFERENCES users(id)');
  }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS user_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      username TEXT NOT NULL,
      type TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT,
      urgent INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const scCols = (sqlite.pragma('table_info(scryfall_cards)') as Array<{ name: string }>).map(c => c.name);
  const addScCol = (name: string, def: string) => {
    if (!scCols.includes(name)) sqlite.exec(`ALTER TABLE scryfall_cards ADD COLUMN ${name} ${def}`);
  };
  addScCol('promo', 'INTEGER NOT NULL DEFAULT 0');
  addScCol('seriealized', 'INTEGER NOT NULL DEFAULT 0');
  addScCol('full_art', 'INTEGER NOT NULL DEFAULT 0');
  addScCol('textless', 'INTEGER NOT NULL DEFAULT 0');
  addScCol('finishes', 'TEXT');
  addScCol('frame_effects', 'TEXT');
  addScCol('card_faces', 'TEXT');

  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_sc_name ON scryfall_cards(name)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_sc_set ON scryfall_cards(set_code)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_sc_color ON scryfall_cards(color_identity)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_sc_type ON scryfall_cards(type_line)`);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_sc_set_col ON scryfall_cards(set_code, collector_number)`);
}
