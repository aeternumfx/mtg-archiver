import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

export const scryfallCards = sqliteTable('scryfall_cards', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  setName: text('set_name').notNull(),
  setCode: text('set_code').notNull(),
  collectorNumber: text('collector_number').notNull(),
  rarity: text('rarity'),
  manaCost: text('mana_cost'),
  cmc: real('cmc'),
  typeLine: text('type_line'),
  oracleText: text('oracle_text'),
  colors: text('colors'),
  colorIdentity: text('color_identity'),
  imageUris: text('image_uris'),
  prices: text('prices'),
  power: text('power'),
  toughness: text('toughness'),
  loyalty: text('loyalty'),
  legalities: text('legalities'),
  releasedAt: text('released_at'),
  layout: text('layout'),
  updatedAt: text('updated_at').notNull(),
  promo: integer('promo').notNull().default(0),
  seriealized: integer('seriealized').notNull().default(0),
  fullArt: integer('full_art').notNull().default(0),
  textless: integer('textless').notNull().default(0),
  finishes: text('finishes'),
  frameEffects: text('frame_effects'),
  cardFaces: text('card_faces'),
}, (table) => ({
  nameIdx: index('idx_cards_name').on(table.name),
  setIdx: index('idx_cards_set').on(table.setCode),
  colorIdx: index('idx_cards_color').on(table.colorIdentity),
  typeIdx: index('idx_cards_type').on(table.typeLine),
}));

export const locationGroups = sqliteTable('location_groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull().$default(() => new Date().toISOString()),
});

export const locations = sqliteTable('locations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  description: text('description'),
  type: text('type').notNull().default('binder'),
  groupId: integer('group_id').references(() => locationGroups.id),
  deckId: integer('deck_id').references(() => decks.id),
  builtIn: integer('built_in').notNull().default(0),
  createdAt: text('created_at').notNull().$default(() => new Date().toISOString()),
});

export const decks = sqliteTable('decks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  description: text('description'),
  cardId: text('card_id').references(() => scryfallCards.id),
  deckType: text('deck_type').notNull().default('custom'),
  commanderCardId: text('commander_card_id').references(() => scryfallCards.id),
  partnerCardId: text('partner_card_id').references(() => scryfallCards.id),
  backgroundCardId: text('background_card_id').references(() => scryfallCards.id),
  commanderItemId: integer('commander_item_id'),
  partnerItemId: integer('partner_item_id'),
  backgroundItemId: integer('background_item_id'),
  groupId: integer('group_id').references(() => locationGroups.id),
  createdAt: text('created_at').notNull().$default(() => new Date().toISOString()),
});

export const deckRequiredCards = sqliteTable('deck_required_cards', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  deckId: integer('deck_id').notNull().references(() => decks.id),
  cardId: text('card_id'),
  cardName: text('card_name').notNull(),
  setCode: text('set_code'),
  collectorNumber: text('collector_number'),
  quantity: integer('quantity').notNull().default(1),
  createdAt: text('created_at').notNull().$default(() => new Date().toISOString()),
});

export const collectionItems = sqliteTable('collection_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cardId: text('card_id').notNull().references(() => scryfallCards.id),
  locationId: integer('location_id').notNull().references(() => locations.id),
  destinationId: integer('destination_id').references(() => locations.id),
  deckId: integer('deck_id').references(() => decks.id),
  foil: integer('foil').notNull().default(0),
  condition: text('condition'),
  quantity: integer('quantity').notNull().default(1),
  purchasePrice: real('purchase_price'),
  priceAutofilled: integer('price_autofilled').notNull().default(0),
  packOpened: integer('pack_opened').notNull().default(0),
  notes: text('notes'),
  acquiredAt: text('acquired_at'),
  createdAt: text('created_at').notNull().$default(() => new Date().toISOString()),
});

export const collectionHistory = sqliteTable('collection_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),
  totalCards: integer('total_cards').notNull(),
  totalValue: real('total_value').notNull(),
  purchaseValue: real('purchase_value'),
  createdAt: text('created_at').notNull().$default(() => new Date().toISOString()),
});

export const sets = sqliteTable('sets', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  setType: text('set_type').notNull(),
  hasBoosters: integer('has_boosters').notNull().default(0),
  releasedAt: text('released_at'),
  updatedAt: text('updated_at'),
});

export const syncMeta = sqliteTable('sync_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const boosterSessions = sqliteTable('booster_sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  setCode: text('set_code').notNull(),
  boosterType: text('booster_type').notNull(),
  boosterPrice: real('booster_price').notNull(),
  totalValue: real('total_value').notNull(),
  completed: integer('completed').notNull().default(0),
  createdAt: text('created_at').notNull().$default(() => new Date().toISOString()),
});

export const wantlistItems = sqliteTable('wantlist_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  cardId: text('card_id'),
  cardName: text('card_name').notNull(),
  setCode: text('set_code'),
  collectorNumber: text('collector_number'),
  foil: integer('foil').notNull().default(0),
  condition: text('condition'),
  quantity: integer('quantity').notNull().default(1),
  notes: text('notes'),
  destinationId: integer('destination_id'),
  collectionGoalId: integer('collection_goal_id'),
  deckRequiredId: integer('deck_required_id'),
  persistent: integer('persistent').notNull().default(0),
  createdAt: text('created_at').notNull().$default(() => new Date().toISOString()),
});

export const collectionGoals = sqliteTable('collection_goals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  locationId: integer('location_id').notNull().references(() => locations.id),
  kind: text('kind').notNull(),
  cardId: text('card_id'),
  cardName: text('card_name'),
  setCodes: text('set_codes'),
  targetCount: integer('target_count'),
  fulfilledCount: integer('fulfilled_count').notNull().default(0),
  status: text('status').notNull().default('active'),
  createdAt: text('created_at').notNull().$default(() => new Date().toISOString()),
});

export const trades = sqliteTable('trades', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title'),
  status: text('status').notNull().default('active'),
  yourCash: real('your_cash').notNull().default(0),
  theirCash: real('their_cash').notNull().default(0),
  contactInfo: text('contact_info'),
  notes: text('notes'),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull().$default(() => new Date().toISOString()),
  updatedAt: text('updated_at').notNull().$default(() => new Date().toISOString()),
});

export const tradeItems = sqliteTable('trade_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tradeId: integer('trade_id').notNull().references(() => trades.id),
  side: text('side').notNull(),
  cardId: text('card_id'),
  cardName: text('card_name').notNull(),
  setCode: text('set_code'),
  collectorNumber: text('collector_number'),
  foil: integer('foil').notNull().default(0),
  condition: text('condition'),
  quantity: integer('quantity').notNull().default(1),
  price: real('price'),
});

export const movementHistory = sqliteTable('movement_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id'),
  cardId: text('card_id'),
  cardName: text('card_name'),
  action: text('action').notNull(),
  fromLocationId: integer('from_location_id'),
  toLocationId: integer('to_location_id'),
  quantity: integer('quantity').notNull().default(1),
  details: text('details'),
  undone: integer('undone').notNull().default(0),
  createdAt: text('created_at').notNull().$default(() => new Date().toISOString()),
});

export const boosterPulls = sqliteTable('booster_pulls', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: integer('session_id').notNull().references(() => boosterSessions.id),
  cardId: text('card_id').notNull().references(() => scryfallCards.id),
  foil: integer('foil').notNull().default(0),
  slotIndex: integer('slot_index').notNull(),
  locationId: integer('location_id').references(() => locations.id),
  addedToCollection: integer('added_to_collection').notNull().default(0),
  createdAt: text('created_at').notNull().$default(() => new Date().toISOString()),
});
