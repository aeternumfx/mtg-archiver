import { systemSqlite } from '../db/system';

const COUNTER_KEY = 'api_call_counts';

export interface CallCounts {
  scryfall: number;
  images: number;
}

function readCounts(): CallCounts {
  const row = systemSqlite.prepare("SELECT value FROM sync_meta WHERE key = ?").get(COUNTER_KEY) as { value: string } | undefined;
  if (!row) return { scryfall: 0, images: 0 };
  try {
    const parsed = JSON.parse(row.value);
    return {
      scryfall: Number(parsed.scryfall) || 0,
      images: Number(parsed.images) || 0,
    };
  } catch {
    return { scryfall: 0, images: 0 };
  }
}

function persist(counts: CallCounts) {
  systemSqlite.prepare('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)')
    .run(COUNTER_KEY, JSON.stringify(counts));
}

export function recordCall(kind: 'scryfall' | 'images') {
  const counts = readCounts();
  counts[kind] += 1;
  persist(counts);
}

export function getCallCounts(): CallCounts {
  return readCounts();
}
