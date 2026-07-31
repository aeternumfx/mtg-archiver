import { Router } from 'express';
import { db, sqlite, schema } from '../db';
import { eq, desc } from 'drizzle-orm';

export const tradesRouter = Router();

tradesRouter.get('/', (_req, res) => {
  const allTrades = db.select().from(schema.trades).orderBy(desc(schema.trades.updatedAt)).all();
  const result = allTrades.map(t => {
    const items = db.select().from(schema.tradeItems).where(eq(schema.tradeItems.tradeId, t.id)).all();
    return { ...t, items };
  });
  res.json(result);
});

tradesRouter.post('/', (req, res) => {
  const { title, yourCash, theirCash, contactInfo, notes, items } = req.body;
  try {
    const trade = db.insert(schema.trades)
      .values({ title: title ?? null, yourCash: yourCash ?? 0, theirCash: theirCash ?? 0, contactInfo: contactInfo ?? null, notes: notes ?? null })
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
          })
          .run();
      }
    }

    const saved = db.select().from(schema.trades).where(eq(schema.trades.id, trade.id)).get();
    const savedItems = db.select().from(schema.tradeItems).where(eq(schema.tradeItems.tradeId, trade.id)).all();
    res.status(201).json({ ...saved, items: savedItems });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

tradesRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const { title, yourCash, theirCash, contactInfo, notes, status, items } = req.body;
  try {
    const updates: Record<string, unknown> = {};
    if (title !== undefined) updates.title = title;
    if (yourCash !== undefined) updates.yourCash = yourCash;
    if (theirCash !== undefined) updates.theirCash = theirCash;
    if (contactInfo !== undefined) updates.contactInfo = contactInfo;
    if (notes !== undefined) updates.notes = notes;
    if (status !== undefined) updates.status = status;
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
            })
            .run();
        }
      })();
    }

    const saved = db.select().from(schema.trades).where(eq(schema.trades.id, id)).get();
    const savedItems = db.select().from(schema.tradeItems).where(eq(schema.tradeItems.tradeId, id)).all();
    res.json({ ...saved, items: savedItems });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

tradesRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  try {
    db.delete(schema.tradeItems).where(eq(schema.tradeItems.tradeId, id)).run();
    db.delete(schema.trades).where(eq(schema.trades.id, id)).run();
    res.status(204).end();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
