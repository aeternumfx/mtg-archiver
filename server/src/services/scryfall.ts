import { catalogDb, catalogSqlite, schema } from '../db';
import { eq, sql } from 'drizzle-orm';
import { recordCall } from './apiCalls';
import { clearCheapestCache } from './cards';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, '../../../data');
fs.mkdirSync(dataDir, { recursive: true });

let syncing = false;
let lastSync: string | null = null;
let progress: number | null = null;
let stage: string | null = null;

export function getSyncStatus() {
  return { syncing, lastSync, progress, stage };
}

async function getLastSyncFromDb(): Promise<string | null> {
  try {
    const row = catalogDb.select().from(schema.syncMeta).where(eq(schema.syncMeta.key, 'last_sync')).get();
    return row?.value ?? null;
  } catch {
    return null;
  }
}

async function setLastSync(date: string) {
  catalogDb.insert(schema.syncMeta)
    .values({ key: 'last_sync', value: date })
    .onConflictDoUpdate({ target: schema.syncMeta.key, set: { value: date } })
    .run();
}

const BOOSTER_SET_TYPES = new Set(['core', 'expansion', 'draft_innovation', 'masters', 'starter']);

export async function syncSets(): Promise<void> {
  try {
    recordCall('scryfall');
    const res = await fetch('https://api.scryfall.com/sets', {
      headers: { 'User-Agent': 'MTG-Archiver/1.0' },
    });
    if (!res.ok) throw new Error(`Failed to fetch sets: ${res.status}`);
    const body = await res.json() as { data: Array<{ code: string; name: string; set_type: string; released_at?: string; updated_at?: string }> };

    const insertSet = catalogSqlite.prepare(`INSERT OR REPLACE INTO sets (code, name, set_type, has_boosters, released_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`);

    catalogSqlite.transaction(() => {
      for (const s of body.data) {
        insertSet.run(s.code, s.name, s.set_type, BOOSTER_SET_TYPES.has(s.set_type) ? 1 : 0, s.released_at ?? null, s.updated_at ?? null);
      }
    })();

    console.log(`Synced ${body.data.length} sets from Scryfall`);
  } catch (err) {
    console.error('Failed to sync sets:', err);
  }
}

interface BulkDataEntry {
  type: string;
  jsonl_download_uri: string;
  compressed_size: number;
  updated_at: string;
}

interface ScryfallCard {
  id: string;
  name: string;
  set_name: string;
  set: string;
  collector_number: string;
  rarity?: string;
  mana_cost?: string;
  cmc?: number;
  type_line?: string;
  oracle_text?: string;
  colors?: string[];
  color_identity?: string[];
  image_uris?: Record<string, string>;
  card_faces?: Array<{ image_uris?: Record<string, string> }>;
  prices?: Record<string, string | null>;
  power?: string;
  toughness?: string;
  loyalty?: string;
  legalities?: Record<string, string>;
  released_at?: string;
  layout?: string;
  updated_at?: string;
  promo?: boolean;
  seriealized?: boolean;
  full_art?: boolean;
  textless?: boolean;
  finishes?: string[];
  frame_effects?: string[];
}

async function fetchBulkDataInfo(): Promise<BulkDataEntry | null> {
  recordCall('scryfall');
  const res = await fetch('https://api.scryfall.com/bulk-data', {
    headers: { 'User-Agent': 'MTG-Archiver/1.0' },
  });
  if (!res.ok) throw new Error(`Failed to fetch bulk data info: ${res.status}`);
  const body = await res.json() as { data: BulkDataEntry[] };
  return body.data.find(e => e.type === 'default_cards') ?? null;
}

function processBatch(cards: ScryfallCard[]) {
  const values = cards.map(c => ({
    id: c.id,
    name: c.name,
    setName: c.set_name,
    setCode: c.set,
    collectorNumber: c.collector_number,
    rarity: c.rarity ?? null,
    manaCost: c.mana_cost ?? null,
    cmc: c.cmc ?? null,
    typeLine: c.type_line ?? null,
    oracleText: c.oracle_text ?? null,
    colors: c.colors ? JSON.stringify(c.colors) : null,
    colorIdentity: c.color_identity ? JSON.stringify(c.color_identity) : null,
    imageUris: c.image_uris ? JSON.stringify(c.image_uris) : null,
    prices: c.prices ? JSON.stringify(c.prices) : null,
    power: c.power ?? null,
    toughness: c.toughness ?? null,
    loyalty: c.loyalty ?? null,
    legalities: c.legalities ? JSON.stringify(c.legalities) : null,
    releasedAt: c.released_at ?? null,
    layout: c.layout ?? null,
    updatedAt: c.updated_at ?? new Date().toISOString(),
    promo: c.promo ? 1 : 0,
    seriealized: c.seriealized ? 1 : 0,
    fullArt: c.full_art ? 1 : 0,
    textless: c.textless ? 1 : 0,
    finishes: c.finishes ? JSON.stringify(c.finishes) : null,
    frameEffects: c.frame_effects ? JSON.stringify(c.frame_effects) : null,
    cardFaces: c.card_faces ? JSON.stringify(c.card_faces) : null,
  }));

  catalogDb.insert(schema.scryfallCards)
    .values(values)
    .onConflictDoUpdate({
      target: schema.scryfallCards.id,
      set: {
        name: sql`excluded.name`,
        setName: sql`excluded.set_name`,
        setCode: sql`excluded.set_code`,
        collectorNumber: sql`excluded.collector_number`,
        rarity: sql`excluded.rarity`,
        manaCost: sql`excluded.mana_cost`,
        cmc: sql`excluded.cmc`,
        typeLine: sql`excluded.type_line`,
        oracleText: sql`excluded.oracle_text`,
        colors: sql`excluded.colors`,
        colorIdentity: sql`excluded.color_identity`,
        imageUris: sql`excluded.image_uris`,
        prices: sql`excluded.prices`,
        power: sql`excluded.power`,
        toughness: sql`excluded.toughness`,
        loyalty: sql`excluded.loyalty`,
        legalities: sql`excluded.legalities`,
        releasedAt: sql`excluded.released_at`,
        layout: sql`excluded.layout`,
        updatedAt: sql`excluded.updated_at`,
        promo: sql`excluded.promo`,
        seriealized: sql`excluded.seriealized`,
        fullArt: sql`excluded.full_art`,
        textless: sql`excluded.textless`,
        finishes: sql`excluded.finishes`,
        frameEffects: sql`excluded.frame_effects`,
        cardFaces: sql`excluded.card_faces`,
      },
    })
    .run();
}

async function downloadAndSync(downloadUri: string, compressedSize: number): Promise<void> {
  syncing = true;
  progress = 0;
  stage = 'Starting sync...';

  const tempFile = path.join(dataDir, 'scryfall_download.jsonl.gz');

  try {
    stage = 'Downloading bulk data from Scryfall...';

    let bytesRead = 0;

    recordCall('scryfall');
    const res = await fetch(downloadUri, {
      headers: {
        'User-Agent': 'MTG-Archiver/1.0',
      },
      signal: AbortSignal.timeout(900_000),
    });
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);

    const reader = res.body!.getReader();
    const fileStream = fs.createWriteStream(tempFile);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.length;
      const canContinue = fileStream.write(Buffer.from(value));
      progress = Math.min(50, Math.round((bytesRead / compressedSize) * 50));
      if (!canContinue) {
        await new Promise<void>(resolve => fileStream.once('drain', resolve));
      }
    }

    await new Promise<void>(resolve => fileStream.end(resolve));

    const dlSize = fs.statSync(tempFile).size;
    console.log(`Downloaded ${Math.round(dlSize / 1024 / 1024)} MB to disk`);
    if (dlSize < 50 * 1024 * 1024) {
      throw new Error(`Download too small (${Math.round(dlSize / 1024 / 1024)} MB)`);
    }

    console.log('Download complete, processing...');
    stage = 'Processing card data...';
    const batch: ScryfallCard[] = [];
    let totalProcessed = 0;

    const expectedTotalCards = 35000;

    await new Promise<void>((resolve, reject) => {
      const readStream = fs.createReadStream(tempFile);
      const gunzip = zlib.createGunzip();
      const rl = readline.createInterface({ input: readStream.pipe(gunzip), crlfDelay: Infinity });

      rl.on('line', (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
          const card = JSON.parse(trimmed) as ScryfallCard;
          if (card.name) {
            batch.push(card);
          }
        } catch {
          /* skip malformed lines */
        }

        if (batch.length >= 500) {
          rl.pause();
          catalogSqlite.transaction(() => processBatch(batch.splice(0)))();
          totalProcessed += 500;
          progress = Math.min(95, 50 + Math.round((totalProcessed / expectedTotalCards) * 45));
          stage = `Processing cards... ${totalProcessed.toLocaleString()} done`;
          rl.resume();
        }
      });

      rl.on('close', () => {
        if (batch.length > 0) {
          catalogSqlite.transaction(() => processBatch(batch.splice(0)))();
          totalProcessed += batch.length;
        }
        stage = `Processing complete: ${totalProcessed.toLocaleString()} cards`;
        console.log(`Processing complete: ${totalProcessed} cards`);
        resolve();
      });

      rl.on('error', reject);
      gunzip.on('error', reject);
      readStream.on('error', reject);
    });

    fs.unlinkSync(tempFile);

    const now = new Date().toISOString();
    await setLastSync(now);
    lastSync = now;
    progress = 100;
    await syncSets();
    stage = 'Sync complete!';
    clearCheapestCache();

    console.log(`Sync complete: ${totalProcessed} cards processed`);
  } catch (err) {
    console.error('Scryfall sync failed:', err);
    stage = 'Sync failed';
    throw err;
  } finally {
    syncing = false;
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  }
}

export async function startSync(): Promise<void> {
  if (syncing) throw new Error('Sync already in progress');
  syncing = true;
  progress = 0;
  stage = 'Fetching bulk data info from Scryfall...';
  try {
    const info = await fetchBulkDataInfo();
    if (!info) throw new Error('Could not find default_cards bulk data');
    await downloadAndSync(info.jsonl_download_uri, info.compressed_size);
  } catch (err) {
    stage = 'Sync failed';
    syncing = false;
    throw err;
  }
}

export async function initScryfallSync() {
  lastSync = await getLastSyncFromDb();

  const shouldSync = !lastSync || (Date.now() - new Date(lastSync).getTime() > 24 * 60 * 60 * 1000);

  if (!shouldSync) {
    console.log(`Scryfall data up to date (last sync: ${lastSync})`);
    await syncSets();
    return;
  }

  console.log('Scryfall data stale, starting sync...');

  try {
    await startSync();
  } catch (err) {
    console.error('Scryfall sync failed, will retry on next restart:', err);
  }
}
