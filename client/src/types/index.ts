export interface ScryfallCard {
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
  colors: string[] | null;
  colorIdentity: string[] | null;
  imageUris: Record<string, string> | null;
  prices: Record<string, string | null> | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  legalities: Record<string, string> | null;
  releasedAt: string | null;
  layout: string | null;
  updatedAt: string;
  promo?: number;
  seriealized?: number;
  fullArt?: number;
  textless?: number;
  finishes?: string[] | null;
  frameEffects?: string[] | null;
  cardFaces?: Array<{ image_uris?: Record<string, string> }> | null;
}

export interface CardResult {
  id: string;
  name: string;
  setName: string;
  setCode: string;
  collectorNumber: string;
  rarity: string | null;
  manaCost: string | null;
  cmc: number | null;
  typeLine: string | null;
  colors: string[] | null;
  imageUris: Record<string, string> | null;
  prices: Record<string, string | null> | null;
  releasedAt: string | null;
  layout: string | null;
  promo: number;
  seriealized: number;
  fullArt: number;
  textless: number;
  finishes: string[] | null;
  frameEffects: string[] | null;
  cardFaces?: Array<{ image_uris?: Record<string, string> }> | null;
}

export interface GroupedCard {
  id: string;
  name: string;
  typeLine: string | null;
  manaCost: string | null;
  cmc: number | null;
  colors: string[] | null;
  imageUris: Record<string, string> | null;
  cardFaces?: Array<{ image_uris?: Record<string, string> }> | null;
  layout: string | null;
  printings: number;
  firstPrinting: string | null;
  lastPrinting: string | null;
  collectionCount?: number;
}

export interface Location {
  id: number;
  name: string;
  description: string | null;
  type: string;
  createdAt: string;
  cardCount?: number;
  groupId?: number | null;
  builtIn?: number;
  deckId?: number | null;
}

export interface LocationGroup {
  id: number;
  name: string;
  description: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface CollectionItem {
  id: number;
  cardId: string;
  locationId: number;
  destinationId: number | null;
  foil: number;
  foreignLanguage?: number;
  condition: string | null;
  quantity: number;
  purchasePrice: number | null;
  priceAutofilled: number;
  packOpened: number;
  proxy?: number;
  misprint?: number;
  altered?: number;
  notes: string | null;
  acquiredAt: string | null;
  createdAt: string;
  card: {
    id: string;
    name: string;
    setName: string;
    setCode: string;
    collectorNumber: string;
    rarity: string | null;
    manaCost: string | null;
    cmc: number | null;
    typeLine: string | null;
    colorIdentity: string[] | null;
    legalities?: Record<string, string> | null;
    imageUris: Record<string, string> | null;
    prices: Record<string, string | null> | null;
    layout?: string | null;
    cardFaces?: Array<{ image_uris?: Record<string, string> }> | null;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface SyncStatus {
  syncing: boolean;
  lastSync: string | null;
  progress: number | null;
  stage: string | null;
}

export const CONDITIONS = ['M', 'NM', 'LP', 'MP', 'HP', 'Dmg'] as const;
export type Condition = typeof CONDITIONS[number];

export interface MissingField {
  field: string;
  type: 'text' | 'integer' | 'real';
  suggested: unknown;
  required: boolean;
}

export interface CollectionDiff {
  present: boolean;
  count: number;
  missing: MissingField[];
  extra: string[];
}

export interface ImportDiffReport {
  version: number | null;
  exportedAt: string | null;
  unknownCollections: string[];
  collections: Record<string, CollectionDiff>;
  totalMissing: number;
  totalExtra: number;
}

export interface ImportOptions {
  collections?: string[];
  missingDefaults?: Record<string, Record<string, unknown>>;
  dropExtra?: boolean | string[];
}

export interface DbSchemaIssue {
  userId: number;
  username: string;
  version: number;
  tables: Array<{ table: string; extra: string[] }>;
  unknownTables: string[];
  error: string | null;
}

export interface DbSchemaHealth {
  schemaVersion: number;
  issues: DbSchemaIssue[];
}
