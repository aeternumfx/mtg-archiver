import { Router } from 'express';
import { db, sqlite, schema } from '../db';
import { eq, desc, sql } from 'drizzle-orm';

export const wantlistRouter = Router();

wantlistRouter.get('/', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 100));
  const destinationId = req.query.destinationId ? Number(req.query.destinationId) : undefined;
  const where = destinationId ? eq(schema.wantlistItems.destinationId, destinationId) : undefined;

  const total = db.select({ count: sql<number>`COUNT(*)` }).from(schema.wantlistItems).where(where).get()?.count ?? 0;

  if (req.query.page === undefined) {
    const items = db.select().from(schema.wantlistItems).where(where).orderBy(desc(schema.wantlistItems.createdAt)).all();
    return res.json(items);
  }

  const items = db.select().from(schema.wantlistItems)
    .where(where)
    .orderBy(desc(schema.wantlistItems.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all();

  res.json({
    data: items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
});

wantlistRouter.post('/', (req, res) => {
  const { cardId, cardName, setCode, collectorNumber, foil, condition, notes, destinationId, collectionGoalId, persistent } = req.body;
  if (!cardName) return res.status(400).json({ error: 'cardName is required' });
  try {
    const item = db.insert(schema.wantlistItems)
      .values({
        cardId: cardId ?? null, cardName, setCode: setCode ?? null, collectorNumber: collectorNumber ?? null,
        foil: foil ? 1 : 0, condition: condition ?? null, quantity: 1, notes: notes ?? null,
        destinationId: destinationId ?? null,
        collectionGoalId: collectionGoalId ?? null,
        persistent: persistent ? 1 : 0,
      })
      .returning().get();
    res.status(201).json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

wantlistRouter.delete('/:id', (req, res) => {
  try {
    db.delete(schema.wantlistItems).where(eq(schema.wantlistItems.id, Number(req.params.id))).run();
    res.status(204).end();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

wantlistRouter.post('/:id/fulfil', (req, res) => {
  const id = Number(req.params.id);
  const count = Math.max(1, Number(req.body?.count) || 1);

  try {
    const item = db.select().from(schema.wantlistItems).where(eq(schema.wantlistItems.id, id)).get();
    if (!item) return res.status(404).json({ error: 'Wantlist item not found' });

    if (!item.collectionGoalId) {
      db.delete(schema.wantlistItems).where(eq(schema.wantlistItems.id, id)).run();
      return res.json({ removed: true });
    }

    const goal = db.select().from(schema.collectionGoals).where(eq(schema.collectionGoals.id, item.collectionGoalId)).get();
    if (!goal) {
      db.delete(schema.wantlistItems).where(eq(schema.wantlistItems.id, id)).run();
      return res.json({ removed: true });
    }

    const newCount = (goal.fulfilledCount || 0) + count;
    const targetMet = goal.targetCount != null && newCount >= goal.targetCount;
    let removed = false;

    if (item.persistent) {
      removed = targetMet;
      if (removed) {
        db.delete(schema.wantlistItems).where(eq(schema.wantlistItems.id, id)).run();
      }
    } else {
      removed = true;
      db.delete(schema.wantlistItems).where(eq(schema.wantlistItems.id, id)).run();
    }

    db.update(schema.collectionGoals)
      .set({ fulfilledCount: newCount, status: targetMet ? 'complete' : goal.status })
      .where(eq(schema.collectionGoals.id, goal.id))
      .run();

    res.json({
      removed,
      goal: {
        id: goal.id,
        fulfilledCount: newCount,
        targetCount: goal.targetCount,
        complete: targetMet,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
