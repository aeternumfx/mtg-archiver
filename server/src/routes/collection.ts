import { fail } from '../utils/http';
import { Router } from 'express';
import { db, sqlite, schema, catalogSqlite } from '../db';
import { eq, and, or, like, asc, desc, sql } from 'drizzle-orm';
import { cardsByIds, cardById, parseCardJson } from '../services/cards';

export const collectionRouter = Router();

// When an item's destination changes, reconcile any deck-ghost fill link. If
// the item was scheduled to fill a deck's required (ghost) card but the new
// destination no longer points at that deck's location, unlink the ghost so it
// reverts to an unfilled state. Likewise, if the destination was cleared. If
// the destination now points at a deck's location with a matching unfilled
// required (ghost) card, link this item to fill it.
function reconcileDeckGhostLink(itemId: number) {
  const item = sqlite.prepare('SELECT card_id, destination_id FROM collection_items WHERE id = ?').get(itemId) as
    | { card_id: string | null; destination_id: number | null }
    | undefined;
  if (!item) return;
  const reqRow = sqlite.prepare('SELECT id, deck_id FROM deck_required_cards WHERE fill_item_id = ?').get(itemId) as
    | { id: number; deck_id: number }
    | undefined;

  if (reqRow) {
    const deckLoc = sqlite.prepare('SELECT id FROM locations WHERE deck_id = ?').get(reqRow.deck_id) as { id: number } | undefined;
    const stillTargetsDeck = item.destination_id != null && deckLoc && item.destination_id === deckLoc.id;
    if (!stillTargetsDeck) {
      sqlite.prepare('UPDATE deck_required_cards SET fill_item_id = NULL WHERE id = ?').run(reqRow.id);
    }
  }

  if (item.destination_id != null) {
    const deck = sqlite.prepare('SELECT deck_id FROM locations WHERE id = ?').get(item.destination_id) as { deck_id: number | null } | undefined;
    if (deck && deck.deck_id != null) {
      const match = sqlite.prepare(
        'SELECT id FROM deck_required_cards WHERE deck_id = ? AND fill_item_id IS NULL AND (card_id = ? OR card_id IS NULL) LIMIT 1'
      ).get(deck.deck_id, item.card_id) as { id: number } | undefined;
      if (match) {
        sqlite.prepare('UPDATE deck_required_cards SET fill_item_id = ? WHERE id = ?').run(itemId, match.id);
      }
    }
  }
}

collectionRouter.get('/names', (_req, res) => {
  const rows = sqlite.prepare('SELECT DISTINCT card_id FROM collection_items').all() as Array<{ card_id: string }>;
  const cards = cardsByIds(rows.map(r => r.card_id));
  const names = [...new Set(rows.map(r => cards.get(r.card_id)?.name).filter(Boolean) as string[])].sort();
  res.json(names);
});

// Returns total collection quantity per card name for the given names.
collectionRouter.get('/counts', (req, res) => {
  let names: string[] = [];
  try {
    const raw = req.query.names as string | undefined;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) names = parsed.map(String).map(s => s.trim()).filter(Boolean);
    }
  } catch { names = []; }
  if (names.length === 0) return res.json({});
  const idRows = catalogSqlite.prepare(
    `SELECT id, name FROM scryfall_cards WHERE name IN (${names.map(() => '?').join(',')})`
  ).all(...names) as Array<{ id: string; name: string }>;
  const ids = idRows.map(r => r.id);
  if (ids.length === 0) return res.json({});
  const countRows = sqlite.prepare(
    `SELECT ci.card_id as cardId, SUM(ci.quantity) as total
     FROM collection_items ci
     WHERE ci.card_id IN (${ids.map(() => '?').join(',')})
     GROUP BY ci.card_id`
  ).all(...ids) as Array<{ cardId: string; total: number }>;
  const nameById = new Map(idRows.map(r => [r.id, r.name]));
  const result: Record<string, number> = {};
  for (const r of countRows) {
    const n = nameById.get(r.cardId);
    if (n) result[n] = (result[n] || 0) + r.total;
  }
  res.json(result);
});

collectionRouter.get('/', (req, res) => {
  const locationId = req.query.location_id ? Number(req.query.location_id) : undefined;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = 50;
  const offset = (page - 1) * pageSize;

  const where = locationId ? eq(schema.collectionItems.locationId, locationId) : undefined;

  const countResult = db.select({ count: sql<number>`count(*)` }).from(schema.collectionItems).where(where).get();
  const total = countResult?.count ?? 0;

  const items = db.select({
    id: schema.collectionItems.id,
    cardId: schema.collectionItems.cardId,
    locationId: schema.collectionItems.locationId,
    destinationId: schema.collectionItems.destinationId,
    foil: schema.collectionItems.foil,
    foreignLanguage: schema.collectionItems.foreignLanguage,
    condition: schema.collectionItems.condition,
    quantity: schema.collectionItems.quantity,
    purchasePrice: schema.collectionItems.purchasePrice,
    priceAutofilled: schema.collectionItems.priceAutofilled,
    packOpened: schema.collectionItems.packOpened,
    proxy: schema.collectionItems.proxy,
    misprint: schema.collectionItems.misprint,
    altered: schema.collectionItems.altered,
    notes: schema.collectionItems.notes,
    acquiredAt: schema.collectionItems.acquiredAt,
    createdAt: schema.collectionItems.createdAt,
  })
    .from(schema.collectionItems)
    .where(where)
    .orderBy(schema.collectionItems.createdAt)
    .limit(pageSize)
    .offset(offset)
    .all();

  const cards = cardsByIds(items.map(i => i.cardId));

  const parsed = items.map(i => ({
    ...i,
    card: i.cardId && cards.get(i.cardId) ? parseCardJson(cards.get(i.cardId)!) : null,
  }));

  res.json({ data: parsed, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
});

collectionRouter.post('/', (req, res) => {
  let { cardId, locationId, destinationId, quantity, foil, foreignLanguage, condition, purchasePrice, priceAutofilled, packOpened, notes, acquiredAt, forceNew, proxy, misprint, altered } = req.body;

  if (!cardId || !locationId) {
    return res.status(400).json({ error: 'cardId and locationId are required' });
  }

  const card = cardById(cardId);
  if (!card) return res.status(404).json({ error: 'Card not found' });

  const loc = db.select().from(schema.locations).where(eq(schema.locations.id, locationId)).get();
  if (!loc) return res.status(404).json({ error: 'Location not found' });

  foil = foil ? 1 : 0;
  foreignLanguage = foreignLanguage ? 1 : 0;
  condition = condition || null;
  quantity = quantity ?? 1;
  packOpened = packOpened ? 1 : 0;
  proxy = proxy ? 1 : 0;
  misprint = misprint ? 1 : 0;
  altered = altered ? 1 : 0;
  priceAutofilled = priceAutofilled ? 1 : 0;
  if (!acquiredAt) acquiredAt = new Date().toISOString().split('T')[0];

  if (purchasePrice === undefined || purchasePrice === null) {
    const prices = card.prices ? JSON.parse(card.prices) : {};
    const usd = (foil ? prices.usd_foil : prices.usd) || prices.usd || prices.usd_foil;
    if (usd) {
      purchasePrice = parseFloat(usd);
      priceAutofilled = 1;
    }
  }

  const existing = forceNew ? undefined : db.select()
    .from(schema.collectionItems)
    .where(and(
      eq(schema.collectionItems.cardId, cardId),
      eq(schema.collectionItems.locationId, locationId),
      eq(schema.collectionItems.foil, foil),
      eq(schema.collectionItems.foreignLanguage, foreignLanguage),
      eq(schema.collectionItems.proxy, proxy),
      eq(schema.collectionItems.misprint, misprint),
      eq(schema.collectionItems.altered, altered),
      condition ? eq(schema.collectionItems.condition, condition) : sql`${schema.collectionItems.condition} IS NULL`,
    ))
    .get();

  if (existing) {
    const updated = db.update(schema.collectionItems)
      .set({
        quantity: existing.quantity + quantity,
        notes: notes ?? existing.notes,
      })
      .where(eq(schema.collectionItems.id, existing.id))
      .returning().get();
    return res.json(updated);
  }

  const item = db.insert(schema.collectionItems)
    .values({ cardId, locationId, destinationId: destinationId ?? null, deckId: loc.deckId ?? null, foil, foreignLanguage, condition, quantity, purchasePrice, priceAutofilled, packOpened, proxy, misprint, altered, notes: notes ?? null, acquiredAt })
    .returning().get();

  const foundCard = cardById(cardId);
  db.insert(schema.movementHistory).values({
    itemId: item.id, cardId, cardName: foundCard?.name || '', action: 'added',
    toLocationId: locationId, quantity,
  }).run();

  res.status(201).json(item);
});

collectionRouter.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const item = db.select().from(schema.collectionItems).where(eq(schema.collectionItems.id, id)).get();
  if (!item) return res.status(404).json({ error: 'Collection item not found' });

  const { quantity, foil, foreignLanguage, condition, purchasePrice, packOpened, notes, acquiredAt, destinationId, locationId, proxy, misprint, altered } = req.body;

  const updates: Record<string, unknown> = {};
  if (quantity !== undefined) updates.quantity = quantity;
  if (foil !== undefined) updates.foil = foil ? 1 : 0;
  if (foreignLanguage !== undefined) updates.foreignLanguage = foreignLanguage ? 1 : 0;
  if (condition !== undefined) updates.condition = condition || null;
  if (purchasePrice !== undefined) updates.purchasePrice = purchasePrice;
  if (packOpened !== undefined) updates.packOpened = packOpened ? 1 : 0;
  if (proxy !== undefined) updates.proxy = proxy ? 1 : 0;
  if (misprint !== undefined) updates.misprint = misprint ? 1 : 0;
  if (altered !== undefined) updates.altered = altered ? 1 : 0;
  if (notes !== undefined) updates.notes = notes;
  if (acquiredAt !== undefined) updates.acquiredAt = acquiredAt;
  if (locationId !== undefined) {
    const loc = db.select().from(schema.locations).where(eq(schema.locations.id, locationId)).get();
    if (!loc) throw new Error('Location not found');
    updates.locationId = locationId;
    updates.deckId = loc.deckId ?? null;
  }
  if (destinationId !== undefined) {
    updates.destinationId = destinationId || null;
    if (destinationId !== null) {
      const destLoc = db.select().from(schema.locations).where(eq(schema.locations.id, destinationId)).get();
      if (!destLoc) throw new Error('Destination location not found');
    }
  }

  const updated = db.update(schema.collectionItems)
    .set(updates)
    .where(eq(schema.collectionItems.id, id))
    .returning().get();

  if (destinationId !== undefined) reconcileDeckGhostLink(id);

  let movedHistoryId: number | null = null;
  if (locationId !== undefined && locationId !== item.locationId) {
    const card = cardById(item.cardId);
    const entry = db.insert(schema.movementHistory).values({
      itemId: id, cardId: item.cardId, cardName: card?.name || '', action: 'moved',
      fromLocationId: item.locationId, toLocationId: locationId, quantity: item.quantity,
    }).returning().get();
    movedHistoryId = entry.id;
  }

  res.json({ ...updated, movedHistoryId });
});

collectionRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const item = db.select().from(schema.collectionItems).where(eq(schema.collectionItems.id, id)).get();
  if (!item) return res.status(404).json({ error: 'Collection item not found' });

  db.delete(schema.collectionItems).where(eq(schema.collectionItems.id, id)).run();
  res.status(204).end();
});

collectionRouter.post('/:id/split-copy', (req, res) => {
  const id = Number(req.params.id);
  const { destinationId } = req.body;

  const item = db.select().from(schema.collectionItems).where(eq(schema.collectionItems.id, id)).get();
  if (!item) return res.status(404).json({ error: 'Collection item not found' });

  const dest = destinationId ?? null;
  if (dest !== null) {
    const loc = db.select().from(schema.locations).where(eq(schema.locations.id, dest)).get();
    if (!loc) return res.status(400).json({ error: 'Destination location not found' });
  }

  try {
    if (item.quantity <= 1) {
      const updated = db.update(schema.collectionItems)
        .set({ destinationId: dest })
        .where(eq(schema.collectionItems.id, id))
        .returning().get();
      reconcileDeckGhostLink(id);
      return res.json(updated);
    }

    const newItem = sqlite.transaction(() => {
      db.update(schema.collectionItems)
        .set({ quantity: item.quantity - 1 })
        .where(eq(schema.collectionItems.id, id))
        .run();
      return db.insert(schema.collectionItems)
        .values({
          cardId: item.cardId,
          locationId: item.locationId,
          destinationId: dest,
          foil: item.foil,
          foreignLanguage: item.foreignLanguage,
          condition: item.condition,
          quantity: 1,
          purchasePrice: item.purchasePrice,
          priceAutofilled: item.priceAutofilled,
          packOpened: item.packOpened,
          proxy: item.proxy,
          misprint: item.misprint,
          altered: item.altered,
          notes: item.notes,
          acquiredAt: item.acquiredAt,
        })
        .returning().get();
    })();

    res.status(201).json(newItem);
  } catch (err: any) {
    fail(res, err);
  }
});

collectionRouter.post('/move', (req, res) => {
  const { items, destinationLocationId } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0 || !destinationLocationId) {
    return res.status(400).json({ error: 'items array and destinationLocationId are required' });
  }

  const destLoc = db.select().from(schema.locations).where(eq(schema.locations.id, destinationLocationId)).get();
  if (!destLoc) return res.status(404).json({ error: 'Destination location not found' });

  // Moving to a deck's location links the card to that deck; moving out of a
  // deck location to a non-deck location unlinks it.
  const destDeckId = destLoc.deckId ?? null;

  const parseQty = (q: unknown): number | null => {
    if (q === null || q === undefined || q === '') return null;
    const n = Math.floor(Number(q));
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  };

  try {
    const results = sqlite.transaction(() => {
      const results: Array<{ id: number; cardId: string; quantity: number }> = [];

      for (const item of items) {
        const itemId = Number(item?.id);
        if (!Number.isInteger(itemId) || itemId <= 0) throw new Error('Invalid collection item id');
        const parsedQty = parseQty(item?.quantity);
        if (item?.quantity !== undefined && item?.quantity !== null && item?.quantity !== '' && parsedQty === null) {
          throw new Error('Invalid quantity');
        }

        const sourceItem = db.select()
          .from(schema.collectionItems)
          .where(eq(schema.collectionItems.id, itemId))
          .get();

        if (!sourceItem) {
          throw new Error(`Collection item ${itemId} not found`);
        }

        const moveQty = parsedQty !== null ? Math.min(parsedQty, sourceItem.quantity) : sourceItem.quantity;
        if (moveQty <= 0) continue;

        const remaining = sourceItem.quantity - moveQty;

        const destExisting = db.select()
          .from(schema.collectionItems)
          .where(and(
            eq(schema.collectionItems.cardId, sourceItem.cardId),
            eq(schema.collectionItems.locationId, destinationLocationId),
            eq(schema.collectionItems.foil, sourceItem.foil),
            eq(schema.collectionItems.foreignLanguage, sourceItem.foreignLanguage),
            eq(schema.collectionItems.proxy, sourceItem.proxy),
            eq(schema.collectionItems.misprint, sourceItem.misprint),
            eq(schema.collectionItems.altered, sourceItem.altered),
            sourceItem.condition
              ? eq(schema.collectionItems.condition, sourceItem.condition)
              : sql`${schema.collectionItems.condition} IS NULL`,
          ))
          .get();

        if (destExisting && destExisting.id !== sourceItem.id) {
          // Fully moved: remove the source, merge into an identical destination row.
          // Preserve notes/price from the source (prefer a manually-set price).
          // The source row is being merged away; drop any ghost link that pointed at it.
          sqlite.prepare('UPDATE deck_required_cards SET fill_item_id = NULL WHERE fill_item_id = ?').run(sourceItem.id);
          if (remaining > 0) {
            db.update(schema.collectionItems)
              .set({ quantity: remaining })
              .where(eq(schema.collectionItems.id, sourceItem.id))
              .run();
          } else {
            db.delete(schema.collectionItems).where(eq(schema.collectionItems.id, sourceItem.id)).run();
          }
          const mergedNotes = [destExisting.notes, sourceItem.notes].filter(Boolean).join('\n') || null;
          const mergedPrice = sourceItem.purchasePrice != null && !sourceItem.priceAutofilled
            ? sourceItem.purchasePrice
            : destExisting.purchasePrice;
          const mergedAutofill = sourceItem.purchasePrice != null && !sourceItem.priceAutofilled
            ? 0
            : destExisting.priceAutofilled;
          db.update(schema.collectionItems)
            .set({
              quantity: destExisting.quantity + moveQty,
              deckId: destExisting.deckId ?? destDeckId,
              destinationId: null,
              notes: mergedNotes,
              purchasePrice: mergedPrice,
              priceAutofilled: mergedAutofill,
            })
            .where(eq(schema.collectionItems.id, destExisting.id))
            .run();
          reconcileDeckGhostLink(destExisting.id);
          results.push({ id: destExisting.id, cardId: sourceItem.cardId, quantity: moveQty });
        } else if (remaining === 0) {
          // No matching destination row and the whole quantity moves in place:
          // keep the source row's identity so deck links and flags are preserved.
          db.update(schema.collectionItems)
            .set({ locationId: destinationLocationId, destinationId: null, deckId: destDeckId })
            .where(eq(schema.collectionItems.id, sourceItem.id))
            .run();
          reconcileDeckGhostLink(sourceItem.id);
          results.push({ id: sourceItem.id, cardId: sourceItem.cardId, quantity: moveQty });
        } else {
          // Partial move with no destination row: reduce source, create a copy.
          db.update(schema.collectionItems)
            .set({ quantity: remaining })
            .where(eq(schema.collectionItems.id, sourceItem.id))
            .run();
          const newItem = db.insert(schema.collectionItems)
            .values({
              cardId: sourceItem.cardId,
              locationId: destinationLocationId,
              destinationId: null,
              deckId: destDeckId,
              foil: sourceItem.foil,
              foreignLanguage: sourceItem.foreignLanguage,
              condition: sourceItem.condition,
              quantity: moveQty,
              purchasePrice: sourceItem.purchasePrice,
              priceAutofilled: sourceItem.priceAutofilled,
              packOpened: sourceItem.packOpened,
              proxy: sourceItem.proxy,
              misprint: sourceItem.misprint,
              altered: sourceItem.altered,
              notes: sourceItem.notes,
              acquiredAt: sourceItem.acquiredAt,
            })
            .returning().get();
          // If the source stays (still at its old location filling a ghost), keep its
          // link; the new copy only matters if it now targets a deck ghost.
          reconcileDeckGhostLink(newItem.id);
          results.push({ id: newItem.id, cardId: sourceItem.cardId, quantity: moveQty });
        }
      }

      return results;
    })();

    res.json({ moved: results });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

collectionRouter.get('/grouped', (req, res) => {
  const locationId = req.query.location_id ? Number(req.query.location_id) : undefined;
  const q = (req.query.q as string ?? '').trim();
  const sort = (req.query.sort as string) || 'price';
  const order = (req.query.order as string) === 'asc' ? 1 : -1;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50));
  const rarityFilter = (req.query.rarity as string) || '';
  const typeFilter = (req.query.type as string) || '';
  const conditionFilter = (req.query.condition as string) || '';
  const cmcMin = req.query.cmcMin ? Number(req.query.cmcMin) : undefined;
  const cmcMax = req.query.cmcMax ? Number(req.query.cmcMax) : undefined;
  const valueMin = req.query.valueMin ? Number(req.query.valueMin) : undefined;
  const valueMax = req.query.valueMax ? Number(req.query.valueMax) : undefined;
  const foilFilter = req.query.foil ? Number(req.query.foil) : undefined;

  const nameTokens = q ? q.replace(/['"]/g, '').split(/[,\s]+/).filter(Boolean) : [];

  const colorInclude: string[] = [];
  const colorExclude: string[] = [];
  for (const key of Object.keys(req.query)) {
    if (key.startsWith('c_') && req.query[key] === 'include') colorInclude.push(key.slice(2).toUpperCase());
    if (key.startsWith('c_') && req.query[key] === 'exclude') colorExclude.push(key.slice(2).toUpperCase());
  }

  const rarityList = rarityFilter.split(',').filter(Boolean);
  const typeList = typeFilter.split(',').filter(Boolean);

  // Card-level filters (name, color identity, rarity, type, cmc) live on cards
  // in the system catalog, a separate SQLite file from the per-user collection.
  // We load the user's own distinct cards (bounded by their collection) and
  // apply these filters against that set in JS, avoiding huge IN clauses over
  // the entire catalog.
  const hasCardFilter =
    nameTokens.length > 0 || colorInclude.length > 0 || colorExclude.length > 0 ||
    rarityList.length > 0 || typeList.length > 0 ||
    (cmcMin !== undefined && !isNaN(cmcMin)) || (cmcMax !== undefined && !isNaN(cmcMax));

  const cardMatches = (card: any): boolean => {
    if (!card) return false;
    if (nameTokens.length > 0) {
      const n = card.name.toLowerCase();
      if (!nameTokens.every(t => n.includes(t.toLowerCase()))) return false;
    }
    let identity: string[] = [];
    if (card.colorIdentity) {
      try { identity = JSON.parse(card.colorIdentity); } catch { identity = []; }
    }
    for (const c of colorInclude) if (!identity.includes(c)) return false;
    for (const c of colorExclude) if (identity.includes(c)) return false;
    if (rarityList.length > 0 && !rarityList.includes(card.rarity)) return false;
    if (typeList.length > 0) {
      const tl = card.typeLine || '';
      if (!typeList.some(t => tl.toLowerCase().includes(t.toLowerCase()))) return false;
    }
    if (cmcMin !== undefined && !isNaN(cmcMin) && (card.cmc ?? 0) < cmcMin) return false;
    if (cmcMax !== undefined && !isNaN(cmcMax) && (card.cmc ?? 0) > cmcMax) return false;
    return true;
  };

  // Per-user item filters (location, deck, group, condition, foil, value).
  let sqlWhere = '';
  const queryParams: any[] = [];
  let joins = '';
  if (locationId) {
    queryParams.push(locationId);
    sqlWhere += `${sqlWhere ? ' AND ' : 'WHERE '} ci.location_id = ?`;
  }
  const deckId = req.query.deck_id ? Number(req.query.deck_id) : undefined;
  if (deckId !== undefined && !isNaN(deckId)) {
    sqlWhere += `${sqlWhere ? ' AND ' : 'WHERE '} ci.deck_id = ?`;
    queryParams.push(deckId);
  }
  const groupId = req.query.group_id ? Number(req.query.group_id) : undefined;
  if (groupId !== undefined && !isNaN(groupId)) {
    joins += ' JOIN locations loc ON loc.id = ci.location_id';
    sqlWhere += `${sqlWhere ? ' AND ' : 'WHERE '} loc.group_id = ?`;
    queryParams.push(groupId);
  } else if (req.query.group_id === 'null') {
    joins += ' JOIN locations loc ON loc.id = ci.location_id';
    sqlWhere += `${sqlWhere ? ' AND ' : 'WHERE '} loc.group_id IS NULL`;
  }

  if (conditionFilter) {
    const conds = conditionFilter.split(',').filter(Boolean);
    if (conds.length > 0) {
      sqlWhere += `${sqlWhere ? ' AND ' : 'WHERE '} ci.condition IN (${conds.map(() => '?').join(',')})`;
      queryParams.push(...conds);
    }
  }

  if (foilFilter !== undefined) {
    sqlWhere += `${sqlWhere ? ' AND ' : 'WHERE '} ci.foil = ?`;
    queryParams.push(foilFilter);
  }

  if (valueMin !== undefined) {
    sqlWhere += `${sqlWhere ? ' AND ' : 'WHERE '} (ci.quantity * ci.purchase_price) >= ?`;
    queryParams.push(valueMin);
  }
  if (valueMax !== undefined) {
    sqlWhere += `${sqlWhere ? ' AND ' : 'WHERE '} (ci.quantity * ci.purchase_price) <= ?`;
    queryParams.push(valueMax);
  }

  const condRank = (cond: string | null): number => {
    const rank: Record<string, number> = { M: 0, NM: 1, LP: 2, MP: 3, HP: 4, Dmg: 5 };
    return cond ? (rank[cond] ?? 99) : 99;
  };

  // Aggregate the collection in SQL, one row per distinct card, computing the
  // best condition via a padded rank string so MIN() yields the best label.
  // This makes the expensive card lookups + JSON parsing scale with the number
  // of distinct cards rather than total item rows.
  const condKey = `CASE ci.condition WHEN 'M' THEN '0M' WHEN 'NM' THEN '1NM' WHEN 'LP' THEN '2LP' WHEN 'MP' THEN '3MP' WHEN 'HP' THEN '4HP' WHEN 'Dmg' THEN '5Dmg' ELSE '99' END`;
  const rawItems = sqlite.prepare(`
    SELECT
      ci.card_id as cardId,
      SUM(ci.quantity) as totalQty,
      SUM(ci.quantity * ci.purchase_price) as totalValue,
      MAX(ci.foil) as hasFoil,
      MIN(${condKey}) as bestCondKey
    FROM collection_items ci
    ${joins}
    ${sqlWhere}
    GROUP BY ci.card_id
  `).all(...queryParams) as Array<{ cardId: string; totalQty: number; totalValue: number; hasFoil: number; bestCondKey: string | null }>;

  const distinctCardIds = rawItems.map(r => r.cardId).filter(Boolean);
  if (distinctCardIds.length === 0) {
    return res.json({ groups: [], total: 0, page, pageSize, totalPages: 0, incoming: locationId ? loadIncoming(locationId) : [] });
  }

  const cards = cardsByIds(distinctCardIds);

  // One entry per distinct card, then merged by name below to preserve the
  // original "one group per card name (across printings)" behavior.
  type PerCard = {
    cardId: string;
    name: string;
    card: NonNullable<ReturnType<typeof cards.get>>;
    setCode: string;
    totalQty: number;
    totalValue: number;
    hasFoil: number;
    bestCondition: string | null;
  };
  const perCard: PerCard[] = [];
  for (const r of rawItems) {
    const card = cards.get(r.cardId);
    if (!card) continue;
    if (hasCardFilter && !cardMatches(card)) continue;
    perCard.push({
      cardId: r.cardId,
      name: card.name,
      card,
      setCode: card.setCode,
      totalQty: r.totalQty,
      totalValue: r.totalValue,
      hasFoil: r.hasFoil ? 1 : 0,
      bestCondition: r.bestCondKey && r.bestCondKey !== '99' ? r.bestCondKey.slice(1) : null,
    });
  }

  // Merge per-card rows into name groups (across printings/sets).
  const nameGroups = new Map<string, typeof perCard>();
  for (const pc of perCard) {
    if (!nameGroups.has(pc.name)) nameGroups.set(pc.name, []);
    nameGroups.get(pc.name)!.push(pc);
  }

  // Representative card (prefer one whose art we can show) + aggregated stats.
  type Group = {
    name: string;
    typeLine: string | null;
    manaCost: string | null;
    cmc: number | null;
    imageUris: unknown;
    cardFaces: unknown;
    layout: string | null;
    setCodes: string[];
    totalQty: number;
    totalValue: number;
    hasFoil: number;
    bestCondition: string | null;
    _members?: PerCard[];
    items?: any[];
  };
  const groups: Group[] = [];
  for (const [name, members] of nameGroups) {
    const rep = members[0];
    const parsed = parseCardJson(rep.card);
    groups.push({
      name,
      typeLine: parsed.typeLine,
      manaCost: parsed.manaCost,
      cmc: parsed.cmc,
      imageUris: parsed.imageUris,
      cardFaces: parsed.cardFaces,
      layout: parsed.layout,
      setCodes: [...new Set(members.map(m => m.setCode))],
      totalQty: members.reduce((s, m) => s + m.totalQty, 0),
      totalValue: members.reduce((s, m) => s + m.totalValue, 0),
      hasFoil: members.some(m => m.hasFoil) ? 1 : 0,
      bestCondition: members.reduce((best, m) => {
        if (!best) return m.bestCondition;
        if (!m.bestCondition) return best;
        return condRank(m.bestCondition) < condRank(best) ? m.bestCondition : best;
      }, null as string | null),
      _members: members,
    });
  }

  groups.sort((a, b) => {
    let cmp = 0;
    if (sort === 'name') cmp = a.name.localeCompare(b.name);
    else if (sort === 'qty') cmp = a.totalQty - b.totalQty;
    else if (sort === 'price') cmp = a.totalValue - b.totalValue;
    else if (sort === 'foil') cmp = (a.hasFoil || 0) - (b.hasFoil || 0);
    else if (sort === 'cond') cmp = condRank(a.bestCondition) - condRank(b.bestCondition);
    else if (sort === 'set') cmp = (a.setCodes[0] || '').localeCompare(b.setCodes[0] || '');
    return cmp * order;
  });

  const total = groups.length;
  const totalPages = Math.ceil(total / pageSize);
  const pageGroups = groups.slice((page - 1) * pageSize, page * pageSize);

  // Fetch the per-item rows (flags + card details) only for the current page's
  // cards, then attach them to each group.
  if (pageGroups.length > 0) {
    const pageCardIds = [...new Set(pageGroups.flatMap(g => (g._members || []).map(m => m.cardId)))];
    const itemRows = loadPageItems(pageCardIds, joins, sqlWhere, queryParams);
    const byCard = new Map<string, any[]>();
    for (const row of itemRows) {
      if (!byCard.has(row.cardId)) byCard.set(row.cardId, []);
      byCard.get(row.cardId)!.push(row);
    }
    const pageCardsMap = cardsByIds(pageCardIds);
    for (const g of pageGroups) {
      const items: any[] = [];
      for (const m of g._members || []) {
        const rows = byCard.get(m.cardId) ?? [];
        for (const r of rows) {
          const c = pageCardsMap.get(r.cardId);
          items.push({ ...r, card: c ? parseCardJson(c) : null });
        }
      }
      g.items = items;
      delete g._members;
    }
  } else {
    for (const g of pageGroups) { delete g._members; }
  }

  res.json({ groups: pageGroups, total, page, pageSize, totalPages, incoming: locationId ? loadIncoming(locationId) : [] });
});

// Fetch per-item collection rows for a set of card ids, reusing the same base
// filter (location/deck/group/condition/foil/value + any card-id filter). The
// caller supplies the already-built joins/where/params.
function loadPageItems(cardIds: string[], joins: string, sqlWhere: string, baseParams: unknown[]) {
  const ids = [...cardIds];
  if (ids.length === 0) return [];
  // Rebuild a filtered query: base filter + only these card ids.
  let where = '';
  const params: unknown[] = [];
  if (sqlWhere) {
    // Strip the leading keyword and rebuild with our own.
    where = sqlWhere.replace(/^WHERE\s+/i, 'WHERE ');
    params.push(...baseParams);
  }
  const idChunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 200) idChunks.push(ids.slice(i, i + 200));
  const idIn = idChunks.map(ch => `ci.card_id IN (${ch.map(() => '?').join(',')})`).join(' OR ');
  where += `${where ? ' AND ' : 'WHERE '} (${idIn})`;
  params.push(...idChunks.flat());
  // Note: card-id filter params in baseParams already bound, so no double-bind.
  return sqlite.prepare(`
    SELECT
      ci.id, ci.card_id as cardId, ci.location_id as locationId, ci.destination_id as destinationId,
      ci.foil, ci.foreign_language as foreignLanguage, ci.condition, ci.quantity,
      ci.purchase_price as purchasePrice, ci.price_autofilled as priceAutofilled,
      ci.pack_opened as packOpened, ci.proxy, ci.misprint, ci.altered, ci.notes, ci.acquired_at as acquiredAt, ci.created_at as createdAt
    FROM collection_items ci
    ${joins}
    ${where}
  `).all(...params) as any[];
}

function loadIncoming(locationId: number): any[] {
  const incStmt = sqlite.prepare(`
    SELECT
      ci.id, ci.card_id as cardId, ci.location_id as locationId, ci.destination_id as destinationId,
      ci.foil, ci.condition, ci.quantity, ci.notes,
      src_loc.name as sourceName
    FROM collection_items ci
    JOIN locations src_loc ON src_loc.id = ci.location_id
    WHERE ci.destination_id = ? AND ci.location_id != ?
    ORDER BY ci.created_at DESC
  `);
  const incRows = incStmt.all(locationId, locationId) as any[];
  const incCards = cardsByIds(incRows.map(i => i.cardId));
  return incRows.map(i => ({
    id: i.id,
    cardId: i.cardId,
    locationId: i.locationId,
    destinationId: i.destinationId,
    foil: i.foil,
    condition: i.condition,
    quantity: i.quantity,
    notes: i.notes,
    sourceName: i.sourceName,
    card: i.cardId && incCards.get(i.cardId) ? parseCardJson(incCards.get(i.cardId)!) : null,
  }));
}
