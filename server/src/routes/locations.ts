import { Router } from 'express';
import { db, schema } from '../db';
import { eq, sql } from 'drizzle-orm';

export const locationsRouter = Router();

locationsRouter.get('/', (_req, res) => {
  const locations = db.all<{
    id: number; name: string; description: string | null; type: string; createdAt: string; cardCount: number; groupId: number | null;
  }>(sql`
    SELECT l.id, l.name, l.description, l.type, l.created_at as createdAt, l.group_id as groupId, l.built_in as builtIn,
      COALESCE(SUM(ci.quantity), 0) as cardCount
    FROM locations l
    LEFT JOIN collection_items ci ON ci.location_id = l.id
    GROUP BY l.id
    ORDER BY l.name
  `);
  res.json(locations);
});

locationsRouter.get('/:id', (req, res) => {
  const loc = db.select().from(schema.locations).where(eq(schema.locations.id, Number(req.params.id))).get();
  if (!loc) return res.status(404).json({ error: 'Location not found' });
  res.json(loc);
});

locationsRouter.post('/', (req, res) => {
  const { name, description, type } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  if (name.trim().toLowerCase() === 'inbox') {
    return res.status(400).json({ error: 'Cannot create a location named Inbox' });
  }
  try {
    const loc = db.insert(schema.locations).values({ name: name.trim(), description: description ?? null, type: type ?? 'binder' }).returning().get();
    res.status(201).json(loc);
  } catch (err: any) {
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Location name already exists' });
    }
    throw err;
  }
});

locationsRouter.put('/:id', (req, res) => {
  const { name, description, type } = req.body;
  const loc = db.select().from(schema.locations).where(eq(schema.locations.id, Number(req.params.id))).get();
  if (!loc) return res.status(404).json({ error: 'Location not found' });
  if (loc.builtIn) return res.status(400).json({ error: 'Cannot edit a built-in location' });
  try {
    const updated = db.update(schema.locations)
      .set({ name: name?.trim() ?? loc.name, description: description ?? loc.description, type: type ?? loc.type })
      .where(eq(schema.locations.id, loc.id))
      .returning().get();
    res.json(updated);
  } catch (err: any) {
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Location name already exists' });
    }
    throw err;
  }
});

locationsRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const loc = db.select().from(schema.locations).where(eq(schema.locations.id, id)).get();
  if (!loc) return res.status(404).json({ error: 'Location not found' });
  if (loc.builtIn) return res.status(400).json({ error: 'Cannot delete a built-in location' });

  const itemCount = db.select().from(schema.collectionItems).where(eq(schema.collectionItems.locationId, id)).all().length;
  if (itemCount > 0) {
    return res.status(400).json({ error: `Location has ${itemCount} card(s). Move or remove them first.` });
  }

  const goals = db.select().from(schema.collectionGoals).where(eq(schema.collectionGoals.locationId, id)).all();
  for (const goal of goals) {
    db.delete(schema.wantlistItems).where(eq(schema.wantlistItems.collectionGoalId, goal.id)).run();
  }
  db.delete(schema.collectionGoals).where(eq(schema.collectionGoals.locationId, id)).run();
  db.delete(schema.locations).where(eq(schema.locations.id, id)).run();
  res.status(204).end();
});
