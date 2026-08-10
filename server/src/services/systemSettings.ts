import { systemSqlite } from '../db/system';

export interface SystemSettings {
  /** Full Scryfall catalog re-sync threshold, in hours. */
  scryfallStaleHours: number;
  /** How often the lightweight sets list refreshes, in hours. */
  setsRefreshHours: number;
  /** Session lifetime, in days. Applies to new sessions. */
  sessionTtlDays: number;
  /** Display name for this instance (landing page / login). */
  instanceName: string;
  /** Domain the instance is hosted on (used for share links). */
  domain: string;
  /** Contact name for the system administrator. */
  adminContactName: string;
  /** Contact email for the system administrator. */
  adminContactEmail: string;
}

const SETTINGS_KEY = 'system_settings';

function defaults(): SystemSettings {
  return {
    scryfallStaleHours: Math.max(1, Number(process.env.SCRYFALL_STALE_HOURS) || 24),
    setsRefreshHours: 1,
    sessionTtlDays: Math.max(1, Number(process.env.SESSION_TTL_DAYS) || 30),
    instanceName: 'MTG Archiver',
    domain: '',
    adminContactName: '',
    adminContactEmail: '',
  };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function getSystemSettings(): SystemSettings {
  const base = defaults();
  const row = systemSqlite.prepare('SELECT value FROM sync_meta WHERE key = ?').get(SETTINGS_KEY) as { value: string } | undefined;
  if (!row) return base;
  try {
    const stored = JSON.parse(row.value) as Partial<SystemSettings>;
    return {
      scryfallStaleHours: clampInt(stored.scryfallStaleHours, 1, 168, base.scryfallStaleHours),
      setsRefreshHours: clampInt(stored.setsRefreshHours, 1, 24, base.setsRefreshHours),
      sessionTtlDays: clampInt(stored.sessionTtlDays, 1, 365, base.sessionTtlDays),
      instanceName: typeof stored.instanceName === 'string' && stored.instanceName.trim()
        ? stored.instanceName.trim().slice(0, 64)
        : base.instanceName,
      domain: typeof stored.domain === 'string' ? stored.domain.trim().slice(0, 128) : base.domain,
      adminContactName: typeof stored.adminContactName === 'string'
        ? stored.adminContactName.trim().slice(0, 64)
        : base.adminContactName,
      adminContactEmail: typeof stored.adminContactEmail === 'string'
        ? stored.adminContactEmail.trim().slice(0, 128)
        : base.adminContactEmail,
    };
  } catch {
    return base;
  }
}

export function updateSystemSettings(partial: Partial<SystemSettings>): SystemSettings {
  const current = getSystemSettings();
  const next: SystemSettings = {
    scryfallStaleHours: partial.scryfallStaleHours !== undefined
      ? clampInt(partial.scryfallStaleHours, 1, 168, current.scryfallStaleHours)
      : current.scryfallStaleHours,
    setsRefreshHours: partial.setsRefreshHours !== undefined
      ? clampInt(partial.setsRefreshHours, 1, 24, current.setsRefreshHours)
      : current.setsRefreshHours,
    sessionTtlDays: partial.sessionTtlDays !== undefined
      ? clampInt(partial.sessionTtlDays, 1, 365, current.sessionTtlDays)
      : current.sessionTtlDays,
    instanceName: partial.instanceName !== undefined
      ? (typeof partial.instanceName === 'string' && partial.instanceName.trim()
          ? partial.instanceName.trim().slice(0, 64)
          : current.instanceName)
      : current.instanceName,
    domain: partial.domain !== undefined
      ? (typeof partial.domain === 'string' ? partial.domain.trim().slice(0, 128) : current.domain)
      : current.domain,
    adminContactName: partial.adminContactName !== undefined
      ? (typeof partial.adminContactName === 'string'
          ? partial.adminContactName.trim().slice(0, 64)
          : current.adminContactName)
      : current.adminContactName,
    adminContactEmail: partial.adminContactEmail !== undefined
      ? (typeof partial.adminContactEmail === 'string'
          ? partial.adminContactEmail.trim().slice(0, 128)
          : current.adminContactEmail)
      : current.adminContactEmail,
  };
  systemSqlite.prepare('INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)')
    .run(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

export function resetSystemSettings(): SystemSettings {
  systemSqlite.prepare('DELETE FROM sync_meta WHERE key = ?').run(SETTINGS_KEY);
  return defaults();
}
