import type { Database as DatabaseType } from 'better-sqlite3';
import { IMPORT_ENTITIES, IMPORT_ENTITY_MAP, type ImportEntity, type ImportFieldType } from './importSchema';

export interface MissingField {
  field: string;
  type: ImportFieldType;
  suggested: unknown;
  required: boolean;
}

export interface CollectionDiff {
  present: boolean;
  count: number;
  missing: MissingField[];
  extra: string[];
}

export interface ImportDiffReport {
  version: number | null;
  exportedAt: string | null;
  unknownCollections: string[];
  collections: Record<string, CollectionDiff>;
  totalMissing: number;
  totalExtra: number;
}

export interface ImportOptions {
  collections?: string[];
  missingDefaults?: Record<string, Record<string, unknown>>;
  dropExtra?: boolean | string[];
}

const STRUCTURAL_KEYS = new Set(['id', 'createdAt', 'updatedAt']);
const METADATA_KEYS = new Set(['version', 'exportedAt']);

export function computeImportDiff(data: any): ImportDiffReport {
  const source = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const report: ImportDiffReport = {
    version: typeof source.version === 'number' ? source.version : null,
    exportedAt: typeof source.exportedAt === 'string' ? source.exportedAt : null,
    unknownCollections: [],
    collections: {},
    totalMissing: 0,
    totalExtra: 0,
  };

  for (const key of Object.keys(source)) {
    if (!IMPORT_ENTITY_MAP[key] && !METADATA_KEYS.has(key)) report.unknownCollections.push(key);
  }

  for (const entity of IMPORT_ENTITIES) {
    const present = Array.isArray(source[entity.key]);
    const rows = present ? source[entity.key] : [];
    const presentFields = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      for (const [k, v] of Object.entries(row)) {
        if (v !== undefined) presentFields.add(k);
      }
    }
    const missing = rows.length > 0
      ? entity.fields
          .filter(fd => !presentFields.has(fd.name))
          .map(fd => ({
            field: fd.name,
            type: fd.type,
            suggested: fd.default ?? null,
            required: !!fd.required,
          }))
      : [];
    const extra = [...presentFields].filter(
      fd => !entity.fields.some(e => e.name === fd) && !STRUCTURAL_KEYS.has(fd),
    );
    report.collections[entity.key] = {
      present,
      count: rows.length,
      missing,
      extra,
    };
    report.totalMissing += missing.length;
    report.totalExtra += extra.length;
  }

  return report;
}

export function resolveImportData(data: any, options?: ImportOptions): any {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const opts = options ?? {};
  const dropAll = opts.dropExtra === true;
  const dropSet = new Set<string>(Array.isArray(opts.dropExtra) ? opts.dropExtra : []);
  const collections = opts.collections && opts.collections.length > 0
    ? new Set(opts.collections)
    : null;

  for (const entity of IMPORT_ENTITIES) {
    if (!Array.isArray(data[entity.key])) continue;
    if (collections && !collections.has(entity.key)) {
      delete data[entity.key];
      continue;
    }
    const defaults = opts.missingDefaults?.[entity.key] ?? {};
    const expected = new Set(entity.fields.map(fd => fd.name));
    for (const row of data[entity.key]) {
      if (!row || typeof row !== 'object') continue;
      for (const fd of entity.fields) {
        if (row[fd.name] === undefined) {
          row[fd.name] = defaults[fd.name] !== undefined ? defaults[fd.name] : (fd.default ?? null);
        }
      }
      for (const k of Object.keys(row)) {
        if (expected.has(k)) continue;
        if (STRUCTURAL_KEYS.has(k)) continue;
        if (dropAll || dropSet.has(`${entity.key}.${k}`)) delete row[k];
      }
    }
  }
  return data;
}

const REMAP_MAPS: Record<string, { map: (m: ImportMaps) => Map<number, number>; fallbackNull: boolean }> = {
  groupId: { map: m => m.groupIdMap, fallbackNull: true },
  locationId: { map: m => m.locationIdMap, fallbackNull: false },
  destinationId: { map: m => m.locationIdMap, fallbackNull: false },
  collectionGoalId: { map: m => m.goalIdMap, fallbackNull: false },
};

interface ImportMaps {
  groupIdMap: Map<number, number>;
  locationIdMap: Map<number, number>;
  goalIdMap: Map<number, number>;
}

export function runImport(sqlite: DatabaseType, data: any, mode: 'merge' | 'replace') {
  const maps: ImportMaps = {
    groupIdMap: new Map<number, number>(),
    locationIdMap: new Map<number, number>(),
    goalIdMap: new Map<number, number>(),
  };

  for (const entity of IMPORT_ENTITIES) {
    const rows = Array.isArray(data[entity.key]) ? data[entity.key] : [];
    if (rows.length === 0) continue;

    const idMapFor = (key: string) => (key === 'locationGroups' ? maps.groupIdMap : maps.locationIdMap);

    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;

      for (const remapKey of entity.remap ?? []) {
        const v = row[remapKey];
        if (v == null) continue;
        const { map: getMap, fallbackNull } = REMAP_MAPS[remapKey];
        const mapped = getMap(maps).get(Number(v));
        if (mapped !== undefined) row[remapKey] = mapped;
        else if (fallbackNull) row[remapKey] = null;
      }

      const cols: string[] = [];
      const vals: unknown[] = [];
      if (entity.hasId && (mode === 'replace' || !entity.byName)) {
        cols.push('id');
        vals.push(row.id ?? null);
      }
      for (const fd of entity.fields) {
        if (row[fd.name] !== undefined) {
          cols.push(fd.column);
          vals.push(row[fd.name]);
        }
      }
      if (cols.length === 0) continue;
      const placeholders = vals.map(() => '?').join(', ');

      try {
        if (entity.byName) {
          if (mode === 'replace') {
            sqlite.prepare(`INSERT INTO ${entity.table} (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals);
            if (row.id != null) idMapFor(entity.key).set(Number(row.id), Number(row.id));
          } else {
            const existing = sqlite.prepare(`SELECT id FROM ${entity.table} WHERE name = ?`).get(row.name) as { id: number } | undefined;
            if (existing) {
              if (row.id != null) idMapFor(entity.key).set(Number(row.id), existing.id);
            } else {
              const result = sqlite.prepare(`INSERT INTO ${entity.table} (${cols.join(', ')}) VALUES (${placeholders}) RETURNING id`).get(...vals) as { id: number };
              if (row.id != null) idMapFor(entity.key).set(Number(row.id), result.id);
            }
          }
        } else if (entity.hasId) {
          sqlite.prepare(`INSERT OR IGNORE INTO ${entity.table} (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals);
        } else {
          sqlite.prepare(`INSERT INTO ${entity.table} (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals);
        }
      } catch {
        /* skip rows that violate constraints (duplicates, dangling refs) */
      }
    }
  }
}

export type { ImportEntity };
