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
