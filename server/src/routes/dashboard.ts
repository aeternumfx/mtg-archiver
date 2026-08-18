import { Router } from 'express';
import { db, sqlite, schema } from '../db';
import { sql, eq, desc } from 'drizzle-orm';
import { cardsByIds } from '../services/cards';

export const dashboardRouter = Router();

dashboardRouter.get('/stats', (_req, res) => {
  const totalCards = db.get<{ count: number }>(
    sql`SELECT COALESCE(SUM(quantity), 0) as count FROM collection_items`,
  )?.count ?? 0;

  const purchaseValue = db.get<{ value: number }>(
    sql`SELECT COALESCE(SUM(quantity * purchase_price), 0) as value FROM collection_items WHERE purchase_price IS NOT NULL`,
  )?.value ?? 0;

  const priceRows = sqlite.prepare(
    `SELECT card_id as cardId, foil, SUM(quantity) as qty FROM collection_items GROUP BY card_id, foil`
  ).all() as Array<{ cardId: string; foil: number; qty: number }>;
  const cards = cardsByIds(priceRows.map(r => r.cardId));

  const priceOf = (cardId: string, foil: boolean): number => {
    const card = cards.get(cardId);
    if (!card?.prices) return 0;
    let prices: Record<string, any> = {};
    try { prices = JSON.parse(card.prices); } catch { prices = {}; }
    const v = prices[foil ? 'usd_foil' : 'usd'];
    return Number(v) || 0;
  };

  const marketValue = priceRows.reduce((s, r) => s + r.qty * priceOf(r.cardId, !!r.foil), 0);

  const locRows = sqlite.prepare(`
    SELECT l.id, l.name, COALESCE(SUM(ci.quantity), 0) as count,
      COALESCE(SUM(ci.quantity * ci.purchase_price), 0) as value
    FROM locations l
    LEFT JOIN collection_items ci ON ci.location_id = l.id
    WHERE l.deck_id IS NULL
    GROUP BY l.id
    ORDER BY l.name
  `).all() as Array<{ id: number; name: string; count: number; value: number }>;

  const locCardRows = sqlite.prepare(`
    SELECT ci.location_id as locationId, ci.card_id as cardId, ci.foil, SUM(ci.quantity) as qty
    FROM collection_items ci GROUP BY ci.location_id, ci.card_id, ci.foil
  `).all() as Array<{ locationId: number; cardId: string; foil: number; qty: number }>;

  const locMarket = new Map<number, number>();
  for (const r of locCardRows) {
    locMarket.set(r.locationId, (locMarket.get(r.locationId) ?? 0) + r.qty * priceOf(r.cardId, !!r.foil));
  }
  const byLocation = locRows.map(l => ({ ...l, marketValue: locMarket.get(l.id) ?? 0 }));

  const deckRows = sqlite.prepare(`
    SELECT d.id, d.name, COALESCE(SUM(ci.quantity), 0) as count,
      COALESCE(SUM(ci.quantity * ci.purchase_price), 0) as value
    FROM decks d
    LEFT JOIN collection_items ci ON ci.deck_id = d.id
    GROUP BY d.id
    ORDER BY d.name
  `).all() as Array<{ id: number; name: string; count: number; value: number }>;

  const deckCardRows = sqlite.prepare(`
    SELECT ci.deck_id as deckId, ci.card_id as cardId, ci.foil, SUM(ci.quantity) as qty
    FROM collection_items ci WHERE ci.deck_id IS NOT NULL GROUP BY ci.deck_id, ci.card_id, ci.foil
  `).all() as Array<{ deckId: number; cardId: string; foil: number; qty: number }>;

  const deckMarket = new Map<number, number>();
  for (const r of deckCardRows) {
    deckMarket.set(r.deckId, (deckMarket.get(r.deckId) ?? 0) + r.qty * priceOf(r.cardId, !!r.foil));
  }
  const deckBreakdown = deckRows.map(d => ({ ...d, marketValue: deckMarket.get(d.id) ?? 0 }));

  const rarityRows = sqlite.prepare(
    `SELECT card_id as cardId, SUM(quantity) as qty, COALESCE(SUM(quantity * purchase_price), 0) as value FROM collection_items GROUP BY card_id`
  ).all() as Array<{ cardId: string; qty: number; value: number }>;
  const rarityMap = new Map<string, { count: number; value: number }>();
  for (const r of rarityRows) {
    const rarity = cards.get(r.cardId)?.rarity || 'unknown';
    const agg = rarityMap.get(rarity) ?? { count: 0, value: 0 };
    agg.count += r.qty;
    agg.value += r.value;
    rarityMap.set(rarity, agg);
  }
  const rarityBreakdown = [...rarityMap.entries()]
    .map(([rarity, v]) => ({ rarity, count: v.count, value: v.value }))
    .sort((a, b) => b.count - a.count);

  const conditionBreakdown = db.all<{ condition: string; count: number; value: number }>(
    sql`SELECT COALESCE(ci.condition, 'unspecified') as condition,
        COALESCE(SUM(ci.quantity), 0) as count,
        COALESCE(SUM(ci.quantity * ci.purchase_price), 0) as value
      FROM collection_items ci
      GROUP BY ci.condition
      ORDER BY count DESC`,
  );

  const topRows = sqlite.prepare(
    `SELECT card_id as cardId, SUM(quantity) as totalQty, COALESCE(SUM(quantity * purchase_price), 0) as totalValue
     FROM collection_items GROUP BY card_id ORDER BY totalValue DESC LIMIT 10`
  ).all() as Array<{ cardId: string; totalQty: number; totalValue: number }>;
  const topCards = topRows.map(r => {
    const card = cards.get(r.cardId);
    return {
      cardId: r.cardId,
      name: card?.name || '',
      setName: card?.setName || '',
      setCode: card?.setCode || '',
      totalQty: r.totalQty,
      totalValue: r.totalValue,
      marketPrice: priceOf(r.cardId, false) || priceOf(r.cardId, true) || null,
    };
  });

  const recentRows = sqlite.prepare(
    `SELECT card_id as cardId, quantity, purchase_price as purchasePrice, created_at as createdAt
     FROM collection_items ORDER BY created_at DESC LIMIT 10`
  ).all() as Array<{ cardId: string; quantity: number; purchasePrice: number | null; createdAt: string }>;
  const recentAdditions = recentRows.map(r => ({
    ...r,
    name: cards.get(r.cardId)?.name || '',
    createdAt: r.createdAt ? r.createdAt.slice(0, 10) : '',
  }));

  const today = new Date().toISOString().split('T')[0];
  const existingSnapshot = db.select()
    .from(schema.collectionHistory)
    .where(eq(schema.collectionHistory.date, today))
    .get();

  if (existingSnapshot) {
    db.update(schema.collectionHistory)
      .set({ totalCards, totalValue: marketValue, purchaseValue })
      .where(eq(schema.collectionHistory.date, today))
      .run();
  } else {
    db.insert(schema.collectionHistory)
      .values({ date: today, totalCards, totalValue: marketValue, purchaseValue, createdAt: new Date().toISOString() })
      .run();
  }

  const valueHistory = db.select({
    date: schema.collectionHistory.date,
    totalCards: schema.collectionHistory.totalCards,
    totalValue: schema.collectionHistory.totalValue,
    purchaseValue: schema.collectionHistory.purchaseValue,
  })
    .from(schema.collectionHistory)
    .orderBy(desc(schema.collectionHistory.date))
    .limit(90)
    .all();

  res.json({
    totalCards,
    purchaseValue,
    marketValue,
    byLocation,
    deckBreakdown,
    valueHistory,
    rarityBreakdown,
    conditionBreakdown,
    topCards,
    recentAdditions,
  });
});
