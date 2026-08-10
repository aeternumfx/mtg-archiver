import { Router } from 'express';
import { db, sqlite, schema } from '../db';
import { eq } from 'drizzle-orm';

export const wantlistRouter = Router();

wantlistRouter.get('/', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 100));
  const destinationId = req.query.destinationId ? Number(req.query.destinationId) : undefined;
  const q = (req.query.q as string ?? '').trim();
  const sort = (req.query.sort as string) || 'created';
  const order = (req.query.order as string) === 'asc' ? 'ASC' : 'DESC';
  const rarityFilter = (req.query.rarity as string) || '';
  const typeFilter = (req.query.type as string) || '';
  const conditionFilter = (req.query.condition as string) || '';
  const cmcMin = req.query.cmcMin ? Number(req.query.cmcMin) : undefined;
  const cmcMax = req.query.cmcMax ? Number(req.query.cmcMax) : undefined;
  const valueMin = req.query.valueMin ? Number(req.query.valueMin) : undefined;
  const valueMax = req.query.valueMax ? Number(req.query.valueMax) : undefined;
  const foilFilter = req.query.foil ? Number(req.query.foil) : undefined;

  const conditions: string[] = [];
  const queryParams: any[] = [];

  if (destinationId) {
    conditions.push('w.destination_id = ?');
    queryParams.push(destinationId);
  }
  if (q) {
    const pattern = `%${q.replace(/['"]/g, '')}%`;
    conditions.push('(w.card_name LIKE ? OR sc.name LIKE ?)');
    queryParams.push(pattern, pattern);
  }
  for (const key of Object.keys(req.query).filter(k => k.startsWith('c_'))) {
    const color = key.slice(2).toUpperCase();
    const val = req.query[key] as string;
    if (val === 'include') {
      conditions.push('(sc.color_identity IS NOT NULL AND sc.color_identity LIKE ?)');
      queryParams.push(`%"${color}"%`);
    } else if (val === 'exclude') {
      conditions.push('(sc.color_identity IS NULL OR sc.color_identity NOT LIKE ?)');
      queryParams.push(`%"${color}"%`);
    }
  }
  const rarityList = rarityFilter.split(',').filter(Boolean);
  if (rarityList.length > 0) {
    conditions.push(`sc.rarity IN (${rarityList.map(() => '?').join(',')})`);
    queryParams.push(...rarityList);
  }
  const typeList = typeFilter.split(',').filter(Boolean);
  if (typeList.length > 0) {
    conditions.push(`(${typeList.map(() => 'sc.type_line LIKE ?').join(' OR ')})`);
    queryParams.push(...typeList.map(t => `%${t}%`));
  }
  const condList = conditionFilter.split(',').filter(Boolean);
  if (condList.length > 0) {
    conditions.push(`w.condition IN (${condList.map(() => '?').join(',')})`);
    queryParams.push(...condList);
  }
  if (foilFilter !== undefined) {
    conditions.push('w.foil = ?');
    queryParams.push(foilFilter);
  }
  if (cmcMin !== undefined) {
    conditions.push('sc.cmc >= ?');
    queryParams.push(cmcMin);
  }
  if (cmcMax !== undefined) {
    conditions.push('sc.cmc <= ?');
    queryParams.push(cmcMax);
  }

  const priceExpr = `CASE WHEN w.foil THEN json_extract(sc.prices, '$.usd_foil') ELSE json_extract(sc.prices, '$.usd') END`;
  if (valueMin !== undefined) {
    conditions.push(`${priceExpr} >= ?`);
    queryParams.push(valueMin);
  }
  if (valueMax !== undefined) {
    conditions.push(`${priceExpr} <= ?`);
    queryParams.push(valueMax);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const orderCol = (() => {
    switch (sort) {
      case 'name': return 'w.card_name';
      case 'set': return 'w.set_code';
      case 'foil': return 'w.foil';
      case 'cond': return 'w.condition';
      case 'price': return priceExpr;
      case 'qty': return 'w.card_name';
      default: return 'w.created_at';
    }
  })();

  const baseSql = `FROM wantlist_items w LEFT JOIN scryfall_cards sc ON sc.id = w.card_id ${where}`;
  const total = (sqlite.prepare(`SELECT COUNT(*) as c ${baseSql}`).get(...queryParams) as { c: number }).c;

  if (req.query.page === undefined) {
    const rows = sqlite.prepare(
      `SELECT w.id, w.card_id as cardId, w.card_name as cardName, w.set_code as setCode, w.collector_number as collectorNumber,
         w.foil, w.condition, w.quantity, w.notes, w.destination_id as destinationId, w.collection_goal_id as collectionGoalId,
         w.deck_required_id as deckRequiredId, w.persistent, w.created_at as createdAt
       ${baseSql} ORDER BY ${orderCol} ${order}`,
    ).all(...queryParams) as any[];
    return res.json(rows);
  }

  const rows = sqlite.prepare(
    `SELECT w.id, w.card_id as cardId, w.card_name as cardName, w.set_code as setCode, w.collector_number as collectorNumber,
       w.foil, w.condition, w.quantity, w.notes, w.destination_id as destinationId, w.collection_goal_id as collectionGoalId,
       w.persistent, w.created_at as createdAt
     ${baseSql} ORDER BY ${orderCol} ${order} LIMIT ? OFFSET ?`,
  ).all(...queryParams, pageSize, (page - 1) * pageSize) as any[];

  res.json({
    data: rows,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
});

wantlistRouter.post('/', (req, res) => {
  const { cardId, cardName, setCode, collectorNumber, foil, condition, notes, destinationId, collectionGoalId, persistent, deckRequiredId } = req.body;
  if (!cardName) return res.status(400).json({ error: 'cardName is required' });
  try {
    const item = db.insert(schema.wantlistItems)
      .values({
        cardId: cardId ?? null, cardName, setCode: setCode ?? null, collectorNumber: collectorNumber ?? null,
        foil: foil ? 1 : 0, condition: condition ?? null, quantity: 1, notes: notes ?? null,
        destinationId: destinationId ?? null,
        collectionGoalId: collectionGoalId ?? null,
        deckRequiredId: deckRequiredId ?? null,
        persistent: persistent ? 1 : 0,
      })
      .returning().get();
    res.status(201).json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

wantlistRouter.delete('/:id', (req, res) => {
  try {
    db.delete(schema.wantlistItems).where(eq(schema.wantlistItems.id, Number(req.params.id))).run();
    res.status(204).end();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

wantlistRouter.post('/:id/fulfil', (req, res) => {
  const id = Number(req.params.id);
  const count = Math.max(1, Number(req.body?.count) || 1);

  try {
    const item = db.select().from(schema.wantlistItems).where(eq(schema.wantlistItems.id, id)).get();
    if (!item) return res.status(404).json({ error: 'Wantlist item not found' });

    if (!item.collectionGoalId) {
      db.delete(schema.wantlistItems).where(eq(schema.wantlistItems.id, id)).run();
      return res.json({ removed: true });
    }

    const goal = db.select().from(schema.collectionGoals).where(eq(schema.collectionGoals.id, item.collectionGoalId)).get();
    if (!goal) {
      db.delete(schema.wantlistItems).where(eq(schema.wantlistItems.id, id)).run();
      return res.json({ removed: true });
    }

    const newCount = (goal.fulfilledCount || 0) + count;
    const targetMet = goal.targetCount != null && newCount >= goal.targetCount;
    let removed = false;

    if (item.persistent) {
      removed = targetMet;
      if (removed) {
        db.delete(schema.wantlistItems).where(eq(schema.wantlistItems.id, id)).run();
      }
    } else {
      removed = true;
      db.delete(schema.wantlistItems).where(eq(schema.wantlistItems.id, id)).run();
    }

    db.update(schema.collectionGoals)
      .set({ fulfilledCount: newCount, status: targetMet ? 'complete' : goal.status })
      .where(eq(schema.collectionGoals.id, goal.id))
      .run();

    res.json({
      removed,
      goal: {
        id: goal.id,
        fulfilledCount: newCount,
        targetCount: goal.targetCount,
        complete: targetMet,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
