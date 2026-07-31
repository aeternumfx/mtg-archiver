import { Router } from 'express';
import { db, sqlite, schema } from '../db';
import { eq, inArray } from 'drizzle-orm';

export const collectionGoalsRouter = Router();

collectionGoalsRouter.get('/', (_req, res) => {
  const goals = sqlite.prepare(`
    SELECT g.id, g.location_id as locationId, g.kind, g.card_id as cardId, g.card_name as cardName,
      g.set_codes as setCodes, g.target_count as targetCount, g.fulfilled_count as fulfilledCount,
      g.status, g.created_at as createdAt, l.name as locationName
    FROM collection_goals g
    JOIN locations l ON l.id = g.location_id
    ORDER BY g.created_at DESC
  `).all() as any[];
  const withCounts = goals.map(g => {
    const remaining = sqlite.prepare(
      'SELECT COUNT(*) as c FROM wantlist_items WHERE collection_goal_id = ?'
    ).get(g.id) as { c: number };
    const cost = sqlite.prepare(`
      SELECT COALESCE(SUM(json_extract(sc.prices, '$.usd')), 0) as total
      FROM wantlist_items w
      JOIN scryfall_cards sc ON sc.id = w.card_id
      WHERE w.collection_goal_id = ?
    `).get(g.id) as { total: number };
    const percent = g.targetCount ? Math.min(100, Math.round(((g.fulfilledCount || 0) / g.targetCount) * 100)) : 0;
    return { ...g, remaining: remaining.c, remainingCost: Math.round(cost.total * 100) / 100, percent };
  });
  res.json(withCounts);
});

collectionGoalsRouter.post('/', (req, res) => {
  const { name, description, kind, cardId, cardName, setCodes, targetCount, perpetual } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!kind || !['specific', 'generic', 'set'].includes(kind)) {
    return res.status(400).json({ error: 'kind must be specific, generic, or set' });
  }
  if (name.trim().toLowerCase() === 'inbox') {
    return res.status(400).json({ error: 'Cannot create a location named Inbox' });
  }

  try {
    const result = sqlite.transaction(() => {
      const loc = db.insert(schema.locations)
        .values({ name: name.trim(), description: description ?? null, type: 'collection' })
        .returning().get();

      const target = kind === 'set' ? null : (perpetual ? null : Math.max(1, Number(targetCount) || 1));

      const goal = db.insert(schema.collectionGoals)
        .values({
          locationId: loc.id,
          kind,
          cardId: cardId ?? null,
          cardName: cardName ?? null,
          setCodes: setCodes ? (Array.isArray(setCodes) ? setCodes.join(',') : String(setCodes)) : null,
          targetCount: target,
          fulfilledCount: 0,
          status: 'active',
        })
        .returning().get();

      let created = 0;
      if (kind === 'specific' && cardId) {
        const card = db.select().from(schema.scryfallCards).where(eq(schema.scryfallCards.id, cardId)).get();
        if (!card) throw new Error('Card not found');
        db.insert(schema.wantlistItems).values({
          cardId: card.id, cardName: card.name, setCode: card.setCode, collectorNumber: card.collectorNumber,
          destinationId: loc.id, collectionGoalId: goal.id, persistent: 1, quantity: 1,
        }).run();
        created = 1;
      } else if (kind === 'generic' && cardName) {
        db.insert(schema.wantlistItems).values({
          cardName, destinationId: loc.id, collectionGoalId: goal.id, persistent: 1, quantity: 1,
        }).run();
        created = 1;
      } else if (kind === 'set' && setCodes && setCodes.length > 0) {
        const codes = (Array.isArray(setCodes) ? setCodes : [String(setCodes)]).filter(Boolean);
        const cards = db.select().from(schema.scryfallCards)
          .where(inArray(schema.scryfallCards.setCode, codes))
          .all();
        const insert = sqlite.prepare(`
          INSERT INTO wantlist_items (card_id, card_name, set_code, collector_number, destination_id, collection_goal_id, persistent, quantity)
          VALUES (?, ?, ?, ?, ?, ?, 0, 1)
        `);
        for (const c of cards) {
          insert.run(c.id, c.name, c.setCode, c.collectorNumber, loc.id, goal.id);
          created++;
        }
        db.update(schema.collectionGoals)
          .set({ targetCount: created })
          .where(eq(schema.collectionGoals.id, goal.id))
          .run();
      }

      return { loc, goal, created };
    })();

    res.status(201).json(result);
  } catch (err: any) {
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Location name already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

collectionGoalsRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  try {
    sqlite.transaction(() => {
      sqlite.prepare('DELETE FROM wantlist_items WHERE collection_goal_id = ?').run(id);
      db.delete(schema.collectionGoals).where(eq(schema.collectionGoals.id, id)).run();
    })();
    res.status(204).end();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
