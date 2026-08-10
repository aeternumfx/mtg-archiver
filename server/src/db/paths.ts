import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, '../../../data');

fs.mkdirSync(dataDir, { recursive: true });

export const systemDbPath = path.join(dataDir, 'system.db');
export const usersDir = path.join(dataDir, 'users');
export const imagesDir = path.join(dataDir, 'images');
export const scryfallDownloadPath = path.join(dataDir, 'scryfall_download.jsonl.gz');

export const userDbPath = (userId: number) => path.join(usersDir, `user_${userId}.db`);
