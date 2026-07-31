import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initDb } from './db/init';
import { locationsRouter } from './routes/locations';
import { locationGroupsRouter } from './routes/locationGroups';
import { cardsRouter } from './routes/cards';
import { collectionRouter } from './routes/collection';
import { dashboardRouter } from './routes/dashboard';
import { dataRouter } from './routes/data';
import { boosterRouter } from './routes/booster';
import { decksRouter } from './routes/decks';
import { wantlistRouter } from './routes/wantlist';
import { tradesRouter } from './routes/trades';
import { organizeRouter } from './routes/organize';
import { collectionGoalsRouter } from './routes/collectionGoals';
import { setupRouter } from './routes/setup';
import { initScryfallSync, getSyncStatus, startSync } from './services/scryfall';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.use('/api/locations', locationsRouter);
app.use('/api/location-groups', locationGroupsRouter);
app.use('/api/cards', cardsRouter);
app.use('/api/collection', collectionRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/data', dataRouter);
app.use('/api/booster', boosterRouter);
app.use('/api/decks', decksRouter);
app.use('/api/wantlist', wantlistRouter);
app.use('/api/trades', tradesRouter);
app.use('/api/organize', organizeRouter);
app.use('/api/collection-goals', collectionGoalsRouter);
app.use('/api/setup', setupRouter);

app.get('/api/sync-status', (_req, res) => {
  res.json(getSyncStatus());
});

app.post('/api/sync', async (_req, res) => {
  try {
    const status = getSyncStatus();
    if (status.syncing) return res.status(400).json({ error: 'Sync already in progress' });
    res.json({ message: 'Sync started' });
    startSync().catch(err => console.error('Manual sync failed:', err));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

initDb();
initScryfallSync().then(() => {
  console.log('Startup sync check complete');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
