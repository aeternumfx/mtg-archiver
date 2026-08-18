import { catalogSqlite } from '../db';

export interface CatalogCardRow {
  id: string;
  name: string;
  setName: string;
  setCode: string;
  collectorNumber: string;
  rarity: string | null;
  manaCost: string | null;
  cmc: number | null;
  typeLine: string | null;
  oracleText: string | null;
  colors: string | null;
  colorIdentity: string | null;
  imageUris: string | null;
  prices: string | null;
  legalities: string | null;
  layout: string | null;
  finishes: string | null;
  cardFaces: string | null;
  releasedAt: string | null;
}

export const CATALOG_SELECT = `
  id, name, set_name as setName, set_code as setCode, collector_number as collectorNumber,
  rarity, mana_cost as manaCost, cmc, type_line as typeLine, oracle_text as oracleText,
  colors, color_identity as colorIdentity, image_uris as imageUris, prices,
  legalities, layout, finishes, card_faces as cardFaces, released_at as releasedAt
`;

export function cardsByIds(ids: Array<string | null | undefined>): Map<string, CatalogCardRow> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (unique.length === 0) return new Map();
  const placeholders = unique.map(() => '?').join(',');
  const rows = catalogSqlite.prepare(
    `SELECT ${CATALOG_SELECT} FROM scryfall_cards WHERE id IN (${placeholders})`
  ).all(...unique) as CatalogCardRow[];
  return new Map(rows.map(r => [r.id, r]));
}

export function cardById(id: string): CatalogCardRow | undefined {
  if (!id) return undefined;
  return catalogSqlite.prepare(`SELECT ${CATALOG_SELECT} FROM scryfall_cards WHERE id = ?`).get(id) as CatalogCardRow | undefined;
}

export function cardsByName(name: string): CatalogCardRow[] {
  return catalogSqlite.prepare(
    `SELECT ${CATALOG_SELECT} FROM scryfall_cards WHERE name = ? ORDER BY released_at DESC`
  ).all(name) as CatalogCardRow[];
}

const NON_PLAYABLE_LAYOUTS = [
  'art_series', 'token', 'double_faced_token', 'emblem', 'scheme',
  'planar', 'vanguard', 'augment', 'host',
];

function usdPrice(c: CatalogCardRow): number | null {
  if (!c.prices) return null;
  let prices: Record<string, any> = {};
  try { prices = JSON.parse(c.prices); } catch { return null; }
  const v = Number(prices.usd);
  return Number.isFinite(v) && v > 0 ? v : null;
}

// In-memory cache for the cheapest-printing lookups. Prices change on the daily
// Scryfall sync, so a short TTL keeps repeats instant while still reflecting
// current prices within the sync window.
const CHEAPEST_TTL_MS = 10 * 60 * 1000; // 10 minutes
const cheapestCache = new Map<string, { card: CatalogCardRow; price: number | null; ts: number }>();

function cheapestCacheGet(key: string): { card: CatalogCardRow; price: number | null } | undefined {
  const e = cheapestCache.get(key);
  if (!e) return undefined;
  if (Date.now() - e.ts > CHEAPEST_TTL_MS) {
    cheapestCache.delete(key);
    return undefined;
  }
  return { card: e.card, price: e.price };
}

export function clearCheapestCache() {
  cheapestCache.clear();
}

/**
 * Returns the cheapest available (non-foil USD) printing for each card name in
 * one query, excluding non-playable layouts and Arena-only printings. Used to
 * show the lowest price / representative art for generic wantlist entries.
 * Results are cached briefly so repeated wantlist loads are fast.
 */
export function cheapestByNames(names: string[]): Map<string, { card: CatalogCardRow; price: number | null }> {
  const result = new Map<string, { card: CatalogCardRow; price: number | null }>();
  const uniq = Array.from(new Set(
    names.map(n => n.trim().toLowerCase().replace(/([%_])/g, '\\$1')).filter(Boolean),
  ));
  if (uniq.length === 0) return result;

  // Serve cached results; collect the names we still need to compute.
  const missing: string[] = [];
  for (const low of uniq) {
    const hit = cheapestCacheGet(low);
    if (hit !== undefined) {
      result.set(low, hit);
    } else {
      missing.push(low);
    }
  }
  if (missing.length === 0) return result;

  const layoutPh = NON_PLAYABLE_LAYOUTS.map(() => '?').join(',');
  const conds: string[] = [];
  const params: unknown[] = [];
  for (const low of missing) {
    conds.push(`(lower(name) = ? OR lower(name) LIKE ? ESCAPE '\\')`);
    params.push(low, `${low} // %`);
  }
  const rows = catalogSqlite.prepare(
    `SELECT ${CATALOG_SELECT} FROM scryfall_cards
     WHERE (${conds.join(' OR ')})
       AND layout NOT IN (${layoutPh})
       AND set_code NOT LIKE 'y%' AND set_code != 'hbg' AND collector_number NOT LIKE 'A-%'
     ORDER BY released_at DESC`
  ).all(...params, ...NON_PLAYABLE_LAYOUTS) as CatalogCardRow[];

  // O(1) lookup of which requested name a card belongs to.
  const missingSet = new Set(missing);
  const byName = new Map<string, string>();
  for (const low of missing) byName.set(low, low);

  // Pick, per name, the cheapest printing that actually has sale data. Cards
  // with no price (usdPrice === null, e.g. $0.00 / no vendor) are ignored unless
  // no printing for that card has any price at all — in which case we fall back
  // to the most-recent printing rather than showing a $0.00 as "cheapest".
  const fallback = new Map<string, CatalogCardRow>();
  const priced = new Map<string, { card: CatalogCardRow; price: number }>();
  const hitNames = new Set<string>();

  for (const r of rows) {
    const ln = r.name.toLowerCase();
    // Fast membership + which name it resolves to.
    const hit = findHit(ln, missingSet, missing);
    if (hit === undefined) continue;
    hitNames.add(hit);
    if (!fallback.has(hit)) fallback.set(hit, r); // most-recent printing

    const p = usdPrice(r);
    if (p !== null) {
      const ex = priced.get(hit);
      if (!ex || p < ex.price) priced.set(hit, { card: r, price: p });
    }
  }

  for (const hit of hitNames) {
    let entry: { card: CatalogCardRow; price: number | null };
    if (priced.has(hit)) {
      entry = priced.get(hit)!;
    } else {
      const card = fallback.get(hit)!;
      entry = { card, price: usdPrice(card) };
    }
    result.set(hit, entry);
    cheapestCache.set(hit, { card: entry.card, price: entry.price, ts: Date.now() });
  }
  return result;
}

// Matches a card's lowercased name against the requested names, handling
// double-faced names ("A // B") that were requested by their short face name.
function findHit(lowerName: string, set: Set<string>, list: string[]): string | undefined {
  if (set.has(lowerName)) return lowerName;
  const idx = lowerName.indexOf(' // ');
  if (idx > 0) {
    const face = lowerName.slice(0, idx);
    if (set.has(face)) return face;
  }
  // Fallback linear scan for exact/prefix edge cases.
  for (const low of list) {
    if (lowerName === low || lowerName.startsWith(low + ' // ')) return low;
  }
  return undefined;
}

export function cheapestByName(name: string): { card: CatalogCardRow; price: number | null } | null {
  return cheapestByNames([name]).get(name.trim().toLowerCase()) ?? null;
}


export function localImageUris(cardId: string, imageUris: string | Record<string, string> | null | undefined, faceIdx?: number): Record<string, string> | null {
  if (!imageUris) return null;
  let uris: Record<string, string>;
  if (typeof imageUris === 'string') {
    try {
      uris = JSON.parse(imageUris);
    } catch {
      return null;
    }
  } else {
    uris = imageUris;
  }
  const out: Record<string, string> = {};
  for (const key of Object.keys(uris)) {
    out[key] = faceIdx !== undefined
      ? `/api/images/${cardId}/${key}/${faceIdx}?v=3`
      : `/api/images/${cardId}/${key}?v=3`;
  }
  return out;
}

export function localizeCardFaces(cardId: string, cardFaces: unknown): Array<Record<string, unknown>> | null {
  if (!cardFaces) return null;
  let faces: Array<{ image_uris?: unknown }>;
  if (typeof cardFaces === 'string') {
    try {
      faces = JSON.parse(cardFaces);
    } catch {
      return null;
    }
  } else {
    faces = cardFaces as Array<{ image_uris?: unknown }>;
  }
  return faces.map((f, i) => ({
    ...f,
    image_uris: localImageUris(cardId, f.image_uris as string | Record<string, string> | undefined, i),
  }));
}

export function parseCardJson(c: CatalogCardRow | Record<string, unknown> | any) {
  const parse = (k: string) => (c[k] ? JSON.parse(c[k] as string) : null);
  const id = c.id as string | undefined;
  return {
    ...c,
    colors: parse('colors'),
    colorIdentity: parse('colorIdentity'),
    imageUris: id ? localImageUris(id, c.imageUris as string | null) : null,
    prices: parse('prices'),
    legalities: parse('legalities'),
    finishes: parse('finishes'),
    frameEffects: c.frameEffects ? JSON.parse(c.frameEffects as string) : null,
    cardFaces: id ? localizeCardFaces(id, c.cardFaces) : parse('cardFaces'),
  };
}
