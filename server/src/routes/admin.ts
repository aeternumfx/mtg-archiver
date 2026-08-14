import { fail } from '../utils/http';
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { requireAdmin, type AuthenticatedRequest } from '../auth/middleware';
import {
  listUsers, getUserById, getUserByUsername, getUserPasswordHash, createUser, setUserPassword, updateUser,
  permanentlyDeleteUser, deleteAllUsersExcept, generateTempPassword, adminStats, usernameExistsCaseInsensitive,
} from '../auth/users';
import { verifyPassword } from '../auth/password';
import { sessionCountsByUser, deleteUserSessions, createImpersonationSession, sessionCookieOptions, IMPERSONATE_COOKIE } from '../auth/sessions';
import { getAdminStats } from '../services/adminStats';
import { getActivity, clearActivity } from '../services/activityLog';
import { clearAllRequests } from '../services/requests';
import { clearImageCache } from '../services/images';
import { getSystemSettings, updateSystemSettings, resetSystemSettings } from '../services/systemSettings';
import { isUserSetupDone, resetUserTour, isInstanceSetupDone, markInstanceSetupDone, markInstanceSetupPending, markUserSetupDone } from '../services/setupStatus';
import { createBackupZip } from '../services/backup';
import { appVersion, autoUpdateAvailable, checkForUpdates, runAutoUpdate } from '../services/updates';
import { restoreFromBackup } from '../services/restore';
import { dataDir, userDbPath } from '../db/paths';

const uploadsDir = path.join(dataDir, '.uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
const upload = multer({ dest: uploadsDir, limits: { fileSize: 500 * 1024 * 1024 } });

export const adminRouter = Router();

adminRouter.use(requireAdmin);

adminRouter.get('/overview', (_req, res) => {
  res.json(adminStats());
});

adminRouter.get('/stats', (_req, res) => {
  res.json(getAdminStats());
});

adminRouter.get('/feed', (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  res.json(getActivity(limit));
});

adminRouter.get('/update/status', async (_req, res) => {
  const status = await checkForUpdates();
  res.json({ ...status, autoUpdateAvailable: autoUpdateAvailable() });
});

adminRouter.post('/update/check', async (_req, res) => {
  const status = await checkForUpdates(true);
  res.json({ ...status, autoUpdateAvailable: autoUpdateAvailable() });
});

adminRouter.get('/backup', async (_req, res) => {
  try {
    const backup = await createBackupZip();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${backup.filename}"`);
    res.setHeader('Content-Length', String(backup.size));
    fs.createReadStream(backup.file).pipe(res);
  } catch (err: any) {
    fail(res, err);
  }
});

adminRouter.post('/update', async (_req, res) => {
  if (!autoUpdateAvailable()) {
    return res.status(400).json({ error: 'In-app auto-update is not enabled. Back up and run ./update.sh on the host instead.' });
  }
  try {
    const backup = await createBackupZip();
    res.json({
      message: 'Update started. The app will restart shortly.',
      backupFile: backup.filename,
      version: appVersion(),
    });
    // Give the response time to flush before the container is recreated.
    setTimeout(() => {
      runAutoUpdate().catch(err => console.error('[update] auto-update failed:', err));
    }, 1500);
  } catch (err: any) {
    fail(res, err);
  }
});

adminRouter.post('/restore', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No backup file provided' });
  }
  try {
    await restoreFromBackup(req.file.path);
    fs.rmSync(req.file.path, { force: true });
    res.json({ message: 'Restore complete. Please sign in again with an account from the backup.' });
  } catch (err: any) {
    if (req.file && fs.existsSync(req.file.path)) fs.rmSync(req.file.path, { force: true });
    res.status(400).json({ error: err.message });
  }
});

adminRouter.get('/settings', (_req, res) => {
  res.json(getSystemSettings());
});

adminRouter.put('/settings', (req, res) => {
  const body = req.body ?? {};
  const allowed = ['scryfallStaleHours', 'setsRefreshHours', 'sessionTtlDays', 'instanceName', 'domain', 'adminContactName', 'adminContactEmail'];
  const partial: Record<string, unknown> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) partial[key] = body[key];
  }
  if (Object.keys(partial).length === 0) {
    return res.status(400).json({ error: 'No valid settings provided' });
  }
  if (typeof partial.adminContactEmail === 'string' && partial.adminContactEmail.trim() !== ''
      && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(partial.adminContactEmail.trim())) {
    return res.status(400).json({ error: 'Admin contact email is not a valid email address' });
  }
  res.json(updateSystemSettings(partial));
});

adminRouter.post('/clear-requests', (_req, res) => {
  clearAllRequests();
  res.json({ message: 'All user requests deleted' });
});

adminRouter.post('/clear-activity', (_req, res) => {
  clearActivity();
  res.json({ message: 'API activity log cleared' });
});

adminRouter.post('/clear-images', (_req, res) => {
  clearImageCache();
  res.json({ message: 'Image cache cleared' });
});

adminRouter.post('/reset-settings', (_req, res) => {
  res.json({ settings: resetSystemSettings(), message: 'System settings reset to defaults' });
});

adminRouter.post('/reset-instance', (req, res) => {
  const actor = (req as AuthenticatedRequest).user!;
  deleteAllUsersExcept(actor.userId);
  clearAllRequests();
  clearActivity();
  clearImageCache();
  resetSystemSettings();
  markInstanceSetupPending();
  res.json({ message: 'Instance reset. All other users and their data were removed; settings and logs cleared. The first-time setup will run again.' });
});

adminRouter.get('/users', (_req, res) => {
  const counts = sessionCountsByUser();
  const users = listUsers().map(u => ({
    ...u,
    activeSessions: counts.get(u.id) ?? 0,
    pendingTour: (u.role === 'user' || u.role === 'moderator') && !isUserSetupDone(u.id),
    demo: !!u.demo,
    storageBytes: userDbBytes(u.id),
  }));
  res.json(users);
});

function userDbBytes(userId: number): number {
  try { return fs.statSync(userDbPath(userId)).size; } catch { return 0; }
}

adminRouter.get('/setup-status', (req, res) => {
  res.json({ done: isInstanceSetupDone(), adminUsername: (req as AuthenticatedRequest).user!.username });
});

adminRouter.post('/complete-setup', (req, res) => {
  const actor = (req as AuthenticatedRequest).user!;
  const { domain, adminContactName, adminContactEmail, demoEnabled, currentPassword, newPassword } = req.body ?? {};

  if (typeof domain !== 'string' || !domain.trim()) {
    return res.status(400).json({ error: 'Domain is required' });
  }
  if (typeof adminContactName !== 'string' || !adminContactName.trim()) {
    return res.status(400).json({ error: 'Admin contact name is required' });
  }
  if (typeof adminContactEmail !== 'string' || !adminContactEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminContactEmail.trim())) {
    return res.status(400).json({ error: 'A valid admin contact email is required' });
  }

  if (newPassword !== undefined) {
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'You must set a new admin password of at least 8 characters' });
    }
    if (typeof currentPassword !== 'string' || currentPassword === newPassword) {
      return res.status(400).json({ error: 'New password must be different from your current password' });
    }
    if (!verifyPassword(currentPassword, getUserPasswordHash(actor.userId))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    setUserPassword(actor.userId, newPassword, false);
  } else {
    return res.status(400).json({ error: 'You must set a new admin password before completing setup' });
  }

  updateSystemSettings({
    domain: domain.trim(),
    adminContactName: adminContactName.trim(),
    adminContactEmail: adminContactEmail.trim(),
  });

  const existingDemo = getUserByUsername('demo');
  if (existingDemo) {
    updateUser(existingDemo.id, { disabled: demoEnabled ? false : true });
  } else {
    const demoUser = createUser('demo', 'demo', 'user', false, true);
    updateUser(demoUser.id, { disabled: demoEnabled ? false : true });
    markUserSetupDone(demoUser.id);
  }

  markInstanceSetupDone();
  res.json({ ok: true, settings: getSystemSettings() });
});

adminRouter.get('/demo', (_req, res) => {
  const demo = getUserByUsername('demo');
  res.json({
    exists: !!demo,
    enabled: !!(demo && !demo.disabled),
    username: demo?.username ?? 'demo',
  });
});

adminRouter.post('/demo', (req, res) => {
  const enabled = req.body?.enabled === true;
  const demo = getUserByUsername('demo');
  if (!demo) return res.status(404).json({ error: 'Demo user not found. Complete the initial setup first.' });
  updateUser(demo.id, { disabled: !enabled });
  res.json({ enabled, message: `Demo user ${enabled ? 'enabled' : 'disabled'}` });
});

adminRouter.post('/users/:id/reset-tour', (req, res) => {
  const id = Number(req.params.id);
  const user = getUserById(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'admin') return res.status(400).json({ error: 'Admin accounts do not have an intro tour' });
  resetUserTour(id);
  res.json({ message: `Intro tour will show for ${user.username} on their next sign-in` });
});

adminRouter.post('/users', (req: AuthenticatedRequest, res) => {
  const { username, role } = req.body ?? {};
  if (typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ error: 'Username is required' });
  }
  const clean = username.trim();
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(clean)) {
    return res.status(400).json({ error: 'Username must be 3-32 characters (letters, numbers, . _ -)' });
  }
  if (usernameExistsCaseInsensitive(clean)) {
    return res.status(409).json({ error: 'Username already exists' });
  }

  const tempPassword = generateTempPassword();
  const userRole = role === 'admin' ? 'admin' : role === 'moderator' ? 'moderator' : 'user';
  try {
    const user = createUser(clean, tempPassword, userRole, true);
    res.status(201).json({
      user: { id: user.id, username: user.username, role: user.role, mustChangePassword: !!user.mustChangePassword },
      tempPassword,
    });
  } catch (err: any) {
    if (String(err?.code ?? err?.message ?? '').includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    throw err;
  }
});

adminRouter.post('/users/:id/reset-password', (req, res) => {
  const id = Number(req.params.id);
  const user = getUserById(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const requested = typeof req.body?.password === 'string' && req.body.password.length >= 8 ? req.body.password : null;
  const tempPassword = requested ?? generateTempPassword();
  setUserPassword(id, tempPassword, requested ? false : true);
  res.json({ tempPassword, mustChangePassword: !requested });
});

adminRouter.patch('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = getUserById(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { disabled, role, mustChangePassword, username } = req.body ?? {};
  if (role !== undefined) {
    if (!['user', 'moderator', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'role must be "user", "moderator", or "admin"' });
    }
    if (id === (req as AuthenticatedRequest).user!.userId) {
      return res.status(400).json({ error: 'You cannot change your own role' });
    }
    if (user.role === 'admin' && role !== 'admin') {
      return res.status(400).json({ error: 'Admins are a separate type and cannot be demoted' });
    }
    if (role === 'admin') {
      return res.status(400).json({ error: 'You cannot promote an account to admin. Create a new admin instead.' });
    }
  }
  if (id === (req as AuthenticatedRequest).user!.userId && (disabled || role !== undefined)) {
    return res.status(400).json({ error: 'You cannot disable or change your own account' });
  }
  if (username !== undefined) {
    if (user.demo) {
      return res.status(400).json({ error: 'The demo username cannot be changed' });
    }
    const clean = String(username).trim();
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(clean)) {
      return res.status(400).json({ error: 'Username must be 3-32 characters (letters, numbers, . _ -)' });
    }
    const conflicting = getUserByUsername(clean);
    if (conflicting && conflicting.id !== id) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    if (usernameExistsCaseInsensitive(clean) && user.username.toLowerCase() !== clean.toLowerCase()) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    try {
      updateUser(id, { username: clean });
    } catch (err: any) {
      if (String(err?.code ?? err?.message ?? '').includes('UNIQUE')) {
        return res.status(409).json({ error: 'Username already exists' });
      }
      throw err;
    }
  }
  updateUser(id, {
    disabled: disabled !== undefined ? !!disabled : undefined,
    role: role as 'admin' | 'user' | undefined,
    mustChangePassword: mustChangePassword !== undefined ? !!mustChangePassword : undefined,
  });
  const updated = getUserById(id);
  const counts = sessionCountsByUser();
  res.json(updated ? { ...updated, activeSessions: counts.get(id) ?? 0 } : updated);
});

adminRouter.post('/users/:id/revoke-sessions', (req, res) => {
  const id = Number(req.params.id);
  const user = getUserById(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  deleteUserSessions(id);
  res.json({ message: `All sessions for ${user.username} revoked` });
});

adminRouter.post('/users/:id/impersonate', (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  const target = getUserById(id);
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.disabled) return res.status(400).json({ error: 'Cannot impersonate a disabled user' });
  if (target.role === 'admin') return res.status(400).json({ error: 'Only users and moderators can be impersonated' });

  const actor = req.user!;
  const { token } = createImpersonationSession(id, actor.userId);
  res.cookie(IMPERSONATE_COOKIE, token, sessionCookieOptions());
  res.json({
    user: {
      id: target.id,
      username: target.username,
      role: target.role,
      mustChangePassword: false,
      impersonating: true,
      impersonatedBy: actor.username,
      isDemo: !!target.demo,
      displayName: target.displayName,
      avatar: target.avatar,
    },
  });
});

adminRouter.delete('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = getUserById(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (id === (req as AuthenticatedRequest).user!.userId) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }

  const permanent = req.body?.permanent === true;
  if (permanent) {
    if (user.demo) {
      return res.status(400).json({ error: 'The demo user cannot be permanently deleted. Use disable instead.' });
    }
    permanentlyDeleteUser(id);
    return res.json({ message: `User ${user.username} permanently deleted` });
  }
  updateUser(id, { disabled: true });
  res.json({ message: `User ${user.username} disabled` });
});
