import { execFile } from 'child_process';
import fs from 'fs';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const IMAGE = 'aeternumfx/mtg-archiver';
const GITHUB_RELEASES_URL = 'https://github.com/aeternumfx/mtg-archiver/releases';
const CHECK_TTL_MS = 10 * 60 * 1000;

export interface UpdateCheck {
  checkedAt: number;
  version: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  latestUrl: string | null;
  releaseNotes: string | null;
}

let cached: UpdateCheck | null = null;

export function appVersion(): string {
  return process.env.APP_VERSION || 'dev';
}

function normalize(v: string): string {
  return String(v).replace(/^v/i, '');
}

function semverCompare(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10));
  const pb = b.split('.').map(n => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function autoUpdateAvailable(): boolean {
  if (process.env.ENABLE_IN_APP_UPDATE !== 'true') return false;
  const socket = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
  const compose = process.env.UPDATE_COMPOSE_PATH || '/app/compose/docker-compose.yml';
  return fs.existsSync(socket) && fs.existsSync(compose);
}

export async function checkForUpdates(force = false): Promise<UpdateCheck> {
  const now = Date.now();
  if (!force && cached && now - cached.checkedAt < CHECK_TTL_MS) return cached;

  const base: UpdateCheck = {
    checkedAt: now,
    version: appVersion(),
    latestVersion: null,
    updateAvailable: false,
    latestUrl: GITHUB_RELEASES_URL,
    releaseNotes: null,
  };

  try {
    const res = await fetch(`https://hub.docker.com/v2/repositories/${IMAGE}/tags/?page_size=100`, {
      headers: { 'User-Agent': 'MTG-Archiver/1.0' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Docker Hub returned ${res.status}`);
    const data = await res.json() as { results?: Array<{ name?: string }> };
    const tags = (data.results || []).map(t => t.name || '').filter(Boolean);
    const versionTags = tags.map(normalize).filter(t => /^\d+\.\d+\.\d+$/.test(t));
    let latest: string | null = null;
    for (const t of versionTags) {
      if (!latest || semverCompare(t, latest) > 0) latest = t;
    }
    base.latestVersion = latest;
    base.updateAvailable = !!(latest && latest !== normalize(appVersion()) && appVersion() !== 'dev');
  } catch {
    // offline / rate-limited — leave updateAvailable false
  }

  cached = base;
  return base;
}

export async function runAutoUpdate(): Promise<void> {
  const socket = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
  const compose = process.env.UPDATE_COMPOSE_PATH || '/app/compose/docker-compose.yml';
  if (!autoUpdateAvailable()) {
    throw new Error('In-app auto-update is not enabled. Run the update script on the host instead.');
  }

  const args = ['compose', '-f', compose, 'pull'];
  const { stdout: pullOut } = await execFileAsync('docker', args, { env: { ...process.env, DOCKER_HOST: `unix://${socket}` }, timeout: 15 * 60 * 1000 });
  console.log('[update] pull:', pullOut);

  const upArgs = ['compose', '-f', compose, 'up', '-d', '--remove-orphans'];
  const { stdout: upOut } = await execFileAsync('docker', upArgs, { env: { ...process.env, DOCKER_HOST: `unix://${socket}` }, timeout: 15 * 60 * 1000 });
  console.log('[update] up:', upOut);
}
