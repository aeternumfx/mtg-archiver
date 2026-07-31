import { Router } from 'express';
import { db, schema } from '../db';
import { eq, sql } from 'drizzle-orm';

export const locationGroupsRouter = Router();

locationGroupsRouter.get('/', (_req, res) => {
  const groups = db.select().from(schema.locationGroups).orderBy(schema.locationGroups.sortOrder).all();
  res.json(groups);
});

locationGroupsRouter.post('/', (req, res) => {
  const { name, description } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  const maxRow = db.get<Record<string, unknown>>(sql`SELECT COALESCE(MAX(sort_order), 0) as max FROM location_groups`);
  const maxOrder = Number((maxRow as any)?.max ?? 0);
  try {
    const g = db.insert(schema.locationGroups)
      .values({ name: name.trim(), description: description ?? null, sortOrder: maxOrder + 1 })
      .returning().get();
    res.status(201).json(g);
  } catch (err: any) {
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Group name already exists' });
    throw err;
  }
});

locationGroupsRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const { name, description } = req.body;
  const group = db.select().from(schema.locationGroups).where(eq(schema.locationGroups.id, id)).get();
  if (!group) return res.status(404).json({ error: 'Group not found' });
  try {
    const updated = db.update(schema.locationGroups)
      .set({ name: name?.trim() ?? group.name, description: description ?? group.description })
      .where(eq(schema.locationGroups.id, id))
      .returning().get();
    res.json(updated);
  } catch (err: any) {
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'Group name already exists' });
    throw err;
  }
});

locationGroupsRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const group = db.select().from(schema.locationGroups).where(eq(schema.locationGroups.id, id)).get();
  if (!group) return res.status(404).json({ error: 'Group not found' });

  // Unset group_id for locations in this group
  db.update(schema.locations).set({ groupId: null }).where(eq(schema.locations.groupId, id)).run();
  db.delete(schema.locationGroups).where(eq(schema.locationGroups.id, id)).run();
  res.status(204).end();
});

// Assign location to group
locationGroupsRouter.patch('/:groupId/locations/:locationId', (req, res) => {
  const groupId = Number(req.params.groupId);
  const locationId = Number(req.params.locationId);
  const loc = db.select().from(schema.locations).where(eq(schema.locations.id, locationId)).get();
  if (!loc) return res.status(404).json({ error: 'Location not found' });
  const updated = db.update(schema.locations)
    .set({ groupId: groupId || null })
    .where(eq(schema.locations.id, locationId))
    .returning().get();
  res.json(updated);
});
