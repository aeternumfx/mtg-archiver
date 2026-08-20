import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';

const SCRYPT_KEYLEN = 64;
// OWASP recommends N >= 2^17 for interactive logins. This is shared by login
// passwords and share-view passwords. maxmem is raised to fit N=2^17 r=8.
export const SCRYPT_OPTIONS = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 } as const;

// Historical scrypt cost factors. Hashes created before the parameters were
// embedded in the stored value used N=16384 and must still verify so existing
// users (including those imported from an older backup) can sign in.
const LEGACY_OPTIONS = { N: 16384, r: 8, p: 1 } as const;

// A valid hash of a random password, compared against when the username does
// not exist so login takes the same time for missing vs incorrect users
// (prevents username enumeration via response timing).
const DUMMY_HASH = hashPassword('mtg-archiver-dummy-password');

// New hashes embed their scrypt parameters so the cost can be changed in the
// future without invalidating existing passwords: `scrypt$N=131072:r=8:p=1$salt:hash`.
// Legacy hashes are the bare `salt:hash` (encoded with the historical N=16384).
function formatHash(salt: string, hash: string, opts = SCRYPT_OPTIONS): string {
  return `scrypt$N=${opts.N}:r=${opts.r}:p=${opts.p}$${salt}:${hash}`;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS).toString('hex');
  return formatHash(salt, hash);
}

function scryptParams(stored: string): { options: typeof SCRYPT_OPTIONS | typeof LEGACY_OPTIONS; rest: string } | null {
  if (stored.startsWith('scrypt$')) {
    const [meta, rest] = stored.slice('scrypt$'.length).split('$');
    if (!meta || rest === undefined) return null;
    const m = meta.match(/^N=(\d+):r=(\d+):p=(\d+)$/);
    if (!m) return null;
    const N = Number(m[1]); const r = Number(m[2]); const p = Number(m[3]);
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || N <= 0 || r <= 0 || p <= 0) return null;
    // Cap the cost so a tampered/corrupt hash can't trigger an absurdly large scrypt.
    if (N > 2 ** 21 || r > 16 || p > 4) return null;
    return { options: { N, r, p, ...(N > 16384 ? { maxmem: 256 * 1024 * 1024 } : {}) } as typeof SCRYPT_OPTIONS, rest };
  }
  // Legacy: bare `salt:hash` created with the historical params.
  return { options: LEGACY_OPTIONS, rest: stored };
}

export function verifyPassword(password: string, stored: string): boolean {
  const parsed = scryptParams(stored);
  if (!parsed) return false;
  const parts = parsed.rest.split(':');
  if (parts.length !== 2) return false;
  const [salt, hash] = parts as [string, string];
  if (!salt || !hash) return false;
  try {
    const candidate = scryptSync(password, salt, SCRYPT_KEYLEN, parsed.options);
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

// Run a scrypt verification against a fixed dummy hash so that a request for a
// non-existent username takes the same time as one for a real user.
export function verifyDummyPassword(password: string): void {
  verifyPassword(password, DUMMY_HASH);
}

export function generateTempPassword(length = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[bytes[i]! % chars.length];
  }
  return out;
}
