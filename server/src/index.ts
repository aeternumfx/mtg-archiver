import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import { initDb } from './db/init';
import { requireAuth, requireUser, requireAdmin } from './auth/middleware';
import type { AuthenticatedRequest } from './auth/middleware';
import { bootstrapAdmin } from './auth/bootstrap';
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
import { authRouter } from './routes/auth';
import { adminRouter } from './routes/admin';
import { imagesRouter } from './routes/images';
import { requestsRouter, adminRequestsRouter } from './routes/requests';
import { initScheduler, getSchedulerStatus } from './scheduler';
import { logActivity } from './services/activityLog';
import { getSystemSettings } from './services/systemSettings';
import { isInstanceSetupDone } from './services/setupStatus';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https://cards.scryfall.io', 'https://*.scryfall.com'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
    },
  },
}));

const allowedOrigin = process.env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean) ?? [];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigin.length === 0 || allowedOrigin.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));

app.use((req, res, next) => {
  res.on('finish', () => {
    try {
      const url = req.originalUrl || req.url;
      if (url.startsWith('/api/') && !url.startsWith('/api/admin/feed')) {
        logActivity({
          username: (req as AuthenticatedRequest).user?.username ?? null,
          method: req.method,
          path: url.split('?')[0],
          status: res.statusCode,
        });
      }
    } catch { /* never let logging break a request */ }
  });
  next();
});

app.use('/api/auth', authRouter);

app.get('/api/meta', (_req, res) => {
  const s = getSystemSettings();
  res.json({
    instanceName: s.instanceName,
    adminContactName: s.adminContactName,
    adminContactEmail: s.adminContactEmail,
    version: process.env.APP_VERSION || 'dev',
    instanceSetupDone: isInstanceSetupDone(),
  });
});

app.get('/api/sync-status', requireAuth, (_req, res) => {
  res.json(getSchedulerStatus());
});

app.post('/api/sync', requireAdmin, async (_req, res) => {
  try {
    const status = getSchedulerStatus();
    if (status.syncing) return res.status(400).json({ error: 'Sync already in progress' });
    res.json({ message: 'Sync started' });
    import('./services/scryfall').then(({ startSync }) => {
      startSync().catch(err => console.error('Manual sync failed:', err));
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/api/images', requireAuth, imagesRouter);
app.use('/api/admin', adminRouter);
app.use('/api/admin/requests', adminRequestsRouter);
app.use('/api/requests', requestsRouter);
app.use('/api/locations', requireUser, locationsRouter);
app.use('/api/location-groups', requireUser, locationGroupsRouter);
app.use('/api/cards', requireAuth, cardsRouter);
app.use('/api/collection', requireUser, collectionRouter);
app.use('/api/dashboard', requireUser, dashboardRouter);
app.use('/api/data', requireUser, dataRouter);
app.use('/api/booster', requireUser, boosterRouter);
app.use('/api/decks', requireUser, decksRouter);
app.use('/api/wantlist', requireUser, wantlistRouter);
app.use('/api/trades', requireUser, tradesRouter);
app.use('/api/organize', requireUser, organizeRouter);
app.use('/api/collection-goals', requireUser, collectionGoalsRouter);
app.use('/api/setup', requireUser, setupRouter);

const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(path.join(clientDist, 'index.html'))) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

initDb();
bootstrapAdmin();
initScheduler().then(() => {
  console.log('Startup sync check complete');
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
