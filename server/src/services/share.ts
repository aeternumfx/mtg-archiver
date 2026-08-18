import { getUserSqlite } from '../db/user';
import { catalogSqlite } from '../db';
import { parseCardJson, cheapestByNames } from './cards';

function userConn(userId: number) {
  return getUserSqlite(userId);
}

export interface SharedCollectionItem {
  id: number;
  cardId: string;
  locationId: number;
  foil: number;
  condition: string | null;
  quantity: number;
  proxy: number;
  misprint: number;
  altered: number;
  notes: string | null;
  card: ReturnType<typeof parseCardJson> | null;
  locationName: string | null;
}

export function getSharedCollection(userId: number): SharedCollectionItem[] {
  const conn = userConn(userId);
  const rows = conn.prepare(`
    SELECT ci.id, ci.card_id as cardId, ci.location_id as locationId, ci.foil, ci.condition,
           ci.quantity, ci.proxy, ci.misprint, ci.altered, ci.notes,
           l.name as locationName
    FROM collection_items ci
    LEFT JOIN locations l ON l.id = ci.location_id
    WHERE ci.deck_id IS NULL
    ORDER BY l.name, ci.id
  `).all() as Array<{
    id: number; cardId: string; locationId: number; foil: number; condition: string | null;
    quantity: number; proxy: number; misprint: number; altered: number; notes: string | null; locationName: string | null;
  }>;

  const cards = catalogSqlite.prepare(
    `SELECT id, name, set_name as setName, set_code as setCode, collector_number as collectorNumber,
       rarity, mana_cost as manaCost, cmc, type_line as typeLine, colors, color_identity as colorIdentity,
       image_uris as imageUris, prices, layout, card_faces as cardFaces
     FROM scryfall_cards WHERE id IN (${rows.map(() => '?').join(',')})`
  ).all(...rows.map(r => r.cardId)) as Array<Record<string, any>>;
  const cardMap = new Map(cards.map(c => [c.id, c]));

  return rows.map(r => ({
    ...r,
    card: r.cardId ? (cardMap.get(r.cardId) ? parseCardJson(cardMap.get(r.cardId)!) : null) : null,
  }));
}

export interface SharedWantlistItem {
  id: number;
  cardId: string | null;
  cardName: string;
  setCode: string | null;
  collectorNumber: string | null;
  foil: number;
  quantity: number;
  notes: string | null;
  destinationName: string | null;
  card: ReturnType<typeof parseCardJson> | null;
  price: number | null;
  cheapestCard: ReturnType<typeof parseCardJson> | null;
  cheapestPrice: number | null;
}

export function getSharedWantlist(userId: number): SharedWantlistItem[] {
  const conn = userConn(userId);
  const rows = conn.prepare(`
    SELECT w.id, w.card_id as cardId, w.card_name as cardName, w.set_code as setCode,
           w.collector_number as collectorNumber, w.foil, w.quantity, w.notes,
           l.name as destinationName
    FROM wantlist_items w
    LEFT JOIN locations l ON l.id = w.destination_id
    WHERE w.trade_id IS NULL
    ORDER BY w.card_name COLLATE NOCASE, w.id
  `).all() as Array<{
    id: number; cardId: string | null; cardName: string; setCode: string | null;
    collectorNumber: string | null; foil: number; quantity: number; notes: string | null; destinationName: string | null;
  }>;

  const ids = rows.map(r => r.cardId).filter((x): x is string => Boolean(x));
  const cardMap = new Map<number, any>();
  if (ids.length > 0) {
    const cards = catalogSqlite.prepare(
      `SELECT id, name, set_name as setName, set_code as setCode, collector_number as collectorNumber,
         rarity, mana_cost as manaCost, cmc, type_line as typeLine, colors, color_identity as colorIdentity,
         image_uris as imageUris, prices, layout, card_faces as cardFaces
       FROM scryfall_cards WHERE id IN (${ids.map(() => '?').join(',')})`
    ).all(...ids) as Array<Record<string, any>>;
    for (const c of cards) {
      cardMap.set(c.id as number, c);
    }
  }

  // Batch-resolve the cheapest printing for all generic entries in one query.
  const genericNames = Array.from(new Set(rows.filter(r => !r.cardId).map(r => r.cardName)));
  const cheapestMap = cheapestByNames(genericNames);

  return rows.map(r => {
    let card: ReturnType<typeof parseCardJson> | null = null;
    let price: number | null = null;
    let cheapestCard: ReturnType<typeof parseCardJson> | null = null;
    let cheapestPrice: number | null = null;

    if (r.cardId && cardMap.has(r.cardId as never)) {
      card = parseCardJson(cardMap.get(r.cardId as never)!);
      let prices: Record<string, any> = {};
      try { prices = JSON.parse(cardMap.get(r.cardId as never)!.prices ?? '{}'); } catch { prices = {}; }
      const p = Number(prices[r.foil ? 'usd_foil' : 'usd'] ?? prices.usd);
      price = Number.isFinite(p) && p > 0 ? p : null;
    } else {
      const best = cheapestMap.get(r.cardName.trim().toLowerCase());
      if (best) {
        cheapestCard = parseCardJson(best.card);
        cheapestPrice = best.price;
      }
    }

    return {
      ...r,
      card,
      price,
      cheapestCard,
      cheapestPrice,
    };
  });
}
