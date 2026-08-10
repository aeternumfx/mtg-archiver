import { startSync, initScryfallSync, getSyncStatus, syncSets } from '../services/scryfall';
import { getSystemSettings } from '../services/systemSettings';

interface Job {
  name: string;
  /** Returns true if the job should run now. */
  due: () => boolean;
  /** Runs the job. Must handle its own single-flight guard. */
  run: () => Promise<void>;
}

const jobs: Job[] = [];
const timers: Array<NodeJS.Timeout> = [];

let lastSetsSync = 0;

export function getSchedulerStatus() {
  const settings = getSystemSettings();
  return {
    ...getSyncStatus(),
    jobs: jobs.map(j => j.name),
    scryfallStaleHours: settings.scryfallStaleHours,
    setsRefreshHours: settings.setsRefreshHours,
  };
}

const scryfallJob: Job = {
  name: 'scryfall-sync',
  due: () => {
    const status = getSyncStatus();
    if (status.syncing) return false;
    if (!status.lastSync) return true;
    const staleMs = getSystemSettings().scryfallStaleHours * 60 * 60 * 1000;
    return Date.now() - new Date(status.lastSync).getTime() > staleMs;
  },
  run: async () => {
    try {
      await startSync();
    } catch (err) {
      console.error('Scheduled Scryfall sync failed:', err);
    }
  },
};

const setsJob: Job = {
  name: 'scryfall-sets',
  due: () => {
    const intervalMs = getSystemSettings().setsRefreshHours * 60 * 60 * 1000;
    return Date.now() - lastSetsSync >= intervalMs;
  },
  run: async () => {
    lastSetsSync = Date.now();
    try {
      await syncSets();
    } catch (err) {
      console.error('Scheduled sets refresh failed:', err);
    }
  },
};

jobs.push(scryfallJob, setsJob);

function tick() {
  for (const job of jobs) {
    try {
      if (job.due()) {
        job.run();
      }
    } catch (err) {
      console.error(`Scheduler job "${job.name}" errored:`, err);
    }
  }
}

export async function initScheduler() {
  await initScryfallSync();
  // Re-check on an interval so a failed/never-run sync eventually retries.
  timers.push(setInterval(tick, 60 * 1000));
  // Immediate first tick after startup.
  setTimeout(tick, 5_000);
}

export function stopScheduler() {
  for (const t of timers) clearInterval(t);
  timers.length = 0;
}
