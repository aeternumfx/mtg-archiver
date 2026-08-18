import fs from 'fs';
import path from 'path';
import { imagesDir } from '../db/paths';
import { cardById } from './cards';
import { recordCall } from './apiCalls';

fs.mkdirSync(imagesDir, { recursive: true });

const MAX_CONCURRENT = 10;
let active = 0;
const queue: Array<() => void> = [];
const inflight = new Map<string, Promise<Buffer | null>>();

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

const VALID_SIZES = new Set(['small', 'normal', 'large', 'png', 'art_crop', 'border_crop']);

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise(resolve => {
    queue.push(() => {
      active++;
      resolve();
    });
  });
}

function release() {
  active = Math.max(0, active - 1);
  const next = queue.shift();
  if (next) next();
}

async function doFetch(url: string): Promise<Buffer | null> {
  await acquire();
  try {
    recordCall('images');
    const res = await fetch(url, {
      headers: { 'User-Agent': 'MTG-Archiver/1.0' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  } finally {
    release();
  }
}

function fetchImage(url: string): Promise<Buffer | null> {
  const existing = inflight.get(url);
  if (existing) return existing;
  const p = doFetch(url).finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}

export interface ResolvedImage {
  file: string;
  contentType: string;
}

export function clearImageCache() {
  if (!fs.existsSync(imagesDir)) return;
  for (const f of fs.readdirSync(imagesDir)) {
    try {
      fs.rmSync(path.join(imagesDir, f), { force: true });
    } catch { /* ignore */ }
  }
}

export async function resolveImage(cardId: string, size: string, faceIdx?: number): Promise<ResolvedImage | null> {
  if (!VALID_SIZES.has(size)) return null;
  const card = cardById(cardId);
  if (!card) return null;

  let url: string | undefined;
  let cacheTag = '';

  if (faceIdx !== undefined) {
    if (!card.cardFaces) return null;
    let faces: Array<{ image_uris?: Record<string, string> }>;
    try {
      faces = JSON.parse(card.cardFaces);
    } catch {
      return null;
    }
    const face = faces[faceIdx];
    if (!face?.image_uris) return null;
    // Art cards are double-sided cards where the back face (index 1) is the
    // actual art-card back. Scryfall's bulk data stores a placeholder for the
    // back's small/normal/large images, but the display size holds the real
    // portrait back design. Serve that instead so the back displays properly.
    if (card.layout === 'art_series' && faceIdx > 0) {
      url = face.image_uris.display || face.image_uris.art_crop || face.image_uris[size];
      cacheTag = 'artback';
    } else {
      url = face.image_uris[size];
    }
  } else {
    if (!card.imageUris) return null;
    let uris: Record<string, string>;
    try {
      uris = JSON.parse(card.imageUris);
    } catch {
      return null;
    }
    url = uris[size];
  }
  if (!url) return null;

  const extMatch = url.match(/\.([a-z0-9]+)(\?|$)/i);
  const ext = extMatch ? extMatch[1]!.toLowerCase() : 'png';
  const facePart = faceIdx !== undefined ? `-f${faceIdx}` : '';
  const file = path.join(imagesDir, `${cardId}-${cacheTag || size}${facePart}.${ext}`);

  if (fs.existsSync(file)) {
    return { file, contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream' };
  }

  const buf = await fetchImage(url);
  if (!buf) return null;
  try {
    fs.writeFileSync(file, buf);
  } catch {
    return null;
  }
  return { file, contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream' };
}
