import { fail } from '../utils/http';
import { Router } from 'express';
import { db, sqlite, schema, catalogSqlite } from '../db';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { cardById, cardsByIds, parseCardJson } from '../services/cards';
import { parseDecklist, type DeckImportEntry } from '../services/decklistParser';

export const decksRouter = Router();

const getDeckLocation = (deckId: number) =>
  db.select().from(schema.locations).where(eq(schema.locations.deckId, deckId)).get();

function findGhostWantlist(reqId: number, cardName: string): { id: number } | undefined {
  const byLink = sqlite.prepare('SELECT id FROM wantlist_items WHERE deck_required_id = ?').get(reqId) as { id: number } | undefined;
  if (byLink) return byLink;
  return sqlite.prepare("SELECT id FROM wantlist_items WHERE card_name = ? AND notes LIKE 'Wanted for deck: %' ORDER BY created_at DESC LIMIT 1")
    .get(cardName) as { id: number } | undefined;
}

function resolvePrinting(name: string, setCode: string | null, collectorNumber: string | null): { cardId: string; canonicalName: string } | null {
  const trimmed = name.trim().toLowerCase();
  if (setCode && collectorNumber) {
    const row = catalogSqlite.prepare(
      `SELECT id, name FROM scryfall_cards WHERE lower(set_code) = ? AND lower(collector_number) = ? AND lower(name) = ? LIMIT 1`
    ).get(setCode.toLowerCase(), collectorNumber.toLowerCase(), trimmed) as { id: string; name: string } | undefined;
    if (row) return { cardId: row.id, canonicalName: row.name };
  }
  return null;
}

// Layouts that are not real playable cards (art cards, tokens, emblems, schemes,
// etc.) and should never be picked when resolving a card name for a deck.
const NON_CARD_LAYOUTS = [
  'art_series',
  'token',
  'double_faced_token',
  'emblem',
  'scheme',
  'planar',
  'vanguard',
  'augment',
  'host',
];

function resolveByName(name: string): { cardId: string; canonicalName: string } | null {
  const lower = name.trim().toLowerCase().replace(/([%_])/g, '\\$1');
  const placeholders = NON_CARD_LAYOUTS.map(() => '?').join(',');
  const row = catalogSqlite.prepare(
    `SELECT id, name FROM scryfall_cards
     WHERE (lower(name) = ? OR lower(name) LIKE ? ESCAPE '\\')
       AND layout NOT IN (${placeholders})
     ORDER BY released_at DESC LIMIT 1`
  ).get(lower, `${lower} // %`, ...NON_CARD_LAYOUTS) as { id: string; name: string } | undefined;
  return row ? { cardId: row.id, canonicalName: row.name } : null;
}

function isPartnerCard(oracleText: string | null): boolean {
  return !!oracleText && /you can have two commanders if both have partner/i.test(oracleText);
}

function isBackgroundCard(typeLine: string | null, oracleText: string | null): boolean {
  return (!!typeLine && /background/i.test(typeLine)) || (!!oracleText && /choose a background/i.test(oracleText));
}

type ImportResult =
  | { ok: true; status: number; body: any }
  | { ok: false; status: number; body: any };

function performImport(deckName: string, description: string | null, deckType: string, content: string, format: 'auto' | 'csv' | 'text'): ImportResult {
  if (!deckName) return { ok: false, status: 400, body: { error: 'Name is required' } };
  if (typeof content !== 'string' || !content.trim()) return { ok: false, status: 400, body: { error: 'No decklist content provided' } };
  if (content.length > 1_000_000) return { ok: false, status: 413, body: { error: 'Decklist is too large' } };

  let entries: DeckImportEntry[];
  try {
    entries = parseDecklist(content, format);
  } catch (err: any) {
    return { ok: false, status: 400, body: { error: `Could not parse decklist: ${err.message}` } };
  }
  if (entries.length === 0) return { ok: false, status: 400, body: { error: 'No cards found in the decklist' } };

  try {
    // Validate every card actually exists in the catalog before creating anything.
    const unknown: string[] = [];
    const validated: Array<{ entry: DeckImportEntry; nameHit: { cardId: string; canonicalName: string } }> = [];
    for (const entry of entries) {
      const nameHit = resolveByName(entry.name);
      if (!nameHit) {
        unknown.push(entry.name);
        continue;
      }
      validated.push({ entry, nameHit });
    }
    if (unknown.length > 0) {
      const shown = unknown.slice(0, 8).join(', ');
      const more = unknown.length > 8 ? ` and ${unknown.length - 8} more` : '';
      return { ok: false, status: 400, body: { error: `Could not find ${unknown.length} card(s) in the card database: ${shown}${more}. No cards were imported.`, unknown } };
    }

    const result = sqlite.transaction(() => {
      const deck = db.insert(schema.decks)
        .values({
          name: deckName,
          description: description ?? null,
          deckType: deckType ?? 'custom',
        })
        .returning().get() as { id: number; name: string; cardId: string | null };

      let loc: { id: number } | null = null;
      try {
        loc = db.insert(schema.locations)
          .values({
            name: deckName,
            description: description ? `Deck location for ${deckName}` : null,
            type: 'deck',
            groupId: null,
            deckId: deck.id,
          })
          .returning().get();
      } catch (err: any) {
        if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw new Error(`A location named "${deckName}" already exists. Rename the deck or that location.`);
        }
        throw err;
      }

      let importedQuantity = 0;
      let commanderCardId: string | null = null;
      let partnerCardId: string | null = null;
      let backgroundCardId: string | null = null;
      const zoneCards: Array<{ slotCardId: string; cardName: string; role: NonNullable<DeckImportEntry['role']> }> = [];

      for (const { entry, nameHit } of validated) {
        let cardId: string | null = null;
        let cardName = nameHit.canonicalName;
        let setCode = entry.setCode;
        let collectorNumber = entry.collectorNumber;
        if (entry.setCode && entry.collectorNumber) {
          const resolved = resolvePrinting(entry.name, entry.setCode, entry.collectorNumber);
          if (resolved) {
            cardId = resolved.cardId;
            cardName = resolved.canonicalName;
          }
        }

        const created = db.insert(schema.deckRequiredCards)
          .values({
            deckId: deck.id,
            cardId,
            cardName,
            setCode,
            collectorNumber,
            quantity: entry.quantity,
          })
          .returning().get();
        db.insert(schema.wantlistItems)
          .values({
            cardId,
            cardName,
            setCode,
            collectorNumber,
            quantity: entry.quantity,
            notes: `Wanted for deck: ${deckName}`,
            destinationId: loc?.id ?? null,
            deckRequiredId: created.id,
          })
          .run();
        importedQuantity += entry.quantity;

        if (entry.role === 'commander' || entry.role === 'partner' || entry.role === 'background') {
          zoneCards.push({ slotCardId: cardId ?? nameHit.cardId, cardName, role: entry.role });
        }
      }

      // Assign the command zone from section/tag roles.
      const commanders = zoneCards.filter(c => c.role === 'commander');
      if (commanders.length > 0) {
        commanderCardId = commanders[0].slotCardId;
        for (const extra of commanders.slice(1)) {
          const card = cardById(extra.slotCardId);
          if (!card) continue;
          if (isPartnerCard(card?.oracleText ?? null)) partnerCardId ??= extra.slotCardId;
          else if (isBackgroundCard(card?.typeLine ?? null, card?.oracleText ?? null)) backgroundCardId ??= extra.slotCardId;
        }
      }
      for (const c of zoneCards) {
        if (c.role === 'partner') partnerCardId ??= c.slotCardId;
        if (c.role === 'background') backgroundCardId ??= c.slotCardId;
      }

      if (commanderCardId || partnerCardId || backgroundCardId) {
        db.update(schema.decks)
          .set({
            ...(commanderCardId ? { commanderCardId } : {}),
            ...(partnerCardId ? { partnerCardId } : {}),
            ...(backgroundCardId ? { backgroundCardId } : {}),
            ...(commanderCardId && !deck.cardId ? { cardId: commanderCardId } : {}),
          })
          .where(eq(schema.decks.id, deck.id))
          .run();
      }

      const finalDeck = db.select().from(schema.decks).where(eq(schema.decks.id, deck.id)).get();
      return { deck: finalDeck!, loc, importedQuantity, uniqueCards: entries.length, commanders: zoneCards.map(c => c.cardName) };
    })();

    return { ok: true, status: 201, body: {
      deck: { ...result.deck, cardCount: 0, locationId: result.loc?.id ?? null },
      importedCards: result.importedQuantity,
      uniqueCards: result.uniqueCards,
      commanders: result.commanders,
    } };
  } catch (err: any) {
    return { ok: false, status: 400, body: { error: err?.message || 'Import failed' } };
  }
}

decksRouter.post('/import', (req, res) => {
  const { name, description, deckType, content, format } = req.body || {};
  const r = performImport(
    String(name ?? '').trim(),
    description ?? null,
    deckType ?? 'custom',
    content ?? '',
    (format ?? 'auto') as 'auto' | 'csv' | 'text',
  );
  return res.status(r.status).json(r.body);
});

// Fetches a decklist from a remote URL: Archidekt and Moxfield are converted
// from their APIs into the plain decklist format; anything else is fetched as-is.
// When `specificPrintings` is set, known set + collector numbers are included.
async function fetchDecklistFromUrl(raw: string, specificPrintings: boolean): Promise<string> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('That does not look like a valid URL');
  }
  const host = u.host.toLowerCase();

  if (host.includes('archidekt')) {
    const m = raw.match(/\/decks\/(\d+)/);
    if (!m) throw new Error('Could not find an Archidekt deck id in that URL');
    const resp = await fetch(`https://archidekt.com/api/decks/${m[1]}/`);
    if (!resp.ok) throw new Error(`Archidekt returned ${resp.status}`);
    const data = await resp.json();
    const cards: any[] = Array.isArray(data?.cards) ? data.cards : [];
    const boards = new Map<string, string[]>();
    const alloc = (header: string) => {
      if (!boards.has(header)) boards.set(header, []);
      return boards.get(header)!;
    };
    for (const c of cards) {
      const name = c?.card?.oracleCard?.name || c?.card?.name;
      const qty = Number(c?.quantity) || 1;
      if (!name) continue;
      const cats = (Array.isArray(c?.categories) ? c.categories : []).map((x: any) => String(x).toLowerCase());
      let header: string;
      if ((cats as string[]).some(s => /^commander/i.test(s))) header = 'Commander';
      else if ((cats as string[]).some(s => /^partner/i.test(s))) header = 'Partner';
      else if ((cats as string[]).some(s => /^background/i.test(s))) header = 'Background';
      else if ((cats as string[]).some(s => /maybeboard|sideboard/i.test(s))) header = 'Maybeboard';
      else header = 'Mainboard';
      const setCode = c?.card?.edition?.editioncode;
      const collector = c?.card?.collectorNumber;
      const suffix = specificPrintings && setCode && collector ? ` (${String(setCode).toUpperCase()}) ${collector}` : '';
      alloc(header).push(`${qty} ${name}${suffix}`);
    }
    if (boards.size === 0) throw new Error('Archidekt deck had no recognizable cards');
    const lines: string[] = [];
    for (const [header, cardLines] of boards) {
      lines.push(`//${header}`);
      lines.push(...cardLines);
    }
    return lines.join('\n');
  }

  if (host.includes('moxfield')) {
    const m = raw.match(/\/decks\/([a-zA-Z0-9_-]+)/);
    if (!m) throw new Error('Could not find a Moxfield deck id in that URL');
    const resp = await fetch(`https://api.moxfield.com/v2/decks/all/${m[1]}`);
    if (!resp.ok) throw new Error(`Moxfield returned ${resp.status}`);
    const data = await resp.json();
    const lines: string[] = [];
    const pushBoard = (label: string, board: Record<string, { quantity?: number | string }> | undefined) => {
      if (!board) return;
      const entries = Object.entries(board);
      if (entries.length === 0) return;
      lines.push(`//${label}`);
      for (const [name, entry] of entries) {
        lines.push(`${Number(entry?.quantity) || 1} ${name}`);
      }
    };
    pushBoard('Commander', data?.commander);
    pushBoard('Mainboard', data?.mainboard);
    pushBoard('Sideboard', data?.sideboard);
    pushBoard('Maybe Board', data?.maybe_board);
    if (lines.length === 0) throw new Error('Moxfield deck had no recognizable cards');
    return lines.join('\n');
  }

  // Generic: treat the URL's body as a plain decklist.
  const resp = await fetch(raw, { headers: { 'user-agent': 'mtg-archiver' } });
  if (!resp.ok) throw new Error(`URL returned ${resp.status}`);
  const text = await resp.text();
  if (text.length > 1_000_000) throw new Error('Decklist from URL is too large');
  return text;
}

decksRouter.post('/import-url', (req, res) => {
  const { name, description, deckType, url, specificPrintings } = req.body || {};
  const deckName = String(name ?? '').trim();
  if (!deckName) return res.status(400).json({ error: 'Name is required' });
  if (typeof url !== 'string' || !url.trim()) return res.status(400).json({ error: 'A deck URL is required' });
  fetchDecklistFromUrl(url.trim(), specificPrintings !== false)
    .then(content => {
      const r = performImport(deckName, description ?? null, deckType ?? 'custom', content, 'auto');
      return res.status(r.status).json(r.body);
    })
    .catch((err: any) =>
      res.status(502).json({ error: `Could not fetch decklist from that URL: ${err.message}` })
    );
});

decksRouter.get('/', (_req, res) => {
  const allDecks = db.select().from(schema.decks).orderBy(schema.decks.name).all();
  if (allDecks.length === 0) return res.json([]);
  const deckIds = allDecks.map(d => d.id);

  const countRows = db.select({
    deckId: schema.collectionItems.deckId,
    qty: sql<number>`SUM(${schema.collectionItems.quantity})`,
  })
    .from(schema.collectionItems)
    .where(inArray(schema.collectionItems.deckId, deckIds))
    .groupBy(schema.collectionItems.deckId)
    .all() as Array<{ deckId: number; qty: number }>;
  const countByDeck = new Map(countRows.map(r => [r.deckId, r.qty]));

  const locRows = db.select().from(schema.locations)
    .where(inArray(schema.locations.deckId, deckIds))
    .all();
  const locByDeck = new Map(locRows.map(l => [l.deckId, l.id]));

  const result = allDecks.map(d => ({
    ...d,
    cardCount: countByDeck.get(d.id) ?? 0,
    locationId: locByDeck.get(d.id) ?? null,
  }));
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
    fail(res, err);
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
    fail(res, err);
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

      const ghostRows = sqlite.prepare('SELECT id FROM deck_required_cards WHERE deck_id = ?').all(id) as Array<{ id: number }>;
      for (const g of ghostRows) {
        sqlite.prepare('DELETE FROM wantlist_items WHERE deck_required_id = ?').run(g.id);
      }
      sqlite.prepare('DELETE FROM deck_required_cards WHERE deck_id = ?').run(id);

      db.delete(schema.decks).where(eq(schema.decks.id, id)).run();
    })();
    res.status(204).end();
  } catch (err: any) {
    fail(res, err);
  }
});

decksRouter.get('/:id/cards', (req, res) => {
  const deckId = Number(req.params.id);
  const items = db.select({
    id: schema.collectionItems.id,
    cardId: schema.collectionItems.cardId,
    locationId: schema.collectionItems.locationId,
    destinationId: schema.collectionItems.destinationId,
    foil: schema.collectionItems.foil,
    foreignLanguage: schema.collectionItems.foreignLanguage,
    condition: schema.collectionItems.condition,
    quantity: schema.collectionItems.quantity,
    purchasePrice: schema.collectionItems.purchasePrice,
    priceAutofilled: schema.collectionItems.priceAutofilled,
    packOpened: schema.collectionItems.packOpened,
    proxy: schema.collectionItems.proxy,
    misprint: schema.collectionItems.misprint,
    altered: schema.collectionItems.altered,
    notes: schema.collectionItems.notes,
    acquiredAt: schema.collectionItems.acquiredAt,
    createdAt: schema.collectionItems.createdAt,
  })
    .from(schema.collectionItems)
    .where(and(eq(schema.collectionItems.deckId, deckId), sql`${schema.collectionItems.destinationId} IS NULL`))
    .all();

  const cards = cardsByIds(items.map(i => i.cardId));

  const parsed = items
    .map(i => ({
      ...i,
      card: i.cardId && cards.get(i.cardId) ? parseCardJson(cards.get(i.cardId)!) : null,
    }))
    .filter(i => i.card)
    .sort((a, b) => ((a.card as any).name || '').localeCompare((b.card as any).name || ''));

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
    fail(res, err);
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
    fail(res, err);
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
      .set({
        deckId,
        locationId: schedule ? item.locationId : deckLoc.id,
        destinationId: schedule ? deckLoc.id : null,
      })
      .where(eq(schema.collectionItems.id, item.id))
      .run();
    res.json({ message: 'Card added to deck from collection' });
  } catch (err: any) {
    fail(res, err);
  }
});

decksRouter.get('/:id/required', (req, res) => {
  const rows = db.select({
    id: schema.deckRequiredCards.id,
    deckId: schema.deckRequiredCards.deckId,
    cardId: schema.deckRequiredCards.cardId,
    cardName: schema.deckRequiredCards.cardName,
    setCode: schema.deckRequiredCards.setCode,
    collectorNumber: schema.deckRequiredCards.collectorNumber,
    quantity: schema.deckRequiredCards.quantity,
    fillItemId: schema.deckRequiredCards.fillItemId,
    createdAt: schema.deckRequiredCards.createdAt,
  })
    .from(schema.deckRequiredCards)
    .where(eq(schema.deckRequiredCards.deckId, Number(req.params.id)))
    .orderBy(schema.deckRequiredCards.createdAt)
    .all();

  const fillIds = rows.map(r => r.fillItemId).filter((x): x is number => x != null);
  const fillMap = new Map<number, string>();
  if (fillIds.length > 0) {
    const chunks: number[][] = [];
    for (let i = 0; i < fillIds.length; i += 500) chunks.push(fillIds.slice(i, i + 500));
    for (const ch of chunks) {
      const placeholders = ch.map(() => '?').join(',');
      const locRows = sqlite.prepare(`
        SELECT ci.id, l.name FROM collection_items ci
        JOIN locations l ON l.id = ci.location_id
        WHERE ci.id IN (${placeholders})
      `).all(...ch) as Array<{ id: number; name: string }>;
      for (const l of locRows) fillMap.set(l.id, l.name);
    }
  }

  const cards = rows.map(r => ({
    ...r,
    fillSourceName: r.fillItemId ? (fillMap.get(r.fillItemId) ?? null) : null,
  }));
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
    fail(res, err);
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
    fail(res, err);
  }
});

decksRouter.patch('/:id/required/:reqId', (req, res) => {
  const deckId = Number(req.params.id);
  const reqId = Number(req.params.reqId);
  const { cardId, quantity } = req.body;
  try {
    const updates: Record<string, any> = {};
    if (cardId !== undefined) updates.cardId = cardId ?? null;
    if (quantity !== undefined) {
      const q = Math.floor(Number(quantity));
      if (Number.isFinite(q) && q > 0) updates.quantity = Math.min(q, 999);
    }
    const updated = db.update(schema.deckRequiredCards)
      .set(updates)
      .where(and(eq(schema.deckRequiredCards.id, reqId), eq(schema.deckRequiredCards.deckId, deckId)))
      .returning().get();
    if (!updated) return res.status(404).json({ error: 'Required card not found' });
    // Keep the linked wantlist quantity in sync.
    if (updated.quantity !== undefined) {
      const wl = findGhostWantlist(updated.id, updated.cardName);
      if (wl) {
        db.update(schema.wantlistItems)
          .set({ quantity: updated.quantity })
          .where(eq(schema.wantlistItems.id, wl.id))
          .run();
      }
    }
    res.json(updated);
  } catch (err: any) {
    fail(res, err);
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
      const reqRow = db.select().from(schema.deckRequiredCards).where(eq(schema.deckRequiredCards.id, reqId)).get();

      if (schedule) {
        // Schedule the move from the item's current location to the deck location.
        // The card stays in its source location (full colour, scheduled move) and
        // the deck keeps showing the ghost with a pending move until resolved.
        db.update(schema.collectionItems)
          .set({ destinationId: deckLoc.id })
          .where(eq(schema.collectionItems.id, itemId))
          .run();

        if (reqRow) {
          // Mark the ghost as being filled by this collection item.
          db.update(schema.deckRequiredCards)
            .set({ fillItemId: itemId })
            .where(eq(schema.deckRequiredCards.id, reqId))
            .run();
          const wl = findGhostWantlist(reqRow.id, reqRow.cardName);
          if (wl) db.delete(schema.wantlistItems).where(eq(schema.wantlistItems.id, wl.id)).run();
        }
      } else {
        // Fill now: the card belongs to the deck immediately.
        db.update(schema.collectionItems)
          .set({ deckId, destinationId: null })
          .where(eq(schema.collectionItems.id, itemId))
          .run();

        if (reqRow) {
          db.delete(schema.deckRequiredCards)
            .where(eq(schema.deckRequiredCards.id, reqId))
            .run();
          const wl = findGhostWantlist(reqRow.id, reqRow.cardName);
          if (wl) db.delete(schema.wantlistItems).where(eq(schema.wantlistItems.id, wl.id)).run();
        }
      }
    })();

    res.json({ message: schedule ? 'Move scheduled from collection to deck' : 'Card added to deck from collection' });
  } catch (err: any) {
    fail(res, err);
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
    fail(res, err);
  }
});

const httpError = (status: number, message: string) => {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
};

// Fill a ghost card with a real copy. Defaults to filling the full required
// quantity with autofilled market pricing. When `opts.allowGeneric === false`,
// ghosts that do not pin a specific printing (no cardId / set+collector number)
// are rejected — the caller must resolve a printing itself (see bulk fill).
function fillGhostExternal(deckId: number, reqId: number, opts: {
  chosenCardId?: string | null;
  foil?: boolean;
  condition?: string | null;
  quantity?: number | null;
  purchasePrice?: string | number | null;
  packOpened?: boolean;
  notes?: string | null;
  locationId?: number | null;
  destinationId?: number | null;
  allowGeneric?: boolean;
} = {}) {
  const {
    chosenCardId, foil, condition, quantity,
    purchasePrice, packOpened, notes, locationId, destinationId,
    allowGeneric = true,
  } = opts;

  const ghost = db.select().from(schema.deckRequiredCards).where(eq(schema.deckRequiredCards.id, reqId)).get();
  if (!ghost || ghost.deckId !== deckId) throw httpError(404, 'Ghost card not found');
  const deckLoc = getDeckLocation(deckId);
  if (!deckLoc) throw httpError(400, 'Deck has no location');
  const loc = locationId == null ? deckLoc : (
    db.select().from(schema.locations).where(eq(schema.locations.id, Number(locationId))).get() ?? null
  );
  if (!loc) throw httpError(400, 'Location not found');

  // Bulk fills must be specific printings — a generic "any printing" ghost has no
  // way to pick a printing without the manual flow.
  if (!allowGeneric && !ghost.cardId && !(ghost.setCode && ghost.collectorNumber)) {
    throw httpError(400, `Cannot bulk-fill "${ghost.cardName}": generic (any printing) ghosts are not supported. Fill it individually to pick a printing.`);
  }

  // Validate an optional scheduled-move destination.
  let resolvedDest: number | null = null;
  if (destinationId !== undefined && destinationId !== null) {
    const dest = db.select().from(schema.locations).where(eq(schema.locations.id, Number(destinationId))).get();
    if (!dest) throw httpError(400, 'Destination location not found');
    resolvedDest = dest.id;
  }

  let cardId = chosenCardId || ghost.cardId || null;
  if (!cardId) {
    const resolved = (ghost.setCode && ghost.collectorNumber)
      ? resolvePrinting(ghost.cardName, ghost.setCode, ghost.collectorNumber)
      : null;
    cardId = resolved?.cardId ?? resolveByName(ghost.cardName)?.cardId ?? null;
  }
  if (!cardId) throw httpError(400, `Could not resolve "${ghost.cardName}" to a card`);
  const card = cardById(cardId);
  if (!card) throw httpError(400, 'Selected printing not found');

  const rawQty = Math.floor(Number(quantity));
  const qty = Number.isFinite(rawQty) && rawQty > 0
    ? Math.min(rawQty, ghost.quantity || 1, 999)
    : Math.min(ghost.quantity || 1, 999);

  // Price: use the supplied value, otherwise autofill the market value of the chosen printing.
  let price: number | null = null;
  let autofilled = 0;
  if (purchasePrice !== undefined && purchasePrice !== null && purchasePrice !== '') {
    const parsed = parseFloat(String(purchasePrice));
    if (!isNaN(parsed)) {
      price = parsed;
    }
  }
  if (price === null) {
    let cardPrices: Record<string, any> = {};
    try { cardPrices = JSON.parse(card.prices ?? '{}'); } catch { cardPrices = {}; }
    const usd = foil ? (cardPrices.usd_foil ?? cardPrices.usd) : (cardPrices.usd ?? cardPrices.usd_foil);
    if (usd) {
      price = parseFloat(usd);
      autofilled = 1;
    }
  }

  // Cancel any pending scheduled move that was filling this ghost.
  if (ghost.fillItemId) {
    db.update(schema.collectionItems)
      .set({ destinationId: null })
      .where(eq(schema.collectionItems.id, ghost.fillItemId))
      .run();
  }

  const item = db.insert(schema.collectionItems)
    .values({
      cardId,
      locationId: loc.id,
      deckId,
      destinationId: resolvedDest,
      foil: foil ? 1 : 0,
      condition: condition ?? null,
      quantity: qty,
      purchasePrice: price,
      priceAutofilled: autofilled,
      packOpened: packOpened ? 1 : 0,
      notes: notes ?? null,
    })
    .returning().get() as { id: number; quantity: number };

  // If this ghost filled a command-zone slot, bind that slot to the new copy.
  const deck = db.select().from(schema.decks).where(eq(schema.decks.id, deckId)).get();
  if (deck) {
    const updates: Record<string, any> = {};
    if (deck.commanderCardId === cardId) updates.commanderItemId = item.id;
    if (deck.partnerCardId === cardId) updates.partnerItemId = item.id;
    if (deck.backgroundCardId === cardId) updates.backgroundItemId = item.id;
    if (Object.keys(updates).length > 0) {
      db.update(schema.decks).set(updates).where(eq(schema.decks.id, deckId)).run();
    }
  }

  // If we filled fewer than the required amount, keep the remaining difference
  // as a ghost so the deck still wants the rest (e.g. 10 islands -> fill 1 -> 9 required).
  const filled = Math.min(qty, ghost.quantity);
  const remaining = ghost.quantity - filled;
  const wl = findGhostWantlist(ghost.id, ghost.cardName);

  if (remaining > 0) {
    db.update(schema.deckRequiredCards)
      .set({ quantity: remaining })
      .where(eq(schema.deckRequiredCards.id, ghost.id))
      .run();
    if (wl) {
      db.update(schema.wantlistItems)
        .set({ quantity: remaining })
        .where(eq(schema.wantlistItems.id, wl.id))
        .run();
    }
  } else {
    if (wl) db.delete(schema.wantlistItems).where(eq(schema.wantlistItems.id, wl.id)).run();
    db.delete(schema.deckRequiredCards).where(eq(schema.deckRequiredCards.id, ghost.id)).run();
  }

  return {
    item,
    remainingGhost: remaining > 0 ? { ...ghost, quantity: remaining } : null,
  };
}

decksRouter.post('/:id/required/:reqId/fill-external', (req, res) => {
  const deckId = Number(req.params.id);
  const reqId = Number(req.params.reqId);
  const body = req.body || {};
  try {
    const result = sqlite.transaction(() => fillGhostExternal(deckId, reqId, {
      chosenCardId: body.cardId,
      foil: body.foil,
      condition: body.condition,
      quantity: body.quantity,
      purchasePrice: body.purchasePrice,
      packOpened: body.packOpened,
      notes: body.notes,
      locationId: body.locationId,
      destinationId: body.destinationId,
    }));
    res.status(201).json(result);
  } catch (err: any) {
    fail(res, err, typeof err?.status === 'number' ? err.status : 500);
  }
});

// Bulk-fill multiple required cards at once. Each ghost must be a specific
// printing; cards are added with default (NM) condition, full quantity, autofill
// pricing, and the deck's location.
decksRouter.post('/:id/required/fill-external-bulk', (req, res) => {
  const deckId = Number(req.params.id);
  const raw = req.body?.reqIds;
  const reqIds = Array.isArray(raw) ? raw.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n)) : [];
  if (reqIds.length === 0) return res.status(400).json({ error: 'No required cards provided' });

  try {
    // Validate the whole batch up front so a bad request doesn't partially fill.
    const ghosts = reqIds.map(id => db.select().from(schema.deckRequiredCards).where(eq(schema.deckRequiredCards.id, id)).get());
    const invalid = ghosts.filter(g => !g || g.deckId !== deckId);
    if (invalid.length > 0) {
      return res.status(400).json({ error: 'One or more required cards were not found in this deck' });
    }
    const generic = ghosts.filter((g: any) => !g.cardId && !(g.setCode && g.collectorNumber));
    if (generic.length > 0) {
      const shown = generic.slice(0, 4).map((g: any) => `"${g.cardName}"`).join(', ');
      const more = generic.length > 4 ? ` and ${generic.length - 4} more` : '';
      return res.status(400).json({
        error: `Bulk filling only works on specific printings. ${generic.length} of the selected card(s) are generic "any printing" wishlist entries — fill them individually to pick a printing.${shown ? ` (${shown}${more})` : ''}`,
      });
    }

    const results = sqlite.transaction(() =>
      reqIds.map(id => fillGhostExternal(deckId, id, { condition: 'NM', allowGeneric: false }))
    )();
    res.status(201).json({
      results: reqIds.map((id, i) => {
        const r = results[i];
        const g = ghosts[i]!;
        return {
          reqId: id,
          itemId: r.item.id,
          quantity: r.item.quantity,
          remainingGhost: r.remainingGhost,
          ghost: { cardId: g.cardId, cardName: g.cardName, setCode: g.setCode, collectorNumber: g.collectorNumber, quantity: g.quantity },
        };
      }),
    });
  } catch (err: any) {
    fail(res, err, typeof err?.status === 'number' ? err.status : 500);
  }
});

// Atomically reverse a bulk fill: delete the created collection copies, restore
// the ghost (required card + wantlist) rows, and clear any command-zone bindings
// that pointed at the removed copies.
decksRouter.post('/:id/required/undo-fill-bulk', (req, res) => {
  const deckId = Number(req.params.id);
  const raw = req.body?.results;
  const results = Array.isArray(raw) ? raw : [];
  if (results.length === 0) return res.status(400).json({ error: 'No results provided' });
  try {
    sqlite.transaction(() => {
      const deck = db.select().from(schema.decks).where(eq(schema.decks.id, deckId)).get();
      const deckLoc = getDeckLocation(deckId);
      for (const r of results) {
        const itemId = Number(r?.itemId);
        const ghost = (r?.ghost ?? {}) as { cardId?: string | null; cardName?: string; setCode?: string | null; collectorNumber?: string | null; quantity?: number };
        const cardName = String(ghost.cardName ?? '').trim();
        if (!cardName) continue;

        if (itemId) {
          if (deck) {
            const updates: Record<string, any> = {};
            if (deck.commanderItemId === itemId) updates.commanderItemId = null;
            if (deck.partnerItemId === itemId) updates.partnerItemId = null;
            if (deck.backgroundItemId === itemId) updates.backgroundItemId = null;
            if (Object.keys(updates).length > 0) {
              db.update(schema.decks).set(updates).where(eq(schema.decks.id, deckId)).run();
            }
          }
          db.delete(schema.collectionItems).where(eq(schema.collectionItems.id, itemId)).run();
        }

        const created = db.insert(schema.deckRequiredCards)
          .values({
            deckId,
            cardId: ghost.cardId ?? null,
            cardName,
            setCode: ghost.setCode ?? null,
            collectorNumber: ghost.collectorNumber ?? null,
            quantity: Math.max(1, Number(ghost.quantity) || 1),
          })
          .returning().get();
        db.insert(schema.wantlistItems)
          .values({
            cardId: ghost.cardId ?? null,
            cardName: created.cardName,
            setCode: created.setCode,
            collectorNumber: created.collectorNumber,
            quantity: created.quantity,
            notes: deck ? `Wanted for deck: ${deck.name}` : 'Wanted for deck',
            destinationId: deckLoc?.id ?? null,
            deckRequiredId: created.id,
          })
          .run();
      }
    })();
    res.json({ ok: true, message: `${results.length} card(s) restored to ghosts` });
  } catch (err: any) {
    fail(res, err, typeof err?.status === 'number' ? err.status : 500);
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

  const itemRows = sqlite.prepare(
    `SELECT card_id as cardId, quantity FROM collection_items WHERE deck_id = ?`
  ).all(deckId) as Array<{ cardId: string; quantity: number }>;
  const cards = cardsByIds(itemRows.map(i => i.cardId));

  const items = itemRows.map(i => {
    const c = cards.get(i.cardId);
    return {
      quantity: i.quantity,
      cardId: i.cardId,
      name: c?.name || '',
      typeLine: c?.typeLine ?? null,
      legalities: c?.legalities ?? null,
      colorIdentity: c?.colorIdentity ?? null,
      oracleText: c?.oracleText ?? null,
    };
  });

  let commander: any = null;
  let partner: any = null;
  let background: any = null;
  if (format === 'commander') {
    const fetchCmd = (id: string | null) => {
      if (!id) return null;
      const c = cardById(id);
      if (!c) return null;
      return { cardId: c.id, name: c.name, typeLine: c.typeLine, legalities: c.legalities, colorIdentity: c.colorIdentity, oracleText: c.oracleText };
    };
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
