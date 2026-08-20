import { fail } from '../utils/http';
import { Router } from 'express';
import { db, sqlite, schema } from '../db';
import { eq, desc, inArray } from 'drizzle-orm';

export const tradesRouter = Router();

function syncTradeGhosts(tradeId: number, trade: { status?: string; title?: string | null; receivedLocationId?: number | null; items?: any[] }) {
  db.delete(schema.wantlistItems).where(eq(schema.wantlistItems.tradeId, tradeId)).run();
  if (trade.status !== 'pending') return;
  const notes = `Pending trade: ${trade.title || `Trade #${tradeId}`}`;
  const insert = sqlite.prepare(`
    INSERT INTO wantlist_items (card_id, card_name, set_code, collector_number, quantity, notes, destination_id, trade_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const item of trade.items || []) {
    const dest = item.side === 'theirs'
      ? (item.locationId ?? trade.receivedLocationId ?? null)
      : (item.locationId ?? null);
    if (!dest) continue;
    insert.run(item.cardId ?? null, item.cardName, item.setCode ?? null, item.collectorNumber ?? null, item.quantity ?? 1, notes, dest, tradeId);
  }
}

tradesRouter.get('/', (_req, res) => {
  const allTrades = db.select().from(schema.trades).orderBy(desc(schema.trades.updatedAt)).all();
  if (allTrades.length === 0) return res.json([]);
  const tradeIds = allTrades.map(t => t.id);
  const allItems = db.select().from(schema.tradeItems).where(inArray(schema.tradeItems.tradeId, tradeIds)).all();
  const byTrade = new Map<number, typeof allItems>();
  for (const it of allItems) {
    if (!byTrade.has(it.tradeId)) byTrade.set(it.tradeId, []);
    byTrade.get(it.tradeId)!.push(it);
  }
  const result = allTrades.map(t => ({ ...t, items: byTrade.get(t.id) ?? [] }));
  res.json(result);
});

tradesRouter.post('/', (req, res) => {
  const { title, yourCash, theirCash, contactInfo, notes, receivedLocationId, receivedDestinationId, status, items } = req.body;
  try {
    const trade = db.insert(schema.trades)
      .values({
        title: title ?? null, yourCash: yourCash ?? 0, theirCash: theirCash ?? 0,
        contactInfo: contactInfo ?? null, notes: notes ?? null,
        receivedLocationId: receivedLocationId ?? null, receivedDestinationId: receivedDestinationId ?? null,
        status: status ?? 'active',
        completedAt: status === 'completed' ? new Date().toISOString() : null,
      })
      .returning().get();

    if (items) {
      for (const item of items) {
        db.insert(schema.tradeItems)
          .values({
            tradeId: trade.id, side: item.side, cardId: item.cardId ?? null,
            cardName: item.cardName, setCode: item.setCode ?? null,
            collectorNumber: item.collectorNumber ?? null,
            foil: item.foil ? 1 : 0, condition: item.condition ?? null,
            quantity: item.quantity ?? 1, price: item.price ?? null,
            locationId: item.locationId ?? null, destinationId: item.destinationId ?? null,
          })
          .run();
      }
    }

    syncTradeGhosts(trade.id, { status, title, receivedLocationId, items });

    const saved = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id)).get();
    const savedItems = db.select().from(schema.tradeItems).where(eq(schema.tradeItems.tradeId, trade.id)).all();
    res.status(201).json({ ...saved, items: savedItems });
  } catch (err: any) {
    fail(res, err);
  }
});

tradesRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const { title, yourCash, theirCash, contactInfo, notes, status, receivedLocationId, receivedDestinationId, items } = req.body;
  try {
    const updates: Record<string, unknown> = {};
    if (title !== undefined) updates.title = title;
    if (yourCash !== undefined) updates.yourCash = yourCash;
    if (theirCash !== undefined) updates.theirCash = theirCash;
    if (contactInfo !== undefined) updates.contactInfo = contactInfo;
    if (notes !== undefined) updates.notes = notes;
    if (status !== undefined) updates.status = status;
    if (receivedLocationId !== undefined) updates.receivedLocationId = receivedLocationId;
    if (receivedDestinationId !== undefined) updates.receivedDestinationId = receivedDestinationId;
    if (status === 'completed') updates.completedAt = new Date().toISOString();
    updates.updatedAt = new Date().toISOString();

    db.update(schema.trades).set(updates).where(eq(schema.trades.id, id)).run();

    if (items) {
      sqlite.transaction(() => {
        db.delete(schema.tradeItems).where(eq(schema.tradeItems.tradeId, id)).run();
        for (const item of items) {
          db.insert(schema.tradeItems)
            .values({
              tradeId: id, side: item.side, cardId: item.cardId ?? null,
              cardName: item.cardName, setCode: item.setCode ?? null,
              collectorNumber: item.collectorNumber ?? null,
              foil: item.foil ? 1 : 0, condition: item.condition ?? null,
              quantity: item.quantity ?? 1, price: item.price ?? null,
              locationId: item.locationId ?? null, destinationId: item.destinationId ?? null,
            })
            .run();
        }
      })();
    }

    syncTradeGhosts(id, { status, title, receivedLocationId, items });

    const saved = db.select().from(schema.trades).where(eq(schema.trades.id, id)).get();
    const savedItems = db.select().from(schema.tradeItems).where(eq(schema.tradeItems.tradeId, id)).all();
    res.json({ ...saved, items: savedItems });
  } catch (err: any) {
    fail(res, err);
  }
});

tradesRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  try {
    db.delete(schema.wantlistItems).where(eq(schema.wantlistItems.tradeId, id)).run();
    db.delete(schema.tradeItems).where(eq(schema.tradeItems.tradeId, id)).run();
    db.delete(schema.trades).where(eq(schema.trades.id, id)).run();
    res.status(204).end();
  } catch (err: any) {
    fail(res, err);
  }
});
