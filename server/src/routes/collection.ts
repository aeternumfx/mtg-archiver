import { Router } from 'express';
import { db, sqlite, schema } from '../db';
import { eq, and, or, like, asc, desc, sql } from 'drizzle-orm';

export const collectionRouter = Router();

collectionRouter.get('/names', (_req, res) => {
  const rows = sqlite.prepare(
    'SELECT DISTINCT sc.name FROM collection_items ci JOIN scryfall_cards sc ON sc.id = ci.card_id ORDER BY sc.name'
  ).all() as Array<{ name: string }>;
  res.json(rows.map(r => r.name));
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
    condition: schema.collectionItems.condition,
    quantity: schema.collectionItems.quantity,
    purchasePrice: schema.collectionItems.purchasePrice,
    priceAutofilled: schema.collectionItems.priceAutofilled,
    packOpened: schema.collectionItems.packOpened,
    notes: schema.collectionItems.notes,
    acquiredAt: schema.collectionItems.acquiredAt,
    createdAt: schema.collectionItems.createdAt,
    card: {
      id: schema.scryfallCards.id,
      name: schema.scryfallCards.name,
      setName: schema.scryfallCards.setName,
      setCode: schema.scryfallCards.setCode,
      collectorNumber: schema.scryfallCards.collectorNumber,
      rarity: schema.scryfallCards.rarity,
      manaCost: schema.scryfallCards.manaCost,
      cmc: schema.scryfallCards.cmc,
      typeLine: schema.scryfallCards.typeLine,
      imageUris: schema.scryfallCards.imageUris,
      prices: schema.scryfallCards.prices,
    },
  })
    .from(schema.collectionItems)
    .where(where)
    .innerJoin(schema.scryfallCards, eq(schema.collectionItems.cardId, schema.scryfallCards.id))
    .orderBy(schema.scryfallCards.name)
    .limit(pageSize)
    .offset(offset)
    .all();

  const parsed = items.map(i => ({
    ...i,
    card: {
      ...i.card,
      imageUris: i.card.imageUris ? JSON.parse(i.card.imageUris) : null,
      prices: i.card.prices ? JSON.parse(i.card.prices) : null,
    },
  }));

  res.json({ data: parsed, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
});

collectionRouter.post('/', (req, res) => {
  let { cardId, locationId, destinationId, quantity, foil, condition, purchasePrice, priceAutofilled, packOpened, notes, acquiredAt, forceNew } = req.body;

  if (!cardId || !locationId) {
    return res.status(400).json({ error: 'cardId and locationId are required' });
  }

  const card = db.select().from(schema.scryfallCards).where(eq(schema.scryfallCards.id, cardId)).get();
  if (!card) return res.status(404).json({ error: 'Card not found' });

  const loc = db.select().from(schema.locations).where(eq(schema.locations.id, locationId)).get();
  if (!loc) return res.status(404).json({ error: 'Location not found' });

  foil = foil ? 1 : 0;
  condition = condition || null;
  quantity = quantity ?? 1;
  packOpened = packOpened ? 1 : 0;
  priceAutofilled = priceAutofilled ? 1 : 0;
  if (!acquiredAt) acquiredAt = new Date().toISOString().split('T')[0];

  if (purchasePrice === undefined || purchasePrice === null) {
    const prices = card.prices ? JSON.parse(card.prices) : {};
    const usd = prices.usd || prices.usd_foil;
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
    .values({ cardId, locationId, destinationId: destinationId ?? null, foil, condition, quantity, purchasePrice, priceAutofilled, packOpened, notes: notes ?? null, acquiredAt })
    .returning().get();

  const foundCard = db.select().from(schema.scryfallCards).where(eq(schema.scryfallCards.id, cardId)).get();
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

  const { quantity, foil, condition, purchasePrice, packOpened, notes, acquiredAt, destinationId, locationId } = req.body;

  const updates: Record<string, unknown> = {};
  if (quantity !== undefined) updates.quantity = quantity;
  if (foil !== undefined) updates.foil = foil ? 1 : 0;
  if (condition !== undefined) updates.condition = condition || null;
  if (purchasePrice !== undefined) updates.purchasePrice = purchasePrice;
  if (packOpened !== undefined) updates.packOpened = packOpened ? 1 : 0;
  if (notes !== undefined) updates.notes = notes;
  if (acquiredAt !== undefined) updates.acquiredAt = acquiredAt;
  if (locationId !== undefined) {
    const loc = db.select().from(schema.locations).where(eq(schema.locations.id, locationId)).get();
    if (!loc) throw new Error('Location not found');
    updates.locationId = locationId;
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

  let movedHistoryId: number | null = null;
  if (locationId !== undefined && locationId !== item.locationId) {
    const card = db.select().from(schema.scryfallCards).where(eq(schema.scryfallCards.id, item.cardId)).get();
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
          condition: item.condition,
          quantity: 1,
          purchasePrice: item.purchasePrice,
          priceAutofilled: item.priceAutofilled,
          packOpened: item.packOpened,
          notes: item.notes,
          acquiredAt: item.acquiredAt,
        })
        .returning().get();
    })();

    res.status(201).json(newItem);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

collectionRouter.post('/move', (req, res) => {
  const { items, destinationLocationId } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0 || !destinationLocationId) {
    return res.status(400).json({ error: 'items array and destinationLocationId are required' });
  }

  const destLoc = db.select().from(schema.locations).where(eq(schema.locations.id, destinationLocationId)).get();
  if (!destLoc) return res.status(404).json({ error: 'Destination location not found' });

  try {
    const results = sqlite.transaction(() => {
      const results: Array<{ id: number; cardId: string; quantity: number }> = [];

      for (const item of items) {
        const { id: itemId, quantity = null } = item;

        const sourceItem = db.select()
          .from(schema.collectionItems)
          .where(eq(schema.collectionItems.id, itemId))
          .get();

        if (!sourceItem) {
          throw new Error(`Collection item ${itemId} not found`);
        }

        const moveQty = quantity !== null ? Math.min(quantity as number, sourceItem.quantity) : sourceItem.quantity;
        if (moveQty <= 0) continue;

        const remaining = sourceItem.quantity - moveQty;

        if (remaining > 0) {
          db.update(schema.collectionItems)
            .set({ quantity: remaining })
            .where(eq(schema.collectionItems.id, sourceItem.id))
            .run();
        } else {
          db.delete(schema.collectionItems).where(eq(schema.collectionItems.id, sourceItem.id)).run();
        }

        const destExisting = db.select()
          .from(schema.collectionItems)
          .where(and(
            eq(schema.collectionItems.cardId, sourceItem.cardId),
            eq(schema.collectionItems.locationId, destinationLocationId),
            eq(schema.collectionItems.foil, sourceItem.foil),
            sourceItem.condition
              ? eq(schema.collectionItems.condition, sourceItem.condition)
              : sql`${schema.collectionItems.condition} IS NULL`,
          ))
          .get();

        if (destExisting) {
          db.update(schema.collectionItems)
            .set({ quantity: destExisting.quantity + moveQty })
            .where(eq(schema.collectionItems.id, destExisting.id))
            .run();
        } else {
          db.insert(schema.collectionItems)
            .values({
              cardId: sourceItem.cardId,
              locationId: destinationLocationId,
              foil: sourceItem.foil,
              condition: sourceItem.condition,
              quantity: moveQty,
              purchasePrice: sourceItem.purchasePrice,
              priceAutofilled: sourceItem.priceAutofilled,
              packOpened: sourceItem.packOpened,
              notes: sourceItem.notes,
              acquiredAt: sourceItem.acquiredAt,
            })
            .run();
        }

        results.push({ id: sourceItem.id, cardId: sourceItem.cardId, quantity: moveQty });
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

  const condRank = (cond: string | null): number => {
    const rank: Record<string, number> = { M: 0, NM: 1, LP: 2, MP: 3, HP: 4, Dmg: 5 };
    return cond ? (rank[cond] ?? 99) : 99;
  };

  let whereConditions: any[] = [];
  const queryParams: any[] = [];
  let joins = '';
  let sqlWhere = '';
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
  if (q) {
    const pattern = `%${q.replace(/['"]/g, '')}%`;
    queryParams.push(pattern);
    sqlWhere += `${sqlWhere ? ' AND ' : 'WHERE '} sc.name LIKE ?`;
  }

  const colorKeys = Object.keys(req.query).filter(k => k.startsWith('c_'));
  for (const key of colorKeys) {
    const color = key.slice(2).toUpperCase();
    const val = req.query[key] as string;
    if (val === 'include') {
      sqlWhere += `${sqlWhere ? ' AND ' : 'WHERE '} (sc.color_identity IS NOT NULL AND sc.color_identity LIKE ?)`;
      queryParams.push(`%"${color}"%`);
    } else if (val === 'exclude') {
      sqlWhere += `${sqlWhere ? ' AND ' : 'WHERE '} (sc.color_identity IS NULL OR sc.color_identity NOT LIKE ?)`;
      queryParams.push(`%"${color}"%`);
    }
  }

  if (rarityFilter) {
    const rarities = rarityFilter.split(',').filter(Boolean);
    if (rarities.length > 0) {
      sqlWhere += `${sqlWhere ? ' AND ' : 'WHERE '} sc.rarity IN (${rarities.map(() => '?').join(',')})`;
      queryParams.push(...rarities);
    }
  }

  if (typeFilter) {
    const types = typeFilter.split(',').filter(Boolean);
    if (types.length > 0) {
      sqlWhere += `${sqlWhere ? ' AND ' : 'WHERE '} (${types.map(t => 'sc.type_line LIKE ?').join(' OR ')})`;
      queryParams.push(...types.map(t => `%${t}%`));
    }
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

  if (cmcMin !== undefined) {
    sqlWhere += `${sqlWhere ? ' AND ' : 'WHERE '} sc.cmc >= ?`;
    queryParams.push(cmcMin);
  }
  if (cmcMax !== undefined) {
    sqlWhere += `${sqlWhere ? ' AND ' : 'WHERE '} sc.cmc <= ?`;
    queryParams.push(cmcMax);
  }

  if (valueMin !== undefined) {
    sqlWhere += `${sqlWhere ? ' AND ' : 'WHERE '} (ci.quantity * ci.purchase_price) >= ?`;
    queryParams.push(valueMin);
  }
  if (valueMax !== undefined) {
    sqlWhere += `${sqlWhere ? ' AND ' : 'WHERE '} (ci.quantity * ci.purchase_price) <= ?`;
    queryParams.push(valueMax);
  }

  const stmt = sqlite.prepare(`
    SELECT
      ci.card_id as cardId,
      sc.name as c_name,
      sc.type_line as typeLine,
      sc.mana_cost as manaCost,
      sc.image_uris as imageUris,
      sc.set_name as setName,
      sc.set_code as setCode,
      sc.collector_number as collectorNumber,
      sc.rarity as rarity,
      COALESCE(SUM(ci.quantity), 0) as sum_qty,
      COALESCE(SUM(ci.quantity * ci.purchase_price), 0) as sum_price,
      MAX(ci.foil) as has_foil,
      sc.prices as prices,
      sc.cmc
    FROM collection_items ci
    ${joins}
    JOIN scryfall_cards sc ON sc.id = ci.card_id
    ${sqlWhere}
    GROUP BY ci.card_id
    ORDER BY c_name
  `);

  const itemsStmt = sqlite.prepare(`
    SELECT
      ci.id, ci.card_id as cardId, ci.location_id as locationId, ci.destination_id as destinationId,
      ci.foil, ci.condition, ci.quantity,
      ci.purchase_price as purchasePrice, ci.price_autofilled as priceAutofilled,
      ci.pack_opened as packOpened, ci.notes, ci.acquired_at as acquiredAt, ci.created_at as createdAt,
      sc.name, sc.set_name as setName, sc.set_code as setCode,
      sc.collector_number as collectorNumber, sc.rarity, sc.mana_cost as manaCost,
      sc.cmc, sc.type_line as typeLine, sc.image_uris as imageUris,
      sc.prices
    FROM collection_items ci
    ${joins}
    JOIN scryfall_cards sc ON sc.id = ci.card_id
    ${sqlWhere}
    ORDER BY sc.name
  `);

  const rawItems = itemsStmt.all(...queryParams) as any[];

  const parsedItems = rawItems.map((i: any) => ({
    id: i.id,
    cardId: i.cardId,
    locationId: i.locationId,
    destinationId: i.destinationId,
    foil: i.foil,
    condition: i.condition,
    quantity: i.quantity,
    purchasePrice: i.purchasePrice,
    priceAutofilled: i.priceAutofilled,
    packOpened: i.packOpened,
    notes: i.notes,
    acquiredAt: i.acquiredAt,
    createdAt: i.createdAt,
    card: {
      id: i.cardId,
      name: i.name,
      setName: i.setName,
      setCode: i.setCode,
      collectorNumber: i.collectorNumber,
      rarity: i.rarity,
      manaCost: i.manaCost,
      cmc: i.cmc,
      typeLine: i.typeLine,
      imageUris: i.imageUris ? JSON.parse(i.imageUris) : null,
      prices: i.prices ? JSON.parse(i.prices) : null,
    },
  }));

  const groupsMap: Record<string, typeof parsedItems> = {};
  for (const item of parsedItems) {
    const key = item.card.name;
    if (!groupsMap[key]) groupsMap[key] = [];
    groupsMap[key].push(item);
  }

  const groupsResult = Object.entries(groupsMap).map(([name, items]) => {
    const card = items[0].card;
    const totalQty = items.reduce((s, i) => s + i.quantity, 0);
    const totalValue = items.reduce((s, i) => s + (i.quantity * (i.purchasePrice ?? 0)), 0);
    const hasFoil = items.some(i => i.foil);
    const setCodes = [...new Set(items.map(i => i.card.setCode))];
    const conds = items.map(i => i.condition).filter(Boolean) as string[];
    conds.sort((a, b) => condRank(a) - condRank(b));
    return {
      name, typeLine: card.typeLine, manaCost: card.manaCost, cmc: card.cmc,
      imageUris: card.imageUris, setCodes, totalQty, totalValue,
      hasFoil: hasFoil ? 1 : 0, bestCondition: conds[0] || null,
      items,
    };
  });

  groupsResult.sort((a, b) => {
    let cmp = 0;
    if (sort === 'name') cmp = a.name.localeCompare(b.name);
    else if (sort === 'qty') cmp = a.totalQty - b.totalQty;
    else if (sort === 'price') cmp = a.totalValue - b.totalValue;
    else if (sort === 'foil') cmp = (a.hasFoil || 0) - (b.hasFoil || 0);
    else if (sort === 'cond') cmp = condRank(a.bestCondition) - condRank(b.bestCondition);
    else if (sort === 'set') cmp = (a.setCodes[0] || '').localeCompare(b.setCodes[0] || '');
    return cmp * order;
  });

  const total = groupsResult.length;
  const totalPages = Math.ceil(total / pageSize);
  const paginated = groupsResult.slice((page - 1) * pageSize, page * pageSize);

  res.json({ groups: paginated, total, page, pageSize, totalPages });
});
