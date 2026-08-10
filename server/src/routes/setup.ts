import { fail } from '../utils/http';
import { Router } from 'express';
import { catalogSqlite, getSessionContext } from '../db';
import { resetToSetup } from './data';

export const setupRouter = Router();

const key = (k: string, uid: number | undefined) => `${k}:${uid ?? 'anon'}`;

setupRouter.get('/', (_req, res) => {
  const uid = getSessionContext()?.userId;
  const mode = (catalogSqlite.prepare("SELECT value FROM sync_meta WHERE key = ?").get(key('setup_mode', uid)) as { value: string } | undefined)?.value ?? null;
  const done = ((catalogSqlite.prepare("SELECT value FROM sync_meta WHERE key = ?").get(key('setup_done', uid)) as { value: string } | undefined)?.value ?? '0') === '1';
  res.json({ mode, done });
});

setupRouter.post('/', (req, res) => {
  const { mode, done } = req.body;
  const uid = getSessionContext()?.userId;
  try {
    if (mode === 'recommended') {
      resetToSetup(mode);
    }
    if (mode) {
      catalogSqlite.prepare('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)').run(key('setup_mode', uid), mode);
    }
    if (done !== undefined) {
      catalogSqlite.prepare('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)').run(key('setup_done', uid), done ? '1' : '0');
    }
    res.json({ ok: true, mode: mode ?? null, done: done ?? false });
  } catch (err: any) {
    fail(res, err);
  }
});
