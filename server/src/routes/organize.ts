import { Router } from 'express';
import { db, sqlite, schema } from '../db';
import { eq, desc, sql } from 'drizzle-orm';

export const organizeRouter = Router();

organizeRouter.get('/pending', (_req, res) => {
  const items = sqlite.prepare(`
    SELECT ci.id, ci.card_id as cardId, ci.location_id as locationId,
      ci.destination_id as destinationId, ci.quantity,
      sc.id as cardId2, sc.name, sc.set_name as setName, sc.set_code as setCode,
      sc.collector_number as collectorNumber, sc.image_uris as imageUris, sc.prices,
      src_loc.name as sourceName, dst_loc.name as destName
    FROM collection_items ci
    JOIN scryfall_cards sc ON sc.id = ci.card_id
    JOIN locations src_loc ON src_loc.id = ci.location_id
    JOIN locations dst_loc ON dst_loc.id = ci.destination_id
    WHERE ci.destination_id IS NOT NULL AND ci.destination_id != ci.location_id
    ORDER BY ci.created_at DESC
  `).all() as any[];

  const parsed = items.map(i => ({
    id: i.id, cardId: i.cardId, locationId: i.locationId,
    destinationId: i.destinationId, quantity: i.quantity,
    card: {
      id: i.cardId2, name: i.name, setName: i.setName, setCode: i.setCode,
      collectorNumber: i.collectorNumber,
      imageUris: i.imageUris ? JSON.parse(i.imageUris) : null,
      prices: i.prices ? JSON.parse(i.prices) : null,
    },
    sourceLoc: { id: i.locationId, name: i.sourceName },
    destLoc: { id: i.destinationId, name: i.destName },
  }));

  res.json(parsed);
});

organizeRouter.post('/resolve', (req, res) => {
  const { itemIds, all } = req.body;

  try {
    const history: Array<{ id: number; locId: number; destId: number | null }> = [];

    sqlite.transaction(() => {
      if (all) {
        const rows = sqlite.prepare(
          'SELECT id, location_id, destination_id FROM collection_items WHERE destination_id IS NOT NULL AND destination_id != location_id',
        ).all() as any[];
        for (const row of rows) {
          history.push({ id: row.id, locId: row.location_id, destId: row.destination_id });
          const item = sqlite.prepare(
            'SELECT card_id, quantity, location_id FROM collection_items WHERE id = ?',
          ).get(row.id) as any;
          sqlite.prepare(`UPDATE collection_items SET location_id = destination_id, destination_id = NULL WHERE id = ?`).run(row.id);
          sqlite.prepare(`INSERT INTO movement_history (item_id, card_id, card_name, action, from_location_id, to_location_id, quantity) VALUES (?, ?, '', 'resolved', ?, ?, ?)`)
            .run(row.id, item.card_id, row.locId, row.destination_id, item.quantity);
        }
      } else if (itemIds && Array.isArray(itemIds)) {
        for (const id of itemIds) {
          const row = sqlite.prepare('SELECT id, location_id, destination_id, card_id, quantity FROM collection_items WHERE id = ? AND destination_id IS NOT NULL AND destination_id != location_id').get(id) as any;
          if (!row) continue;
          history.push({ id: row.id, locId: row.location_id, destId: row.destination_id });
          sqlite.prepare(`UPDATE collection_items SET location_id = destination_id, destination_id = NULL WHERE id = ?`).run(id);
          sqlite.prepare(`INSERT INTO movement_history (item_id, card_id, card_name, action, from_location_id, to_location_id, quantity) VALUES (?, ?, '', 'resolved', ?, ?, ?)`)
            .run(id, row.card_id, row.location_id, row.destination_id, row.quantity);
        }
      }
    })();

    res.json({ message: 'Movements resolved', undo: history });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

organizeRouter.post('/undo-resolve', (req, res) => {
  const { history } = req.body;
  if (!history || !Array.isArray(history)) return res.status(400).json({ error: 'history required' });

  try {
    sqlite.transaction(() => {
      for (const h of history) {
        sqlite.prepare(`UPDATE collection_items SET location_id = ?, destination_id = ? WHERE id = ?`).run(h.locId, h.destId, h.id);
        sqlite.prepare(`DELETE FROM movement_history WHERE item_id = ? AND action = 'resolved' ORDER BY created_at DESC LIMIT 1`).run(h.id);
      }
    })();
    res.json({ message: 'Undone' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

organizeRouter.get('/history', (_req, res) => {
  const limit = Math.min(200, Math.max(1, Number(_req.query.limit) || 100));
  const entries = db.select().from(schema.movementHistory).orderBy(desc(schema.movementHistory.createdAt)).limit(limit).all();
  res.json(entries);
});

organizeRouter.post('/history/undo', (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array is required' });
  }
  try {
    sqlite.transaction(() => {
      for (const id of ids) {
        sqlite.prepare('UPDATE movement_history SET undone = 1 WHERE id = ?').run(Number(id));
      }
    })();
    res.json({ message: 'Marked as undone' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
