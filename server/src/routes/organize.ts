import { fail } from '../utils/http';
import { Router } from 'express';
import { db, sqlite, schema } from '../db';
import { eq, desc, sql } from 'drizzle-orm';
import { cardsByIds, parseCardJson } from '../services/cards';

export const organizeRouter = Router();

organizeRouter.get('/pending', (_req, res) => {
  const items = sqlite.prepare(`
    SELECT ci.id, ci.card_id as cardId, ci.location_id as locationId,
      ci.destination_id as destinationId, ci.quantity,
      src_loc.name as sourceName, dst_loc.name as destName
    FROM collection_items ci
    JOIN locations src_loc ON src_loc.id = ci.location_id
    JOIN locations dst_loc ON dst_loc.id = ci.destination_id
    WHERE ci.destination_id IS NOT NULL AND ci.destination_id != ci.location_id
    ORDER BY ci.created_at DESC
  `).all() as any[];

  const cards = cardsByIds(items.map(i => i.cardId));

  const parsed = items.map(i => ({
    id: i.id, cardId: i.cardId, locationId: i.locationId,
    destinationId: i.destinationId, quantity: i.quantity,
    card: i.cardId && cards.get(i.cardId) ? parseCardJson(cards.get(i.cardId)!) : null,
    sourceLoc: { id: i.locationId, name: i.sourceName },
    destLoc: { id: i.destinationId, name: i.destName },
  }));

  res.json(parsed);
});

organizeRouter.post('/resolve', (req, res) => {
  const { itemIds, all } = req.body;

  try {
    const history: Array<{ id: number; locId: number; destId: number | null }> = [];

    const resolveItem = (row: { id: number; location_id: number; destination_id: number | null; card_id: string; quantity: number }) => {
      const locId = row.location_id;
      const destId = row.destination_id;
      history.push({ id: row.id, locId, destId });
      sqlite.prepare(`UPDATE collection_items SET location_id = destination_id, destination_id = NULL WHERE id = ?`).run(row.id);
      sqlite.prepare(`INSERT INTO movement_history (item_id, card_id, card_name, action, from_location_id, to_location_id, quantity) VALUES (?, ?, '', 'resolved', ?, ?, ?)`)
        .run(row.id, row.card_id, locId, destId, row.quantity);

      // If this item was scheduled to fill a deck's required (ghost) card, the
      // card has now arrived at the deck location: attach it to the deck and
      // remove the ghost.
      const reqRow = sqlite.prepare('SELECT id, deck_id FROM deck_required_cards WHERE fill_item_id = ?').get(row.id) as { id: number; deck_id: number } | undefined;
      if (reqRow) {
        sqlite.prepare(`UPDATE collection_items SET deck_id = ? WHERE id = ?`).run(reqRow.deck_id, row.id);
        sqlite.prepare(`DELETE FROM deck_required_cards WHERE id = ?`).run(reqRow.id);
      }
    };

    sqlite.transaction(() => {
      if (all) {
        const rows = sqlite.prepare(
          'SELECT id, location_id, destination_id, card_id, quantity FROM collection_items WHERE destination_id IS NOT NULL AND destination_id != location_id',
        ).all() as any[];
        for (const row of rows) resolveItem(row);
      } else if (itemIds && Array.isArray(itemIds)) {
        for (const id of itemIds) {
          const row = sqlite.prepare('SELECT id, location_id, destination_id, card_id, quantity FROM collection_items WHERE id = ? AND destination_id IS NOT NULL AND destination_id != location_id').get(id) as any;
          if (!row) continue;
          resolveItem(row);
        }
      }
    })();

    res.json({ message: 'Movements resolved', undo: history });
  } catch (err: any) {
    fail(res, err);
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
    fail(res, err);
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
    fail(res, err);
  }
});
