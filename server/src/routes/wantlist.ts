import { fail } from '../utils/http';
import { Router } from 'express';
import { db, sqlite, schema } from '../db';
import { eq } from 'drizzle-orm';
import { cardsByIds } from '../services/cards';

export const wantlistRouter = Router();

wantlistRouter.get('/', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 100));
  const destinationId = req.query.destinationId ? Number(req.query.destinationId) : undefined;
  const q = (req.query.q as string ?? '').trim();
  const sort = (req.query.sort as string) || 'created';
  const order = (req.query.order as string) === 'asc' ? 1 : -1;
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

  if (req.query.tradeGhosts !== '1') {
    conditions.push('trade_id IS NULL');
  }

  if (destinationId) {
    conditions.push('destination_id = ?');
    queryParams.push(destinationId);
  }
  if (q) {
    const pattern = `%${q.replace(/['"]/g, '')}%`;
    conditions.push('card_name LIKE ?');
    queryParams.push(pattern);
  }
  const condList = conditionFilter.split(',').filter(Boolean);
  if (condList.length > 0) {
    conditions.push(`condition IN (${condList.map(() => '?').join(',')})`);
    queryParams.push(...condList);
  }
  if (foilFilter !== undefined) {
    conditions.push('foil = ?');
    queryParams.push(foilFilter);
  }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const colorInclude: string[] = [];
  const colorExclude: string[] = [];
  for (const key of Object.keys(req.query)) {
    if (key.startsWith('c_') && req.query[key] === 'include') colorInclude.push(key.slice(2).toUpperCase());
    if (key.startsWith('c_') && req.query[key] === 'exclude') colorExclude.push(key.slice(2).toUpperCase());
  }
  const rarityList = rarityFilter.split(',').filter(Boolean);
  const typeList = typeFilter.split(',').filter(Boolean);

  const baseSql = `FROM wantlist_items w ${where}`;
  const total = (sqlite.prepare(`SELECT COUNT(*) as c ${baseSql}`).get(...queryParams) as { c: number }).c;

  const rows = sqlite.prepare(
    `SELECT w.id, w.card_id as cardId, w.card_name as cardName, w.set_code as setCode, w.collector_number as collectorNumber,
       w.foil, w.condition, w.quantity, w.notes, w.destination_id as destinationId, w.collection_goal_id as collectionGoalId,
       w.deck_required_id as deckRequiredId, w.trade_id as tradeId, w.persistent, w.created_at as createdAt
     ${baseSql}`
  ).all(...queryParams) as any[];

  const cards = cardsByIds(rows.map(r => r.cardId));

  const priceOf = (row: any): number => {
    const card = row.cardId ? cards.get(row.cardId) : undefined;
    if (!card?.prices) return 0;
    let prices: Record<string, any> = {};
    try { prices = JSON.parse(card.prices); } catch { prices = {}; }
    const key = row.foil ? 'usd_foil' : 'usd';
    const v = prices[key] ?? prices.usd ?? 0;
    return Number(v) || 0;
  };

  const matches = (row: any): boolean => {
    const card = row.cardId ? cards.get(row.cardId) : undefined;
    if (colorInclude.length || colorExclude.length || rarityList.length || typeList.length ||
        (cmcMin !== undefined && !isNaN(cmcMin)) || (cmcMax !== undefined && !isNaN(cmcMax))) {
      if (!card) return false;
      let identity: string[] = [];
      if (card.colorIdentity) {
        try { identity = JSON.parse(card.colorIdentity); } catch { identity = []; }
      }
      for (const c of colorInclude) if (!identity.includes(c)) return false;
      for (const c of colorExclude) if (identity.includes(c)) return false;
      if (rarityList.length > 0 && !rarityList.includes(card.rarity ?? '')) return false;
      if (typeList.length > 0) {
        const tl = card.typeLine || '';
        if (!typeList.some(t => tl.toLowerCase().includes(t.toLowerCase()))) return false;
      }
      if (cmcMin !== undefined && !isNaN(cmcMin) && (card.cmc ?? 0) < cmcMin) return false;
      if (cmcMax !== undefined && !isNaN(cmcMax) && (card.cmc ?? 0) > cmcMax) return false;
    }
    const price = priceOf(row);
    if (valueMin !== undefined && price < valueMin) return false;
    if (valueMax !== undefined && price > valueMax) return false;
    return true;
  };

  const filtered = rows.filter(matches);
  filtered.sort((a, b) => {
    let cmp = 0;
    switch (sort) {
      case 'name': cmp = a.cardName.localeCompare(b.cardName); break;
      case 'set': cmp = (a.setCode || '').localeCompare(b.setCode || ''); break;
      case 'foil': cmp = (a.foil || 0) - (b.foil || 0); break;
      case 'cond': cmp = (a.condition || '').localeCompare(b.condition || ''); break;
      case 'price': cmp = priceOf(a) - priceOf(b); break;
      case 'qty': cmp = (a.quantity || 0) - (b.quantity || 0); break;
      default: cmp = (a.createdAt || '').localeCompare(b.createdAt || ''); break;
    }
    return cmp * order;
  });

  const totalCount = filtered.length;
  const totalPages = Math.ceil(totalCount / pageSize);

  if (req.query.page === undefined) {
    return res.json(filtered);
  }

  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);
  res.json({ data: paginated, total: totalCount, page, pageSize, totalPages });
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
    fail(res, err);
  }
});

wantlistRouter.delete('/:id', (req, res) => {
  try {
    db.delete(schema.wantlistItems).where(eq(schema.wantlistItems.id, Number(req.params.id))).run();
    res.status(204).end();
  } catch (err: any) {
    fail(res, err);
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
    fail(res, err);
  }
});
