import { Router } from 'express';
import { db, sqlite, schema } from '../db';
import { sql, eq, desc } from 'drizzle-orm';

export const dashboardRouter = Router();

dashboardRouter.get('/stats', (_req, res) => {
  const totalCards = db.get<{ count: number }>(
    sql`SELECT COALESCE(SUM(quantity), 0) as count FROM collection_items`,
  )?.count ?? 0;

  const purchaseValue = db.get<{ value: number }>(
    sql`SELECT COALESCE(SUM(quantity * purchase_price), 0) as value FROM collection_items WHERE purchase_price IS NOT NULL`,
  )?.value ?? 0;

  const marketValue = db.get<{ value: number }>(
    sql`SELECT COALESCE(SUM(ci.quantity * CASE WHEN ci.foil THEN json_extract(sc.prices, '$.usd_foil') ELSE json_extract(sc.prices, '$.usd') END), 0) as value
        FROM collection_items ci
        JOIN scryfall_cards sc ON sc.id = ci.card_id
        WHERE (CASE WHEN ci.foil THEN json_extract(sc.prices, '$.usd_foil') ELSE json_extract(sc.prices, '$.usd') END) IS NOT NULL`,
  )?.value ?? 0;

  const byLocation = db.all<{
    id: number; name: string; count: number; value: number; marketValue: number;
  }>(sql`
    SELECT l.id, l.name,
      COALESCE(SUM(ci.quantity), 0) as count,
      COALESCE(SUM(ci.quantity * ci.purchase_price), 0) as value,
      COALESCE(SUM(ci.quantity * CASE WHEN ci.foil THEN json_extract(sc.prices, '$.usd_foil') ELSE json_extract(sc.prices, '$.usd') END), 0) as marketValue
    FROM locations l
    LEFT JOIN collection_items ci ON ci.location_id = l.id
    LEFT JOIN scryfall_cards sc ON sc.id = ci.card_id
    GROUP BY l.id
    ORDER BY l.name
  `);

  const deckBreakdown = db.all<{
    id: number; name: string; count: number; value: number; marketValue: number;
  }>(sql`
    SELECT d.id, d.name,
      COALESCE(SUM(ci.quantity), 0) as count,
      COALESCE(SUM(ci.quantity * ci.purchase_price), 0) as value,
      COALESCE(SUM(ci.quantity * CASE WHEN ci.foil THEN json_extract(sc.prices, '$.usd_foil') ELSE json_extract(sc.prices, '$.usd') END), 0) as marketValue
    FROM decks d
    LEFT JOIN collection_items ci ON ci.deck_id = d.id
    LEFT JOIN scryfall_cards sc ON sc.id = ci.card_id
    GROUP BY d.id
    ORDER BY d.name
  `);

  const rarityBreakdown = db.all<{ rarity: string; count: number; value: number }>(
    sql`SELECT COALESCE(sc.rarity, 'unknown') as rarity,
        COALESCE(SUM(ci.quantity), 0) as count,
        COALESCE(SUM(ci.quantity * ci.purchase_price), 0) as value
      FROM collection_items ci
      JOIN scryfall_cards sc ON sc.id = ci.card_id
      GROUP BY sc.rarity
      ORDER BY count DESC`,
  );

  const conditionBreakdown = db.all<{ condition: string; count: number; value: number }>(
    sql`SELECT COALESCE(ci.condition, 'unspecified') as condition,
        COALESCE(SUM(ci.quantity), 0) as count,
        COALESCE(SUM(ci.quantity * ci.purchase_price), 0) as value
      FROM collection_items ci
      GROUP BY ci.condition
      ORDER BY count DESC`,
  );

  const topCards = db.all<{
    cardId: string; name: string; setName: string; setCode: string;
    totalQty: number; totalValue: number; marketPrice: number | null;
  }>(
    sql`SELECT ci.card_id as cardId, sc.name, sc.set_name as setName, sc.set_code as setCode,
        COALESCE(SUM(ci.quantity), 0) as totalQty,
        COALESCE(SUM(ci.quantity * ci.purchase_price), 0) as totalValue,
        MAX(CASE WHEN ci.foil THEN json_extract(sc.prices, '$.usd_foil') ELSE json_extract(sc.prices, '$.usd') END) as marketPrice
      FROM collection_items ci
      JOIN scryfall_cards sc ON sc.id = ci.card_id
      GROUP BY ci.card_id
      ORDER BY totalValue DESC
      LIMIT 10`,
  );

  const recentAdditions = db.all<{
    cardId: string; name: string; quantity: number; purchasePrice: number | null; createdAt: string;
  }>(
    sql`SELECT ci.card_id as cardId, sc.name, ci.quantity, ci.purchase_price as purchasePrice, ci.created_at as createdAt
      FROM collection_items ci
      JOIN scryfall_cards sc ON sc.id = ci.card_id
      ORDER BY ci.created_at DESC
      LIMIT 10`,
  ).map(r => ({ ...r, createdAt: r.createdAt ? r.createdAt.slice(0, 10) : '' }));

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
