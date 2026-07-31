import { Router } from 'express';
import { db, sqlite } from '../db';
import { schema } from '../db';
import { eq, sql } from 'drizzle-orm';

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
    sqlite.exec('DELETE FROM sync_meta');
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

export function applyDemo() {
  const demoGroupIds = sqlite.prepare('SELECT id, name FROM location_groups ORDER BY name')
    .all() as Array<{ id: number; name: string }>;
  const bindersGroup = demoGroupIds.find(g => g.name === 'Binders');
  const bulkGroup = demoGroupIds.find(g => g.name === 'Bulk');

  if (bindersGroup) {
    const insertLoc = sqlite.prepare('INSERT INTO locations (name, description, group_id, type) VALUES (?, ?, ?, ?) RETURNING id');
    const binder1 = insertLoc.get('Red Binder', 'Modern staples and recent pulls', bindersGroup.id, 'binder') as { id: number };
    const binder2 = insertLoc.get('Blue Binder', 'Commander and casual cards', bindersGroup.id, 'binder') as { id: number };

    const demoCardIds = sqlite.prepare('SELECT id, name, prices FROM scryfall_cards WHERE prices IS NOT NULL AND prices LIKE \'%"usd"%\' ORDER BY RANDOM() LIMIT 15')
      .all() as Array<{ id: string; name: string; prices: string }>;

    const insertItem = sqlite.prepare(
      'INSERT INTO collection_items (card_id, location_id, quantity, condition, purchase_price, price_autofilled) VALUES (?, ?, ?, ?, ?, ?)',
    );

    const demoItems = [
      { locId: binder1.id, count: 4 },
      { locId: binder1.id, count: 2 },
      { locId: binder1.id, count: 1 },
      { locId: binder2.id, count: 3 },
      { locId: binder2.id, count: 1 },
      { locId: binder2.id, count: 2 },
    ];

    for (let i = 0; i < Math.min(demoItems.length, demoCardIds.length); i++) {
      const item = demoItems[i];
      const card = demoCardIds[i];
      const prices = JSON.parse(card.prices);
      const price = parseFloat(prices.usd || prices.usd_foil || '0') || null;
      insertItem.run(card.id, item.locId, item.count, 'NM', price, price ? 0 : 1);
    }
  }

  if (bulkGroup) {
    const insertLoc = sqlite.prepare('INSERT INTO locations (name, description, group_id, type) VALUES (?, ?, ?, ?)');
    insertLoc.run('Bulk Box 1', 'Common/uncommon bulk from recent sets', bulkGroup.id, 'other');

    const bulkCards = sqlite.prepare('SELECT id, prices FROM scryfall_cards WHERE prices IS NULL OR prices NOT LIKE \'%"usd"%\' ORDER BY RANDOM() LIMIT 50')
      .all() as Array<{ id: string; prices: string | null }>;

    const bulkLoc = sqlite.prepare('SELECT id FROM locations WHERE name = ?').get('Bulk Box 1') as { id: number } | undefined;
    if (bulkLoc) {
      const insertItem = sqlite.prepare(
        'INSERT INTO collection_items (card_id, location_id, quantity, condition, purchase_price, price_autofilled) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (let i = 0; i < Math.min(8, bulkCards.length); i++) {
        insertItem.run(bulkCards[i].id, bulkLoc.id, Math.floor(Math.random() * 10) + 1, 'LP', null, 1);
      }
    }
  }

  const insertDeck = sqlite.prepare(
    "INSERT INTO decks (name, description, deck_type, commander_card_id) VALUES (?, ?, ?, ?) RETURNING id",
  );
  const commander = sqlite.prepare(
    "SELECT id, name FROM scryfall_cards WHERE type_line LIKE 'Legendary Creature%' AND legalities LIKE '%\"commander\":\"legal\"%' ORDER BY RANDOM() LIMIT 1",
  ).get() as { id: string; name: string } | undefined;
  const commanderId = commander?.id ?? null;

  const deck1 = insertDeck.get('Standard Aggro', 'A fast red-based standard deck', 'standard', null) as { id: number };
  const deck2 = insertDeck.get('Commander Goodstuff', `Casual commander deck led by ${commander?.name ?? 'a legendary creature'}`, 'commander', commanderId) as { id: number };

  const insertDeckItem = sqlite.prepare(
    'INSERT INTO collection_items (card_id, location_id, deck_id, quantity, condition, purchase_price, price_autofilled) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );

  const locs = sqlite.prepare('SELECT id FROM locations ORDER BY RANDOM()').all() as Array<{ id: number }>;

  if (commanderId && locs.length > 0) {
    insertDeckItem.run(commanderId, locs[0].id, deck2.id, 1, 'NM', null, 1);
  }

  const deckCards = sqlite.prepare('SELECT id FROM scryfall_cards ORDER BY RANDOM() LIMIT 40')
    .all() as Array<{ id: string }>;

  for (let i = 0; i < Math.min(15, deckCards.length); i++) {
    const loc = locs[i % locs.length];
    insertDeckItem.run(deckCards[i].id, loc.id, deck1.id, Math.floor(Math.random() * 3) + 1, 'NM', null, 1);
  }
  let deck2Count = 0;
  for (let i = 15; i < Math.min(40, deckCards.length) && deck2Count < 60; i++) {
    const loc = locs[(deck2Count) % locs.length];
    insertDeckItem.run(deckCards[i].id, loc.id, deck2.id, 1, 'NM', null, 1);
    deck2Count++;
  }
}

export function resetToSetup(mode: 'wipe' | 'basic' | 'demo' | 'recommended') {
  wipeAllUserData();
  if (mode === 'basic' || mode === 'recommended' || mode === 'demo') applyBasicSetup();
  if (mode === 'recommended') applyRecommended();
  if (mode === 'demo') applyDemo();
  ensureInbox();
}

dataRouter.get('/export', (_req, res) => {
  const locationGroups = db.select().from(schema.locationGroups).all();
  const locations = db.select().from(schema.locations).all();
  const collectionItems = db.select().from(schema.collectionItems).all();
  const collectionHistory = db.select().from(schema.collectionHistory).all();
  const decks = db.select().from(schema.decks).all();
  const deckRequiredCards = db.select().from(schema.deckRequiredCards).all();
  const boosterSessions = db.select().from(schema.boosterSessions).all();
  const boosterPulls = db.select().from(schema.boosterPulls).all();
  const syncMeta = db.select().from(schema.syncMeta).all();
  const wantlistItems = db.select().from(schema.wantlistItems).all();
  const collectionGoals = db.select().from(schema.collectionGoals).all();
  const trades = db.select().from(schema.trades).all();
  const tradeItems = db.select().from(schema.tradeItems).all();
  const movementHistory = db.select().from(schema.movementHistory).all();

  res.json({
    version: 3,
    exportedAt: new Date().toISOString(),
    locationGroups,
    locations,
    collectionItems,
    collectionHistory,
    decks,
    deckRequiredCards,
    boosterSessions,
    boosterPulls,
    syncMeta,
    wantlistItems,
    collectionGoals,
    trades,
    tradeItems,
    movementHistory,
  });
});

dataRouter.post('/import', (req, res) => {
  const { data, mode } = req.body;

  if (!data || !mode || !['merge', 'replace'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid request. Provide data and mode ("merge" | "replace").' });
  }

  try {
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
        sqlite.exec('DELETE FROM sync_meta');
      }

      const groupIdMap = new Map<number, number>();

      if (data.locationGroups) {
        const insertGroup = sqlite.prepare(
          'INSERT INTO location_groups (name, description, sort_order) VALUES (?, ?, ?) RETURNING id',
        );
        const findGroup = sqlite.prepare('SELECT id FROM location_groups WHERE name = ?');

        for (const g of data.locationGroups) {
          if (mode === 'replace') {
            sqlite.prepare(
              'INSERT INTO location_groups (id, name, description, sort_order) VALUES (?, ?, ?, ?)',
            ).run(g.id, g.name, g.description ?? null, g.sortOrder ?? 0);
            groupIdMap.set(g.id, g.id);
          } else {
            const existing = findGroup.get(g.name) as { id: number } | undefined;
            if (existing) {
              groupIdMap.set(g.id, existing.id);
            } else {
              const result = insertGroup.get(g.name, g.description ?? null, g.sortOrder ?? 0) as { id: number };
              groupIdMap.set(g.id, result.id);
            }
          }
        }
      }

      const locationIdMap = new Map<number, number>();

      if (data.locations) {
        const insertLoc = sqlite.prepare(
          'INSERT INTO locations (name, description, group_id) VALUES (?, ?, ?) RETURNING id',
        );
        const findLoc = sqlite.prepare('SELECT id FROM locations WHERE name = ?');

        for (const l of data.locations) {
          const mappedGroupId = l.groupId ? (groupIdMap.get(l.groupId) ?? null) : null;
          if (mode === 'replace') {
            sqlite.prepare(
              'INSERT INTO locations (id, name, description, group_id) VALUES (?, ?, ?, ?)',
            ).run(l.id, l.name, l.description ?? null, mappedGroupId);
            locationIdMap.set(l.id, l.id);
          } else {
            const existing = findLoc.get(l.name) as { id: number } | undefined;
            if (existing) {
              locationIdMap.set(l.id, existing.id);
            } else {
              const result = insertLoc.get(l.name, l.description ?? null, mappedGroupId) as { id: number };
              locationIdMap.set(l.id, result.id);
            }
          }
        }
      }

      if (data.collectionItems) {
        const insertItem = sqlite.prepare(
          `INSERT INTO collection_items (card_id, location_id, deck_id, destination_id, foil, condition, quantity, purchase_price, price_autofilled, pack_opened, notes, acquired_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const item of data.collectionItems) {
          const mappedLocationId = locationIdMap.get(item.locationId) ?? item.locationId;
          const mappedDest = item.destinationId ? (locationIdMap.get(item.destinationId) ?? item.destinationId) : null;
          try {
            insertItem.run(
              item.cardId,
              mappedLocationId,
              item.deckId ?? null,
              mappedDest,
              item.foil ?? 0,
              item.condition ?? null,
              item.quantity ?? 1,
              item.purchasePrice ?? null,
              item.priceAutofilled ?? 0,
              item.packOpened ?? 0,
              item.notes ?? null,
              item.acquiredAt ?? null,
            );
          } catch {
            /* skip duplicates */
          }
        }
      }

      if (data.collectionHistory) {
        const insertHist = sqlite.prepare(
          'INSERT OR IGNORE INTO collection_history (date, total_cards, total_value) VALUES (?, ?, ?)',
        );
        for (const h of data.collectionHistory) {
          insertHist.run(h.date, h.totalCards, h.totalValue);
        }
      }

      const goalIdMap = new Map<number, number>();

      if (data.collectionGoals) {
        const insertGoal = sqlite.prepare(
          'INSERT OR IGNORE INTO collection_goals (id, location_id, kind, card_id, card_name, set_codes, target_count, fulfilled_count, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        );
        for (const g of data.collectionGoals) {
          const mappedLocationId = locationIdMap.get(g.locationId) ?? g.locationId;
          try {
            insertGoal.run(g.id, mappedLocationId, g.kind, g.cardId ?? null, g.cardName ?? null, g.setCodes ?? null, g.targetCount ?? null, g.fulfilledCount ?? 0, g.status ?? 'active');
            goalIdMap.set(g.id, g.id);
          } catch {}
        }
      }

      if (data.wantlistItems) {
        const insertWl = sqlite.prepare(
          'INSERT OR IGNORE INTO wantlist_items (id, card_id, card_name, set_code, collector_number, foil, condition, quantity, notes, destination_id, collection_goal_id, persistent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        );
        for (const w of data.wantlistItems) {
          const mappedDest = w.destinationId ? (locationIdMap.get(w.destinationId) ?? w.destinationId) : null;
          const mappedGoal = w.collectionGoalId ? (goalIdMap.get(w.collectionGoalId) ?? w.collectionGoalId) : null;
          try {
            insertWl.run(w.id, w.cardId ?? null, w.cardName, w.setCode ?? null, w.collectorNumber ?? null, w.foil ?? 0, w.condition ?? null, w.quantity ?? 1, w.notes ?? null, mappedDest, mappedGoal, w.persistent ?? 0);
          } catch {}
        }
      }

      if (data.decks) {
        const insertDeck = sqlite.prepare(
          'INSERT OR IGNORE INTO decks (id, name, description, card_id, deck_type, commander_card_id, partner_card_id, background_card_id, group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        );
        for (const d of data.decks) {
          try {
            insertDeck.run(d.id, d.name, d.description ?? null, d.cardId ?? null, d.deckType ?? 'custom', d.commanderCardId ?? null, d.partnerCardId ?? null, d.backgroundCardId ?? null, d.groupId ?? null);
          } catch {}
        }
      }

      if (data.deckRequiredCards) {
        const insertReq = sqlite.prepare(
          'INSERT OR IGNORE INTO deck_required_cards (id, deck_id, card_id, card_name, set_code, collector_number, quantity) VALUES (?, ?, ?, ?, ?, ?, ?)',
        );
        for (const r of data.deckRequiredCards) {
          try {
            insertReq.run(r.id, r.deckId, r.cardId ?? null, r.cardName, r.setCode ?? null, r.collectorNumber ?? null, r.quantity ?? 1);
          } catch {}
        }
      }

      if (data.boosterSessions) {
        for (const s of data.boosterSessions) {
          try {
            sqlite.prepare(
              'INSERT OR IGNORE INTO booster_sessions (id, set_code, booster_type, booster_price, total_value, completed) VALUES (?, ?, ?, ?, ?, ?)',
            ).run(s.id, s.setCode, s.boosterType, s.boosterPrice, s.totalValue, s.completed ?? 0);
          } catch {}
        }
      }

      if (data.boosterPulls) {
        for (const p of data.boosterPulls) {
          try {
            sqlite.prepare(
              'INSERT OR IGNORE INTO booster_pulls (id, session_id, card_id, foil, slot_index, location_id, added_to_collection) VALUES (?, ?, ?, ?, ?, ?, ?)',
            ).run(p.id, p.sessionId, p.cardId, p.foil ?? 0, p.slotIndex ?? 0, p.locationId ?? null, p.addedToCollection ?? 0);
          } catch {}
        }
      }

      if (data.trades) {
        const insertTrade = sqlite.prepare(
          'INSERT OR IGNORE INTO trades (id, title, status, your_cash, their_cash, contact_info, notes, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        );
        for (const t of data.trades) {
          try {
            insertTrade.run(t.id, t.title ?? null, t.status ?? 'active', t.yourCash ?? 0, t.theirCash ?? 0, t.contactInfo ?? null, t.notes ?? null, t.completedAt ?? null);
          } catch {}
        }
      }

      if (data.tradeItems) {
        const insertTi = sqlite.prepare(
          'INSERT OR IGNORE INTO trade_items (id, trade_id, side, card_id, card_name, set_code, collector_number, foil, condition, quantity, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        );
        for (const ti of data.tradeItems) {
          try {
            insertTi.run(ti.id, ti.tradeId, ti.side, ti.cardId ?? null, ti.cardName, ti.setCode ?? null, ti.collectorNumber ?? null, ti.foil ?? 0, ti.condition ?? null, ti.quantity ?? 1, ti.price ?? null);
          } catch {}
        }
      }

      if (data.movementHistory) {
        const insertMh = sqlite.prepare(
          'INSERT OR IGNORE INTO movement_history (id, item_id, card_id, card_name, action, from_location_id, to_location_id, quantity, details, undone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        );
        for (const mh of data.movementHistory) {
          try {
            insertMh.run(mh.id, mh.itemId ?? null, mh.cardId ?? null, mh.cardName ?? null, mh.action, mh.fromLocationId ?? null, mh.toLocationId ?? null, mh.quantity ?? 1, mh.details ?? null, mh.undone ?? 0);
          } catch {}
        }
      }

      if (data.syncMeta) {
        for (const m of data.syncMeta) {
          try {
            sqlite.prepare(
              'INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)',
            ).run(m.key, m.value);
          } catch {}
        }
      }
    })();
    sqlite.exec('PRAGMA foreign_keys = ON');
    ensureInbox();

    res.json({ message: `Import successful (mode: ${mode})` });
  } catch (err: any) {
    sqlite.exec('PRAGMA foreign_keys = ON');
    res.status(500).json({ error: err.message });
  }
});

dataRouter.post('/delete', (req, res) => {
  const { mode } = req.body;
  if (!mode || !['wipe', 'basic', 'demo'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode. Use "wipe", "basic", or "demo".' });
  }

  try {
    resetToSetup(mode);

    if (mode === 'wipe') {
      res.json({ message: 'All data deleted.' });
    } else if (mode === 'basic') {
      res.json({ message: 'Data deleted. Basic location groups created.' });
    } else {
      res.json({ message: 'Data deleted. Demo data loaded.' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
