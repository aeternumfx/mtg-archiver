import { Router } from 'express';
import { sqlite } from '../db';
import { resetToSetup } from './data';

export const setupRouter = Router();

setupRouter.get('/', (_req, res) => {
  const mode = (sqlite.prepare("SELECT value FROM sync_meta WHERE key = 'setup_mode'").get() as { value: string } | undefined)?.value ?? null;
  const done = ((sqlite.prepare("SELECT value FROM sync_meta WHERE key = 'setup_done'").get() as { value: string } | undefined)?.value ?? '0') === '1';
  res.json({ mode, done });
});

setupRouter.post('/', (req, res) => {
  const { mode, done } = req.body;
  try {
    if (mode === 'demo' || mode === 'recommended') {
      resetToSetup(mode);
    }
    if (mode) {
      sqlite.prepare('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)').run('setup_mode', mode);
    }
    if (done !== undefined) {
      sqlite.prepare('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)').run('setup_done', done ? '1' : '0');
    }
    res.json({ ok: true, mode: mode ?? null, done: done ?? false });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
