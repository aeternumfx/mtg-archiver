import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { verifyPassword } from '../auth/password';
import {
  createSession, deleteSession, sessionCookieOptions, COOKIE_NAME, IMPERSONATE_COOKIE,
  readSessionCookie, readImpersonationCookie,
} from '../auth/sessions';
import { getUserByUsername, getUserById, getUserPasswordHash, setUserPassword, touchLastLogin, listUsers } from '../auth/users';
import { requireAuth, type AuthenticatedRequest } from '../auth/middleware';
import { isInstanceSetupDone } from '../services/setupStatus';

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

authRouter.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = getUserByUsername(username);
  if (!user || user.disabled || !verifyPassword(password, getUserPasswordHash(user.id))) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const { token } = createSession(user.id);
  touchLastLogin(user.id);
  res.cookie(COOKIE_NAME, token, sessionCookieOptions());
  res.json({
    user: { id: user.id, username: user.username, role: user.role, mustChangePassword: !!user.mustChangePassword },
  });
});

authRouter.post('/demo-login', demoLoginLimiter, (req, res) => {
  const demo = getUserByUsername('demo');
  if (!demo || demo.disabled || !demo.demo || !verifyPassword('demo', getUserPasswordHash(demo.id))) {
    return res.status(400).json({ error: 'The demo account is not available right now.' });
  }
  const { token } = createSession(demo.id);
  touchLastLogin(demo.id);
  res.cookie(COOKIE_NAME, token, sessionCookieOptions());
  res.json({
    user: { id: demo.id, username: demo.username, role: demo.role, mustChangePassword: false, isDemo: true },
  });
});

// One-time bootstrap login: only works before the instance setup is completed.
authRouter.post('/setup-login', (req, res) => {
  if (isInstanceSetupDone()) {
    return res.status(400).json({ error: 'Setup has already been completed. Sign in with your admin credentials.' });
  }
  const adminRow = listUsers().find(u => u.role === 'admin');
  if (!adminRow) {
    return res.status(400).json({ error: 'No admin account exists yet.' });
  }
  const admin = getUserById(adminRow.id);
  if (!admin || admin.disabled) {
    return res.status(400).json({ error: 'The admin account is not available.' });
  }
  const { token } = createSession(admin.id);
  touchLastLogin(admin.id);
  res.cookie(COOKIE_NAME, token, sessionCookieOptions());
  res.json({
    user: { id: admin.id, username: admin.username, role: admin.role, mustChangePassword: !!admin.mustChangePassword },
  });
});

authRouter.post('/logout', (req, res) => {
  deleteSession(readSessionCookie(req));
  res.clearCookie(COOKIE_NAME, { ...sessionCookieOptions(), maxAge: 0 });
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const impBy = (req as AuthenticatedRequest).impersonatedBy;
  const impersonatedByUsername = impBy ? getUserById(impBy)?.username ?? null : null;
  res.json({
    user: {
      id: user.userId,
      username: user.username,
      role: user.role,
      mustChangePassword: !!user.mustChangePassword,
      impersonating: !!req.impersonating,
      impersonatedBy: impersonatedByUsername,
      isDemo: !!user.isDemo,
    },
  });
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
  res.json({ ok: true, user: { id: user.id, username: user.username, role: user.role, mustChangePassword: false } });
});
