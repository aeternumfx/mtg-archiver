import { Router } from 'express';
import { catalogDb, schema } from '../db';
import { like, or, and, sql, eq, asc, desc } from 'drizzle-orm';
import { localImageUris, localizeCardFaces } from '../services/cards';

export const cardsRouter = Router();

function parseQuery(q: string): { type: 'setnum' | 'scryfall' | 'name'; set?: string; num?: string } {
  const scryfallMatch = q.match(/^s:(\S+)\s+cn:(\S+)$/i);
  if (scryfallMatch) return { type: 'scryfall', set: scryfallMatch[1].toLowerCase(), num: scryfallMatch[2] };

  const setnumMatch = q.match(/^([a-z]{2,4})\s*(\d+)$/i);
  if (setnumMatch) return { type: 'setnum', set: setnumMatch[1].toLowerCase(), num: setnumMatch[2] };

  return { type: 'name' };
}

const NOT_ARENA = sql`(${schema.scryfallCards.setCode} NOT LIKE 'y%' AND ${schema.scryfallCards.setCode} != 'hbg' AND ${schema.scryfallCards.collectorNumber} NOT LIKE 'A-%')`;

cardsRouter.get('/find', (req, res) => {
  const q = (req.query.q as string ?? '').trim();
  if (!q) return res.json([]);

  const parsed = parseQuery(q);

  const cardFields = {
    id: schema.scryfallCards.id,
    name: schema.scryfallCards.name,
    setName: schema.scryfallCards.setName,
    setCode: schema.scryfallCards.setCode,
    collectorNumber: schema.scryfallCards.collectorNumber,
    rarity: schema.scryfallCards.rarity,
    manaCost: schema.scryfallCards.manaCost,
    cmc: schema.scryfallCards.cmc,
    typeLine: schema.scryfallCards.typeLine,
    oracleText: schema.scryfallCards.oracleText,
    colors: schema.scryfallCards.colors,
    imageUris: schema.scryfallCards.imageUris,
    prices: schema.scryfallCards.prices,
    releasedAt: schema.scryfallCards.releasedAt,
    promo: schema.scryfallCards.promo,
    seriealized: schema.scryfallCards.seriealized,
    fullArt: schema.scryfallCards.fullArt,
    textless: schema.scryfallCards.textless,
    finishes: schema.scryfallCards.finishes,
    frameEffects: schema.scryfallCards.frameEffects,
    cardFaces: schema.scryfallCards.cardFaces,
  } as const;

  const parseCard = (c: any) => ({
    ...c,
    colors: c.colors ? JSON.parse(c.colors) : null,
    imageUris: localImageUris(c.id, c.imageUris),
    prices: c.prices ? JSON.parse(c.prices) : null,
    finishes: c.finishes ? JSON.parse(c.finishes) : null,
    frameEffects: c.frameEffects ? JSON.parse(c.frameEffects) : null,
    cardFaces: localizeCardFaces(c.id, c.cardFaces),
  });

  if (parsed.type === 'name') {
    const tokens = q.replace(/['"]/g, '').split(/[,\s]+/).filter(Boolean);
    const cards = catalogDb.select(cardFields)
      .from(schema.scryfallCards)
      .where(and(NOT_ARENA, ...tokens.map(t => like(schema.scryfallCards.name, `%${t}%`))))
      .orderBy(asc(schema.scryfallCards.name), desc(schema.scryfallCards.releasedAt))
      .limit(20)
      .all();

    return res.json(cards.map(parseCard));
  }

  const setCode = parsed.set!;
  const rawNum = parsed.num!;
  const numVariants = [rawNum];
  const stripped = rawNum.replace(/^0+/, '');
  if (stripped !== rawNum && stripped.length > 0) numVariants.push(stripped);

  const allMatch = catalogDb.select(cardFields)
    .from(schema.scryfallCards)
    .where(and(
      NOT_ARENA,
      eq(schema.scryfallCards.setCode, setCode),
      or(...numVariants.map(n => eq(schema.scryfallCards.collectorNumber, n))),
    ))
    .all();

  if (allMatch.length > 0) {
    return res.json(allMatch.map(parseCard));
  }

  const likeResult = catalogDb.select(cardFields)
    .from(schema.scryfallCards)
    .where(and(
      NOT_ARENA,
      eq(schema.scryfallCards.setCode, setCode),
      or(...numVariants.map(n => like(schema.scryfallCards.collectorNumber, `${n}%`))),
    ))
    .orderBy(asc(schema.scryfallCards.collectorNumber))
    .limit(10)
    .all();

  const result = likeResult.map(c => ({
    ...c,
    colors: c.colors ? JSON.parse(c.colors) : null,
    imageUris: localImageUris(c.id, c.imageUris),
    prices: c.prices ? JSON.parse(c.prices) : null,
  }));
  res.json(result);
});

cardsRouter.get('/search', (req, res) => {
  const q = (req.query.q as string ?? '').trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  const where = q
    ? and(NOT_ARENA, or(like(schema.scryfallCards.name, `%${q}%`), like(schema.scryfallCards.typeLine, `%${q}%`), like(schema.scryfallCards.oracleText, `%${q}%`)))
    : NOT_ARENA;

  const countResult = catalogDb.select({ count: sql<number>`count(*)` }).from(schema.scryfallCards).where(where).get();
  const total = countResult?.count ?? 0;

  const cards = catalogDb.select({
    id: schema.scryfallCards.id,
    name: schema.scryfallCards.name,
    setName: schema.scryfallCards.setName,
    setCode: schema.scryfallCards.setCode,
    collectorNumber: schema.scryfallCards.collectorNumber,
    rarity: schema.scryfallCards.rarity,
    manaCost: schema.scryfallCards.manaCost,
    cmc: schema.scryfallCards.cmc,
    typeLine: schema.scryfallCards.typeLine,
    oracleText: schema.scryfallCards.oracleText,
    colors: schema.scryfallCards.colors,
    colorIdentity: schema.scryfallCards.colorIdentity,
    imageUris: schema.scryfallCards.imageUris,
    prices: schema.scryfallCards.prices,
    releasedAt: schema.scryfallCards.releasedAt,
    layout: schema.scryfallCards.layout,
  })
    .from(schema.scryfallCards)
    .where(where)
    .orderBy(asc(schema.scryfallCards.name), desc(schema.scryfallCards.releasedAt))
    .limit(pageSize)
    .offset(offset)
    .all();

  const parsed = cards.map(c => ({
    ...c,
    colors: c.colors ? JSON.parse(c.colors) : null,
    colorIdentity: c.colorIdentity ? JSON.parse(c.colorIdentity) : null,
    imageUris: localImageUris(c.id, c.imageUris),
    prices: c.prices ? JSON.parse(c.prices) : null,
  }));

  res.json({ data: parsed, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
});

cardsRouter.get('/grouped', (req, res) => {
  const q = (req.query.q as string ?? '').trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = 20;
  const offset = (page - 1) * pageSize;

  const tokens = q ? q.replace(/['"]/g, '').split(/[,\s]+/).filter(Boolean) : [];
  const conditions: ReturnType<typeof sql>[] = [NOT_ARENA, ...tokens.map(t => like(schema.scryfallCards.name, `%${t}%`))];

  const colorInclude: string[] = [];
  const colorExclude: string[] = [];
  for (const key of Object.keys(req.query)) {
    if (key.startsWith('c_') && req.query[key] === 'include') colorInclude.push(key.slice(2).toUpperCase());
    if (key.startsWith('c_') && req.query[key] === 'exclude') colorExclude.push(key.slice(2).toUpperCase());
  }
  if (colorInclude.length > 0) {
    const colLike = colorInclude.map(c => like(schema.scryfallCards.colors, `%"${c}"%`));
    const colorMode = req.query.colorMode === 'and' ? 'and' : 'or';
    if (colLike.length === 1) conditions.push(colLike[0]!);
    else if (colorMode === 'and') conditions.push(and(...colLike)!);
    else conditions.push(or(...colLike)!);
  }
  colorExclude.forEach(c => {
    if (c === 'C') {
      conditions.push(sql`(${schema.scryfallCards.colors} IS NULL OR ${schema.scryfallCards.colors} = '[]')`);
    } else {
      conditions.push(sql`(${schema.scryfallCards.colors} IS NULL OR ${schema.scryfallCards.colors} NOT LIKE ${`%"${c}"%`})`);
    }
  });

  const cmcMin = req.query.cmcMin ? Number(req.query.cmcMin) : undefined;
  const cmcMax = req.query.cmcMax ? Number(req.query.cmcMax) : undefined;
  if (cmcMin !== undefined && !isNaN(cmcMin)) conditions.push(sql`${schema.scryfallCards.cmc} >= ${cmcMin}`);
  if (cmcMax !== undefined && !isNaN(cmcMax)) conditions.push(sql`${schema.scryfallCards.cmc} <= ${cmcMax}`);

  const rarity = (req.query.rarity as string ?? '').trim();
  if (rarity) {
    const rarities = rarity.split(',').filter(Boolean);
    const rarityConditions = rarities.map(r => eq(schema.scryfallCards.rarity, r));
    conditions.push(rarityConditions.length === 1 ? rarityConditions[0]! : or(...rarityConditions)!);
  }

  if (req.query.promo === '1') conditions.push(eq(schema.scryfallCards.promo, 1));
  if (req.query.serial === '1') conditions.push(eq(schema.scryfallCards.seriealized, 1));
  if (req.query.fullArt === '1') conditions.push(eq(schema.scryfallCards.fullArt, 1));
  if (req.query.textless === '1') conditions.push(eq(schema.scryfallCards.textless, 1));
  if (req.query.artCard === '1') conditions.push(eq(schema.scryfallCards.layout, 'art_series'));

  const typeFilter = (req.query.type as string ?? '').trim();
  if (typeFilter) {
    const types = typeFilter.split(',').filter(Boolean);
    const typeConditions = types.map(t => like(schema.scryfallCards.typeLine, `%${t}%`));
    conditions.push(typeConditions.length === 1 ? typeConditions[0]! : or(...typeConditions)!);
  }

  const whereClause = conditions.length > 0 ? and(...conditions)! : undefined;

  const countResult = catalogDb.select({ count: sql<number>`COUNT(DISTINCT name)` })
    .from(schema.scryfallCards)
    .where(whereClause)
    .get();
  const total = countResult?.count ?? 0;

  type GroupedRow = {
    id: string;
    name: string;
    typeLine: string | null;
    manaCost: string | null;
    cmc: number | null;
    colors: string | null;
    imageUris: string | null;
    cardFaces: string | null;
    printings: number;
    firstPrinting: string | null;
    lastPrinting: string | null;
  };

  const whereSql = whereClause
    ? sql`WHERE ${whereClause}`
    : sql``;

  const rows = catalogDb.all<GroupedRow>(sql`
    WITH ranked AS (
      SELECT *,
        ROW_NUMBER() OVER (
          PARTITION BY name
          ORDER BY
            CASE WHEN promo = 0 AND set_code NOT LIKE 'sl%' AND textless = 0 THEN 0 ELSE 1 END,
            released_at DESC
        ) as rn
      FROM scryfall_cards
      ${whereSql}
    ),
    stats AS (
      SELECT
        name,
        COUNT(*) as printings,
        MIN(released_at) as firstPrinting,
        MAX(released_at) as lastPrinting
      FROM scryfall_cards
      ${whereSql}
      GROUP BY name
    )
    SELECT
      r.id,
      r.name,
      r.type_line as typeLine,
      r.mana_cost as manaCost,
      r.cmc,
      r.colors,
      r.image_uris as imageUris,
      r.card_faces as cardFaces,
      s.printings,
      s.firstPrinting,
      s.lastPrinting
    FROM ranked r
    JOIN stats s ON s.name = r.name
    WHERE r.rn = 1
    ORDER BY r.name
    LIMIT ${pageSize}
    OFFSET ${offset}
  `);

  const parsed = rows.map(r => ({
    ...r,
    colors: r.colors ? JSON.parse(r.colors) : null,
    imageUris: localImageUris(r.id, r.imageUris),
    cardFaces: localizeCardFaces(r.id, r.cardFaces),
  }));

  res.json({ data: parsed, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
});

cardsRouter.get('/printings', (req, res) => {
  const name = req.query.name as string;
  if (!name) return res.status(400).json({ error: 'name query param required' });

  const page = req.query.page ? Math.max(1, Number(req.query.page)) : undefined;
  const pageSize = req.query.pageSize ? Math.min(200, Math.max(1, Number(req.query.pageSize))) : undefined;

  const baseWhere = and(NOT_ARENA, eq(schema.scryfallCards.name, name));
  const parseCard = (c: any) => ({
    ...c,
    colors: c.colors ? JSON.parse(c.colors) : null,
    colorIdentity: c.colorIdentity ? JSON.parse(c.colorIdentity) : null,
    imageUris: localImageUris(c.id, c.imageUris),
    prices: c.prices ? JSON.parse(c.prices) : null,
    cardFaces: localizeCardFaces(c.id, c.cardFaces),
  });

  if (page && pageSize) {
    const total = catalogDb.select({ count: sql<number>`count(*)` }).from(schema.scryfallCards).where(baseWhere).get()?.count ?? 0;
    const printings = catalogDb.select()
      .from(schema.scryfallCards)
      .where(baseWhere)
      .orderBy(desc(schema.scryfallCards.releasedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .all();
    return res.json({ data: printings.map(parseCard), total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
  }

  const printings = catalogDb.select()
    .from(schema.scryfallCards)
    .where(baseWhere)
    .orderBy(desc(schema.scryfallCards.releasedAt))
    .all();

  res.json(printings.map(parseCard));
});

cardsRouter.get('/sets', (_req, res) => {
  const result = catalogDb.select({
    setCode: schema.sets.code,
    setName: schema.sets.name,
    hasBoosters: schema.sets.hasBoosters,
    setType: schema.sets.setType,
  })
    .from(schema.sets)
    .where(sql`(${schema.sets.code} NOT LIKE 'y%' AND ${schema.sets.code} != 'hbg')`)
    .orderBy(schema.sets.name)
    .all();
  res.json(result);
});

cardsRouter.get('/set/:setCode', (req, res) => {
  const cards = catalogDb.select().from(schema.scryfallCards)
    .where(and(NOT_ARENA, eq(schema.scryfallCards.setCode, req.params.setCode)))
    .orderBy(sql`CAST(REPLACE(REPLACE(collector_number, 'a', ''), 'b', '') AS INTEGER)`)
    .all();

  const parsed = cards.map(c => ({
    ...c,
    colors: c.colors ? JSON.parse(c.colors) : null,
    colorIdentity: c.colorIdentity ? JSON.parse(c.colorIdentity) : null,
    imageUris: localImageUris(c.id, c.imageUris),
    prices: c.prices ? JSON.parse(c.prices) : null,
    legalities: c.legalities ? JSON.parse(c.legalities) : null,
    cardFaces: localizeCardFaces(c.id, c.cardFaces),
    finishes: c.finishes ? JSON.parse(c.finishes) : null,
    frameEffects: c.frameEffects ? JSON.parse(c.frameEffects) : null,
  }));

  res.json(parsed);
});

cardsRouter.get('/:id', (req, res) => {
  const card = catalogDb.select().from(schema.scryfallCards).where(eq(schema.scryfallCards.id, req.params.id)).get();
  if (!card) return res.status(404).json({ error: 'Card not found' });

  res.json({
    ...card,
    colors: card.colors ? JSON.parse(card.colors) : null,
    colorIdentity: card.colorIdentity ? JSON.parse(card.colorIdentity) : null,
    imageUris: localImageUris(card.id, card.imageUris),
    prices: card.prices ? JSON.parse(card.prices) : null,
    legalities: card.legalities ? JSON.parse(card.legalities) : null,
    cardFaces: localizeCardFaces(card.id, card.cardFaces),
  });
});
