export type ImportFieldType = 'text' | 'integer' | 'real';

export interface ImportField {
  name: string;
  column: string;
  type: ImportFieldType;
  default?: unknown;
  required?: boolean;
}

export type RemapKey = 'groupId' | 'locationId' | 'destinationId' | 'collectionGoalId';

export interface ImportEntity {
  key: string;
  table: string;
  hasId: boolean;
  byName?: boolean;
  remap?: RemapKey[];
  fields: ImportField[];
}

const f = (
  name: string,
  column: string,
  type: ImportFieldType,
  extra?: Partial<ImportField>,
): ImportField => ({ name, column, type, default: null, ...extra });

export const IMPORT_ENTITIES: ImportEntity[] = [
  {
    key: 'locationGroups',
    table: 'location_groups',
    hasId: true,
    byName: true,
    fields: [
      f('name', 'name', 'text', { required: true }),
      f('description', 'description', 'text', { default: null }),
      f('sortOrder', 'sort_order', 'integer', { default: 0 }),
    ],
  },
  {
    key: 'locations',
    table: 'locations',
    hasId: true,
    byName: true,
    remap: ['groupId'],
    fields: [
      f('name', 'name', 'text', { required: true }),
      f('description', 'description', 'text', { default: null }),
      f('type', 'type', 'text', { default: 'binder' }),
      f('groupId', 'group_id', 'integer', { default: null }),
      f('deckId', 'deck_id', 'integer', { default: null }),
      f('builtIn', 'built_in', 'integer', { default: 0 }),
    ],
  },
  {
    key: 'collectionItems',
    table: 'collection_items',
    hasId: false,
    remap: ['locationId', 'destinationId'],
    fields: [
      f('cardId', 'card_id', 'text', { required: true }),
      f('locationId', 'location_id', 'integer', { required: true }),
      f('destinationId', 'destination_id', 'integer', { default: null }),
      f('deckId', 'deck_id', 'integer', { default: null }),
      f('foil', 'foil', 'integer', { default: 0 }),
      f('condition', 'condition', 'text', { default: null }),
      f('quantity', 'quantity', 'integer', { default: 1 }),
      f('purchasePrice', 'purchase_price', 'real', { default: null }),
      f('priceAutofilled', 'price_autofilled', 'integer', { default: 0 }),
      f('packOpened', 'pack_opened', 'integer', { default: 0 }),
      f('notes', 'notes', 'text', { default: null }),
      f('acquiredAt', 'acquired_at', 'text', { default: null }),
    ],
  },
  {
    key: 'collectionHistory',
    table: 'collection_history',
    hasId: false,
    fields: [
      f('date', 'date', 'text', { required: true }),
      f('totalCards', 'total_cards', 'integer', { required: true }),
      f('totalValue', 'total_value', 'real', { required: true }),
      f('purchaseValue', 'purchase_value', 'real', { default: null }),
    ],
  },
  {
    key: 'decks',
    table: 'decks',
    hasId: true,
    remap: ['groupId'],
    fields: [
      f('name', 'name', 'text', { required: true }),
      f('description', 'description', 'text', { default: null }),
      f('cardId', 'card_id', 'text', { default: null }),
      f('deckType', 'deck_type', 'text', { default: 'custom' }),
      f('commanderCardId', 'commander_card_id', 'text', { default: null }),
      f('partnerCardId', 'partner_card_id', 'text', { default: null }),
      f('backgroundCardId', 'background_card_id', 'text', { default: null }),
      f('commanderItemId', 'commander_item_id', 'integer', { default: null }),
      f('partnerItemId', 'partner_item_id', 'integer', { default: null }),
      f('backgroundItemId', 'background_item_id', 'integer', { default: null }),
      f('groupId', 'group_id', 'integer', { default: null }),
    ],
  },
  {
    key: 'deckRequiredCards',
    table: 'deck_required_cards',
    hasId: true,
    fields: [
      f('deckId', 'deck_id', 'integer', { required: true }),
      f('cardId', 'card_id', 'text', { default: null }),
      f('cardName', 'card_name', 'text', { required: true }),
      f('setCode', 'set_code', 'text', { default: null }),
      f('collectorNumber', 'collector_number', 'text', { default: null }),
      f('quantity', 'quantity', 'integer', { default: 1 }),
      f('fillItemId', 'fill_item_id', 'integer', { default: null }),
    ],
  },
  {
    key: 'boosterSessions',
    table: 'booster_sessions',
    hasId: true,
    fields: [
      f('setCode', 'set_code', 'text', { required: true }),
      f('boosterType', 'booster_type', 'text', { required: true }),
      f('boosterPrice', 'booster_price', 'real', { required: true }),
      f('totalValue', 'total_value', 'real', { required: true }),
      f('completed', 'completed', 'integer', { default: 0 }),
    ],
  },
  {
    key: 'boosterPulls',
    table: 'booster_pulls',
    hasId: true,
    fields: [
      f('sessionId', 'session_id', 'integer', { required: true }),
      f('cardId', 'card_id', 'text', { required: true }),
      f('foil', 'foil', 'integer', { default: 0 }),
      f('slotIndex', 'slot_index', 'integer', { default: 0 }),
      f('locationId', 'location_id', 'integer', { default: null }),
      f('addedToCollection', 'added_to_collection', 'integer', { default: 0 }),
    ],
  },
  {
    key: 'wantlistItems',
    table: 'wantlist_items',
    hasId: true,
    remap: ['destinationId', 'collectionGoalId'],
    fields: [
      f('cardId', 'card_id', 'text', { default: null }),
      f('cardName', 'card_name', 'text', { required: true }),
      f('setCode', 'set_code', 'text', { default: null }),
      f('collectorNumber', 'collector_number', 'text', { default: null }),
      f('foil', 'foil', 'integer', { default: 0 }),
      f('condition', 'condition', 'text', { default: null }),
      f('quantity', 'quantity', 'integer', { default: 1 }),
      f('notes', 'notes', 'text', { default: null }),
      f('destinationId', 'destination_id', 'integer', { default: null }),
      f('collectionGoalId', 'collection_goal_id', 'integer', { default: null }),
      f('deckRequiredId', 'deck_required_id', 'integer', { default: null }),
      f('tradeId', 'trade_id', 'integer', { default: null }),
      f('persistent', 'persistent', 'integer', { default: 0 }),
    ],
  },
  {
    key: 'collectionGoals',
    table: 'collection_goals',
    hasId: true,
    remap: ['locationId'],
    fields: [
      f('locationId', 'location_id', 'integer', { required: true }),
      f('kind', 'kind', 'text', { required: true }),
      f('cardId', 'card_id', 'text', { default: null }),
      f('cardName', 'card_name', 'text', { default: null }),
      f('setCodes', 'set_codes', 'text', { default: null }),
      f('targetCount', 'target_count', 'integer', { default: null }),
      f('fulfilledCount', 'fulfilled_count', 'integer', { default: 0 }),
      f('status', 'status', 'text', { default: 'active' }),
    ],
  },
  {
    key: 'trades',
    table: 'trades',
    hasId: true,
    fields: [
      f('title', 'title', 'text', { default: null }),
      f('status', 'status', 'text', { default: 'active' }),
      f('yourCash', 'your_cash', 'real', { default: 0 }),
      f('theirCash', 'their_cash', 'real', { default: 0 }),
      f('contactInfo', 'contact_info', 'text', { default: null }),
      f('notes', 'notes', 'text', { default: null }),
      f('receivedLocationId', 'received_location_id', 'integer', { default: null }),
      f('receivedDestinationId', 'received_destination_id', 'integer', { default: null }),
      f('completedAt', 'completed_at', 'text', { default: null }),
    ],
  },
  {
    key: 'tradeItems',
    table: 'trade_items',
    hasId: true,
    fields: [
      f('tradeId', 'trade_id', 'integer', { required: true }),
      f('side', 'side', 'text', { required: true }),
      f('cardId', 'card_id', 'text', { default: null }),
      f('cardName', 'card_name', 'text', { required: true }),
      f('setCode', 'set_code', 'text', { default: null }),
      f('collectorNumber', 'collector_number', 'text', { default: null }),
      f('foil', 'foil', 'integer', { default: 0 }),
      f('condition', 'condition', 'text', { default: null }),
      f('quantity', 'quantity', 'integer', { default: 1 }),
      f('price', 'price', 'real', { default: null }),
      f('locationId', 'location_id', 'integer', { default: null }),
      f('destinationId', 'destination_id', 'integer', { default: null }),
    ],
  },
  {
    key: 'movementHistory',
    table: 'movement_history',
    hasId: true,
    fields: [
      f('itemId', 'item_id', 'integer', { default: null }),
      f('cardId', 'card_id', 'text', { default: null }),
      f('cardName', 'card_name', 'text', { default: null }),
      f('action', 'action', 'text', { required: true }),
      f('fromLocationId', 'from_location_id', 'integer', { default: null }),
      f('toLocationId', 'to_location_id', 'integer', { default: null }),
      f('quantity', 'quantity', 'integer', { default: 1 }),
      f('details', 'details', 'text', { default: null }),
      f('undone', 'undone', 'integer', { default: 0 }),
    ],
  },
];

export const IMPORT_ENTITY_MAP: Record<string, ImportEntity> = Object.fromEntries(
  IMPORT_ENTITIES.map(e => [e.key, e]),
);
