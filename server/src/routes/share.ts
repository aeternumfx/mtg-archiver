import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createHmac, timingSafeEqual, scryptSync, randomBytes } from 'crypto';
import { requireAuth, type AuthenticatedRequest } from '../auth/middleware';
import {
  getUserByShareToken, getUserById, updateUserPrivacy,
  getUserCollectionPasswordHash, getUserWantlistPasswordHash, generateShareToken, getUserShareToken,
} from '../auth/users';
import { getSharedCollection, getSharedWantlist } from '../services/share';
import { getSharesSecret, ensureSharesSecret } from '../services/shareSecret';
import { SCRYPT_OPTIONS } from '../auth/password';

export const shareRouter = Router();
export const profilePrivacyRouter = Router();

// Per-instance random secret for signing ephemeral "view" tokens. Persisted on
// first use so the key survives restarts and is never derived from guessable
// deployment parameters.
const VIEW_TTL_MS = 60 * 60 * 1000; // 1 hour
let SIGN_KEY: string | null = null;
function signKey(): string {
  if (!SIGN_KEY) {
    ensureSharesSecret();
    SIGN_KEY = getSharesSecret() || '';
    if (!SIGN_KEY) throw new Error('No share signing secret configured');
  }
  return SIGN_KEY;
}

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later.' },
});

function signViewToken(shareToken: string, scope: 'collection' | 'wantlist'): string {
  const exp = Date.now() + VIEW_TTL_MS;
  const payload = `${shareToken}:${scope}:${exp}`;
  const sig = createHmac('sha256', signKey()).update(payload).digest('base64url');
  return `${payload}:${sig}`;
}

function validViewToken(raw: string, shareToken: string, scope: 'collection' | 'wantlist'): boolean {
  try {
    const [st, sc, exp, sig] = raw.split(':');
    if (!st || !sc || !exp || !sig) return false;
    if (st !== shareToken || sc !== scope) return false;
    if (Number(exp) < Date.now()) return false;
    const payload = `${st}:${sc}:${exp}`;
    const expected = createHmac('sha256', signKey()).update(payload).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function scopeAllowed(user: { collectionPrivacy: string; wantlistPrivacy: string }, scope: 'collection' | 'wantlist'): boolean {
  const level = scope === 'collection' ? user.collectionPrivacy : user.wantlistPrivacy;
  return level === 'public' || level === 'password';
}

// Authed: get my privacy settings + share link
profilePrivacyRouter.get('/', requireAuth, (req: AuthenticatedRequest, res) => {
  const me = getUserById(req.user!.userId);
  if (!me) return res.status(404).json({ error: 'User not found' });
  const token = me.shareToken ?? getUserShareToken(me.id);
  res.json({
    collectionPrivacy: me.collectionPrivacy,
    wantlistPrivacy: me.wantlistPrivacy,
    shareToken: token,
    shareBase: '', // client appends location origin
    username: me.username,
    displayName: me.displayName,
  });
});

// Authed: update my privacy settings
profilePrivacyRouter.put('/', requireAuth, (req: AuthenticatedRequest, res) => {
  const userId = req.user!.userId;
  const { collectionPrivacy, wantlistPrivacy, collectionPassword, wantlistPassword } = req.body ?? {};

  const normalize = (v: unknown): 'public' | 'password' | 'private' | null => {
    if (v === 'public' || v === 'password' || v === 'private') return v;
    return null;
  };
  const cLevel = collectionPrivacy !== undefined ? normalize(collectionPrivacy) : undefined;
  const wLevel = wantlistPrivacy !== undefined ? normalize(wantlistPrivacy) : undefined;
  if (collectionPrivacy !== undefined && cLevel === null) return res.status(400).json({ error: 'Invalid collection privacy' });
  if (wantlistPrivacy !== undefined && wLevel === null) return res.status(400).json({ error: 'Invalid wantlist privacy' });

  // Validate passwords when set.
  const hashIfProvided = (pw: unknown): string | null | undefined => {
    if (pw === undefined) return undefined;
    if (pw === null || pw === '') return null;
    if (typeof pw !== 'string' || pw.length < 4) {
      throw new Error('Password must be at least 4 characters');
    }
    return hashFrom(pw);
  };

  try {
    let colPwHash: string | null | undefined;
    let wantPwHash: string | null | undefined;
    if (collectionPassword !== undefined) colPwHash = hashIfProvided(collectionPassword);
    if (wantlistPassword !== undefined) wantPwHash = hashIfProvided(wantlistPassword);

    // If switching to 'password' without a password, keep existing (or require one).
    if (cLevel === 'password' && colPwHash === undefined) {
      const existing = getUserCollectionPasswordHash(userId);
      if (!existing) return res.status(400).json({ error: 'Set a password to enable password-protected collection' });
    }
    if (wLevel === 'password' && wantPwHash === undefined) {
      const existing = getUserWantlistPasswordHash(userId);
      if (!existing) return res.status(400).json({ error: 'Set a password to enable password-protected wantlist' });
    }

    // If privacy becomes private, clear the password hash.
    if (cLevel === 'private' && colPwHash === undefined) colPwHash = null;
    if (wLevel === 'private' && wantPwHash === undefined) wantPwHash = null;

    updateUserPrivacy(userId, {
      ...(cLevel !== undefined ? { collectionPrivacy: cLevel as 'public' | 'password' | 'private' } : {}),
      ...(wLevel !== undefined ? { wantlistPrivacy: wLevel as 'public' | 'password' | 'private' } : {}),
      ...(colPwHash !== undefined ? { collectionPassword: colPwHash } : {}),
      ...(wantPwHash !== undefined ? { wantlistPassword: wantPwHash } : {}),
    });

    // If nothing is shared, clear the share token for tidiness.
    const me = getUserById(userId)!;
    const anyShared = me.collectionPrivacy !== 'private' || me.wantlistPrivacy !== 'private';
    if (!anyShared && me.shareToken) {
      // Regenerate on next share.
    }

    const updated = getUserById(userId)!;
    res.json({
      collectionPrivacy: updated.collectionPrivacy,
      wantlistPrivacy: updated.wantlistPrivacy,
      shareToken: updated.shareToken ?? getUserShareToken(userId),
      username: updated.username,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

const SCRYPT_COST = { ...SCRYPT_OPTIONS };

function hashFrom(pw: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(pw, 'share:' + salt, 64, SCRYPT_COST).toString('hex');
  return `share:${salt}:${hash}`;
}

function verifySharePassword(pw: string, stored: string | null): boolean {
  if (!stored) return false;
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'share') return false;
  const [, salt, hashHex] = parts as [string, string, string];
  try {
    const candidate = scryptSync(pw, 'share:' + salt, 64, SCRYPT_COST);
    const expected = Buffer.from(hashHex, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

interface ShareUser {
  id: number;
  username: string;
  displayName: string | null;
  avatar: string | null;
  collectionPrivacy: string;
  wantlistPrivacy: string;
}

// Public: get share metadata (no data yet)
shareRouter.get('/:token/status', (req, res) => {
  const token = req.params.token;
  const user = getUserByShareToken(token);
  if (!user) return res.status(404).json({ error: 'Share link not found' });

  const outlook: ShareUser = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar,
    collectionPrivacy: user.collectionPrivacy,
    wantlistPrivacy: user.wantlistPrivacy,
  };

  // Hide username if they share nothing publicly (keeps link unguessable anyway).
  res.json({
    displayName: user.displayName,
    avatar: user.avatar,
    collection: {
      shared: user.collectionPrivacy !== 'private',
      password: user.collectionPrivacy === 'password',
    },
    wantlist: {
      shared: user.wantlistPrivacy !== 'private',
      password: user.wantlistPrivacy === 'password',
    },
  });
});

// Public: verify password for a scope, returns an access token.
// Rate-limited to blunt brute-forcing and blocking-scrypt CPU exhaustion.
shareRouter.post('/:token/verify', verifyLimiter, (req, res) => {
  const token = req.params.token;
  const { scope, password } = req.body ?? {};
  if (scope !== 'collection' && scope !== 'wantlist') {
    return res.status(400).json({ error: 'Invalid scope' });
  }
  const user = getUserByShareToken(token);
  if (!user) return res.status(404).json({ error: 'Share link not found' });

  const level = scope === 'collection' ? user.collectionPrivacy : user.wantlistPrivacy;
  if (level === 'private') return res.status(403).json({ error: 'Not shared' });
  if (level === 'public') {
    // Public scopes don't need an access token; minting one adds surface for no benefit.
    return res.json({ scope, access: null });
  }
  // password protected
  if (typeof password !== 'string' || !password) {
    return res.status(401).json({ error: 'Password required' });
  }
  const stored = scope === 'collection' ? getUserCollectionPasswordHash(user.id) : getUserWantlistPasswordHash(user.id);
  if (!verifySharePassword(password, stored)) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  res.json({ scope, access: signViewToken(token, scope) });
});

function requireScopeAccess(req: any, scope: 'collection' | 'wantlist'): ShareUser | null {
  const token = req.params.token;
  const user = getUserByShareToken(token);
  if (!user) return null;
  const level = scope === 'collection' ? user.collectionPrivacy : user.wantlistPrivacy;
  if (level === 'private') return null;
  if (level === 'password') {
    const access = req.query.access as string | undefined;
    if (!access || !validViewToken(access, token, scope)) return null;
  }
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar,
    collectionPrivacy: user.collectionPrivacy,
    wantlistPrivacy: user.wantlistPrivacy,
  };
}

shareRouter.get('/:token/collection', (req, res) => {
  const user = requireScopeAccess(req, 'collection');
  if (!user) return res.status(403).json({ error: 'Not authorized' });
  const items = getSharedCollection(user.id);
  res.json({ displayName: user.displayName, items });
});

shareRouter.get('/:token/wantlist', (req, res) => {
  const user = requireScopeAccess(req, 'wantlist');
  if (!user) return res.status(403).json({ error: 'Not authorized' });
  const items = getSharedWantlist(user.id);
  res.json({ displayName: user.displayName, items });
});
