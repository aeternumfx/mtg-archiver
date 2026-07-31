import { Router } from 'express';
import { db, sqlite, schema } from '../db';
import { eq, desc } from 'drizzle-orm';

export const boosterRouter = Router();

boosterRouter.get('/history', (_req, res) => {
  const sessions = db.select().from(schema.boosterSessions)
    .orderBy(desc(schema.boosterSessions.createdAt))
    .all();

  const result = sessions.map(s => ({
    ...s,
    pulls: db.select().from(schema.boosterPulls)
      .where(eq(schema.boosterPulls.sessionId, s.id))
      .all(),
  }));

  res.json(result);
});

boosterRouter.get('/session/:id', (req, res) => {
  const session = db.select().from(schema.boosterSessions)
    .where(eq(schema.boosterSessions.id, Number(req.params.id)))
    .get();
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const pulls = db.select().from(schema.boosterPulls)
    .where(eq(schema.boosterPulls.sessionId, session.id))
    .all();

  res.json({ ...session, pulls });
});

boosterRouter.post('/finish', (req, res) => {
  const { setCode, boosterType, boosterPrice, pulls } = req.body;

  if (!setCode || !boosterType || !boosterPrice || !pulls || !Array.isArray(pulls)) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const result = sqlite.transaction(() => {
      const totalValue = pulls.reduce((sum: number, p: any) => {
        const card = db.select().from(schema.scryfallCards)
          .where(eq(schema.scryfallCards.id, p.cardId))
          .get();
        if (card && card.prices) {
          const prices = JSON.parse(card.prices);
          const val = p.foil ? prices.usd_foil : prices.usd;
          return sum + (parseFloat(val) || 0);
        }
        return sum;
      }, 0);

      const session = db.insert(schema.boosterSessions)
        .values({ setCode, boosterType, boosterPrice, totalValue })
        .returning().get();

      for (const pull of pulls) {
        db.insert(schema.boosterPulls)
          .values({
            sessionId: session.id,
            cardId: pull.cardId,
            foil: pull.foil ? 1 : 0,
            slotIndex: pull.slotIndex,
            locationId: pull.locationId,
            addedToCollection: 1,
          })
          .run();
      }

      for (const pull of pulls) {
        if (!pull.locationId) continue;
        const existing = db.select()
          .from(schema.collectionItems)
          .where(eq(schema.collectionItems.cardId, pull.cardId))
          .get();

        if (existing) {
          db.update(schema.collectionItems)
            .set({ quantity: existing.quantity + 1 })
            .where(eq(schema.collectionItems.id, existing.id))
            .run();
        } else {
          db.insert(schema.collectionItems)
            .values({
              cardId: pull.cardId,
              locationId: pull.locationId,
              quantity: 1,
              foil: pull.foil ? 1 : 0,
              purchasePrice: boosterPrice / pulls.length,
              priceAutofilled: 0,
              condition: 'NM',
            })
            .run();
        }
      }

      return { session, totalValue };
    })();

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
