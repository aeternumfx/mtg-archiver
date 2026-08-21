import { fail } from '../utils/http';
import { Router } from 'express';
import { db, sqlite, getSessionContext } from '../db';
import { schema } from '../db';
import { clearUserSetup } from '../services/setupStatus';
import { computeImportDiff, resolveImportData, runImport } from '../services/importCompat';
import { getSystemSettings } from '../services/systemSettings';

export const dataRouter = Router();

function ensureInbox() {
  const exists = sqlite.prepare("SELECT id FROM locations WHERE name = 'Inbox'").get();
  if (!exists) {
    sqlite.prepare("INSERT INTO locations (name, description, type, built_in) VALUES ('Inbox', 'Default location for new cards. Cannot be renamed or deleted.', 'other', 1)").run();
  }
}

export function wipeAllUserData() {
  sqlite.exec('PRAGMA foreign_keys = OFF');
  sqlite.transaction(() => {
    sqlite.exec('DELETE FROM trade_items');
    sqlite.exec('DELETE FROM trades');
    sqlite.exec('DELETE FROM movement_history');
    sqlite.exec('DELETE FROM deck_required_cards');
    sqlite.exec('DELETE FROM wantlist_items');
    sqlite.exec('DELETE FROM collection_goals');
    sqlite.exec('DELETE FROM booster_pulls');
    sqlite.exec('DELETE FROM booster_sessions');
    sqlite.exec('DELETE FROM collection_history');
    sqlite.exec('DELETE FROM collection_items');
    sqlite.exec('DELETE FROM locations');
    sqlite.exec('DELETE FROM decks');
    sqlite.exec('DELETE FROM location_groups');
  })();
  sqlite.exec('PRAGMA foreign_keys = ON');
}

export function applyBasicSetup() {
  const groups = [
    { name: 'Binders', description: 'Physical binders and folders' },
    { name: 'Bulk', description: 'Bulk commons and uncommons' },
    { name: 'Decks', description: 'Constructed decks' },
  ];
  const insertGroup = sqlite.prepare('INSERT INTO location_groups (name, description) VALUES (?, ?) RETURNING id');
  for (const g of groups) {
    insertGroup.get(g.name, g.description);
  }
}

export function applyRecommended() {
  const groups = sqlite.prepare('SELECT id, name FROM location_groups ORDER BY name').all() as Array<{ id: number; name: string }>;
  const binders = groups.find(g => g.name === 'Binders');
  const bulk = groups.find(g => g.name === 'Bulk');
  const insertLoc = sqlite.prepare('INSERT INTO locations (name, description, group_id, type) VALUES (?, ?, ?, ?)');
  if (binders) {
    insertLoc.run('Red Binder', 'Modern staples and recent pulls', binders.id, 'binder');
    insertLoc.run('Blue Binder', 'Commander and casual cards', binders.id, 'binder');
  }
  if (bulk) insertLoc.run('Bulk Box 1', 'Common/uncommon bulk from recent sets', bulk.id, 'other');
}


export function resetToSetup(mode: 'basic' | 'recommended') {
  wipeAllUserData();
  if (mode === 'basic' || mode === 'recommended') applyBasicSetup();
  if (mode === 'recommended') applyRecommended();
  ensureInbox();
}

// Billing details shown to users on their profile so they know how to pay and
// what the plans cost. Deliberately only exposes billing fields (no other admin
// settings) to any authenticated user.
dataRouter.get('/billing', (_req, res) => {
  const s = getSystemSettings();
  res.json({
    basicPrice: s.basicPrice,
    proPrice: s.proPrice,
    accountName: s.accountName,
    accountHolder: s.accountHolder,
  });
});

dataRouter.get('/export', (_req, res) => {
  const locationGroups = db.select().from(schema.locationGroups).all();  const locations = db.select().from(schema.locations).all();
  const collectionItems = db.select().from(schema.collectionItems).all();
  const collectionHistory = db.select().from(schema.collectionHistory).all();
  const decks = db.select().from(schema.decks).all();
  const deckRequiredCards = db.select().from(schema.deckRequiredCards).all();
  const boosterSessions = db.select().from(schema.boosterSessions).all();
  const boosterPulls = db.select().from(schema.boosterPulls).all();
  const wantlistItems = db.select().from(schema.wantlistItems).all();
  const collectionGoals = db.select().from(schema.collectionGoals).all();
  const trades = db.select().from(schema.trades).all();
  const tradeItems = db.select().from(schema.tradeItems).all();
  const movementHistory = db.select().from(schema.movementHistory).all();

  res.json({
    version: 4,
    exportedAt: new Date().toISOString(),
    locationGroups,
    locations,
    collectionItems,
    collectionHistory,
    decks,
    deckRequiredCards,
    boosterSessions,
    boosterPulls,
    wantlistItems,
    collectionGoals,
    trades,
    tradeItems,
    movementHistory,
  });
});

dataRouter.post('/import/preview', (req, res) => {
  const { data } = req.body ?? {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return res.status(400).json({ error: 'Invalid request. Provide a backup data object.' });
  }
  try {
    res.json(computeImportDiff(data));
  } catch (err: any) {
    fail(res, err);
  }
});

dataRouter.post('/import', (req, res) => {
  const { data, mode, options } = req.body ?? {};

  if (!data || !mode || !['merge', 'replace'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid request. Provide data and mode ("merge" | "replace").' });
  }

  try {
    const normalized = resolveImportData(data, options);
    sqlite.exec('PRAGMA foreign_keys = OFF');
    sqlite.transaction(() => {
      if (mode === 'replace') {
        sqlite.exec('DELETE FROM trade_items');
        sqlite.exec('DELETE FROM trades');
        sqlite.exec('DELETE FROM movement_history');
        sqlite.exec('DELETE FROM deck_required_cards');
        sqlite.exec('DELETE FROM wantlist_items');
        sqlite.exec('DELETE FROM collection_goals');
        sqlite.exec('DELETE FROM booster_pulls');
        sqlite.exec('DELETE FROM booster_sessions');
        sqlite.exec('DELETE FROM collection_history');
        sqlite.exec('DELETE FROM collection_items');
        sqlite.exec('DELETE FROM decks');
        sqlite.exec('DELETE FROM locations');
        sqlite.exec('DELETE FROM location_groups');
      }
      runImport(sqlite, normalized, mode);
    })();
    sqlite.exec('PRAGMA foreign_keys = ON');
    ensureInbox();

    res.json({ message: `Import successful (mode: ${mode})` });
  } catch (err: any) {
    sqlite.exec('PRAGMA foreign_keys = ON');
    fail(res, err);
  }
});

dataRouter.post('/delete', (_req, res) => {
  try {
    wipeAllUserData();
    const ctx = getSessionContext();
    if (ctx) clearUserSetup(ctx.userId);
    ensureInbox();
    res.json({ message: 'All data deleted. The initial setup will be shown again.' });
  } catch (err: any) {
    fail(res, err);
  }
});
