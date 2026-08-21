import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyPassword, verifyDummyPassword } from '../auth/password';
import {
  createSession, deleteSession, sessionCookieOptions, COOKIE_NAME, IMPERSONATE_COOKIE,
  readSessionCookie, readImpersonationCookie,
} from '../auth/sessions';
import { getUserByUsername, getUserById, getUserPasswordHash, setUserPassword, touchLastLogin, listUsers, updateProfile, type UserRow } from '../auth/users';
import { requireAuth, type AuthenticatedRequest } from '../auth/middleware';
import { isInstanceSetupDone, verifySetupToken } from '../services/setupStatus';
import { getSystemSettings } from '../services/systemSettings';
import { cardById } from '../services/cards';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
});

const demoLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many demo logins, please try again later.' },
});

const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password change attempts, please try again later.' },
});

function serializeUser(u: UserRow) {
  const s = getSystemSettings();
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    mustChangePassword: !!u.mustChangePassword,
    isDemo: !!u.demo,
    displayName: u.displayName,
    avatar: u.avatar,
    paymentRef: u.paymentRef,
    membershipTier: u.membershipTier,
    paidUntil: u.paidUntil,
    freeMonths: u.freeMonths,
    paidMonths: u.paidMonths,
    trialWeeks: u.trialWeeks,
    arrearsDays: s.arrearsDays,
    arrearsAction: s.arrearsAction,
  };
}

authRouter.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = getUserByUsername(username);
  if (!user || user.disabled) {
    // Burn equal time for a missing user as for a wrong password so we don't
    // leak which usernames exist via response timing.
    if (!user) verifyDummyPassword(password);
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  if (!verifyPassword(password, getUserPasswordHash(user.id))) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const { token } = createSession(user.id);
  touchLastLogin(user.id);
  res.cookie(COOKIE_NAME, token, sessionCookieOptions());
  res.json({ user: serializeUser(user) });
});

authRouter.post('/demo-login', demoLoginLimiter, (req, res) => {
  const demo = getUserByUsername('demo');
  if (!demo || demo.disabled || !demo.demo || !verifyPassword('demo', getUserPasswordHash(demo.id))) {
    return res.status(400).json({ error: 'The demo account is not available right now.' });
  }
  const { token } = createSession(demo.id);
  touchLastLogin(demo.id);
  res.cookie(COOKIE_NAME, token, sessionCookieOptions());
  res.json({ user: serializeUser(demo) });
});

// One-time bootstrap login: only works before the instance setup is completed,
// and only with the one-time setup token printed to the server console at boot.
authRouter.post('/setup-login', (req, res) => {
  if (isInstanceSetupDone()) {
    return res.status(400).json({ error: 'Setup has already been completed. Sign in with your admin credentials.' });
  }
  const { token } = req.body ?? {};
  if (typeof token !== 'string' || !verifySetupToken(token)) {
    return res.status(401).json({ error: 'A valid one-time setup token is required. Check the server console/logs for it.' });
  }
  const adminRow = listUsers().find(u => u.role === 'admin');
  if (!adminRow) {
    return res.status(400).json({ error: 'No admin account exists yet.' });
  }
  const admin = getUserById(adminRow.id);
  if (!admin || admin.disabled) {
    return res.status(400).json({ error: 'The admin account is not available.' });
  }
  const { token: sessionToken } = createSession(admin.id);
  touchLastLogin(admin.id);
  res.cookie(COOKIE_NAME, sessionToken, sessionCookieOptions());
  res.json({ user: serializeUser(admin) });
});

authRouter.post('/logout', (req, res) => {
  deleteSession(readSessionCookie(req));
  res.clearCookie(COOKIE_NAME, { ...sessionCookieOptions(), maxAge: 0 });
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const row = getUserById(req.user!.userId);
  if (!row) return res.status(404).json({ error: 'User not found' });
  const impBy = (req as AuthenticatedRequest).impersonatedBy;
  const impersonatedByUsername = impBy ? getUserById(impBy)?.username ?? null : null;
  res.json({
    user: {
      ...serializeUser(row),
      impersonating: !!req.impersonating,
      impersonatedBy: impersonatedByUsername,
    },
  });
});

authRouter.put('/profile', requireAuth, (req: AuthenticatedRequest, res) => {
  const { displayName, avatarCardId, avatarFace } = req.body ?? {};
  const userId = req.user!.userId;

  if (displayName !== undefined) {
    if (typeof displayName !== 'string') {
      return res.status(400).json({ error: 'Invalid display name' });
    }
    const trimmed = displayName.trim().slice(0, 60);
    updateProfile(userId, { displayName: trimmed || null });
  }

  if (avatarCardId !== undefined) {
    if (avatarCardId === null) {
      updateProfile(userId, { avatar: null });
    } else {
      if (typeof avatarCardId !== 'string' || !avatarCardId.trim()) {
        return res.status(400).json({ error: 'Invalid card id' });
      }
      let faceIdx: number | undefined;
      if (avatarFace !== undefined && avatarFace !== null) {
        faceIdx = Number(avatarFace);
        if (!Number.isInteger(faceIdx) || faceIdx < 0 || faceIdx > 5) {
          return res.status(400).json({ error: 'Invalid face index' });
        }
      }
      const card = cardById(avatarCardId.trim());
      if (!card) return res.status(400).json({ error: 'Card not found' });
      const url = faceIdx !== undefined
        ? `/api/images/${card.id}/art_crop/${faceIdx}`
        : `/api/images/${card.id}/art_crop`;
      updateProfile(userId, { avatar: url });
    }
  }

  const updated = getUserById(userId)!;
  res.json({ user: serializeUser(updated) });
});

authRouter.post('/exit-impersonation', requireAuth, (req, res) => {
  deleteSession(readImpersonationCookie(req));
  res.clearCookie(IMPERSONATE_COOKIE, { ...sessionCookieOptions(), maxAge: 0 });
  res.json({ ok: true });
});

authRouter.post('/change-password', changePasswordLimiter, requireAuth, (req: AuthenticatedRequest, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  if (typeof currentPassword !== 'string' || currentPassword === newPassword) {
    return res.status(400).json({ error: 'New password must be different from your current password' });
  }
  const user = getUserById(req.user!.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (!verifyPassword(currentPassword, getUserPasswordHash(user.id))) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  setUserPassword(user.id, newPassword, false);
  deleteSession(readSessionCookie(req));
  const { token } = createSession(user.id);
  res.cookie(COOKIE_NAME, token, sessionCookieOptions());
  res.json({ ok: true, user: serializeUser(user) });
});
