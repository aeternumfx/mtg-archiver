import { Router } from 'express';
import { db, sqlite, schema } from '../db';
import { eq, and, sql } from 'drizzle-orm';

export const decksRouter = Router();

const getDeckLocation = (deckId: number) =>
  db.select().from(schema.locations).where(eq(schema.locations.deckId, deckId)).get();

function findGhostWantlist(reqId: number, cardName: string): { id: number } | undefined {
  const byLink = sqlite.prepare('SELECT id FROM wantlist_items WHERE deck_required_id = ?').get(reqId) as { id: number } | undefined;
  if (byLink) return byLink;
  return sqlite.prepare("SELECT id FROM wantlist_items WHERE card_name = ? AND notes LIKE 'Wanted for deck: %' ORDER BY created_at DESC LIMIT 1")
    .get(cardName) as { id: number } | undefined;
}

decksRouter.get('/', (_req, res) => {
  const allDecks = db.select().from(schema.decks).orderBy(schema.decks.name).all();
  const result = allDecks.map(d => {
    const count = db.select().from(schema.collectionItems)
      .where(eq(schema.collectionItems.deckId, d.id))
      .all()
      .reduce((s, i) => s + i.quantity, 0);
    const loc = getDeckLocation(d.id);
    return { ...d, cardCount: count, locationId: loc?.id ?? null };
  });
  res.json(result);
});

decksRouter.get('/:id', (req, res) => {
  const deck = db.select().from(schema.decks).where(eq(schema.decks.id, Number(req.params.id))).get();
  if (!deck) return res.status(404).json({ error: 'Deck not found' });
  const count = db.select().from(schema.collectionItems)
    .where(eq(schema.collectionItems.deckId, deck.id))
    .all()
    .reduce((s, i) => s + i.quantity, 0);
  const loc = getDeckLocation(deck.id);
  res.json({ ...deck, cardCount: count, locationId: loc?.id ?? null });
});

decksRouter.post('/', (req, res) => {
  const { name, description, cardId, deckType, commanderCardId, partnerCardId, backgroundCardId, groupId, commanderItemId, partnerItemId, backgroundItemId } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const { deck, loc } = sqlite.transaction(() => {
      const deck = db.insert(schema.decks)
        .values({
          name, description: description ?? null, cardId: cardId ?? null,
          deckType: deckType ?? 'custom', commanderCardId: commanderCardId ?? null,
          partnerCardId: partnerCardId ?? null, backgroundCardId: backgroundCardId ?? null,
          commanderItemId: commanderItemId ?? null, partnerItemId: partnerItemId ?? null, backgroundItemId: backgroundItemId ?? null,
          groupId: groupId ?? null,
        })
        .returning().get();
      let loc: { id: number } | null = null;
      try {
        loc = db.insert(schema.locations)
          .values({
            name: deck.name,
            description: description ? `Deck location for ${deck.name}` : null,
            type: 'deck',
            groupId: groupId ?? null,
            deckId: deck.id,
          })
          .returning().get();
      } catch (err: any) {
        if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw new Error(`A location named "${deck.name}" already exists. Rename the deck or that location.`);
        }
        throw err;
      }
      return { deck, loc };
    })();
    res.status(201).json({ ...deck, cardCount: 0, locationId: loc?.id ?? null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

decksRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const { name, description, cardId, deckType, commanderCardId, partnerCardId, backgroundCardId, groupId, commanderItemId, partnerItemId, backgroundItemId } = req.body;
  try {
    const values: Record<string, any> = {};
    if (name !== undefined) values.name = name;
    if (description !== undefined) values.description = description ?? null;
    if (cardId !== undefined) values.cardId = cardId ?? null;
    if (deckType !== undefined) values.deckType = deckType ?? 'custom';
    if (commanderCardId !== undefined) values.commanderCardId = commanderCardId ?? null;
    if (partnerCardId !== undefined) values.partnerCardId = partnerCardId ?? null;
    if (backgroundCardId !== undefined) values.backgroundCardId = backgroundCardId ?? null;
    if (groupId !== undefined) values.groupId = groupId ?? null;

    const validateItem = (itemId: number | null) => {
      if (itemId === null || itemId === undefined) return itemId ?? null;
      const item = db.select().from(schema.collectionItems).where(eq(schema.collectionItems.id, itemId)).get();
      if (!item) throw new Error('Collection item not found');
      return itemId;
    };
    if (commanderItemId !== undefined) values.commanderItemId = validateItem(commanderItemId);
    if (partnerItemId !== undefined) values.partnerItemId = validateItem(partnerItemId);
    if (backgroundItemId !== undefined) values.backgroundItemId = validateItem(backgroundItemId);

    const deck = sqlite.transaction(() => {
      const deck = db.update(schema.decks)
        .set(values)
        .where(eq(schema.decks.id, id))
        .returning().get();
      if (!deck) return null;
      if (name !== undefined) {
        const loc = getDeckLocation(id);
        if (loc && loc.name !== name) {
          db.update(schema.locations).set({ name }).where(eq(schema.locations.id, loc.id)).run();
        }
      }
      if (groupId !== undefined) {
        const loc = getDeckLocation(id);
        if (loc) db.update(schema.locations).set({ groupId: groupId ?? null }).where(eq(schema.locations.id, loc.id)).run();
      }
      return deck;
    })();
    if (!deck) return res.status(404).json({ error: 'Deck not found' });
    const loc = getDeckLocation(id);
    res.json({ ...deck, locationId: loc?.id ?? null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

decksRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  try {
    sqlite.transaction(() => {
      db.update(schema.collectionItems)
        .set({ deckId: null })
        .where(eq(schema.collectionItems.deckId, id))
        .run();

      const loc = getDeckLocation(id);
      if (loc) {
        const inbox = db.select().from(schema.locations).where(eq(schema.locations.builtIn, 1)).get();
        if (inbox) {
          db.update(schema.collectionItems)
            .set({ locationId: inbox.id, destinationId: null })
            .where(eq(schema.collectionItems.locationId, loc.id))
            .run();
        }
        db.delete(schema.locations).where(eq(schema.locations.id, loc.id)).run();
      }

      db.delete(schema.decks).where(eq(schema.decks.id, id)).run();
    })();
    res.status(204).end();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

decksRouter.get('/:id/cards', (req, res) => {
  const deckId = Number(req.params.id);
  const items = db.select({
    id: schema.collectionItems.id,
    cardId: schema.collectionItems.cardId,
    locationId: schema.collectionItems.locationId,
    foil: schema.collectionItems.foil,
    condition: schema.collectionItems.condition,
    quantity: schema.collectionItems.quantity,
    purchasePrice: schema.collectionItems.purchasePrice,
    priceAutofilled: schema.collectionItems.priceAutofilled,
    packOpened: schema.collectionItems.packOpened,
    notes: schema.collectionItems.notes,
    acquiredAt: schema.collectionItems.acquiredAt,
    createdAt: schema.collectionItems.createdAt,
    card: {
      id: schema.scryfallCards.id,
      name: schema.scryfallCards.name,
      setName: schema.scryfallCards.setName,
      setCode: schema.scryfallCards.setCode,
      collectorNumber: schema.scryfallCards.collectorNumber,
      rarity: schema.scryfallCards.rarity,
      manaCost: schema.scryfallCards.manaCost,
      cmc: schema.scryfallCards.cmc,
      typeLine: schema.scryfallCards.typeLine,
      colorIdentity: schema.scryfallCards.colorIdentity,
      legalities: schema.scryfallCards.legalities,
      cardFaces: schema.scryfallCards.cardFaces,
      imageUris: schema.scryfallCards.imageUris,
      prices: schema.scryfallCards.prices,
    },
  })
    .from(schema.collectionItems)
    .where(eq(schema.collectionItems.deckId, deckId))
    .innerJoin(schema.scryfallCards, eq(schema.collectionItems.cardId, schema.scryfallCards.id))
    .orderBy(schema.scryfallCards.name)
    .all();

  const parsed = items.map(i => ({
    ...i,
    card: {
      ...i.card,
      colorIdentity: i.card.colorIdentity ? JSON.parse(i.card.colorIdentity) : null,
      legalities: (i.card as any).legalities ? JSON.parse((i.card as any).legalities) : null,
      cardFaces: (i.card as any).cardFaces ? JSON.parse((i.card as any).cardFaces) : null,
      imageUris: i.card.imageUris ? JSON.parse(i.card.imageUris) : null,
      prices: i.card.prices ? JSON.parse(i.card.prices) : null,
    },
  }));

  res.json(parsed);
});

decksRouter.post('/:id/cards', (req, res) => {
  const deckId = Number(req.params.id);
  const { cardId, locationId, quantity, foil, condition, purchasePrice, notes } = req.body;

  if (!cardId || !locationId) {
    return res.status(400).json({ error: 'cardId and locationId are required' });
  }

  try {
    const item = db.insert(schema.collectionItems)
      .values({
        cardId,
        locationId,
        deckId,
        foil: foil ? 1 : 0,
        condition: condition ?? null,
        quantity: quantity ?? 1,
        purchasePrice: purchasePrice ?? null,
        priceAutofilled: purchasePrice ? 0 : 1,
        notes: notes ?? null,
      })
      .returning().get();

    res.status(201).json(item);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

decksRouter.delete('/:id/cards/:itemId', (req, res) => {
  const { id, itemId } = req.params;
  try {
    db.update(schema.collectionItems)
      .set({ deckId: null })
      .where(eq(schema.collectionItems.id, Number(itemId)))
      .run();
    res.status(204).end();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

decksRouter.post('/:id/link', (req, res) => {
  const deckId = Number(req.params.id);
  const { itemId, schedule } = req.body;
  if (!itemId) return res.status(400).json({ error: 'itemId is required' });
  try {
    const item = db.select().from(schema.collectionItems).where(eq(schema.collectionItems.id, Number(itemId))).get();
    if (!item) return res.status(404).json({ error: 'Collection item not found' });
    const deckLoc = getDeckLocation(deckId);
    if (!deckLoc) return res.status(400).json({ error: 'Deck has no location' });
    db.update(schema.collectionItems)
      .set({ deckId, destinationId: schedule ? deckLoc.id : null })
      .where(eq(schema.collectionItems.id, item.id))
      .run();
    res.json({ message: 'Card added to deck from collection' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

decksRouter.get('/:id/required', (req, res) => {
  const cards = db.select().from(schema.deckRequiredCards)
    .where(eq(schema.deckRequiredCards.deckId, Number(req.params.id)))
    .orderBy(schema.deckRequiredCards.createdAt)
    .all();
  res.json(cards);
});

decksRouter.post('/:id/required', (req, res) => {
  const deckId = Number(req.params.id);
  const { cardId, cardName, setCode, collectorNumber, quantity } = req.body;
  if (!cardName) return res.status(400).json({ error: 'cardName is required' });
  try {
    const card = db.insert(schema.deckRequiredCards)
      .values({ deckId, cardId: cardId ?? null, cardName, setCode: setCode ?? null, collectorNumber: collectorNumber ?? null, quantity: quantity ?? 1 })
      .returning().get();
    res.status(201).json(card);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

decksRouter.delete('/:id/required/:reqId', (req, res) => {
  try {
    sqlite.transaction(() => {
      const ghostReq = db.select().from(schema.deckRequiredCards).where(eq(schema.deckRequiredCards.id, Number(req.params.reqId))).get();
      const wl = ghostReq ? findGhostWantlist(ghostReq.id, ghostReq.cardName) : undefined;
      if (wl) db.delete(schema.wantlistItems).where(eq(schema.wantlistItems.id, wl.id)).run();
      db.delete(schema.deckRequiredCards)
        .where(eq(schema.deckRequiredCards.id, Number(req.params.reqId)))
        .run();
    })();
    res.status(204).end();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

decksRouter.patch('/:id/required/:reqId', (req, res) => {
  const deckId = Number(req.params.id);
  const reqId = Number(req.params.reqId);
  const { cardId } = req.body;
  try {
    const updated = db.update(schema.deckRequiredCards)
      .set({ cardId: cardId ?? null })
      .where(and(eq(schema.deckRequiredCards.id, reqId), eq(schema.deckRequiredCards.deckId, deckId)))
      .returning().get();
    if (!updated) return res.status(404).json({ error: 'Required card not found' });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

decksRouter.post('/:id/required/:reqId/fill', (req, res) => {
  const deckId = Number(req.params.id);
  const reqId = Number(req.params.reqId);
  const { itemId, schedule } = req.body;

  if (!itemId) return res.status(400).json({ error: 'itemId is required' });

  try {
    const deckLoc = getDeckLocation(deckId);
    if (!deckLoc) return res.status(400).json({ error: 'Deck has no location' });

    sqlite.transaction(() => {
      const item = db.select().from(schema.collectionItems).where(eq(schema.collectionItems.id, itemId)).get();
      if (!item) throw new Error('Collection item not found');
      const req = db.select().from(schema.deckRequiredCards).where(eq(schema.deckRequiredCards.id, reqId)).get();

      db.update(schema.collectionItems)
        .set({ deckId, destinationId: schedule ? deckLoc.id : null })
        .where(eq(schema.collectionItems.id, itemId))
        .run();

      db.delete(schema.deckRequiredCards)
        .where(eq(schema.deckRequiredCards.id, reqId))
        .run();

      const wl = req ? findGhostWantlist(req.id, req.cardName) : undefined;
      if (wl) db.delete(schema.wantlistItems).where(eq(schema.wantlistItems.id, wl.id)).run();
    })();

    res.json({ message: 'Card added to deck from collection' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

decksRouter.post('/:id/required/:reqId/move', (req, res) => {
  const reqId = Number(req.params.reqId);
  const { destinationType, destinationId } = req.body;

  try {
    const ghost = db.select().from(schema.deckRequiredCards).where(eq(schema.deckRequiredCards.id, reqId)).get();
    if (!ghost) return res.status(404).json({ error: 'Required card not found' });

    if (destinationType === 'location') {
      const loc = db.select().from(schema.locations).where(eq(schema.locations.id, destinationId)).get();
      if (!loc) return res.status(400).json({ error: 'Location not found' });
      sqlite.transaction(() => {
        const wl = findGhostWantlist(ghost.id, ghost.cardName);
        if (wl) {
          db.update(schema.wantlistItems)
            .set({ destinationId: loc.id, deckRequiredId: null, notes: null })
            .where(eq(schema.wantlistItems.id, wl.id))
            .run();
        }
        db.delete(schema.deckRequiredCards)
          .where(eq(schema.deckRequiredCards.id, ghost.id))
          .run();
      })();
      return res.json({ message: `Ghost moved to ${loc.name}` });
    }

    if (destinationType === 'deck') {
      const targetDeck = db.select().from(schema.decks).where(eq(schema.decks.id, destinationId)).get();
      if (!targetDeck) return res.status(400).json({ error: 'Deck not found' });
      const targetLoc = getDeckLocation(targetDeck.id);
      sqlite.transaction(() => {
        db.update(schema.deckRequiredCards)
          .set({ deckId: targetDeck.id })
          .where(eq(schema.deckRequiredCards.id, ghost.id))
          .run();
        const wl = findGhostWantlist(ghost.id, ghost.cardName);
        if (wl) {
          db.update(schema.wantlistItems)
            .set({ destinationId: targetLoc?.id ?? null, notes: `Wanted for deck: ${targetDeck.name}` })
            .where(eq(schema.wantlistItems.id, wl.id))
            .run();
        }
      })();
      return res.json({ message: `Ghost moved to ${targetDeck.name}` });
    }

    res.status(400).json({ error: 'destinationType must be "location" or "deck"' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

decksRouter.patch('/:id/group', (req, res) => {
  const id = Number(req.params.id);
  const { groupId } = req.body;
  const deck = db.update(schema.decks)
    .set({ groupId: groupId ?? null })
    .where(eq(schema.decks.id, id))
    .returning().get();
  if (!deck) return res.status(404).json({ error: 'Deck not found' });
  res.json(deck);
});

decksRouter.get('/:id/legality', (req, res) => {
  const deckId = Number(req.params.id);
  const deck = db.select().from(schema.decks).where(eq(schema.decks.id, deckId)).get();
  if (!deck) return res.status(404).json({ error: 'Deck not found' });

  const format = deck.deckType;
  const issues: Array<{ type: string; cardName: string; detail: string }> = [];
  const cardStatuses: Array<{ name: string; status: string }> = [];

  if (format === 'custom') {
    const totalCards = db.select().from(schema.collectionItems)
      .where(eq(schema.collectionItems.deckId, deckId))
      .all()
      .reduce((s, i) => s + i.quantity, 0);
    return res.json({ format, legal: true, totalCards, issues: [], cardStatuses: [] });
  }

  const items = sqlite.prepare(`
    SELECT ci.quantity, sc.id as cardId, sc.name, sc.type_line as typeLine,
      sc.legalities, sc.color_identity as colorIdentity, sc.oracle_text as oracleText
    FROM collection_items ci
    JOIN scryfall_cards sc ON sc.id = ci.card_id
    WHERE ci.deck_id = ?
  `).all(deckId) as any[];

  let commander: any = null;
  let partner: any = null;
  let background: any = null;
  if (format === 'commander') {
    const fetchCmd = (id: string | null) => id ? sqlite.prepare(
      'SELECT id as cardId, name, type_line as typeLine, legalities, color_identity as colorIdentity, oracle_text as oracleText FROM scryfall_cards WHERE id = ?'
    ).get(id) as any : null;
    commander = fetchCmd(deck.commanderCardId);
    partner = fetchCmd(deck.partnerCardId);
    background = fetchCmd(deck.backgroundCardId);
  }

  const commanderCount = commander ? 1 + (partner ? 1 : 0) : 0;
  const zoneCount = commanderCount + (background ? 1 : 0);
  const totalCards = items.reduce((s: number, i: any) => s + (i.quantity || 0), 0) + zoneCount;

  // Commander-specific checks
  if (format === 'commander') {
    const commanderColors = new Set<string>();
    const cmdCols = (c: any) => (c?.colorIdentity ? JSON.parse(c.colorIdentity) : []) as string[];
    if (commander) {
      cmdCols(commander).forEach(c => commanderColors.add(c));
      const legalities = commander.legalities ? JSON.parse(commander.legalities) : {};
      const cStatus = legalities.commander || 'not_legal';
      cardStatuses.push({ name: `${commander.name} (Commander)`, status: cStatus });
      if (cStatus !== 'legal' && cStatus !== 'restricted') {
        issues.push({ type: 'commander_not_legal', cardName: commander.name, detail: `Commander is ${cStatus} in Commander.` });
      }
      const cmdText = commander.oracleText || '';
      const isCommanderEligible = /^Legendary /i.test(commander.typeLine || '') || /(^|\n)\s*Partner/i.test(cmdText) || /can be your commander/i.test(cmdText) || /Choose a Background/i.test(cmdText);
      if (!isCommanderEligible) {
        issues.push({ type: 'commander_not_legendary', cardName: commander.name, detail: 'Commander must be a legendary creature (or have partner, "choose a background", or "can be your commander").' });
      }
    } else {
      issues.push({ type: 'commander_missing', cardName: '—', detail: 'This commander deck has no commander selected.' });
    }

    if (partner || background) {
      const second = partner || background;
      const secondName = second.name;
      const secondText = second.oracleText || '';
      const validAsPartner = /(^|\n)\s*Partner/i.test(secondText) || /can be your commander/i.test(secondText);
      const validAsBackground = /\(Choose a Background\)|Background$/i.test(second.typeLine || '');

      if (validAsPartner) {
        cmdCols(second).forEach(c => commanderColors.add(c));
        const legalities = second.legalities ? JSON.parse(second.legalities) : {};
        const sStatus = legalities.commander || 'not_legal';
        cardStatuses.push({ name: `${secondName} (Partner)`, status: sStatus });
        if (sStatus !== 'legal' && sStatus !== 'restricted') {
          issues.push({ type: 'commander_not_legal', cardName: secondName, detail: `Partner ${secondName} is ${sStatus} in Commander.` });
        }
      } else if (validAsBackground) {
        cmdCols(second).forEach(c => commanderColors.add(c));
        const bgLegalities = second.legalities ? JSON.parse(second.legalities) : {};
        cardStatuses.push({ name: `${secondName} (Background)`, status: bgLegalities.commander || 'legal' });
        if (commander && !/Choose a Background/i.test(commander.oracleText || '')) {
          issues.push({ type: 'background_no_commander', cardName: secondName, detail: `The commander must have "Choose a Background" to use ${secondName}.` });
        }
      } else {
        issues.push({ type: 'partner_background_not_valid', cardName: secondName, detail: `${secondName} is neither a valid partner nor a valid background.` });
      }
    }

    const commanderColorStr = [...commanderColors].join('');

    if (totalCards !== 100) {
      issues.push({ type: 'card_count', cardName: '—', detail: `Commander decks must have exactly 100 cards (currently ${totalCards}).` });
    }

    const seen = new Set<string>();
    const basics = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes']);
    for (const item of items) {
      const legalities = item.legalities ? JSON.parse(item.legalities) : {};
      const status = legalities.commander || 'not_legal';
      if (status !== 'legal' && status !== 'restricted') {
        issues.push({ type: 'not_legal', cardName: item.name, detail: `${item.name} is ${status} in Commander.` });
      }
      const identity: string[] = item.colorIdentity ? JSON.parse(item.colorIdentity) : [];
      for (const c of identity) {
        if (!commanderColors.has(c)) {
          issues.push({ type: 'color_identity', cardName: item.name, detail: `${item.name} has ${c} in its color identity outside the commander's (${commanderColorStr}).` });
          break;
        }
      }
      if (!basics.has(item.name)) {
        const key = item.cardId;
        if (seen.has(key)) {
          issues.push({ type: 'duplicate', cardName: item.name, detail: `${item.name} appears more than once.` });
        }
        seen.add(key);
      }
      cardStatuses.push({ name: item.name, status });
    }
  } else {
    // Non-commander formats: check each card's legalities for the format
    const formatKey = format;
    for (const item of items) {
      const legalities = item.legalities ? JSON.parse(item.legalities) : {};
      const status = legalities[formatKey] || 'not_legal';
      if (status === 'banned') {
        issues.push({ type: 'banned', cardName: item.name, detail: `${item.name} is banned in ${formatKey}.` });
      } else if (status === 'not_legal') {
        issues.push({ type: 'not_legal', cardName: item.name, detail: `${item.name} is not legal in ${formatKey}.` });
      }
      cardStatuses.push({ name: item.name, status });
    }
  }

  res.json({
    format,
    legal: issues.length === 0,
    totalCards,
    issues,
    cardStatuses,
  });
});

decksRouter.post('/:id/artwork', (req, res) => {
  const id = Number(req.params.id);
  const { cardId } = req.body;
  if (!cardId) return res.status(400).json({ error: 'cardId is required' });
  const deck = db.update(schema.decks)
    .set({ cardId })
    .where(eq(schema.decks.id, id))
    .returning().get();
  if (!deck) return res.status(404).json({ error: 'Deck not found' });
  res.json(deck);
});
