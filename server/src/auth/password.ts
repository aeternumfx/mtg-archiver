import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';

const SCRYPT_KEYLEN = 64;
// OWASP recommends N >= 2^17 for interactive logins. This is shared by login
// passwords and share-view passwords. maxmem is raised to fit N=2^17 r=8.
export const SCRYPT_OPTIONS = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 } as const;

// A valid hash of a random password, compared against when the username does
// not exist so login takes the same time for missing vs incorrect users
// (prevents username enumeration via response timing).
const DUMMY_HASH = hashPassword('mtg-archiver-dummy-password');

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, hash] = parts as [string, string];
  if (!salt || !hash) return false;
  try {
    const candidate = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
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
