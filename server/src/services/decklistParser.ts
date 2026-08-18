export type DeckImportRole = 'commander' | 'partner' | 'background' | null;

export interface DeckImportEntry {
  name: string;
  setCode: string | null;
  collectorNumber: string | null;
  quantity: number;
  tags: string[];
  role: DeckImportRole;
}

// Guards against pathological input: a single absurdly long line, or an
// unreasonable number of lines, could otherwise cause slow parsing/backtracking.
const MAX_LINE_LEN = 10_000;
const MAX_ENTRIES = 20_000;

const NAME_KEYS = new Set(['card', 'name', 'cardname', 'cname']);
const SET_KEYS = new Set(['set', 'setcode', 'edition', 'expansion', 'setname']);
const COLLECTOR_KEYS = new Set(['collector', 'collectornumber', 'cn', 'collectorset', 'collectorno']);
const QTY_KEYS = new Set(['quantity', 'qty', 'count', 'amount', 'copies']);
const TAGS_KEYS = new Set(['tags', 'tag', 'categories', 'category', 'section', 'groups']);

const SECTION_WORDS: Record<string, { role: DeckImportRole }> = {
  commander: { role: 'commander' },
  commanders: { role: 'commander' },
  'command zone': { role: 'commander' },
  czone: { role: 'commander' },
  partner: { role: 'partner' },
  partners: { role: 'partner' },
  background: { role: 'background' },
  backgrounds: { role: 'background' },
  main: { role: null },
  mainboard: { role: null },
  'main board': { role: null },
  deck: { role: null },
  sideboard: { role: null },
  'side board': { role: null },
  sidedeck: { role: null },
  maybeboard: { role: null },
  maybe: { role: null },
  'maybe board': { role: null },
  companion: { role: null },
  companions: { role: null },
};

function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function detectDelimiter(firstLine: string): string {
  let best = ',';
  let bestCount = firstLine.split(',').length;
  for (const d of [';', '\t']) {
    const count = firstLine.split(d).length;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function detectColumns(header: string[]): { nameIndex: number; setIndex?: number; collectorIndex?: number; quantityIndex?: number; tagsIndex?: number } | null {
  const out: { nameIndex?: number; setIndex?: number; collectorIndex?: number; quantityIndex?: number; tagsIndex?: number } = {};
  for (let i = 0; i < header.length; i++) {
    const k = normKey(header[i]);
    if (!k) continue;
    if (out.nameIndex == null && NAME_KEYS.has(k)) { out.nameIndex = i; continue; }
    if (out.setIndex == null && SET_KEYS.has(k)) { out.setIndex = i; continue; }
    if (out.collectorIndex == null && COLLECTOR_KEYS.has(k)) { out.collectorIndex = i; continue; }
    if (out.quantityIndex == null && QTY_KEYS.has(k)) { out.quantityIndex = i; continue; }
    if (out.tagsIndex == null && TAGS_KEYS.has(k)) { out.tagsIndex = i; continue; }
  }
  if (out.nameIndex == null && out.quantityIndex == null) return null;
  return out as { nameIndex: number; setIndex?: number; collectorIndex?: number; quantityIndex?: number; tagsIndex?: number };
}

function looksLikeCsv(text: string): boolean {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  const first = lines[0];
  const delim = detectDelimiter(first);
  if (!first.includes(delim)) return false;
  const cells = splitCsvLine(first, delim).map(c => normKey(c));
  const hasHeaderToken = cells.some(c => NAME_KEYS.has(c) || QTY_KEYS.has(c) || SET_KEYS.has(c) || COLLECTOR_KEYS.has(c) || TAGS_KEYS.has(c));
  if (hasHeaderToken) return true;
  return lines.filter(l => l.includes(delim)).length >= 2;
}

function cleanName(raw: string): string {
  return raw
    .replace(/^\s*(\d+)\s*[xX*×]\s*/, '')
    .replace(/^\s*(\d+)\s+/, '')
    .trim();
}

function roleFromTags(tags: string[]): DeckImportRole {
  for (const tag of tags) {
    const t = tag.toLowerCase();
    if (/^commander(s)?$/.test(t)) return 'commander';
    if (/^partner(s)?$/.test(t)) return 'partner';
    if (/^background(s)?$/.test(t)) return 'background';
  }
  return null;
}

function roleFromCategory(category: string | null): DeckImportRole {
  if (!category) return null;
  const c = category.replace(/\{[^}]*\}/g, '').replace(/[^a-z]/gi, '').toLowerCase();
  if (/^commander(s)?$/.test(c)) return 'commander';
  if (/^partner(s)?$/.test(c)) return 'partner';
  if (/^background(s)?$/.test(c)) return 'background';
  return null;
}

function detectSectionHeader(line: string): { role: DeckImportRole } | null {
  const s = line
    .replace(/^\/\/+/, '')
    .replace(/^#+/, '')
    .replace(/^[\s-]+/, '')
    .replace(/[:,\s]+$/, '');
  const lower = s.toLowerCase().trim();
  if (lower.startsWith('section:')) return { role: null };
  if (SECTION_WORDS[lower] !== undefined) return SECTION_WORDS[lower];
  return null;
}

const QTY_PREFIX_RE = /^\s*\d+\s*[xX*×]?\s*[^\s]/;

/** Parses the Archidekt suffix `(set) collector [category] ^tag,#color^ *F*<ignored>` from a card line. */
function parseArchidektSuffix(rest: string): { name: string; setCode: string | null; collectorNumber: string | null; category: string | null } {
  let s = rest.trim();
  // Strip trailing color tags (^...^) and foil markers — everything after the card is metadata.
  let prev: string;
  do {
    prev = s;
    s = s.replace(/\s*\^[^\^]*\^\s*$/g, '').replace(/\s*\*F\*\s*$/i, '').trim();
  } while (s !== prev && s);
  if (!s) s = prev;

  // Capture the trailing category [..] (may contain nested {..}).
  let category: string | null = null;
  const cat = s.match(/\[([^\]]*)\]\s*$/);
  if (cat) {
    category = cat[1].trim();
    s = s.slice(0, cat.index).trim();
  }

  // Drop a stray trailing "xN" if a leading quantity already consumed one.
  s = s.replace(/\s+[xX]\s*\d+\s*$/, '');

  let setCode: string | null = null;
  let collectorNumber: string | null = null;
  const withSet = s.match(/^(.+?)\s*\(([^)]{1,8})\)\s+([^\s,;]+)\s*$/);
  if (withSet) {
    return { name: withSet[1].trim(), setCode: withSet[2].toUpperCase(), collectorNumber: withSet[3], category };
  }
  const bareNum = s.match(/^(.+?)\s+(\d+)\s*$/);
  if (bareNum) {
    return { name: bareNum[1].trim(), setCode, collectorNumber: bareNum[2], category };
  }
  return { name: s, setCode, collectorNumber, category };
}

export function parseCsv(content: string): DeckImportEntry[] {
  const lines = content.split(/\r?\n/).map(l => l.trimEnd());
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  const first = lines.find(l => l.trim().length > 0);
  if (!first) return [];

  const delim = detectDelimiter(first);
  const rows: string[][] = [];
  for (const line of lines) {
    if (line.trim()) rows.push(splitCsvLine(line, delim));
  }
  const cols = detectColumns(rows[0].map(c => c.trim()));
  const dataRows = cols ? rows.slice(1) : rows;

  const entries: DeckImportEntry[] = [];
  for (const fields of dataRows) {
    const cells = fields.map(c => c.trim());
    let name = '';
    let setCode: string | null = null;
    let collectorNumber: string | null = null;
    let quantity = 1;
    const tags: string[] = [];

    if (cols) {
      let cells = fields.map(c => c.trim());
      const maxCol = Math.max(...Object.values(cols)) + 1;
      if (cols.nameIndex != null && cols.setIndex != null && cols.setIndex === cols.nameIndex + 1 && fields.length > maxCol) {
        const nameFieldCount = 1 + (fields.length - maxCol);
        cells = [fields.slice(cols.nameIndex, cols.nameIndex + nameFieldCount).join(',').trim()]
          .concat(fields.slice(cols.nameIndex + nameFieldCount)).map(c => c.trim());
      }
      const at = (i: number | undefined) => (i == null ? undefined : cells[i] || undefined);
      name = at(cols.nameIndex) || '';
      setCode = at(cols.setIndex) || null;
      collectorNumber = at(cols.collectorIndex) || null;
      const qtyRaw = at(cols.quantityIndex);
      if (qtyRaw) quantity = parseInt(qtyRaw.replace(/[^0-9]/g, ''), 10) || 1;
      const tagRaw = at(cols.tagsIndex);
      if (tagRaw) tags.push(...tagRaw.split(/[|;]/).map(t => t.trim()).filter(Boolean));
    } else {
      name = cells[0] || '';
      const rest = cells.slice(1);
      const isSetCode = (s: string) => /^[a-z0-9]{2,6}$/i.test(s) && !/^\d+$/.test(s);
      if (rest.length === 1) {
        if (/^\d+$/.test(rest[0])) quantity = parseInt(rest[0], 10) || 1;
        else if (isSetCode(rest[0])) setCode = rest[0].toUpperCase();
        else collectorNumber = rest[0];
      } else if (rest.length === 2) {
        setCode = isSetCode(rest[0]) ? rest[0].toUpperCase() : rest[0];
        collectorNumber = rest[1];
      } else if (rest.length >= 3) {
        setCode = isSetCode(rest[0]) ? rest[0].toUpperCase() : rest[0];
        collectorNumber = rest[1];
        if (/^\d+$/.test(rest[2])) quantity = parseInt(rest[2], 10) || 1;
      }
    }

    name = cleanName(name);
    if (!name) continue;
    entries.push({
      name,
      setCode: setCode?.toUpperCase() ?? null,
      collectorNumber: collectorNumber?.trim() || null,
      quantity,
      tags,
      role: roleFromTags(tags),
    });
  }
  return entries;
}

export function parseDecklistText(content: string): DeckImportEntry[] {
  const lines = content.split(/\r?\n/).map(l => l.trim().slice(0, MAX_LINE_LEN)).filter(Boolean);
  // If any line has a quantity prefix, the list uses the `[qty] name ...` format
  // and bare word-only lines are section/category headers (Archidekt), not cards.
  const qtyMode = lines.some(l => QTY_PREFIX_RE.test(l));

  const entries: DeckImportEntry[] = [];
  let role: DeckImportRole = null;

  for (const line of lines) {
    if (line.startsWith('//') || line.startsWith('#')) {
      const header = detectSectionHeader(line);
      role = header ? header.role : null;
      continue;
    }

    const header = detectSectionHeader(line);
    if (header) {
      role = header.role;
      continue;
    }

    // In qty mode a bare word line is a section header, not a card.
    if (qtyMode && !QTY_PREFIX_RE.test(line)) {
      role = null;
      continue;
    }

    let qty = 1;
    let rest = line;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(\d+)\s*[xX*×]\s*(.+)$/))) {
      qty = parseInt(m[1], 10) || 1;
      rest = m[2].trim();
    } else if ((m = line.match(/^(\d+)\s+(.+)$/))) {
      qty = parseInt(m[1], 10) || 1;
      rest = m[2].trim();
    } else {
      // Trailing "Name xN" form. Scan from the end once to avoid the previous
      // quadratic backtracking on long lines without a trailing count.
      const suffix = rest.match(/\s+[xX*×]?\s*0*(\d{1,6})\s*$/);
      if (suffix && rest.length - suffix.index! > 1) {
        qty = parseInt(suffix[1], 10) || 1;
        rest = rest.slice(0, suffix.index).trim();
      }
    }

    const parsed = parseArchidektSuffix(rest);
    const name = cleanName(parsed.name);
    if (!name) continue;

    const categoryRole = roleFromCategory(parsed.category);
    entries.push({
      name,
      setCode: parsed.setCode,
      collectorNumber: parsed.collectorNumber,
      quantity: qty,
      tags: [],
      role: categoryRole ?? role,
    });
  }
  return entries;
}

export function parseDecklist(content: string, format: 'auto' | 'csv' | 'text' = 'auto'): DeckImportEntry[] {
  const text = content.replace(/^\uFEFF/, '').trim();
  if (!text) return [];
  const isCsv = format === 'csv' || (format === 'auto' && looksLikeCsv(text));
  const entries = isCsv ? parseCsv(text) : parseDecklistText(text);
  if (entries.length > MAX_ENTRIES) return [];

  const merged = new Map<string, DeckImportEntry>();
  for (const e of entries) {
    const key = `${e.name.toLowerCase()}::${(e.setCode || '').toUpperCase()}::${(e.collectorNumber || '').toLowerCase()}`;
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += e.quantity;
      existing.tags.push(...e.tags);
    } else {
      merged.set(key, { ...e, tags: [...e.tags], role: e.role });
    }
  }
  return [...merged.values()];
}