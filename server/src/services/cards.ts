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

const NON_PLAYABLE_LAYOUTS = [
  'art_series', 'token', 'double_faced_token', 'emblem', 'scheme',
  'planar', 'vanguard', 'augment', 'host',
];

// Static SQL fragments reused by the name-resolution queries below.
const NON_PLAYABLE_SQL = `layout NOT IN (${NON_PLAYABLE_LAYOUTS.map(() => '?').join(',')})`;
const NON_ARENA_SQL = `set_code NOT LIKE 'y%' AND set_code != 'hbg' AND collector_number NOT LIKE 'A-%'`;

/**
 * Resolves many card names to the most recent real, playable printing of each,
 * using index-friendly per-name queries (a single big OR would force a full
 * table scan and be orders of magnitude slower). Handles double-faced cards
 * requested by their short face name ("A // B" matched via "A").
 */
export function latestCardByNames(names: string[]): Map<string, CatalogCardRow> {
  const result = new Map<string, CatalogCardRow>();
  const uniq = Array.from(new Set(
    names.map(n => n.trim()).filter(Boolean).slice(0, 200),
  )) as string[];
  if (uniq.length === 0) return result;

  const layoutParams = NON_PLAYABLE_LAYOUTS;
  const exact = catalogSqlite.prepare(
    `SELECT ${CATALOG_SELECT} FROM scryfall_cards
     WHERE name = ? COLLATE NOCASE AND ${NON_PLAYABLE_SQL} AND ${NON_ARENA_SQL}
     ORDER BY released_at DESC LIMIT 1`,
  );
  const prefix = catalogSqlite.prepare(
    `${`SELECT ${CATALOG_SELECT} FROM scryfall_cards
     WHERE name LIKE ? ESCAPE '\\' AND ${NON_PLAYABLE_SQL} AND ${NON_ARENA_SQL}
     ORDER BY released_at DESC LIMIT 1`}`,
  );

  for (const name of uniq) {
    const low = name.toLowerCase();
    const byExact = exact.get(low, ...layoutParams) as CatalogCardRow | undefined;
    if (byExact) {
      result.set(name, byExact);
      continue;
    }
    // Double-faced cards: the short face name won't match exactly, so check the
    // "A // B" prefix form.
    const byPrefix = prefix.get(low + ' // %', ...layoutParams) as CatalogCardRow | undefined;
    if (byPrefix) result.set(name, byPrefix);
  }
  return result;
}

export function cardsByName(name: string): CatalogCardRow[] {
  return catalogSqlite.prepare(
    `SELECT ${CATALOG_SELECT} FROM scryfall_cards WHERE name = ? ORDER BY released_at DESC`
  ).all(name) as CatalogCardRow[];
}

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

  // For each name, pick the cheapest printing with valid sale data directly in
  // SQL (only the winning row is fetched — no full printing-list transfer or
  // per-row JSON parsing, which matters for high-printing cards like basic
  // lands). Names with no priced printing fall back to the most-recent one.
  const byName = cheapestRowsByNames(missing);

  for (const low of missing) {
    let entry: { card: CatalogCardRow; price: number | null } | undefined;
    const win = byName.get(low);
    if (win) entry = { card: win.card, price: win.price };
    result.set(low, entry!);
    cheapestCache.set(low, { card: win?.card as CatalogCardRow, price: win?.price ?? null, ts: Date.now() });
  }
  return result;
}

// Resolves each name to its single cheapest (priced) printing and, separately,
// its most-recent printing as a fallback. The cheapest is selected in SQL so a
// high-printing card (e.g. basic lands with ~900 printings) only ever returns
// the winning row — never the whole printing list. If no printing has a valid
// price, we fall back to the most recent printing (an untracked $0.00 card would
// otherwise show "$0.00" as misleadingly "cheapest").
function cheapestRowsByNames(names: string[]): Map<string, { card: CatalogCardRow; price: number | null }> {
  const out = new Map<string, { card: CatalogCardRow; price: number | null }>();

  // Cheapest priced printing, picked in SQL (INDEXED on name; only 1 row back).
  const cheapestSql = catalogSqlite.prepare(
    `SELECT ${CATALOG_SELECT} FROM scryfall_cards
     WHERE name = ? COLLATE NOCASE AND ${NON_PLAYABLE_SQL} AND ${NON_ARENA_SQL}
       AND CAST(json_extract(prices, '$.usd') AS REAL) > 0
     ORDER BY CAST(json_extract(prices, '$.usd') AS REAL) ASC, released_at DESC
     LIMIT 1`,
  );
  // Most-recent printing, as the fallback when nothing is priced.
  const recentSql = catalogSqlite.prepare(
    `SELECT ${CATALOG_SELECT} FROM scryfall_cards
     WHERE name = ? COLLATE NOCASE AND ${NON_PLAYABLE_SQL} AND ${NON_ARENA_SQL}
     ORDER BY released_at DESC LIMIT 1`,
  );
  const layoutParams = NON_PLAYABLE_LAYOUTS;

  for (const low of names) {
    const cheapest = cheapestSql.get(low, ...layoutParams) as CatalogCardRow | undefined;
    if (cheapest) {
      out.set(low, { card: cheapest, price: usdPrice(cheapest) });
      continue;
    }
    const recent = recentSql.get(low, ...layoutParams) as CatalogCardRow | undefined;
    if (recent) out.set(low, { card: recent, price: usdPrice(recent) });
  }
  return out;
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
